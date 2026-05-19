/**
 * JSON 文件存储（记录已处理种子的 hash，防止重复下载）
 * 替代 better-sqlite3，无需 C++ 编译，零依赖
 */

const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, '..', 'data', 'processed.json');

// 确保 data 目录存在
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 加载或初始化数据
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { torrents: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { torrents: {} };
  }
}

// 保存数据到文件
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 检查 hash 是否已处理过且是免费（免费种子永久跳过）
 * 非免费种子会检查是否超过重检窗口期，超过则允许重新检查
 * @param {string} hash
 * @param {number} rescanWindowMs 重检窗口期（毫秒），默认 24 小时
 * @returns {boolean} true=永久跳过，false=可以重新检查
 */
function isHashProcessed(hash, rescanWindowMs = 24 * 60 * 60 * 1000) {
  if (!hash) return false;
  const data = loadData();
  const entry = data.torrents[hash];
  if (!entry) return false;
  // 免费种子永久跳过
  if (entry.isFree === 1) return true;
  // 非免费种子：检查是否超过重检窗口
  const elapsed = Date.now() - entry.lastChecked;
  return elapsed < rescanWindowMs;
}

/**
 * 记录已处理的 hash
 * @param {string} hash
 * @param {boolean} isFree 是否免费
 * @param {string} link 种子详情页链接（用于重检时检测免费状态）
 * @param {string} name 种子名称
 * @param {string} url 种子下载链接（用于重新添加到 qBittorrent）
 */
function markAsProcessed(hash, isFree, link, name, url) {
  if (!hash) return;
  const data = loadData();
  const now = Date.now();
  if (data.torrents[hash]) {
    // 已存在，更新
    data.torrents[hash].isFree = isFree ? 1 : 0;
    data.torrents[hash].lastChecked = now;
    if (link) data.torrents[hash].link = link;
    if (name) data.torrents[hash].name = name;
    if (url) data.torrents[hash].url = url;
  } else {
    // 新建
    data.torrents[hash] = {
      added: now,
      isFree: isFree ? 1 : 0,
      lastChecked: now,
      link: link || '',
      name: name || '',
      url: url || '',
    };
  }
  saveData(data);
}

/**
 * 获取需要重新检查的非免费种子列表
 * @param {number} limit 最多返回数量
 * @param {number} rescanWindowMs 重检窗口期（毫秒），默认 24 小时
 * @returns {Array} [{hash, link, name, url, lastChecked}]
 */
function getSeedsToRescan(limit = 10, rescanWindowMs = 24 * 60 * 60 * 1000) {
  const data = loadData();
  const now = Date.now();
  return Object.entries(data.torrents)
    .filter(([hash, v]) => {
      // 只取非免费的
      if (v.isFree === 1) return false;
      // 跳过窗口期内的
      if (now - v.lastChecked < rescanWindowMs) return false;
      // 需要有 link（详情页）才能重检
      if (!v.link) return false;
      return true;
    })
    .sort((a, b) => a[1].lastChecked - b[1].lastChecked) // 最久未检查的优先
    .slice(0, limit)
    .map(([hash, v]) => ({
      hash,
      link: v.link,
      name: v.name,
      url: v.url,
      lastChecked: v.lastChecked,
    }));
}

/**
 * 获取最近免费种子（统计）
 */
function getRecentFree(limit) {
  if (limit === undefined) limit = 50;
  const data = loadData();
  return Object.entries(data.torrents)
    .map(([hash, v]) => ({
      hash,
      addedAt: new Date(v.added).toISOString(),
      isFree: v.isFree === 1,
    }))
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
    .slice(0, limit);
}

/**
 * 清空所有记录
 */
function clearAll() {
  const data = { torrents: {} };
  saveData(data);
}

/**
 * 清理 30 天前的记录
 */
function cleanOldRecords() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const data = loadData();
  const before = Object.keys(data.torrents).length;
  for (const hash of Object.keys(data.torrents)) {
    if (data.torrents[hash].added < cutoff) {
      delete data.torrents[hash];
    }
  }
  saveData(data);
  return before - Object.keys(data.torrents).length;
}

module.exports = {
  isHashProcessed,
  markAsProcessed,
  getSeedsToRescan,
  getRecentFree,
  cleanOldRecords,
  clearAll,
};
