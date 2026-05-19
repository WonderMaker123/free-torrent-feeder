const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

let CONFIG = require('./config');

// 确保重检配置有默认值
CONFIG.APP.RESCAN_INTERVAL_MS = CONFIG.APP.RESCAN_INTERVAL_MS || 10 * 60 * 1000;
CONFIG.APP.RESCAN_WINDOW_HOURS = CONFIG.APP.RESCAN_WINDOW_HOURS || 24;
CONFIG.APP.RESCAN_MAX_PER_CYCLE = CONFIG.APP.RESCAN_MAX_PER_CYCLE || 10;
const qbClient = require('./libs/qb');
const rssParser = require('./libs/rss');
const scrape = require('./libs/scrape');
const Database = require('./libs/db');
const logger = require('./libs/logger');

const app = express();
const bus = new EventEmitter();
const PORT = process.env.PORT || 3000;

global.bus = bus;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'free-torrent-feeder-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.get('/', (req, res) => {
  if (!req.session.authenticated) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => {
  if (!req.session.authenticated) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: '未登录' });
}

let qbCookie = '';
let cycleRunning = false;
let cycleTimer = null;
let rescanTimer = null;
let lastCycleTime = null;
let nextCycleTime = null;
const rssState = new Map();
const loginAttempts = new Map();

function appUsername() {
  return CONFIG.APP.USERNAME || 'admin';
}

function appPassword() {
  return CONFIG.APP.PASSWORD || 'admin123';
}

function normalizeLevel(level) {
  return String(level || 'info').toLowerCase();
}

function emitLog(level, message) {
  const entry = { time: new Date().toISOString(), level: normalizeLevel(level), message };
  logger._emit(entry);
  bus.emit('log', entry);
}

function errorMessage(error) {
  return error?.message || error?.code || error?.cause?.message || String(error || '未知错误');
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function torrentKey(torrent) {
  if (torrent.hash) return String(torrent.hash);
  if (torrent.id) return `id:${torrent.id}`;
  const source = torrent.url || torrent.link || torrent.name || JSON.stringify(torrent);
  return `sha1:${crypto.createHash('sha1').update(source).digest('hex')}`;
}

function checkLoginLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, first: now };
  if (now - record.first > 5 * 60 * 1000) {
    loginAttempts.set(ip, { count: 0, first: now });
    return false;
  }
  return record.count >= 8;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, first: now };
  if (now - record.first > 5 * 60 * 1000) {
    loginAttempts.set(ip, { count: 1, first: now });
  } else {
    record.count += 1;
    loginAttempts.set(ip, record);
  }
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = n;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function publicTorrent(torrent) {
  return {
    id: torrent.id || '',
    name: torrent.name || '',
    size: torrent.size || 0,
    sizeText: formatSize(torrent.size),
    hash: torrentKey(torrent),
    url: torrent.url || '',
    link: torrent.link || '',
    pubTime: torrent.pubTime || 0,
    description: torrent.description || '',
    isFree: torrent.isFree ?? null,
    processed: !!torrent.processed,
    added: !!torrent.added,
    error: torrent.error || '',
  };
}

function ensureFeedState(feed) {
  const key = feed.name || feed.url;
  if (!rssState.has(key)) {
    rssState.set(key, {
      name: feed.name || '未命名 RSS',
      url: feed.url,
      status: 'idle',
      lastFetched: null,
      lastError: '',
      total: 0,
      freeCount: 0,
      addedCount: 0,
      items: [],
    });
  }
  return rssState.get(key);
}

function getAllRssState() {
  for (const feed of CONFIG.RSS_FEEDS || []) ensureFeedState(feed);
  const activeKeys = new Set((CONFIG.RSS_FEEDS || []).map(feed => feed.name || feed.url));
  for (const key of rssState.keys()) {
    if (!activeKeys.has(key)) rssState.delete(key);
  }
  return Array.from(rssState.values()).map(state => ({ ...state, items: state.items.slice(0, 100) }));
}

function broadcastRssState() {
  bus.emit('rss', getAllRssState());
}

async function processRssFeed(feed) {
  const state = ensureFeedState(feed);
  const name = feed.name || '未命名 RSS';
  state.status = 'fetching';
  state.lastError = '';
  state.lastFetched = new Date().toISOString();
  broadcastRssState();
  emitLog('info', `[${name}] 正在抓取 RSS`);

  let torrents = [];
  try {
    torrents = await rssParser.getTorrents(feed.url, feed.cookie || '');
  } catch (e) {
    state.status = 'error';
    state.lastError = errorMessage(e);
    broadcastRssState();
    emitLog('error', `[${name}] RSS 抓取失败: ${errorMessage(e)}`);
    return;
  }

  state.items = torrents.map(publicTorrent);
  state.total = state.items.length;
  state.freeCount = 0;
  state.addedCount = 0;
  state.status = torrents.length ? 'checking' : 'idle';
  broadcastRssState();

  if (!torrents.length) {
    emitLog('info', `[${name}] 未发现种子`);
    return;
  }

  emitLog('info', `[${name}] 发现 ${torrents.length} 个种子，开始检测免费状态`);

  for (const torrent of torrents) {
    const key = torrentKey(torrent);
    const item = state.items.find(x => x.hash === key || (x.url && x.url === torrent.url));

    let isFree = false;
    try {
      isFree = await scrape.free(torrent.link || torrent.url, feed.cookie || '');
    } catch (e) {
      if (item) item.error = errorMessage(e);
      emitLog('warn', `[${name}] 免费检测异常 [${torrent.name}]: ${errorMessage(e)}`);
      broadcastRssState();
      continue;
    }

    if (item) item.isFree = isFree;
    if (!isFree) {
      // 非免费，跳过（不记录，避免污染记录）
      continue;
    }

    state.freeCount += 1;
    emitLog('success', `[${name}] 发现免费种子: ${torrent.name} (${formatSize(torrent.size)})`);

    try {
      await qbClient.addTorrent(
        torrent.url,
        CONFIG.QBITORRENT.SKIP_HASH_CHECK,
        CONFIG.QBITORRENT.UPLOAD_LIMIT,
        CONFIG.QBITORRENT.DOWNLOAD_LIMIT,
        CONFIG.QBITORRENT.SAVE_PATH,
        CONFIG.QBITORRENT.CATEGORY,
        CONFIG.QBITORRENT.AUTO_TMM,
        CONFIG.QBITORRENT.FIRST_LAST_PIECE_PRIO,
        CONFIG.QBITORRENT.PAUSED
      );
      state.addedCount += 1;
      if (item) {
        item.added = true;
        item.processed = true;
      }
      emitLog('success', `[${name}] 已添加: ${torrent.name}`);
    } catch (e) {
      if (item) item.error = errorMessage(e);
      emitLog('error', `[${name}] 添加失败 [${torrent.name}]: ${errorMessage(e)}`);
      // 添加失败，不记录，下次 RSS 仍会检测
    }
    broadcastRssState();
  }

  state.status = 'idle';
  state.lastFetched = new Date().toISOString();
  broadcastRssState();
  emitLog('info', `[${name}] 本次检查完成，免费 ${state.freeCount} 个，添加 ${state.addedCount} 个`);
}

async function runCycle() {
  if (cycleRunning) {
    emitLog('warn', '抓取周期正在运行，已跳过本次触发');
    return;
  }
  cycleRunning = true;
  lastCycleTime = new Date().toISOString();
  bus.emit('status');
  emitLog('info', '========== 开始抓取周期 ==========');

  try {
    const feeds = CONFIG.RSS_FEEDS || [];
    for (const feed of feeds) {
      await processRssFeed(feed);
      await sleep(CONFIG.APP.SITE_DELAY_MS || 3000);
    }
    emitLog('info', '========== 抓取周期结束 ==========');

    // 重检近期非免费种子（是否有变成免费的）
    await rescanNonFreeSeeds();
  } catch (e) {
    emitLog('error', `抓取周期异常: ${errorMessage(e)}`);
  } finally {
    cycleRunning = false;
    lastCycleTime = new Date().toISOString();
    const interval = CONFIG.APP.INTERVAL_MS || 5 * 60 * 1000;
    nextCycleTime = new Date(Date.now() + interval).toISOString();
    bus.emit('status');
  }
}

/**
 * 独立重检周期（不受 RSS 抓取影响）
 */
async function runRescanCycle() {
  if (cycleRunning) {
    // 如果 RSS 抓取正在运行，跳过本次重检
    return;
  }
  emitLog('info', '========== 定时重检开始 ==========');
  try {
    await rescanNonFreeSeeds();
  } catch (e) {
    emitLog('error', `重检周期异常: ${errorMessage(e)}`);
  }
  emitLog('info', '========== 定时重检结束 ==========');
}

/**
 * 重检近期非免费种子，看是否已变免费
 */
async function rescanNonFreeSeeds() {
  const maxPerCycle = CONFIG.APP.RESCAN_MAX_PER_CYCLE || 10;
  const windowMs = (CONFIG.APP.RESCAN_WINDOW_HOURS || 24) * 60 * 60 * 1000;

  const seeds = Database.getSeedsToRescan(maxPerCycle, windowMs);
  if (!seeds.length) return;

  emitLog('info', `========== 重检 ${seeds.length} 个近期非免费种子 ==========`);

  for (const seed of seeds) {
    // 找出这个 seed 属于哪个 RSS 源（通过 link 的 host 匹配）
    const feed = (CONFIG.RSS_FEEDS || []).find(f => {
      try {
        return new URL(seed.link).host === new URL(f.url).host;
      } catch { return false; }
    });
    if (!feed) {
      emitLog('warn', `[重检] 未找到对应 RSS 源，跳过: ${seed.name}`);
      continue;
    }

    let isFree = false;
    try {
      isFree = await scrape.free(seed.link, feed.cookie || '');
    } catch (e) {
      emitLog('warn', `重检失败 [${seed.name}]: ${errorMessage(e)}`);
      // 更新检查时间，避免每次都重试失败的
      Database.markAsProcessed(seed.hash, false, seed.link, seed.name, seed.url);
      continue;
    }

    if (!isFree) {
      // 更新检查时间
      Database.markAsProcessed(seed.hash, false, seed.link, seed.name, seed.url);
      continue;
    }

    // 变免费了！立刻添加
    emitLog('success', `[重检] ★ 种子变免费: ${seed.name}`);
    try {
      // 优先用 enclosure url（下载链接），fallback 到详情页（qB 可自动处理）
      const torrentUrl = seed.url || seed.link;
      await qbClient.addTorrent(
        torrentUrl,
        CONFIG.QBITORRENT.SKIP_HASH_CHECK,
        CONFIG.QBITORRENT.UPLOAD_LIMIT,
        CONFIG.QBITORRENT.DOWNLOAD_LIMIT,
        CONFIG.QBITORRENT.SAVE_PATH,
        CONFIG.QBITORRENT.CATEGORY,
        CONFIG.QBITORRENT.AUTO_TMM,
        CONFIG.QBITORRENT.FIRST_LAST_PIECE_PRIO,
        CONFIG.QBITORRENT.PAUSED
      );
      Database.markAsProcessed(seed.hash, true, seed.link, seed.name, seed.url);
      emitLog('success', `[重检] 已添加: ${seed.name}`);
    } catch (e) {
      emitLog('error', `[重检] 添加失败 [${seed.name}]: ${errorMessage(e)}`);
    }

    await sleep(CONFIG.APP.SITE_DELAY_MS || 3000);
  }

  emitLog('info', '========== 重检完成 ==========');
}

function startScheduler() {
  if (cycleTimer) clearInterval(cycleTimer);
  const interval = Number(CONFIG.APP.INTERVAL_MS) || 5 * 60 * 1000;
  cycleTimer = setInterval(runCycle, interval);
  nextCycleTime = new Date(Date.now() + interval).toISOString();
  bus.emit('status');
}

function startRescanScheduler() {
  if (rescanTimer) clearInterval(rescanTimer);
  const interval = Number(CONFIG.APP.RESCAN_INTERVAL_MS) || 10 * 60 * 1000;
  rescanTimer = setInterval(runRescanCycle, interval);
  emitLog('info', `重检定时器已启动，间隔 ${Math.round(interval / 60000)} 分钟`);
}

function serializeConfig() {
  return `module.exports = ${JSON.stringify(CONFIG, null, 2)};\n`;
}

function saveConfig() {
  fs.writeFileSync(path.join(__dirname, 'config.js'), serializeConfig(), 'utf8');
}

function mergeConfig(newConfig) {
  if (newConfig.QBITORRENT) {
    const qb = { ...newConfig.QBITORRENT };
    if (!qb.PASSWORD || qb.PASSWORD === '********') delete qb.PASSWORD;
    if (qb.URL && !isValidHttpUrl(qb.URL)) badRequest('qBittorrent 地址必须是 http/https URL');
    const reconnectFields = ['URL', 'USERNAME', 'PASSWORD'];
    const needsReconnect = reconnectFields.some(key => Object.prototype.hasOwnProperty.call(qb, key) && qb[key] !== CONFIG.QBITORRENT[key]);
    Object.assign(CONFIG.QBITORRENT, qb);
    qbClient._clientUrl = CONFIG.QBITORRENT.URL;
    if (needsReconnect) {
      qbCookie = '';
      qbClient._cookie = null;
    }
  }
  if (newConfig.APP) {
    const appConfig = { ...newConfig.APP };
    if (!appConfig.PASSWORD || appConfig.PASSWORD === '********') delete appConfig.PASSWORD;
    if (!appConfig.USERNAME) delete appConfig.USERNAME;
    if (appConfig.INTERVAL_MS !== undefined && Number(appConfig.INTERVAL_MS) < 60000) {
      badRequest('抓取间隔不能小于 1 分钟');
    }
    if (appConfig.SITE_DELAY_MS !== undefined && Number(appConfig.SITE_DELAY_MS) < 0) {
      badRequest('站点请求间隔不能小于 0');
    }
    if (appConfig.RESCAN_INTERVAL_MS !== undefined) {
      const ri = Number(appConfig.RESCAN_INTERVAL_MS);
      if (ri < 60000) badRequest('重检间隔不能小于 1 分钟');
      CONFIG.APP.RESCAN_INTERVAL_MS = ri;
      startRescanScheduler();
    }
    if (appConfig.RESCAN_WINDOW_HOURS !== undefined) {
      CONFIG.APP.RESCAN_WINDOW_HOURS = Number(appConfig.RESCAN_WINDOW_HOURS);
    }
    if (appConfig.RESCAN_MAX_PER_CYCLE !== undefined) {
      CONFIG.APP.RESCAN_MAX_PER_CYCLE = Number(appConfig.RESCAN_MAX_PER_CYCLE);
    }
    Object.assign(CONFIG.APP, appConfig);
    startScheduler();
  }
  if (Array.isArray(newConfig.RSS_FEEDS)) {
    const names = new Set();
    CONFIG.RSS_FEEDS = newConfig.RSS_FEEDS.map(feed => ({
      name: String(feed.name || '').trim(),
      url: String(feed.url || '').trim(),
      cookie: String(feed.cookie || ''),
    })).filter(feed => feed.name && feed.url).map(feed => {
      if (names.has(feed.name)) badRequest(`RSS 名称重复: ${feed.name}`);
      if (!isValidHttpUrl(feed.url)) badRequest(`RSS URL 无效: ${feed.name}`);
      names.add(feed.name);
      return feed;
    });
    broadcastRssState();
  }
}

app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'init', logs: logger.getRecent(200), rss: getAllRssState() })}\n\n`);

  const logHandler = entry => res.write(`data: ${JSON.stringify({ type: 'log', entry })}\n\n`);
  const statusHandler = () => res.write(`data: ${JSON.stringify({ type: 'status' })}\n\n`);
  const rssHandler = rss => res.write(`data: ${JSON.stringify({ type: 'rss', rss })}\n\n`);
  bus.on('log', logHandler);
  bus.on('status', statusHandler);
  bus.on('rss', rssHandler);
  req.on('close', () => {
    bus.off('log', logHandler);
    bus.off('status', statusHandler);
    bus.off('rss', rssHandler);
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (checkLoginLimit(ip)) {
    return res.status(429).json({ error: '登录失败次数过多，请 5 分钟后再试' });
  }
  if ((username || '').trim() === appUsername() && password === appPassword()) {
    req.session.authenticated = true;
    req.session.username = appUsername();
    loginAttempts.delete(ip);
    return res.json({ ok: true });
  }
  recordLoginFailure(ip);
  return res.status(401).json({ error: '账号或密码错误' });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ authenticated: true, username: req.session.username || appUsername() });
});

app.get('/api/status', requireAuth, (req, res) => {
  const interval = Number(CONFIG.APP.INTERVAL_MS) || 5 * 60 * 1000;
  res.json({
    cycleRunning,
    lastCycleTime,
    nextCycleTime: nextCycleTime || new Date(Date.now() + interval).toISOString(),
    intervalMs: interval,
    intervalMin: Math.round(interval / 60000),
    feedCount: (CONFIG.RSS_FEEDS || []).length,
    qbUrl: CONFIG.QBITORRENT.URL,
    qbConnected: !!qbCookie,
  });
});

app.post('/api/cycle/run', requireAuth, (req, res) => {
  if (cycleRunning) return res.status(409).json({ error: '抓取周期正在运行中' });
  runCycle().catch(e => emitLog('error', `周期异常: ${errorMessage(e)}`));
  res.json({ ok: true, message: '抓取周期已启动' });
});

app.get('/api/logs', requireAuth, (req, res) => {
  res.json({ logs: logger.getRecent(Number(req.query.n) || 200) });
});

app.post('/api/logs/clear', requireAuth, (req, res) => {
  logger.clear();
  res.json({ ok: true });
});

app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    QBITORRENT: {
      ...CONFIG.QBITORRENT,
      PASSWORD: '********',
    },
    RSS_FEEDS: CONFIG.RSS_FEEDS || [],
    APP: {
      ...CONFIG.APP,
      USERNAME: appUsername(),
      PASSWORD: '********',
    },
  });
});

app.put('/api/config', requireAuth, (req, res) => {
  try {
    mergeConfig(req.body || {});
    saveConfig();
    emitLog('info', '配置已保存并应用');
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: errorMessage(e) });
  }
});

app.post('/api/feeds', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const url = String(req.body.url || '').trim();
  const cookie = String(req.body.cookie || '');
  if (!name || !url) return res.status(400).json({ error: '名称和 URL 必填' });
  if (!isValidHttpUrl(url)) return res.status(400).json({ error: 'RSS URL 无效' });
  if ((CONFIG.RSS_FEEDS || []).some(feed => feed.name === name)) {
    return res.status(409).json({ error: 'RSS 名称已存在' });
  }
  CONFIG.RSS_FEEDS = CONFIG.RSS_FEEDS || [];
  CONFIG.RSS_FEEDS.push({ name, url, cookie });
  ensureFeedState({ name, url });
  saveConfig();
  broadcastRssState();
  emitLog('info', `RSS 源已添加: ${name}`);
  res.json({ ok: true });
});

app.delete('/api/feeds/:name', requireAuth, (req, res) => {
  const idx = (CONFIG.RSS_FEEDS || []).findIndex(feed => feed.name === req.params.name);
  if (idx === -1) return res.status(404).json({ error: 'RSS 源不存在' });
  const [removed] = CONFIG.RSS_FEEDS.splice(idx, 1);
  rssState.delete(removed.name || removed.url);
  saveConfig();
  broadcastRssState();
  emitLog('info', `RSS 源已删除: ${removed.name}`);
  res.json({ ok: true });
});

app.get('/api/rss/current', requireAuth, (req, res) => {
  res.json({ feeds: getAllRssState() });
});

app.post('/api/qb/test', requireAuth, async (req, res) => {
  try {
    const cookie = await qbClient.login(
      CONFIG.QBITORRENT.USERNAME,
      CONFIG.QBITORRENT.URL,
      CONFIG.QBITORRENT.PASSWORD
    );
    qbCookie = cookie;
    qbClient._cookie = cookie;
    qbClient._clientUrl = CONFIG.QBITORRENT.URL;
    emitLog('success', 'qBittorrent 连接测试成功');
    res.json({ ok: true });
  } catch (e) {
    qbCookie = '';
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/stats', requireAuth, (req, res) => {
  res.json({ recent: Database.getRecentFree(100) });
});

app.post('/api/stats/clear', requireAuth, (req, res) => {
  Database.clearAll();
  res.json({ ok: true });
});

async function main() {
  emitLog('info', '========== 免费种子监控程序启动 ==========');
  emitLog('info', `qBittorrent 地址: ${CONFIG.QBITORRENT.URL}`);
  emitLog('info', `监控 RSS 源: ${(CONFIG.RSS_FEEDS || []).length} 个`);

  try {
    qbCookie = await qbClient.login(
      CONFIG.QBITORRENT.USERNAME,
      CONFIG.QBITORRENT.URL,
      CONFIG.QBITORRENT.PASSWORD
    );
    qbClient._cookie = qbCookie;
    qbClient._clientUrl = CONFIG.QBITORRENT.URL;
    emitLog('success', 'qBittorrent 登录成功');
  } catch (e) {
    emitLog('error', `qBittorrent 登录失败: ${errorMessage(e)}，程序会继续运行`);
  }

  startScheduler();
  startRescanScheduler();
  setTimeout(() => {
    emitLog('info', '首次抓取将在后台进行');
    runCycle().catch(e => emitLog('error', `首次抓取异常: ${errorMessage(e)}`));
  }, 10000);

  app.listen(PORT, () => {
    emitLog('info', `Web UI 已启动: http://localhost:${PORT}`);
    emitLog('info', `默认账号: ${appUsername()} / 默认密码: ${appPassword()}`);
  });
}

main().catch(e => {
  console.error('启动失败:', e);
  process.exit(1);
});
