const fs = require('fs');
const { execFileSync } = require('child_process');

const jsFiles = [
  'server.js',
  'config.js',
  'libs/db.js',
  'libs/logger.js',
  'libs/qb.js',
  'libs/rss.js',
  'libs/scrape.js',
];

for (const file of jsFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

for (const file of ['public/index.html', 'public/login.html']) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  for (const script of scripts) {
    new Function(script);
  }
}

console.log('Syntax check passed.');
