# Free Torrent Feeder

一个带 Web UI 的 PT 免费种子监控工具。程序定时抓取 RSS，检测免费状态，把符合条件的种子自动添加到 qBittorrent。支持**非免费种子定时重检**——种子首次不免费也不会丢弃，之后变免费了会自动补抓。

## 功能特性

- **Web 控制台**：登录、状态概览、实时日志、RSS 抓取面板
- **RSS 管理**：在 UI 中添加、编辑、删除 RSS 源和 Cookie/API Key
- **qBittorrent 管理**：在 UI 中配置地址、账号、分类、保存路径、限速
- **自动去重**：使用 JSON 数据库记录已处理种子，不重复添加
- **非免费重检**：非免费种子每轮都会重检，变免费后立即补抓
- **实时状态**：通过 SSE 推送日志和抓取状态
- **站点适配**：支持 M-Team、U2.dmhy.org、HDHome、HDSky、OurBits、CHDBits、HDChina 等 30+ PT 站点

---

## 一键安装（Debian / Ubuntu）

### 方式一：一行命令（推荐）

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/WonderMaker123/free-torrent-feeder/main/install.sh)"
```

### 方式二：手动运行安装脚本

```bash
git clone https://github.com/WonderMaker123/free-torrent-feeder.git ~/free-torrent-feeder
cd ~/free-torrent-feeder
bash install.sh
```

安装脚本会自动完成：
1. 检测 Debian / Ubuntu 系统
2. 安装 Node.js 20 和 PM2
3. 克隆源码（已有源码则自动 git pull 更新）
4. `npm install` 安装依赖
5. 生成 `config.js`（如不存在）
6. 启动服务 + 开机自启

---

## 一键更新

```bash
cd ~/free-torrent-feeder && bash update.sh
```

更新脚本会自动完成：
1. `git pull` 获取最新代码
2. `npm install` 安装新依赖
3. **智能合并** `config.example.js` 的新字段到你的 `config.js`（保留你的所有配置）
4. `pm2 restart` 重启服务

---

## 快速配置

安装完成后，编辑配置文件：

```bash
nano ~/free-torrent-feeder/config.js
```

**必填项：**

```js
QBITORRENT: {
  URL: 'http://localhost:8080',      // qBittorrent Web UI 地址
  USERNAME: 'admin',                  // qBittorrent 用户名
  PASSWORD: 'adminadmin',             // qBittorrent 密码
}
```

**qBittorrent Web UI 必须开启**：qB → 设置 → Web UI → 勾选「启用 Web UI」。

然后打开 `http://你的服务器IP:3000`，默认账号：

```
账号: admin
密码: admin123
```

首次登录后**务必去「设置」修改密码**。

---

## Web UI 可调参数

登录后进入「设置」页面，可直接修改以下参数：

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| 抓取间隔 | RSS 多久查一次新种子 | 5 分钟 |
| 站点请求间隔 | 每个站点之间等多久（防封 IP） | 3 秒 |
| **重检间隔** | 多久触发一次非免费种子重检 | 30 分钟 |
| **重检窗口** | 非免费种子超过几小时再次被检 | 1 小时 |
| **每批数量** | 每次重检多少个（分批避免请求过多） | 10 |

> 注意：修改后设置会自动保存，定时器会自动重启。

---

## RSS 站点配置

在 Web UI 的「RSS 源管理」中添加：

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

**如何获取 RSS URL**：站点的「我的 RSS」或用户控制台生成 RSS Feed 地址。

---

## 常用命令

```bash
# 查看日志
pm2 logs free-torrent-feeder

# 重启服务
pm2 restart free-torrent-feeder

# 停止服务
pm2 stop free-torrent-feeder

# 修改配置后重载
nano ~/free-torrent-feeder/config.js
pm2 restart free-torrent-feeder

# 一键更新到最新代码
bash ~/free-torrent-feeder/update.sh
```

---

## 目录结构

```
free-torrent-feeder/
├── install.sh              # 一键安装脚本
├── update.sh               # 一键更新脚本
├── server.js              # Web 服务端入口
├── index.js               # 命令行版本
├── config.example.js       # 配置文件示例
├── config.js               # 实际配置文件（不提交到 Git）
├── package.json
├── public/                 # Web UI 静态文件
│   ├── index.html
│   └── login.html
├── libs/                   # 核心模块
│   ├── db.js              # JSON 数据库（已处理种子记录）
│   ├── logger.js           # 日志
│   ├── qb.js              # qBittorrent API
│   ├── rss.js             # RSS 解析
│   └── scrape.js           # 免费状态检测
└── data/
    └── processed.json      # 已处理种子的 hash 记录
```

---

## 常见问题

**Q: 免费种子没有被检测到？**
- 检查 Cookie 是否过期，在浏览器重新获取
- 查看日志确认请求是否成功，Cookie 失效会报错「Cookie 失效」
- 确保代码是最新版本（`bash update.sh`）

**Q: 提示「qBittorrent 登录失败」？**
- 确认 qB Web UI 已启用
- 确认地址、端口、账号密码正确
- 确认 qB 设置里「允许远程连接」已勾选

**Q: 想让非免费种子检查得更频繁？**
- 在 UI 设置里把「重检间隔」改小（比如 10 分钟）
- 把「重检窗口」改小（比如 1 小时）
- 把「每批数量」调大（比如 30）

**Q: 想添加新的站点？**
- 在 `libs/scrape.js` 的 `getHandler` 函数中添加站点路由
- 参考已有的站点适配器实现

---

## 安全注意

- **不要把 config.js 上传到公开仓库**，里面包含 qB 密码和 Cookie
- **首次使用修改默认密码**，Web UI 默认密码是 `admin123`
- 建议通过 Nginx 反向代理 + HTTPS 访问，不要直接暴露 3000 端口
