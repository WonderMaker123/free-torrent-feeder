/**
 * qBittorrent Web API v2 封装
 * 参考 vertex-app/vertex app/libs/client/qb.js
 *
 * 支持 qBittorrent v4 和 v5（API 2.9.3+ 的兼容处理）
 */

const gotImport = require('got');
const got = gotImport.default || gotImport.got || gotImport;
const { JSDOM } = require('jsdom');

// API 版本缓存
const apiVersionCache = {};

/**
 * 通用 HTTP 请求（带 cookie 维持登录状态）
 */
async function request(opts) {
  const res = await got({
    timeout: { request: 30000 },
    ...opts,
  });
  return res;
}

/**
 * 获取缓存的 API 版本
 */
async function getCachedApiVersion(clientUrl, cookie) {
  const cacheKey = clientUrl;
  if (apiVersionCache[cacheKey]) {
    return apiVersionCache[cacheKey];
  }
  const version = await getApiVersion(clientUrl, cookie);
  apiVersionCache[cacheKey] = version;
  return version;
}

/**
 * 比较 API 版本
 */
function isVersionGreaterThan(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return true;
    if (p1 < p2) return false;
  }
  return false;
}

/**
 * 登录 qBittorrent，返回 cookie
 */
async function login(username, clientUrl, password) {
  const res = await got.post(`${clientUrl}/api/v2/auth/login`, {
    form: { username, password },
    timeout: { request: 15000 },
  });

  if (res.body.includes('Ok')) {
    // 清除 API 版本缓存（重新登录后版本可能变化）
    delete apiVersionCache[clientUrl];
    const cookie = res.headers['set-cookie'][0];
    return cookie.substring(0, cookie.indexOf(';'));
  }
  if (res.body.includes('Fails')) {
    throw new Error('qBittorrent 密码错误');
  }
  throw new Error(`qBittorrent 登录失败，状态码: ${res.statusCode}`);
}

/**
 * 获取 API 版本
 */
async function getApiVersion(clientUrl, cookie) {
  const res = await got.get(`${clientUrl}/api/v2/app/webapiVersion`, {
    headers: { cookie },
    timeout: { request: 10000 },
  });
  return res.body.trim();
}

/**
 * 通过 URL 添加种子（核心方法）
 */
async function addTorrent(
  torrentUrl,
  skipHashCheck = true,
  uploadLimit = 0,
  downloadLimit = 0,
  savePath = '',
  category = '',
  autoTMM = false,
  firstLastPiecePrio = false,
  paused = false
) {
  // 若未传入 cookie，从模块级获取（由 login() 设置）
  const cookie = module.exports._cookie;
  if (!cookie) throw new Error('请先调用 qb.login() 登录');

  // 检测 API 版本，决定暂停参数名（v5 新增 /start /stop，废弃 /pause /resume）
  const apiVersion = await getCachedApiVersion(module.exports._clientUrl, cookie);
  const pausedParam = isVersionGreaterThan(apiVersion, '2.9.3') ? 'stopped' : 'paused';

  const formData = {
    urls: torrentUrl,
    skip_checking: skipHashCheck ? 'true' : 'false',
    upLimit: String(uploadLimit),
    dlLimit: String(downloadLimit),
    firstLastPiecePrio: firstLastPiecePrio ? 'true' : 'false',
    [pausedParam]: paused ? 'true' : 'false',
  };

  if (savePath) formData.savepath = savePath;
  if (category) formData.category = category;
  if (autoTMM) formData.autoTMM = 'true';

  const res = await got.post(`${module.exports._clientUrl}/api/v2/torrents/add`, {
    headers: { cookie },
    form: formData,
    timeout: { request: 30000 },
  });

  if (res.body === 'Ok.') return;
  // qB 返回种子已存在的提示不算错误
  if (res.body.includes('Fails.') && res.body.includes('already exist')) return;
  throw new Error(`qBittorrent 添加种子失败: ${res.body}`);
}

/**
 * 暂停种子
 */
async function pauseTorrent(hash, cookie, clientUrl) {
  const apiVersion = await getCachedApiVersion(clientUrl, cookie);
  const endpoint = isVersionGreaterThan(apiVersion, '2.9.3')
    ? '/api/v2/torrents/stop'
    : '/api/v2/torrents/pause';

  await got.post(`${clientUrl}${endpoint}`, {
    headers: { cookie },
    form: { hashes: hash },
  });
}

/**
 * 删除种子文件
 */
async function deleteTorrent(hash, cookie, clientUrl, deleteFiles = false) {
  await pauseTorrent(hash, cookie, clientUrl);
  await got.post(`${clientUrl}/api/v2/torrents/delete`, {
    headers: { cookie },
    form: { hashes: hash, deleteFiles: deleteFiles ? 'true' : 'false' },
  });
}

/**
 * 获取所有种子列表
 */
async function getTorrents(cookie, clientUrl) {
  const res = await got.get(`${clientUrl}/api/v2/torrents/info`, {
    headers: { cookie },
    searchParams: { sort: 'added_on', reverse: 'true' },
    timeout: { request: 15000 },
  });
  return JSON.parse(res.body);
}

/**
 * 获取服务器状态（剩余空间等）
 */
async function getMaindata(cookie, clientUrl) {
  const res = await got.get(`${clientUrl}/api/v2/sync/maindata`, {
    headers: { cookie },
    timeout: { request: 15000 },
  });
  return JSON.parse(res.body);
}

module.exports = {
  login,
  addTorrent,
  pauseTorrent,
  deleteTorrent,
  getTorrents,
  getMaindata,
  isVersionGreaterThan,
  // 以下为内部状态（由 index.js 在 login 成功后注入）
  _cookie: null,
  _clientUrl: null,
};
