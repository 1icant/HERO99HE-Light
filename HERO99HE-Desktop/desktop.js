'use strict';
(() => {
  const desktop = window.HeroDesktop;
  if (!desktop) return;
  document.title = 'HERO 99HE · 桌面灯光 ' + desktop.version;
  const version = document.querySelector('.brand small span');
  if (version) version.textContent = '桌面版 v' + desktop.version;
  const footer = document.querySelector('footer span:last-child');
  if (footer) footer.textContent = '关闭窗口收进托盘 · 右键托盘可退出';
  desktop.onStop(async () => {
    try { await document.getElementById('stop').onclick(); }
    finally { desktop.stopped(); }
  });
  const status = document.getElementById('status');
  const update = () => desktop.setRunning(status.classList.contains('running'));
  new MutationObserver(update).observe(status, { attributes: true, attributeFilter: ['class'] });
  update();
})();
