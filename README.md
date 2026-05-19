# Free Torrent Feeder

一个带 Web UI 的 PT 免费种子监控工具。程序会定时抓取 RSS，检测免费状态，并把符合条件的种子添加到 qBittorrent。

## 功能

- Web 控制台：登录、状态概览、实时日志、RSS 当前抓取面板
- RSS 管理：在 UI 中添加、编辑、删除 RSS 源和 Cookie/API Key
- qBittorrent 管理：在 UI 中配置地址、账号、分类、保存路径、限速和添加参数
- 自动去重：使用 `data/processed.json` 记录已处理种子
- 实时状态：通过 SSE 推送日志和 RSS 抓取状态
- 安全默认值：真实 `config.js`、日志和运行数据默认不会提交到 Git

## 快速开始

```bash
npm install
copy config.example.js config.js
npm start
```

打开：

```text
http://localhost:3000
```

默认登录：

```text
账号: admin
密码: admin123
```

登录后建议先在“设置”里修改管理账号和密码。

## 配置

大部分配置都可以在 Web UI 里完成：

- `qBittorrent`：Web UI 地址、账号密码、分类、保存路径、上传/下载限速
- `RSS 源`：站点名称、RSS URL、Cookie 或 API Key
- `设置`：管理账号密码、抓取间隔、站点请求间隔、调试模式

也可以手动修改本地 `config.js`。首次使用时从示例文件复制：

```bash
copy config.example.js config.js
```

## 常用命令

```bash
npm start
npm run dev
npm run check
```

`npm run check` 会检查后端 JavaScript 和页面脚本语法。

## 目录结构

```text
free-torrent-feeder/
├── server.js
├── config.example.js
├── package.json
├── public/
│   ├── index.html
│   └── login.html
├── libs/
│   ├── db.js
│   ├── logger.js
│   ├── qb.js
│   ├── rss.js
│   └── scrape.js
└── scripts/
    └── check.js
```

## 注意

- 不要把真实 `config.js` 上传到公开仓库，里面可能包含 qB 密码、RSS passkey、Cookie 或 API Key。
- qBittorrent 需要启用 Web UI，并确认地址、端口、账号密码正确。
- Cookie 过期后免费检测可能失败，需要在 UI 里更新。
- 默认端口是 `3000`，可通过环境变量 `PORT` 修改。
