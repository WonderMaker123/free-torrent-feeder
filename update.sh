#!/bin/bash
# ============================================================
# Free Torrent Feeder 一键更新脚本
# 使用方式：bash update.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  Free Torrent Feeder 一键更新"
echo "=========================================="

# 保存更新前的 config.js（以防新版本 config.example 有变化）
if [ -f config.js ]; then
    cp config.js config.js.bak
    echo -e "[已备份 config.js -> config.js.bak]"
fi

# Git pull
echo -e "\n[1/3] Git pull..."
git pull origin main

# 安装新依赖（如果 package.json 有变化）
echo -e "\n[2/3] 安装依赖..."
npm install

# 合并 config.example.js 的新字段到 config.js（保留用户配置）
echo -e "\n[3/3] 重启服务..."
# 合并 config.example.js 的新字段到 config.js
node -e "
const fs = require('fs');
const example = require('./config.example.js');
const current = require('./config.js');

function deepMerge(target, src) {
  for (const key of Object.keys(src)) {
    if (typeof src[key] === 'object' && !Array.isArray(src[key]) && src[key] !== null) {
      target[key] = deepMerge(target[key] || {}, src[key]);
    } else if (!(key in target)) {
      target[key] = src[key];
    }
  }
  return target;
}

const merged = deepMerge(current, example);
fs.writeFileSync('config.js', 'module.exports = ' + JSON.stringify(merged, null, 2) + ';\n');
console.log('config.js 已更新，新增字段已合并');
" 2>/dev/null || echo -e "${YELLOW}config.js 合并跳过（无 node 环境或格式问题）${NC}"

# 重启 PM2
pm2 restart free-torrent-feeder 2>/dev/null || pm2 start server.js --name free-torrent-feeder
pm2 save

echo ""
echo "=========================================="
echo -e "${GREEN}  更新完成！${NC}"
echo "=========================================="
echo -e "日志: pm2 logs free-torrent-feeder"
echo ""
