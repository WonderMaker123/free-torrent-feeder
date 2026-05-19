#!/bin/bash
# ============================================================
# Free Torrent Feeder 一键安装脚本（Debian / Ubuntu）
# 使用方式：bash -c "$(curl -fsSL https://raw.githubusercontent.com/WonderMaker123/free-torrent-feeder/main/install.sh)"
# 或直接：bash install.sh
# ============================================================

set -e

echo "=========================================="
echo "  Free Torrent Feeder 一键安装"
echo "=========================================="

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 安装目录（默认当前用户 home 目录下）
INSTALL_DIR="${INSTALL_DIR:-$HOME/free-torrent-feeder}"

# --- 1. 检测系统 ---
echo -e "\n${YELLOW}[1/6] 检测系统...${NC}"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS="$ID"
else
    echo -e "${RED}无法检测系统版本，只支持 Debian / Ubuntu${NC}"
    exit 1
fi

if [[ "$OS" != "debian" && "$OS" != "ubuntu" && "$OS" != "linuxmint" && "$OS" != "raspbian" ]]; then
    echo -e "${RED}当前系统 ($OS) 不受支持，请使用 Debian 或 Ubuntu${NC}"
    exit 1
fi
echo -e "${GREEN}系统: $PRETTY_NAME${NC}"

# --- 2. 安装 Node.js ---
echo -e "\n${YELLOW}[2/6] 安装 Node.js 20...${NC}"
if command -v node &> /dev/null; then
    NODE_VER=$(node -v)
    echo -e "${GREEN}Node.js 已安装: $NODE_VER${NC}"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo -e "${GREEN}Node.js 安装完成: $(node -v)${NC}"
fi

# --- 3. 安装 PM2 ---
echo -e "\n${YELLOW}[3/6] 安装 PM2...${NC}"
if command -v pm2 &> /dev/null; then
    echo -e "${GREEN}PM2 已安装${NC}"
else
    npm install -g pm2
    echo -e "${GREEN}PM2 安装完成${NC}"
fi

# --- 4. 下载源码 ---
echo -e "\n${YELLOW}[4/6] 下载源码到 $INSTALL_DIR ...${NC}"
if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "${GREEN}源码已存在，执行更新...${NC}"
    cd "$INSTALL_DIR"
    git pull origin main
else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone https://github.com/WonderMaker123/free-torrent-feeder.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# --- 5. 安装依赖 ---
echo -e "\n${YELLOW}[5/6] 安装依赖...${NC}"
npm install
echo -e "${GREEN}依赖安装完成${NC}"

# --- 6. 配置 ---
echo -e "\n${YELLOW}[6/6] 配置...${NC}"
if [ ! -f config.js ]; then
    cp config.example.js config.js
    echo -e "${YELLOW}已创建 config.js，请编辑配置：${NC}"
    echo -e "  nano $INSTALL_DIR/config.js"
else
    echo -e "${GREEN}config.js 已存在，跳过${NC}"
fi

# 尝试启动（如果 config.js 已配置好）
echo -e "\n${YELLOW}尝试启动服务...${NC}"
pm2 delete free-torrent-feeder 2>/dev/null || true
NODE_ENV=production pm2 start server.js --name free-torrent-feeder --cwd "$INSTALL_DIR"

# 保存启动规则
pm2 save
pm2 startup 2>/dev/null || echo -e "${YELLOW}提示：如需开机自启，手动执行: pm2 startup${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}  安装完成！${NC}"
echo "=========================================="
echo -e "Web UI:   ${GREEN}http://localhost:3000${NC}"
echo -e "源码目录: ${GREEN}$INSTALL_DIR${NC}"
echo ""
echo -e "常用命令："
echo -e "  nano $INSTALL_DIR/config.js     ${YELLOW}# 修改配置${NC}"
echo -e "  pm2 logs free-torrent-feeder   ${YELLOW}# 查看日志${NC}"
echo -e "  pm2 restart free-torrent-feeder ${YELLOW}# 重启服务${NC}"
echo -e "  bash $INSTALL_DIR/update.sh        ${YELLOW}# 一键更新${NC}"
echo ""
