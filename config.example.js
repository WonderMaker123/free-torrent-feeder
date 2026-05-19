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
  },
};
