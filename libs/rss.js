/**
 * RSS Feed 解析器
 * 参考 vertex-app/vertex app/libs/rss.js
 *
 * 支持站点类型：
 *   - NexusPHP 通用（大多数国内站：HDHome/HDSky/OurBits/CHDBits/LemonHD/PTHome/U2.dmhy 等）
 *   - M-Team 专用
 *   - Gazelle 系（需 bencode 解析获取 hash）
 *   - Luminance 系
 *   - AvistaZ 系
 *   - Unit3D 系
 *   - BeyondHD
 *   - HDBits
 *   - TorrentLeech
 *   - 等等
 */

const { JSDOM } = require('jsdom');
const { parseStringPromise } = require('xml2js');
const gotImport = require('got');
const got = gotImport.default || gotImport.got || gotImport;
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
let bencodeModule = null;

async function getBencode() {
  if (!bencodeModule) {
    bencodeModule = await import('bencode');
  }
  return bencodeModule.default || bencodeModule;
}

// ============================================================
// RSS 内容获取（带简单内存缓存）
// ============================================================

const rssCache = new Map();
const CACHE_TTL = 45000; // 45 秒缓存

async function fetchRssContent(rssUrl, host) {
  const now = Date.now();
  const cached = rssCache.get(rssUrl);
  if (cached && now - cached.ts < CACHE_TTL) {
    return cached.body;
  }

  // 添加随机参数防缓存
  let url = rssUrl;
  if (!url.includes('m-team')) {
    url += (url.includes('?') ? '&' : '?') + '___=' + Math.random();
  }

  const res = await got.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    timeout: { request: 30000 },
  });

  rssCache.set(rssUrl, { body: res.body, ts: now });
  return res.body;
}

// ============================================================
// XML 解析
// ============================================================

function parseXml(xml) {
  return parseStringPromise(xml, {
    explicitArray: true,
    ignoreAttrs: false,
  });
}

// ============================================================
// Bencode 解析（从 .torrent 文件获取 hash 和 size）
// ============================================================

async function getTorrentByBencode(url, cookie, clientUrl) {
  const bencode = await getBencode();
  const res = await got.get(url, {
    headers: {
      cookie,
      'User-Agent': 'Mozilla/5.0',
    },
    encoding: null,
    timeout: { request: 20000 },
  });

  const contentType = res.headers['content-type'] || '';
  if (!contentType.includes('bittorrent') && !url.endsWith('.torrent')) {
    return { exists: false, hash: '', size: 0, name: '' };
  }

  const buffer = Buffer.from(res.rawBody);
  const torrent = bencode.decode(buffer);

  // 计算总大小
  const size = torrent.info.length
    || (torrent.info.files
      ? torrent.info.files.map(f => f.length).reduce((a, b) => a + b, 0)
      : 0);

  // 计算 info hash：SHA1(bencode(info)) → MD5 → hex
  const sha1 = crypto.createHash('sha1');
  sha1.update(bencode.encode(torrent.info));
  const md5 = crypto.createHash('md5').update(sha1.digest()).digest('hex');

  return {
    exists: true,
    hash: md5,
    size,
    name: Buffer.isBuffer(torrent.info.name)
      ? torrent.info.name.toString('utf8')
      : torrent.info.name,
  };
}

// ============================================================
// 通用 NexusPHP RSS 解析
// 大多数国内站（HDHome/HDSky/OurBits/CHDBits/LemonHD/PTHome 等）
// ============================================================

async function parseNexusPHP(rssUrl) {
  const body = await fetchRssContent(rssUrl);
  const rss = await parseXml(body);
  const items = rss?.rss?.channel?.[0]?.item || [];
  if (!items.length) return [];

  return items.map(item => {
    const enclosure = item.enclosure?.[0]?.$ || {};
    const link = item.link?.[0] || '';
    // 从 link 中提取 id，例如：https://hdhome.org/details.php?id=12345
    const idMatch = link.match(/[?&]id=(\d+)/);
    const id = idMatch ? idMatch[1] : '';

    // guid 有时候是 hash，有时候是 id
    const guid = item.guid?.[0];
    const hash = typeof guid === 'object' ? guid._ || guid : guid || '';

    return {
      id,
      name: item.title?.[0] || '',
      size: parseInt(enclosure.length) || 0,
      url: enclosure.url || item.link?.[0] || '',
      link,
      hash,
      pubTime: item.pubDate?.[0]
        ? Math.floor(new Date(item.pubDate[0]).getTime() / 1000)
        : 0,
      description: item.description?.[0] || '',
    };
  });
}

// ============================================================
// M-Team 专用解析
// ============================================================

async function parseMTeam(rssUrl) {
  const body = await fetchRssContent(rssUrl);
  const rss = await parseXml(body);
  const items = rss?.rss?.channel?.[0]?.item || [];
  if (!items.length) return [];

  return items.map(item => {
    const link = item.link?.[0] || '';
    // M-Team RSS 格式：/download.php/?id=xxx&passkey=xxx
    const idMatch = link.match(/[?&]id=(\d+)/);
    const id = idMatch ? idMatch[1] : '';

    return {
      id,
      name: item.title?.[0] || '',
      size: parseInt(item['media:content']?.[0]?.$.fileSize) || 0,
      url: item.link?.[0] || '',
      link,
      hash: item.guid?.[0] || id,
      pubTime: item.pubDate?.[0]
        ? Math.floor(new Date(item.pubDate[0]).getTime() / 1000)
        : 0,
      description: item.description?.[0] || '',
    };
  });
}

// ============================================================
// Gazelle 系解析（uhdbits/jpopsuki/dicmusic/greatposterwall 等）
// 需要下载 .torrent 解析 hash
// ============================================================

async function parseGazelle(rssUrl, cookie, clientUrl) {
  const body = await fetchRssContent(rssUrl);
  const rss = await parseXml(body);
  const items = rss?.rss?.channel?.[0]?.item || [];
  if (!items.length) return [];

  const results = [];
  for (const item of items) {
    const link = item.link?.[0] || '';
    const idMatch = link.match(/id=(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    // Gazelle 下载链接格式：/torrents.php?action=download&id=xxx
    const downloadLink = `${new URL(rssUrl).origin}/torrents.php?action=download&id=${id}`;

    const result = await getTorrentByBencode(downloadLink, cookie, clientUrl);

    results.push({
      id,
      name: item.title?.[0] || '',
      size: result.size || 0,
      url: downloadLink,
      link: item.comments?.[0] || link,
      hash: result.hash || id,
      pubTime: item.pubDate?.[0]
        ? Math.floor(new Date(item.pubDate[0]).getTime() / 1000)
        : 0,
    });
  }
  return results;
}

// ============================================================
// BeyondHD 解析（从 guid 提取 hash）
// ============================================================

async function parseBeyondHD(rssUrl) {
  const body = await fetchRssContent(rssUrl);
  const rss = await parseXml(body);
  const items = rss?.rss?.channel?.[0]?.item || [];
  if (!items.length) return [];

  return items.map(item => {
    const title = item.title?.[0] || '';
    // BeyondHD title 格式："Movie.Name 2024 1080p Bluray 1.23 GiB"
    const sizeMatch = title.match(/(\d+\.?\d*)\s*(GiB|MiB|TiB)/i);
    let size = 0;
    if (sizeMatch) {
      const units = { GiB: 1024 ** 3, MiB: 1024 ** 2, TiB: 1024 ** 4 };
      size = parseFloat(sizeMatch[1]) * (units[sizeMatch[2]] || 0);
    }

    const link = item.guid?.[0] || item.link?.[0] || '';
    const idMatch = link.match(/\.(\d+)/);
    const id = idMatch ? idMatch[1] : '';

    return {
      id,
      name: title.split('\n')[0] || '',
      size,
      url: item.link?.[0] || '',
      link,
      hash: 'fake' + id + 'hash',
      pubTime: item.pubDate?.[0]
        ? Math.floor(new Date(item.pubDate[0]).getTime() / 1000)
        : 0,
    };
  });
}

// ============================================================
// Luminance 系（empornium 等）
// ============================================================

async function parseLuminance(rssUrl) {
  const body = await fetchRssContent(rssUrl);
  const rss = await parseXml(body);
  const items = rss?.rss?.channel?.[0]?.item || [];
  if (!items.length) return [];

  return items.map(item => {
    const link = item.link?.[0] || '';
    const idMatch = link.match(/[?&]id=(\d+)/);
    const id = idMatch ? idMatch[1] : '';
    const torrent = item['media:torrent']?.[0] || {};
    const torrentAttrs = torrent.$ || {};

    return {
      id,
      name: item.title?.[0] || '',
      size: parseInt(torrentAttrs.length) || 0,
      url: item.enclosure?.[0]?.$.url || '',
      link,
      hash: torrent['torrent:infoHash']?.[0] || item.guid?.[0] || id,
      pubTime: item.pubDate?.[0]
        ? Math.floor(new Date(item.pubDate[0]).getTime() / 1000)
        : 0,
    };
  });
}

// ============================================================
// 站点适配器路由表
// ============================================================

const adapterMap = {
  // M-Team
  isMTeam: host => host.includes('m-team') || host.includes('mteam'),
  // Gazelle 系
  isGazelle: host => ['uhdbits.org', 'jpopsuki.eu', 'dicmusic.com',
    'greatposterwall.com', 'libble.me', 'lp.pw', 'blutopia.cc'
  ].some(s => host.includes(s)),
  // BeyondHD
  isBeyondHD: host => host.includes('beyond-hd'),
  // Luminance
  isLuminance: host => ['empornium', 'pixelcove', 'cathode-ray'
  ].some(s => host.includes(s)),
};

// ============================================================
// 主入口
// ============================================================

/**
 * 解析 RSS URL，返回统一的 torrent 列表
 * @param {string} rssUrl - RSS Feed 地址
 * @param {string} cookie - 站点 Cookie（部分站点需要）
 */
async function getTorrents(rssUrl, cookie = '') {
  const url = new URL(rssUrl);
  const host = url.host.toLowerCase();

  try {
    // M-Team
    if (adapterMap.isMTeam(host)) {
      return await parseMTeam(rssUrl);
    }
    // Gazelle
    if (adapterMap.isGazelle(host)) {
      const clientUrl = `${url.protocol}//${url.host}`;
      return await parseGazelle(rssUrl, cookie, clientUrl);
    }
    // BeyondHD
    if (adapterMap.isBeyondHD(host)) {
      return await parseBeyondHD(rssUrl);
    }
    // Luminance
    if (adapterMap.isLuminance(host)) {
      return await parseLuminance(rssUrl);
    }
    // 其他默认走 NexusPHP 通用解析
    return await parseNexusPHP(rssUrl);
  } catch (e) {
    console.error(`RSS 解析失败 [${host}]:`, e.message);
    return [];
  }
}

module.exports = { getTorrents, getTorrentByBencode };
