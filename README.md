# Free Torrent Feeder

一个带 Web UI 的 PT 免费种子监控工具。程序定时抓取 RSS，检测免费状态，把符合条件的种子自动添加到 qBittorrent。

## 功能特性

- **Web 控制台**：登录、状态概览、实时日志、RSS 抓取面板
- **RSS 管理**：在 UI 中添加、编辑、删除 RSS 源和 Cookie/API Key
- **qBittorrent 管理**：在 UI 中配置地址、账号、分类、保存路径、限速
- **自动去重**：使用 SQLite 数据库记录已处理种子，不重复添加
- **实时状态**：通过 SSE 推送日志和抓取状态
- **站点适配**：支持 M-Team、U2.dmhy.org、HDHome、HDSky、OurBits、CHDBits、HDChina 等 30+ PT 站点

---

## 一键安装（Debian / Ubuntu）

```bash
# 1. 安装 Node.js 18+ 和 Git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# 2. 下载源码
git clone https://github.com/WonderMaker123/free-torrent-feeder.git
cd free-torrent-feeder

# 3. 安装依赖
npm install

# 4. 复制配置文件
cp config.example.js config.js

# 5. 修改配置文件（必填项）
nano config.js
# 需要填写的内容见下方「配置说明」

# 6. 启动
npm start
```

打开 `http://你的服务器IP:3000`，用默认账号登录：

```
账号: admin
密码: admin123
```

**首次登录后务必去「设置」修改密码。**

---

## 配置说明

### qBittorrent 配置（config.js）

```js
QBITORRENT: {
  URL: 'http://localhost:8080',      // qBittorrent Web UI 地址
  USERNAME: 'admin',                  // qBittorrent 用户名
  PASSWORD: 'adminadmin',             // qBittorrent 密码
  CATEGORY: 'auto-free',              // 添加时使用的分类，可留空
  SAVE_PATH: '',                      // 保存路径，留空使用 qB 默认路径
  DOWNLOAD_LIMIT: 0,                  // 下载限速（字节/秒），0=不限
  UPLOAD_LIMIT: 0,                   // 上传限速，0=不限
  PAUSED: false,                     // true=添加后暂停，false=立即开始
}
```

**qBittorrent Web UI 必须开启**：在 qB 设置 → Web UI → 勾选「启用 Web UI」。

### RSS 站点配置

在 Web UI 的「RSS 源管理」中添加，格式如下：

| 字段 | 说明 |
|------|------|
| 名称 | 站点名称，随便写 |
| RSS URL | 从站点复制的 RSS Feed 地址 |
| Cookie / API Key | 登录站点的 Cookie（大多数站）或 API Key（M-Team） |

**如何获取 Cookie**：
1. 浏览器登录 PT 站点
2. 按 F12 → Network（网络）标签
3. 刷新页面，点击任意请求
4. 复制 Request Headers 中的 `Cookie` 字段

**如何获取 RSS URL**：在站点的「我的 RSS」或用户控制台生成 RSS Feed 地址。

**支持的站点类型**（会自动识别）：

| 站点 | 类型 |
|------|------|
| U2.dmhy.org | NexusPHP，免费检测用 `img[class=pro_free]` |
| M-Team | 专用 API，API Key 方式 |
| HDHome / HDSky / OurBits / CHDBits 等 | NexusPHP 通用 |
| HDChina | NexusPHP + CSRF |
| HDBits | 专用适配器 |
| ToTheGlory | 专用图标检测 |
| OpenCD | pro_free 检测 |

---

## 使用方式

### 启动服务

```bash
# 普通启动
npm start

# 开发模式（修改代码后自动重启）
npm run dev

# 语法检查
npm run check
```

### 进程守护（生产环境推荐用 PM2）

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start server.js --name free-torrent-feeder

# 开机自启
pm2 save
pm2 startup

# 其他常用命令
pm2 logs free-torrent-feeder    # 查看日志
pm2 restart free-torrent-feeder  # 重启
pm2 stop free-torrent-feeder    # 停止
```

### 通过反向代理访问（可选）

如果想用域名/外网访问，建议用 Nginx 反向代理：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

然后申请 SSL 证书（Let's Encrypt）：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## 目录结构

```
free-torrent-feeder/
├── server.js              # Web 服务端入口
├── index.js               # 命令行版本（可直接 node index.js 运行）
├── config.example.js      # 配置文件示例
├── config.js              # 实际配置文件（不提交到 Git）
├── package.json
├── public/                # Web UI 静态文件
│   ├── index.html
│   └── login.html
├── libs/                  # 核心模块
│   ├── db.js              # SQLite 数据库
│   ├── logger.js          # 日志
│   ├── qb.js              # qBittorrent API
│   ├── rss.js             # RSS 解析
│   └── scrape.js          # 免费状态检测
├── scripts/
│   └── check.js           # 语法检查
└── data/                  # 运行时数据
    └── database.sqlite    # 去过重的种子记录
```

---

## 常见问题

**Q: 免费种子没有被检测到？**
- 检查 Cookie 是否过期，在浏览器重新获取
- 查看日志确认请求是否成功，Cookie 失效会报错「Cookie 失效」
- 部分站点（如 U2）有专属检测逻辑，确保代码是最新版本

**Q: 提示「qBittorrent 登录失败」？**
- 确认 qB Web UI 已启用
- 确认地址、端口、账号密码正确
- 确认 qB 设置里「Web UI」→「允许远程连接」已勾选（如果外网访问）

**Q: 如何查看实时日志？**
- `pm2 logs free-torrent-feeder`（PM2 方式）
- Web UI 右上角有实时日志面板

**Q: 想添加新的站点？**
- 在 `libs/scrape.js` 的 `getHandler` 函数中添加站点路由
- 参考已有的站点适配器实现

---

## 安全注意

- **不要把 config.js 上传到公开仓库**，里面包含 qB 密码和 Cookie
- **修改默认密码**，Web UI 默认密码是 `admin123`
- 建议通过 Nginx 反向代理 + HTTPS 访问，不要直接暴露 3000 端口
