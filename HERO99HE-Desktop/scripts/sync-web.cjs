'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(root, '..', 'HERO99HE-Light');
const target = path.join(root, 'web');
const {version}=require('../package.json');
fs.mkdirSync(target, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'core.js', 'layout.js']) {
  let content = fs.readFileSync(path.join(source, file), 'utf8');
  if (file === 'index.html') content = content.replace('</head>', `  <script defer src="desktop.js?v=${version}"></script>\n</head>`);
  fs.writeFileSync(path.join(target, file), content);
}
fs.copyFileSync(path.join(root, 'desktop.js'), path.join(target, 'desktop.js'));
console.log('Synced shared web UI into desktop bundle.');
