'use strict';
(() => {
  const desktop = window.HeroDesktop;
  if (!desktop) return;
  const version = document.querySelector('.brand small span');
  const webVersion = version?.textContent?.trim();
  const label = '桌面版 v' + desktop.version;
  document.title = 'HERO 99HE · ' + label;
  if (version) version.textContent = label + (webVersion ? ' · Web ' + webVersion : '');
  const footer = document.querySelector('footer span:last-child');
  if (footer) footer.textContent = '关闭窗口收进托盘 · 右键托盘可退出';
  desktop.onStop(async () => {
    try { await document.getElementById('stop').onclick(); }
    finally { desktop.stopped(); }
  });
})();
