'use strict';
// Mocked Electron, pure policy and bundled-file checks. Never opens real HID.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const P = require('../policy.cjs');
const root = path.resolve(__dirname, '..');
function device(overrides = {}) {
  return { deviceId: 'fake-hero', name: 'AULA HERO 99 HE', vendorId: 0x372e, productId: 0x103e,
    collections: [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 9, items: [{ reportSize: 8, reportCount: 63 }] }] }], ...overrides };
}
function rig({ locked = true } = {}) {
  const app = new EventEmitter(), ipcMain = new EventEmitter(), ses = new EventEmitter();
  const state = { dialogs: [], windows: [], menus: [], exits: [], schemes: [] };
  Object.assign(app, { setName() {}, requestSingleInstanceLock: () => locked, quit() { state.quits = (state.quits || 0) + 1; },
    whenReady: async () => {}, exit(code) { state.exits.push(code); } });
  ses.protocol = { handle(scheme, handler) { state.handler = handler; assert.equal(scheme, 'hero-light'); } };
  ses.setPermissionCheckHandler = handler => { state.check = handler; };
  ses.setPermissionRequestHandler = handler => { state.permission = handler; };
  ses.webRequest = { onBeforeRequest(handler) { state.beforeRequest = handler; } };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.hidden = true; this.destroyed = false; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { isDestroyed: () => this.destroyed, getURL: () => P.ENTRY,
        setWindowOpenHandler: fn => { state.openHandler = fn; }, send: channel => { state.sent = channel; } });
      state.windows.push(this);
    }
    isDestroyed() { return this.destroyed; } isMinimized() { return false; }
    show() { this.hidden = false; } focus() {} hide() { this.hidden = true; } restore() {}
    removeMenu() {} async loadURL(url) { state.loaded = url; this.emit('ready-to-show'); }
  }
  class Tray extends EventEmitter {
    constructor() { super(); state.tray = this; }
    setToolTip(text) { state.tooltip = text; }
    setContextMenu(menu) { state.menu = menu; }
    displayBalloon(value) { state.balloon = value; } destroy() { state.trayDestroyed = true; }
  }
  const electron = { app, ipcMain, BrowserWindow, Tray, session: { defaultSession: ses },
    protocol: { registerSchemesAsPrivileged: items => { state.schemes = items; } },
    Menu: { buildFromTemplate: template => template }, nativeImage: { createFromPath: value => value },
    dialog: { showErrorBox(title, message) { throw Error(title + message); },
      async showMessageBox(win, options) { state.dialogs.push(options); return { response: state.response ?? options.cancelId ?? 0 }; } }
  };
  const context = { require: name => name === 'electron' ? electron : name === './policy.cjs' ? P : require(name),
    __dirname: root, Response, setTimeout, clearTimeout, URL, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.cjs'), 'utf8'), context);
  return { app, ipcMain, ses, state, async ready() { for (let i = 0; i < 20; i++) await Promise.resolve(); } };
}
test('only the private local origin and exact bundled asset routes are accepted', () => {
  assert.ok(P.trustedOrigin(P.ENTRY)); assert.ok(P.route(P.ENTRY));
  assert.equal(P.route(P.ORIGIN + '/core.js?v=0.1.10')[0], 'core.js');
  for (const url of ['https://studio/', 'file:///index.html', 'hero-light://evil/', 'hero-light://studio:123/', 'hero-light://user@studio/']) assert.equal(P.trustedOrigin(url), false);
  for (const url of ['/main.cjs', '/preload.cjs', '/policy.cjs', '/assets/icon.png', '/%2e%2e/main.cjs', '/core.js/extra']) assert.equal(P.route(P.ORIGIN + url), null);
  assert.equal(P.route(P.ENTRY, 'POST'), null);
  assert.equal(P.allowedRequest('https://hub.aulacn.com/'), false); assert.equal(P.allowedRequest('http://127.0.0.1:8731/'), false);
  assert.equal(P.allowedRequest('blob:' + P.ORIGIN + '/export'), true);
});
test('device chooser permits only proven model, vendor collection, report ID and length', () => {
  assert.ok(P.matchesDevice(device()));
  for (const overrides of [{ vendorId: 1 }, { productId: 1 }, { name: 'OTHER MODEL' }, { collections: [] }]) assert.equal(P.matchesDevice(device(overrides)), false);
  const wrong = device(); wrong.collections[0].outputReports[0].items[0].reportCount = 64; assert.equal(P.matchesDevice(wrong), false);
});
test('desktop bundle preserves the working core, effects, layout and web interaction byte for byte', () => {
  for (const file of ['core.js', 'app.js', 'layout.js', 'style.css']) {
    assert.deepEqual(fs.readFileSync(path.join(root, 'web', file)), fs.readFileSync(path.join(root, '..', 'HERO99HE-Light', file)));
  }
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  assert.match(html, /desktop.js\?v=0.2.2/); assert.doesNotMatch(html, /\b(?:src|href)=["']https?:\/\//);
});
test('window is sandboxed and retains its renderer rather than destroying it on close', async () => {
  const r = rig(); await r.ready(); const win = r.state.windows[0];
  assert.equal(r.state.loaded, P.ENTRY);
  const prefs = win.options.webPreferences;
  assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true);
  assert.equal(prefs.backgroundThrottling, false); assert.equal(prefs.webSecurity, true);
  let prevented = false; win.emit('close', { preventDefault() { prevented = true; } });
  assert.ok(prevented); assert.ok(win.hidden); assert.equal(win.destroyed, false); assert.equal(r.state.exits.length, 0);
  assert.ok(r.state.balloon); r.state.menu[0].click(); assert.equal(win.hidden, false);
});
test('unknown permissions, remote origins, remote navigation and popups are denied', async () => {
  const r = rig(); await r.ready(); const contents = r.state.windows[0].webContents;
  assert.ok(r.state.check(contents, 'hid', P.ORIGIN)); assert.ok(r.state.check(null, 'hid', P.ORIGIN));
  for (const permission of ['usb', 'serial', 'media', 'notifications']) assert.equal(r.state.check(contents, permission, P.ORIGIN), false);
  assert.equal(r.state.check(contents, 'hid', 'https://studio'), false);
  assert.equal(r.state.openHandler().action, 'deny');
  let prevented = false; contents.emit('will-navigate', { preventDefault() { prevented = true; } }); assert.ok(prevented);
  r.state.beforeRequest({ url: 'https://example.com/' }, result => assert.equal(result.cancel, true));
});
test('device selection requires an explicit dialog choice; cancel never grants a device', async () => {
  const r = rig(); await r.ready(); let selected = 'unset';
  const trigger = () => r.ses.emit('select-hid-device', { preventDefault() {} }, { frame: { url: P.ENTRY }, deviceList: [device()] }, id => { selected = id; });
  trigger(); await r.ready(); assert.equal(selected, undefined);
  r.state.response = 0; trigger(); await r.ready(); assert.equal(selected, 'fake-hero');
  assert.equal(r.state.dialogs.length, 2);
});
test('tray Stop asks renderer to drain output; Exit waits for stop acknowledgement', async () => {
  const r = rig(); await r.ready(); const contents = r.state.windows[0].webContents;
  r.ipcMain.emit('desktop:running', { sender: contents }, true); assert.match(r.state.tooltip, /后台运行/);
  r.state.menu[1].click(); assert.equal(r.state.sent, 'desktop:stop');
  r.ipcMain.emit('desktop:stopped', { sender: contents }); await r.ready();
  assert.equal(r.state.exits.length, 0); assert.match(r.state.tooltip, /尚未输出/);
  r.state.menu[3].click(); await r.ready(); assert.equal(r.state.exits.length, 0);
  r.ipcMain.emit('desktop:stopped', { sender: {} }); await r.ready(); assert.equal(r.state.exits.length, 0);
  r.ipcMain.emit('desktop:stopped', { sender: contents }); await r.ready();
  assert.deepEqual(r.state.exits, [0]); assert.equal(r.state.trayDestroyed, true);
});
test('a second process creates no window or tray', async () => {
  const r = rig({ locked: false }); await r.ready(); assert.equal(r.state.quits, 1); assert.equal(r.state.windows.length, 0); assert.equal(r.state.tray, undefined);
});

test('bundled responses carry CSP and allow query-versioned worker scripts without exposing shell files', async () => {
  const r=rig(); await r.ready();
  const response=await r.state.handler({url:P.ORIGIN+'/core.js?v=0.1.10',method:'GET'});
  assert.equal(response.status,200); assert.equal(response.headers.get('Content-Security-Policy'),P.CSP);
  assert.equal(await response.text(),fs.readFileSync(path.join(root,'web/core.js'),'utf8'));
  assert.equal((await r.state.handler({url:P.ORIGIN+'/main.cjs',method:'GET'})).status,404);
});

test('desktop page bridge waits for Stop promise before acknowledging drain', async () => {
  let listener, stopped=0, finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const bridge={version:'test',onStop(fn){listener=fn;},stopped(){stopped++;},setRunning(){}};
  const elements={status:{classList:{contains:()=>false}},stop:{onclick:()=>pending}};
  const document={querySelector:()=>null,getElementById:id=>elements[id]};
  vm.runInNewContext(fs.readFileSync(path.join(root,'desktop.js'),'utf8'),{window:{HeroDesktop:bridge},document,
    MutationObserver:class{observe(){}}});
  const stop=listener(); await Promise.resolve(); assert.equal(stopped,0); finish(); await stop; assert.equal(stopped,1);
});
