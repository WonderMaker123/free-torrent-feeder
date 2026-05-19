/**
 * 免费种子自动下载程序
 * 基于 vertex-app/vertex 的 RSS 抓取与免费检测逻辑重构
 *
 * 依赖安装：npm install xml2js jsdom got better-sqlite3 node-cron
 */

const CONFIG = require('./config');
const qbClient = require('./libs/qb');
const rssParser = require('./libs/rss');
const scrape = require('./libs/scrape');
const Database = require('./libs/db');
const logger = require('./libs/logger');

// ============================================================
// 核心逻辑
// ============================================================

/**
 * 处理单个 RSS 源
 */
async function processRssFeed(feed) {
  const { name, url, cookie } = feed;
  logger.info(`[${name}] 正在抓取 RSS...`);

  let torrents;
  try {
    torrents = await rssParser.getTorrents(url);
  } catch (e) {
    logger.error(`[${name}] RSS 抓取失败:`, e.message);
    return;
  }

  if (!torrents.length) {
    logger.info(`[${name}] 未发现新种子`);
    return;
  }

  logger.info(`[${name}] 发现 ${torrents.length} 个种子，开始过滤免费...`);

  for (const torrent of torrents) {
    // 检查是否已处理（数据库去重）
    if (Database.isHashProcessed(torrent.hash)) {
      continue;
    }

    // 抓取免费状态
    let isFree = false;
    try {
      isFree = await scrape.free(torrent.link, cookie);
    } catch (e) {
      logger.warn(`[${name}] 免费检测异常 [${torrent.name}]: ${e.message}`);
      // 异常时默认不下载，避免误下非免费种
      continue;
    }

    if (!isFree) {
      logger.info(`[${name}] 非免费，跳过: ${torrent.name}`);
      Database.markAsProcessed(torrent.hash, false);
      continue;
    }

    // 免费种子 → 添加到 qBittorrent
    logger.info(`[${name}] ★ 发现免费种子: ${torrent.name} (${formatSize(torrent.size)})`);

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
      Database.markAsProcessed(torrent.hash, true);
      logger.info(`[${name}] ✓ 已添加到 qBittorrent: ${torrent.name}`);
    } catch (e) {
      logger.error(`[${name}] 添加种子失败 [${torrent.name}]: ${e.message}`);
      Database.markAsProcessed(torrent.hash, false);
    }
  }
}

/**
 * 主循环：处理所有 RSS 源
 */
async function runCycle() {
  logger.info('========== 开始抓取周期 ==========');
  const feeds = CONFIG.RSS_FEEDS;

  for (const feed of feeds) {
    await processRssFeed(feed);
    // 每个源间隔 3 秒，避免请求过快被封
    await sleep(3000);
  }

  logger.info('========== 抓取周期结束 ==========');
}

// ============================================================
// 工具函数
// ============================================================

function formatSize(bytes) {
  if (!bytes) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 启动
// ============================================================

async function main() {
  logger.info('免费种子自动下载程序启动');
  logger.info(`监控站点数: ${CONFIG.RSS_FEEDS.length}`);
  logger.info(`qBittorrent 地址: ${CONFIG.QBITORRENT.URL}`);

  // 初始化 qBittorrent 登录
  try {
    const cookie = await qbClient.login(
      CONFIG.QBITORRENT.USERNAME,
      CONFIG.QBITORRENT.URL,
      CONFIG.QBITORRENT.PASSWORD
    );
    // 将 cookie 和地址注入 qb 模块（后续 addTorrent 依赖这些）
    qbClient._cookie = cookie;
    qbClient._clientUrl = CONFIG.QBITORRENT.URL;
    logger.info('qBittorrent 登录成功');
  } catch (e) {
    logger.error('qBittorrent 登录失败:', e.message);
    process.exit(1);
  }

  // 立即执行一次
  await runCycle();

  // 每 5 分钟定时执行
  setInterval(runCycle, 5 * 60 * 1000);
}

main().catch(e => {
  logger.error('程序异常退出:', e);
  process.exit(1);
});
