module.exports = {
  QBITORRENT: {
    URL: 'http://localhost:8080',
    USERNAME: 'admin',
    PASSWORD: 'adminadmin',
    SKIP_HASH_CHECK: true,
    UPLOAD_LIMIT: 0,
    DOWNLOAD_LIMIT: 0,
    SAVE_PATH: '',
    CATEGORY: 'auto-free',
    AUTO_TMM: false,
    FIRST_LAST_PIECE_PRIO: false,
    PAUSED: false,
  },

  RSS_FEEDS: [
    {
      name: 'M-Team',
      url: 'https://api.m-team.cc/api/torrent/rss?type=passkey&passkey=YOUR_PASSKEY&inclfree=1',
      cookie: 'YOUR_MTEAM_API_KEY',
    },
  ],

  APP: {
    USERNAME: 'admin',
    PASSWORD: 'admin123',
    INTERVAL_MS: 5 * 60 * 1000,
    SITE_DELAY_MS: 3000,
    DEBUG: false,

    // ----- 非免费种子重检配置 -----
    // 重检独立间隔（毫秒），默认 10 分钟
    // 独立于 RSS 抓取周期，每隔这么久检查一次非免费种子是否变免费
    RESCAN_INTERVAL_MS: 10 * 60 * 1000,

    // 重检窗口期（小时），非免费种子超过此时间后会重新检测是否变免费
    // 默认 24 小时，即同一种子最多每 24 小时重检一次
    RESCAN_WINDOW_HOURS: 24,

    // 每次重检最多检查多少个非免费种子
    RESCAN_MAX_PER_CYCLE: 10,
  },
};
