/**
 * 免费种子检测器
 * 参考 vertex-app/vertex app/libs/scrape.js
 */

const gotImport = require('got');
const got = gotImport.default || gotImport.got || gotImport;
const { JSDOM } = require('jsdom');
const { URL } = require('url');

// 内存缓存（40 秒 TTL）
const scrapeCache = new Map();

function getCached(key) {
  const item = scrapeCache.get(key);
  if (item && Date.now() - item.ts < 40000) return item.result;
  return null;
}

function setCache(key, result) {
  scrapeCache.set(key, { result, ts: Date.now() });
}

async function fetchPage(url, cookie) {
  const res = await got.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookie || '',
      'Referer': new URL(url).origin,
    },
    timeout: { request: 20000 },
    throwHttpErrors: false,
  });
  return res.body;
}

// 通用 NexusPHP（支持 HDHome/HDSky/OurBits/CHDBits/LemonHD/PTHome 等 20+ 站）
async function freeNexusPHP(html, host) {
  if (!html.includes('userdetails') && !html.includes('mybonus')) {
    throw new Error('[' + host + '] Cookie 失效');
  }
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  if (doc.querySelector('#top font.free, #top font.twoupfree')) return true;
  if (doc.querySelector('#top span.free, #top span.twoupfree')) return true;
  return false;
}

// M-Team（API 方式）
async function freeMTeam(url, apiKey) {
  const tidMatch = url.match(/id=(\d+)/);
  if (!tidMatch) return false;
  const tid = tidMatch[1];
  const res = await got.post('https://api.m-team.cc/api/torrent/detail', {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    form: { id: tid },
    timeout: { request: 15000 },
    throwHttpErrors: false,
  });
  try {
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    return (body && body.data && body.data.status && body.data.status.discount || '').includes('FREE');
  } catch { return false; }
}

// HDChina（AJAX + CSRF）
async function freeHDChina(html, url, cookie) {
  if (!html.includes('userdetails')) throw new Error('[HDChina] Cookie 失效');
  const csrfMatch = html.match(/name="csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) throw new Error('[HDChina] CSRF 未找到');
  const tidMatch = url.match(/id=(\d+)/);
  if (!tidMatch) return false;
  const res = await got.post('https://hdchina.org/ajax_promotion.php', {
    headers: { Cookie: cookie },
    form: { 'ids[]': tidMatch[1], csrf: csrfMatch[1] },
    timeout: { request: 15000 },
    throwHttpErrors: false,
  });
  try {
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    const state = body && body.message && body.message[tidMatch[1]] && body.message[tidMatch[1]].sp_state || '';
    return state.includes('pro_free') || state.includes('pro_twoupfree');
  } catch { return false; }
}

// HDBits
async function freeHDBits(html) {
  if (!html.includes('userdetails') && !html.includes('nav_userinfo')) {
    throw new Error('[HDBits] Cookie 失效');
  }
  return html.includes('freeleech');
}

// ToTheGlory
async function freeToTheGlory(html) {
  return html.includes('ico_free.gif');
}

// OpenCD
async function freeOpenCD(html) {
  if (!html.includes('userdetails')) throw new Error('[OpenCD] Cookie 失效');
  return html.includes('pro_free');
}

// BeyondHD
async function freeBeyondHD(html) {
  return html.includes('freeleech');
}

// U2.dmhy.org（动漫花园，NexusPHP，免费标记 #top font.free）
// HDCity
async function freeHDCity(html) {
  if (!html.includes('userdetails')) throw new Error('[HDCity] Cookie 失效');
  return html.includes('"free"') || html.includes("'free'");
}

// U2.dmhy.org（动漫花园，NexusPHP，与通用一致）
async function freeU2DMHY(html) {
  if (!html.includes('userdetails') && !html.includes('mybonus')) {
    throw new Error('[U2] Cookie 失效');
  }
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  if (doc.querySelector('#top font.free, #top font.twoupfree')) return true;
  if (doc.querySelector('#top span.free, #top span.twoupfree')) return true;
  return false;
}

// 站点路由
function getHandler(host) {
  if (host.includes('hdchina')) return freeHDChina;
  if (host.includes('hdbits')) return freeHDBits;
  if (host.includes('totheglory')) return freeToTheGlory;
  if (host.includes('open.cd')) return freeOpenCD;
  if (host.includes('hdcity')) return freeHDCity;
  if (host.includes('beyond-hd')) return freeBeyondHD;
  if (host.includes('dmhy') || host === 'u2.dmhy.org') return freeU2DMHY;
  return freeNexusPHP;
}

/**
 * 主入口：判断某 URL 对应种子是否免费
 */
async function free(url, cookie) {
  if (new URL(url).host.includes('m-team')) {
    return await freeMTeam(url, cookie);
  }
  const cached = getCached(url);
  if (cached !== null) return cached;
  const html = await fetchPage(url, cookie);
  const host = new URL(url).host;
  const handler = getHandler(host);
  const result = await handler(html, url, cookie);
  setCache(url, result);
  return result;
}

module.exports = { free };
