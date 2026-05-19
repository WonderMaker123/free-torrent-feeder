/**
 * 轻量日志模块（带控制台彩色输出 + 文件记录 + 内存缓冲）
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, 'free-torrent-feeder-' + today + '.log');
}

const DEBUG = process.env.DEBUG === '1';

// 内存缓冲（最多 2000 条）
const buffer = [];
const MAX_BUFFER = 2000;

function pad(n) { return String(n).padStart(2, '0'); }

function timestamp() {
  const d = new Date();
  return '[' + d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']';
}

function write(type, color, args) {
  const msg = args.map(function(a) {
    return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a);
  }).join(' ');
  const time = new Date().toISOString();
  const level = type;
  const line = time + ' [' + type + '] ' + msg;
  const colored = timestamp() + ' \x1b[' + color + 'm[' + type + ']\x1b[0m ' + msg;
  console.log(colored);
  fs.appendFileSync(getLogFile(), line + '\n');

  // 写入内存缓冲
  buffer.push({ time, level, message: msg });
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

var INFO  = function() { write('INFO',  '32', Array.prototype.slice.call(arguments)); };
var WARN  = function() { write('WARN',  '33', Array.prototype.slice.call(arguments)); };
var ERROR = function() { write('ERROR', '31', Array.prototype.slice.call(arguments)); };
var DEBUG_ = function() {
  if (DEBUG) write('DEBUG', '90', Array.prototype.slice.call(arguments));
};

/**
 * 供 server.js 劫持的内部 emit 方法
 * @param {object} entry - { time, level, message }
 */
function _emit(entry) {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

/**
 * 获取最近的 n 条日志
 */
function getRecent(n) {
  return buffer.slice(-n);
}

/**
 * 清空内存缓冲（不删文件）
 */
function clear() {
  buffer.length = 0;
}

module.exports = {
  info: INFO,
  warn: WARN,
  error: ERROR,
  debug: DEBUG_,
  _emit,
  getRecent,
  clear,
};
