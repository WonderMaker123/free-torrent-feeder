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
 * 检查 hash 是否已处理过
 */
function isHashProcessed(hash) {
  if (!hash) return false;
  const data = loadData();
  return !!data.torrents[hash];
}

/**
 * 记录已处理的 hash
 */
function markAsProcessed(hash, isFree) {
  if (!hash) return;
  const data = loadData();
  data.torrents[hash] = {
    added: Date.now(),
    isFree: isFree ? 1 : 0,
  };
  saveData(data);
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
  getRecentFree,
  cleanOldRecords,
};
