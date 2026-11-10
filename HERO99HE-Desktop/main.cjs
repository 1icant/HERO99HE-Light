'use strict';
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const P = require('./policy.cjs');
const { createReactiveInput } = require('./reactive.cjs');

// No public HTTP server, remote scripts, Node.js in the page, or security bypass.
protocol.registerSchemesAsPrivileged([{ scheme: 'hero-light', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }]);
app.setName('HERO99HE Light Studio');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let win, tray, allowQuit = false, stopPromise = null, stopDone = null, showingPicker = false;
let active = false, trayNoticeShown = false;
let reactive = null, inputEnabled = false, inputNeeded = false,inputBackend='raw';
function refreshInput() { reactive?.setContext({ enabled: inputEnabled, active: active && inputNeeded && !stopPromise && !allowQuit,backend:inputBackend }); }
const iconPath = path.join(__dirname, 'assets', 'icon.png');

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function sendPreviewVisibility(){
  if(!win||win.isDestroyed()||win.webContents.isDestroyed())return;
  win.webContents.send('desktop:preview-visible',win.isVisible()&&!win.isMinimized());
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip('HERO 99HE v' + app.getVersion() + ' · ' + (active ? '灯效正在后台运行' : '已就绪，尚未输出'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开控制面板', click: showWindow },
    { label: active ? '停止灯效' : '停止输出', click: () => { void requestStop(); } },
    { type: 'separator' },
    { label: '退出程序', click: () => { void quitSafely(); } }
  ]));
}
function requestStop() {
  reactive?.setContext({enabled:inputEnabled,active:false,backend:inputBackend});
  if (stopPromise) return stopPromise;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve();
  stopPromise = new Promise(resolve => {
    const timer = setTimeout(() => { stopDone = null; resolve(); }, 3000);
    stopDone = () => { clearTimeout(timer); stopDone = null; resolve(); };
    win.webContents.send('desktop:stop');
  }).finally(() => { stopPromise = null; });
  return stopPromise;
}
async function quitSafely() {
  if (allowQuit) return;
  await requestStop();
  allowQuit = true;
  reactive?.dispose();
  tray?.destroy(); tray = null;
  // Closing the process also releases the OS HID handle, including a stalled
  // worker. No save/reset/recovery commands are emitted on exit.
  app.exit(0);
}
async function selectDevice(event, details, callback) {
  event.preventDefault();
  if (showingPicker || !details.frame || !P.trustedOrigin(details.frame.url) || !win || win.isDestroyed()) { callback(); return; }
  const candidates = details.deviceList.filter(P.matchesDevice);
  if (!candidates.length) {
    callback();
    await dialog.showMessageBox(win, { type: 'info', title: '没有找到 HERO 99HE', message: '未找到匹配的 HERO 99 HE / HERO 99 灯光接口。', detail: '请检查有线连接，并关闭其他占用设备的灯光软件。不会尝试其他型号或强制发送。' });
    return;
  }
  showingPicker = true;
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'question', title: '连接键盘', message: '请选择要连接的 HERO 99HE',
      detail: '仅授权本次程序会话；连接本身不会更改灯光。',
      buttons: [...candidates.map((d, i) => (i + 1) + '. ' + d.name + ' · HERO 灯光接口'), '取消'],
      cancelId: candidates.length, defaultId: candidates.length, noLink: true
    });
    const chosen = candidates[result.response];
    callback(chosen && win && !win.isDestroyed() && P.trustedOrigin(win.webContents.getURL()) ? chosen.deviceId : undefined);
  } catch { callback(); }
  finally { showingPicker = false; }
}
async function main() {
  if (!locked) return;
  const ses = session.defaultSession;
  await ses.protocol.handle('hero-light', async request => {
    const target = P.route(request.url, request.method);
    if (!target) return new Response('Not found', { status: 404 });
    try {
      const body = request.method === 'HEAD' ? null : await fs.readFile(path.join(__dirname, 'web', target[0]));
      return new Response(body, { headers: { 'Content-Type': target[1], 'Content-Security-Policy': P.CSP,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    } catch { return new Response('Missing application file', { status: 500 }); }
  });
  ses.setPermissionCheckHandler((contents, permission, origin) => permission === 'hid' && P.trustedOrigin(origin) &&
    (!contents || contents === win?.webContents));
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'hid' && contents === win?.webContents && P.trustedOrigin(details.requestingUrl || contents.getURL()));
  });
  // Keep Electron's default per-selected-device, in-memory grants. Do NOT
  // grant all matching devices globally or persist permission automatically.
  ses.on('select-hid-device', (event, details, callback) => { void selectDevice(event, details, callback); });
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !P.allowedRequest(details.url) }));
  win = new BrowserWindow({ width: 1420, height: 960, minWidth: 980, minHeight: 700, show: false,
    title: 'HERO 99HE · Light Studio', icon: iconPath, backgroundColor: '#17141d', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false }
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('render-process-gone', () => { active = false; refreshInput(); updateTray(); });
  reactive = createReactiveInput({
    helperPath: app.isPackaged ? path.join(process.resourcesPath,'native','HeroKeyInput.exe') : path.join(__dirname,'native','HeroKeyInput.exe'),
    isFocused: () => Boolean(win && !win.isDestroyed() && win.isFocused()),
    onKey: value => { if(win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('desktop:key',value); },
    onStatus: value => { if(win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('desktop:input-status',value); }
  });
  win.on('focus', () => reactive.reset());
  // backgroundThrottling stays off for USB output; Chrome can therefore
  // report "visible" even when the desktop window is hidden or minimized.
  for(const event of ['show','hide','minimize','restore'])win.on(event,sendPreviewVisibility);
  win.on('close', event => {
    if (allowQuit) return;
    event.preventDefault(); win.hide();
    if (!trayNoticeShown) {
      trayNoticeShown = true;
      tray?.displayBalloon({ icon: iconPath, title: 'HERO 99HE 已收进托盘', content: '灯效可继续后台运行。右键托盘图标可停止或彻底退出。' });
    }
  });
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.on('double-click', showWindow); tray.on('click', showWindow); updateTray();
  ipcMain.on('desktop:stopped', event => { if (event.sender === win?.webContents) { active = false; refreshInput(); updateTray(); stopDone?.(); } });
  ipcMain.on('desktop:preview-ready',event=>{
    if(event.sender===win?.webContents&&P.trustedOrigin(event.sender.getURL()))sendPreviewVisibility();
  });
  ipcMain.on('desktop:input-context', (event,value) => {
    if(event.sender!==win?.webContents || !P.trustedOrigin(event.sender.getURL()))return;
    const wasActive=active;
    inputEnabled=value?.enabled===true;inputNeeded=value?.reactive===true;active=value?.running===true;inputBackend=value?.backend==='poll'?'poll':'raw';
    refreshInput();if(wasActive!==active)updateTray();
  });
  win.once('ready-to-show', showWindow);
  await win.loadURL(P.ENTRY);
}
app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', event => { if (locked && !allowQuit) { event.preventDefault(); void quitSafely(); } });
if (locked) app.whenReady().then(main).catch(error => {
  dialog.showErrorBox('HERO 99HE 启动失败', error.message);
  allowQuit = true; app.exit(1);
});
