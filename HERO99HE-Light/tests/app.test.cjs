'use strict';
// A fake DOM and a fake HID device: these tests NEVER access a real browser or USB device.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js'), keys = require('../layout.js');
const code = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.handlers = {}; this.attributes = {};
    this.className = ''; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
    this.classList = { toggle: (name, enabled) => { const set = new Set(this.className.split(' ').filter(Boolean)); if (enabled) set.add(name); else set.delete(name); this.className = [...set].join(' '); } };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  closest() { return null; }
  click() { return this.onclick?.(); }
}
function environment({ chosen, stored, workerUnsupported = false, probeTimeoutMs, previewCore = C, previewPerformance = performance } = {}) {
  const ids = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const timers = new Set(), storage = new Map(stored ? [['hero99-light/v1', stored]] : []), exports = [];
  const doc = { getElementById: id => ids.get(id), createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }), querySelectorAll: selector => selector === '.effect' ? ids.get('effects').children : [] };
  const hid = { handlers: {}, async requestDevice() { return chosen ? [chosen] : []; }, addEventListener(name, fn) { this.handlers[name] = fn; } };
  class FakeWorker {
    constructor(url) {
      assert.match(url, /^core\.js\?v=/); this.closed = false;
      this.engine = C.createOutputEngine({ keys, hid: workerUnsupported ? undefined : { async getDevices() { return chosen ? [chosen] : []; } },
        ...(Number.isFinite(probeTimeoutMs) ? { setTimeout: fn => setTimeout(fn, probeTimeoutMs), clearTimeout } : {}),
        post: message => queueMicrotask(() => { if (!this.closed) this.onmessage?.({ data: structuredClone(message) }); }) });
    }
    postMessage(message) {
      const copy = structuredClone(message);
      queueMicrotask(async () => {
        if (this.closed) return;
        try { const result = await this.engine.command(copy.type, copy.payload); if (copy.id && !this.closed) this.onmessage?.({ data: { id: copy.id, ok: true, result } }); }
        catch (error) { if (!this.closed) this.onmessage?.({ data: copy.id ? { id: copy.id, ok: false, error: error.message, details: error.details || null } : { event: 'fault', error: error.message } }); }
      });
    }
    terminate() { this.closed = true; void this.engine.command('disconnect'); }
  }
  const ctx = vm.createContext({ HeroCore: previewCore, HeroKeys: keys, document: doc, navigator: { hid }, performance: previewPerformance, console, Worker: FakeWorker,
    Blob, URL: { createObjectURL(blob) { exports.push(blob); return 'blob:mock'; }, revokeObjectURL() {} },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    setTimeout(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    requestAnimationFrame(fn) { ctx.draw = fn; }, confirm() { return false; }
  });
  ctx.window = { isSecureContext: true, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  vm.runInContext(code, ctx, { timeout: 1000 });
  return { ids, hid, ctx, storage, exports, async cleanup() { await ids.get('disconnect').onclick(); for (const timer of timers) clearTimeout(timer); } };
}
function fakeDevice() {
  const d = { vendorId: 0x372e, productId: 0x103e, productName: 'HERO 99 HE', opened: false, sent: [],
    collections: [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 9, items: [{ reportCount: 63, reportSize: 8 }] }] }],
    async open() { this.opened = true; }, async close() { this.opened = false; }, async sendReport(id, packet) { assert.equal(id, 9); assert.equal(packet.length, 63); this.sent.push([...packet]); }
  }; return d;
}
function addCapabilities(d, length = 26, fixedBody = false) {
  const listeners = new Set();
  d.collections[0].inputReports = [{ reportId: 9, items: [{ reportCount: 63, reportSize: 8 }] }];
  d.addEventListener = (name, fn) => { assert.equal(name, 'inputreport'); listeners.add(fn); };
  d.removeEventListener = (name, fn) => { assert.equal(name, 'inputreport'); listeners.delete(fn); };
  const original = d.sendReport.bind(d);
  d.sendReport = async (id, packet) => {
    await original(id, packet);
    if (packet[0] !== 0x82 && !(packet[0] === 4 && packet[1] === 6)) return;
    const data = fixedBody && packet[0] === 0x82 ? Uint8Array.from(require('./fixtures/hero99he-capabilities.json')) : new Uint8Array(63);
    if (!(fixedBody && packet[0] === 0x82)) {
      data.set([packet[0], packet[1], 0, 1, 0, packet[0] === 4 ? 0 : length]);
      if (packet[0] === 0x82 && length > 0) { data[6 + 22] = 1; data[6 + 24] = 80; }
      data[62] = (255 - 9 - data.reduce((a, b) => a + b, 0)) & 255;
    }
    for (const fn of [...listeners]) fn({ reportId: 9, data: new DataView(data.buffer) });
  };
}
test('UI initializes 101 physical positions, thirty-two effects and thirty presets without HID writes', async () => {
  const d = fakeDevice(), e = environment({ chosen: d });
  try { assert.equal(e.ids.get('keyboard').children.length, 101); assert.equal(e.ids.get('effects').children.length, 32); assert.equal(e.ids.get('presets').children.length, 30); assert.ok(e.ids.get('start').disabled); e.ctx.draw(); assert.equal(d.sent.length, 0); assert.equal(d.opened, false); }
  finally { await e.cleanup(); }
});
test('new frame-linked modes and software gain can be staged, applied and exported without a reload', async () => {
  const d=fakeDevice();addCapabilities(d,0,true);const e=environment({chosen:d});
  try{
    const options=[...html.matchAll(/<option value="([^"]+)">/g)].map(m=>m[1]);
    for(const mode of C.STRIP_MODES)assert.ok(options.includes(mode));
    await e.ids.get('connect').onclick();
    e.ids.get('sideGain').value='175';e.ids.get('sideGain').handlers.input();
    assert.equal(e.ids.get('sideGainValue').value,'175%');assert.equal(d.sent.length,0);
    await e.ids.get('start').onclick();
    for(const mode of C.FRAME_STRIP_MODES.slice(1)){
      e.ids.get('stripMode').value=mode;e.ids.get('stripMode').onchange();
      const sent=d.sent.filter(p=>p[0]===4).length;
      await e.ids.get('applySideLight').onclick();await pause(100);assert.equal(e.ids.get('stop').disabled,false);
      assert.ok(d.sent.filter(p=>p[0]===4).length>sent,mode);
    }
    await e.ids.get('stop').onclick();e.ids.get('export').onclick();
    const saved=JSON.parse(await e.exports[0].text());assert.equal(saved.strip.mode,'follow-flash');assert.equal(saved.strip.gain,1.75);
    assert.equal(d.sent.filter(p=>p[0]===0x82).length,1);assert.ok(d.sent.some(p=>p[0]===4));
  }finally{await e.cleanup();}
});

test('PrintScreen and bottom-row Fn labels match the new reference without assigning a fake Fn code', async () => {
  const e=environment();
  try{
    const prt=e.ids.get('keyboard').children.find(el=>el.dataset.key===95),fn=e.ids.get('keyboard').children.find(el=>el.dataset.key===72);
    assert.equal(prt.children[0].textContent,'PrtSc');assert.equal(fn.children[0].textContent,'Fn');
    assert.equal(keys.find(k=>k.id===72).code,'');
    e.ctx.window.handlers.keydown({code:'PrintScreen',target:new Element(),repeat:false,preventDefault(){}});e.ctx.draw();assert.match(prt.className,/pressed/);
    e.ctx.window.handlers.keyup({code:'PrintScreen'});e.ctx.draw();assert.doesNotMatch(prt.className,/pressed/);
  }finally{await e.cleanup();}
});

test('palette selection preserves painted keys and animation and exports all colors', async () => {
  const e = environment();
  try {
    e.ids.get('capture').onclick();
    e.ids.get('presets').children[1].onclick(); e.ids.get('export').onclick();
    const saved = JSON.parse(await e.exports[0].text());
    assert.equal(saved.frames.length, 1); assert.deepEqual(saved.settings.palette, C.PRESETS[1].palette);
    assert.deepEqual(saved.strip.color, C.PRESETS[1].color); assert.equal(saved.strip.mode, 'off');
    assert.deepEqual(C.validateProject(saved, keys), saved);
  } finally { await e.cleanup(); }
});
test('linked strip starts only on explicit Start, queries once, and Stop ends both streams', async () => {
  const d = fakeDevice(); addCapabilities(d, 0, true); const e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); e.ids.get('stripMode').value = 'follow'; e.ids.get('stripMode').onchange();
    await pause(30); assert.equal(d.sent.length,0,'staged mode edit does not write');
    assert.equal(e.ids.get('start').disabled, false); await e.ids.get('start').onclick(); await pause(180);
    assert.equal(d.sent.filter(p=>p[0]===0x82).length,1);
    assert.ok(d.sent.some(p => p[0] === 4)); assert.equal(e.ids.get('stripMode').disabled, false);
    await e.ids.get('stop').onclick();
    const count = d.sent.length; await pause(80); assert.equal(d.sent.length, count);
  } finally { await e.cleanup(); }
});
test('strip brightness is labelled as five levels, not a five-LED limit', () => {
  assert.match(html, /灯带亮度 · 1–5 档/);
  assert.match(html, /id="sideBrightness"[^>]*min="1" max="5"/);
  assert.match(html, /aria-label="灯带亮度档位，非灯珠数量"/);
});
test('fixed response enables native color on explicit application, without checkboxes', async () => {
  const d = fakeDevice(); addCapabilities(d, 0, true); const e = environment({ chosen: d });
  try {
    e.ids.get('stripMode').value = 'solid'; e.ids.get('stripMode').onchange();
    e.ids.get('sideColor').value = '#00a0ff'; e.ids.get('sideBrightness').value = '3';
    await e.ids.get('connect').onclick(); assert.equal(d.sent.length, 0);
    await e.ids.get('inspectLighting').onclick(); assert.equal(d.sent.length, 1); assert.match(e.ids.get('lightingCapabilities').textContent, /固件报告数量 23/);
    assert.match(e.ids.get('lightingCapabilities').textContent, /不等于已核实的物理灯珠数/);
    assert.equal(e.ids.get('applySideLight').disabled, false);
    await e.ids.get('applySideLight').onclick(); await pause(40); assert.equal(d.sent.length, 2); assert.deepEqual(d.sent[1].slice(0, 2), [4, 6]);
    assert.equal(d.sent.filter(p => p[0] === 8).length, 0, 'standalone strip does not send key colors');
    e.ids.get('diagnostics').onclick(); const saved = JSON.parse(await e.exports[0].text()); assert.equal(saved.sideApplication.delivery, 'stream'); assert.equal(saved.sideApplication.acknowledged, false);
    assert.equal(saved.lightingInspection.payloadFormat, 'official-fixed-body');
    await e.ids.get('start').onclick(); await pause(150); assert.equal(e.ids.get('applySideLight').disabled, false);
    assert.ok(d.sent.some(p => p[0] === 8)); assert.ok(d.sent.filter(p => p[0] === 4).length >= 2);
  } finally { await e.cleanup(); }
});
test('key output first, then Apply strip, color edits and Apply again work without refresh', async () => {
  const d = fakeDevice(); addCapabilities(d, 0, true); const e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(70);
    assert.ok(d.sent.some(p => p[0] === 8));
    e.ids.get('stripMode').value = 'follow'; e.ids.get('stripMode').onchange();
    assert.equal(e.ids.get('applySideLight').disabled, false);
    await e.ids.get('applySideLight').onclick(); await pause(160);
    assert.equal(d.sent.filter(p => p[0] === 0x82).length, 1, 'capability queried in explicit Apply workflow');
    assert.ok(d.sent.some(p => p[0] === 4)); assert.ok(e.ids.get('start').disabled, 'key output resumed');
    const before = d.sent.length;
    e.ids.get('presets').children[15].onclick();
    e.ids.get('sideBrightness').value = '5'; e.ids.get('sideBrightness').onchange();
    assert.equal(e.ids.get('applySideLight').disabled, false);
    await e.ids.get('applySideLight').onclick(); await pause(160);
    assert.ok(d.sent.slice(before).some(p => p[0] === 8)); assert.ok(d.sent.slice(before).some(p => p[0] === 4 && p[11] === 4));
    assert.equal(d.sent.filter(p => p[0] === 0x82).length, 1, 'same connection capability reused');
  } finally { await e.cleanup(); }
});
test('Apply supports independent animation, then keys, then no-strip without reloading', async () => {
  const d = fakeDevice(); addCapabilities(d, 0, true); const e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); e.ids.get('stripMode').value = 'breathe'; e.ids.get('stripMode').onchange();
    await e.ids.get('applySideLight').onclick(); await pause(320);
    assert.ok(d.sent.some(p => p[0] === 4)); assert.ok(!d.sent.some(p => p[0] === 8));
    assert.equal(e.ids.get('start').disabled, false);
    await e.ids.get('start').onclick(); await pause(150); assert.ok(d.sent.some(p => p[0] === 8));
    e.ids.get('stripMode').value = 'off'; e.ids.get('stripMode').onchange();
    await e.ids.get('applySideLight').onclick(); const at = d.sent.length; await pause(350);
    assert.ok(d.sent.slice(at).some(p => p[0] === 8)); assert.ok(!d.sent.slice(at).some(p => p[0] === 4));
  } finally { await e.cleanup(); }
});
test('Stop during automatic capability read prevents Apply from restarting output', async () => {
  const d = fakeDevice(); addCapabilities(d, 0, true);
  d.sendReport = async (id, packet) => { d.sent.push([...packet]); }; // No response: user interrupts rather than waits.
  const e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); e.ids.get('stripMode').value = 'solid'; e.ids.get('stripMode').onchange();
    const pending = e.ids.get('applySideLight').onclick(); await pause(20); await e.ids.get('stop').onclick(); await pending;
    await pause(30); assert.equal(d.sent.length, 1); assert.equal(d.sent[0][0], 0x82);
    assert.equal(e.ids.get('applySideLight').disabled, false);
  } finally { await e.cleanup(); }
});
test('preset search is reversible and choosing a preset makes fixed rainbow palette visible', async () => {
  const e = environment();
  try {
    e.ids.get('presetSearch').value = '薄荷'; e.ids.get('presetSearch').handlers.input();
    assert.equal(e.ids.get('presets').children.filter(b => !b.hidden).length, 1);
    e.ids.get('presetSearch').value = ''; e.ids.get('presetSearch').handlers.input();
    assert.equal(e.ids.get('presets').children.filter(b => !b.hidden).length, 30);
    e.ids.get('presets').children[10].onclick(); e.ids.get('export').onclick();
    assert.equal(JSON.parse(await e.exports[0].text()).settings.effect, 'gradient');
  } finally { await e.cleanup(); }
});
test('compact page removes long technical explanations and visible packet counters', () => {
  assert.ok(!html.includes('HID 包')); assert.ok(!html.includes('包/帧')); assert.ok(!html.includes('运行日志'));
  assert.match(html, /<div hidden aria-hidden="true">/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('ack')); assert.ok(!ids.includes('sideConsent'));
  assert.ok(!html.includes('已关闭其他灯光软件，允许按键输出')); assert.ok(!html.includes('允许控制灯带；设备可能记忆设置'));
});
test('effect category filter shows all five reactive modes and restores all thirty-two modes', async () => {
  const e = environment();
  try {
    assert.deepEqual(e.ids.get('effects').children.map(b => b.dataset.effect).sort(), [...C.EFFECTS].sort());
    e.ids.get('effectFilter').value = 'reactive'; e.ids.get('effectFilter').onchange();
    assert.equal(e.ids.get('effects').children.filter(b => !b.hidden).length, 5);
    const selected = e.ids.get('effects').children.find(b => b.dataset.effect === 'keycross'); selected.onclick();
    e.ids.get('export').onclick(); const p = JSON.parse(await e.exports[0].text()); assert.equal(p.settings.effect, 'keycross');
    e.ids.get('effectFilter').value = 'all'; e.ids.get('effectFilter').onchange();
    assert.equal(e.ids.get('effects').children.filter(b => !b.hidden).length, 32);
  } finally { await e.cleanup(); }
});
test('physical Escape and Insert events highlight the right preview keys without sending HID', async () => {
  const d = fakeDevice(), e = environment({ chosen: d });
  try {
    for (const [code, id, label] of [['Escape', 1, 'Esc'], ['Insert', 98, 'Ins']]) {
      const el = e.ids.get('keyboard').children.find(k => k.dataset.key === id);
      e.ctx.window.handlers.keydown({ code, target: new Element(), repeat: false, preventDefault() {} }); e.ctx.draw();
      assert.match(el.className, /pressed/); assert.match(e.ids.get('hoverKey').textContent, new RegExp(label));
      e.ctx.window.handlers.keyup({ code }); e.ctx.draw(); assert.doesNotMatch(el.className, /pressed/);
    }
    assert.equal(d.sent.length, 0);
  } finally { await e.cleanup(); }
});
test('focused toolbar buttons do not swallow physical Escape events', async () => {
  const e = environment();
  try {
    const buttonTarget = { closest: selector => selector === 'button' ? {} : null };
    e.ctx.window.handlers.keydown({ code: 'Escape', target: buttonTarget, repeat: false, preventDefault() {} }); e.ctx.draw();
    assert.match(e.ids.get('hoverKey').textContent, /收到实体 Esc/);
    assert.match(e.ids.get('keyboard').children.find(k => k.dataset.key === 1).className, /pressed/);
  } finally { await e.cleanup(); }
});
test('legacy local storage is loaded, migrated and exportable without clearing saved scenes', async () => {
  const p = C.defaultProject(); delete p.layout;
  p.settings.effect = 'studio'; p.paint = { 71: [1, 2, 3] };
  p.frames = [Object.fromEntries([...Array.from({ length: 94 }, (_, i) => i + 1), 99, 100, 101, 102, 103].map(id => [id, [100, 50, 25]]))];
  const e = environment({ stored: JSON.stringify(p) });
  try {
    e.ctx.draw(); e.ids.get('export').onclick(); const migrated = JSON.parse(await e.exports[0].text());
    assert.equal(migrated.layout, 'hero99he-101/v1'); assert.equal(migrated.settings.effect, 'studio');
    assert.equal(migrated.frames.length, 1); assert.equal(Object.keys(migrated.frames[0]).length, keys.length);
    assert.deepEqual(migrated.paint[72], [1, 2, 3]); assert.deepEqual(migrated.frames[0][98], [100, 50, 25]);
    assert.doesNotMatch(e.ids.get('log').textContent, /旧配置未载入/);
  } finally { await e.cleanup(); }
});
test('Connect opens only selected device with no reports; Start needs no checkbox', async () => {
  const d = fakeDevice(), e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); assert.equal(d.opened, true); assert.equal(d.sent.length, 0);
    await pause(30); assert.equal(d.sent.length,0,'connection alone must not start output');
    assert.equal(e.ids.get('start').disabled, false);
    await e.ids.get('start').onclick(); await pause(80); assert.ok(d.sent.length > 0);
    await e.ids.get('stop').onclick(); const stoppedAt = d.sent.length; await pause(70); assert.equal(d.sent.length, stoppedAt);
    await e.ids.get('disconnect').onclick(); assert.equal(d.opened, false); assert.ok(e.ids.get('start').disabled);
  } finally { await e.cleanup(); }
});

test('stored strip settings and preview never start hardware on load or connection', async () => {
  const d=fakeDevice(); addCapabilities(d,0,true);
  const p=C.defaultProject(); p.strip.mode='spectrum';
  const e=environment({chosen:d,stored:JSON.stringify(p)});
  try {
    e.ctx.draw(); await pause(30); assert.equal(d.sent.length,0);
    await e.ids.get('connect').onclick(); e.ctx.draw(); await pause(30); assert.equal(d.sent.length,0);
    e.ids.get('sideBrightness').value='5'; e.ids.get('sideBrightness').onchange(); await pause(30); assert.equal(d.sent.length,0);
    assert.equal(e.ids.get('applySideLight').disabled,false);
    await e.ids.get('applySideLight').onclick(); await pause(70);
    assert.ok(d.sent.some(p=>p[0]===4&&p[11]===4)); assert.ok(!d.sent.some(p=>p[0]===8));
  } finally { await e.cleanup(); }
});

test('maximum strip brightness submits full RGB while key brightness is only 20 percent', async () => {
  const d=fakeDevice(); addCapabilities(d,0,true); const e=environment({chosen:d});
  try {
    await e.ids.get('connect').onclick();
    e.ids.get('brightness').value='20'; e.ids.get('brightness').handlers.input();
    e.ids.get('stripMode').value='solid'; e.ids.get('stripMode').onchange();
    e.ids.get('sideColor').value='#ffa050'; e.ids.get('sideColor').onchange();
    e.ids.get('sideBrightness').value='5'; e.ids.get('sideBrightness').onchange();
    await e.ids.get('applySideLight').onclick(); await pause(40);
    const native=d.sent.find(p=>p[0]===4); assert.deepEqual(native.slice(8,12),[255,160,80,4]);
  } finally { await e.cleanup(); }
});
test('hidden document, window blur and no preview redraw do not stop worker output', async () => {
  const d = fakeDevice(), e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(80);
    const count = d.sent.length; e.ctx.document.visibilityState = 'hidden'; e.ctx.window.handlers.blur();
    await pause(120); assert.ok(d.sent.length > count); assert.match(e.ids.get('backgroundState').textContent, /后台线程/);
  } finally { await e.cleanup(); }
});
test('missing worker WebHID does not fall back to a foreground sender', async () => {
  const d = fakeDevice(), e = environment({ chosen: d, workerUnsupported: true });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(40);
    assert.equal(d.opened, false); assert.equal(d.sent.length, 0); assert.match(e.ids.get('log').textContent, /后台 WebHID/); assert.ok(e.ids.get('start').disabled);
  } finally { await e.cleanup(); }
});
test('lighting capability query is opt-in while stopped and is included in local diagnostics', async () => {
  const d = fakeDevice(); addCapabilities(d); const e = environment({ chosen: d });
  try {
    assert.equal(e.ids.get('inspectLighting').disabled, true); await e.ids.get('inspectLighting').onclick(); assert.equal(d.sent.length, 0);
    await e.ids.get('connect').onclick(); assert.equal(d.sent.length, 0); assert.equal(e.ids.get('inspectLighting').disabled, false);
    await e.ids.get('inspectLighting').onclick(); assert.equal(d.sent.length, 1); assert.equal(d.sent[0][0], 0x82);
    assert.match(e.ids.get('lightingCapabilities').textContent, /1 × 80/);
    e.ids.get('diagnostics').onclick(); const diagnostics = JSON.parse(await e.exports[0].text());
    assert.equal(diagnostics.lightingInspection.ok, true); assert.equal(diagnostics.lightingInspection.lightbox.columns, 80);
    assert.equal(diagnostics.device.collections[0].inputReports[0].reportId, 9);
    await e.ids.get('start').onclick(); await pause(30);
    assert.equal(e.ids.get('inspectLighting').disabled, true); const queries = d.sent.filter(p => p[0] === 0x82).length;
    await e.ids.get('inspectLighting').onclick(); assert.equal(d.sent.filter(p => p[0] === 0x82).length, queries);
  } finally { await e.cleanup(); }
});
test('short capability reply displays unknown and exports raw evidence through the worker boundary', async () => {
  const d = fakeDevice(); addCapabilities(d, 0); const e = environment({ chosen: d, probeTimeoutMs: 5 });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('inspectLighting').onclick();
    assert.match(e.ids.get('lightingCapabilities').textContent, /短响应（0 字节/); assert.match(e.ids.get('lightingCapabilities').textContent, /未知/);
    assert.doesNotMatch(e.ids.get('lightingCapabilities').textContent, /不支持/);
    e.ids.get('diagnostics').onclick(); const saved = JSON.parse(await e.exports[0].text()).lightingInspection;
    assert.equal(saved.capabilityFieldsComplete, false); assert.equal(saved.queryCapture.responses[0].rawReport.length, 63);
    assert.equal(saved.sideLight, null); assert.equal(d.sent.length, 1);
  } finally { await e.cleanup(); }
});
test('invalid capability reply retains failure data in downloadable diagnostics', async () => {
  const d = fakeDevice(); addCapabilities(d, 57); const e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('inspectLighting').onclick();
    e.ids.get('diagnostics').onclick(); const saved = JSON.parse(await e.exports[0].text()).lightingInspection;
    assert.equal(saved.ok, false); assert.equal(saved.details.responses[0].declaredLength, 57);
    assert.equal(saved.details.responses[0].rawReport.length, 63); assert.equal(d.sent.length, 1);
  } finally { await e.cleanup(); }
});
test('wrong model and wrong report size never open or send', async () => {
  for (const mutate of [d => d.productName = 'HERO 68 HE', d => d.collections[0].outputReports[0].items[0].reportCount = 64]) {
    const d = fakeDevice(); mutate(d); const e = environment({ chosen: d });
    try { await e.ids.get('connect').onclick(); assert.equal(d.opened, false); await e.ids.get('start').onclick(); assert.equal(d.sent.length, 0); assert.ok(e.ids.get('start').disabled); }
    finally { await e.cleanup(); }
  }
});
test('studio capture, frame selection, color painting and project export work offline', async () => {
  const e = environment();
  try {
    e.ids.get('tabStudio').onclick(); e.ids.get('capture').onclick(); assert.equal(e.ids.get('timeline').children.length, 1); assert.equal(e.ids.get('paintMode').checked, true);
    const a = e.ids.get('keyboard').children.find(el => el.dataset.key === 43); a.handlers.pointerdown({ button: 0, preventDefault() {} });
    e.ids.get('frameMs').value = '200'; e.ids.get('frameMs').onchange(); e.ids.get('playStudio').onclick();
    e.ids.get('export').onclick(); const project = JSON.parse(await e.exports[0].text());
    assert.equal(project.frames.length, 1); assert.equal(project.settings.effect, 'studio'); assert.equal(project.frameMs, 200);
    assert.deepEqual(project.frames[0]['43'], [97, 218, 251]); C.validateProject(project, keys);
  } finally { await e.cleanup(); }
});
test('Stop and disconnect cancel further packets without checkboxes', async () => {
  const d = fakeDevice(), e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(20);
    await e.ids.get('stop').onclick(); const count = d.sent.length; await pause(70); assert.equal(d.sent.length, count);
    e.hid.handlers.disconnect({ device: d }); assert.ok(e.ids.get('start').disabled); await pause(60); assert.equal(d.sent.length, count);
  } finally { await e.cleanup(); }
});
test('invalid stored configuration is ignored, not executed', async () => {
  const e = environment({ stored: '{"format":"malicious"}' });
  try { assert.equal(e.ids.get('keyboard').children.length, 101); assert.match(e.ids.get('log').textContent, /旧配置未载入/); assert.ok(e.ids.get('start').disabled); }
  finally { await e.cleanup(); }
});
test('preview skips hidden computation, caps visible cadence and redraws edits immediately', async () => {
  let stamp = 0, renders = 0;
  const e = environment({ previewPerformance: { now: () => stamp }, previewCore: { ...C, render(...args) { renders++; return C.render(...args); } } });
  try {
    e.ctx.draw(); assert.equal(renders, 1); // One raw sample, not another for strip preview.
    stamp = 10; e.ctx.draw(); assert.equal(renders, 1);
    stamp = 50; e.ctx.draw(); assert.equal(renders, 2);
    e.ctx.document.visibilityState = 'hidden'; stamp = 1000; e.ctx.draw(); assert.equal(renders, 2);
    e.ctx.document.visibilityState = 'visible'; e.ctx.draw(); assert.equal(renders, 3);
    e.ids.get('swatches').children[0].onclick(); e.ctx.draw(); assert.equal(renders, 4);
    assert.equal(e.hid.handlers.requestDevice, undefined);
  } finally { await e.cleanup(); }
});

test('failed transmission stops output without retrying indefinitely', async () => {
  const d = fakeDevice(); let calls = 0; d.sendReport = async () => { calls++; throw Error('fake unplug'); }; const e = environment({ chosen: d });
  try { await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(30); assert.equal(calls, 1); assert.match(e.ids.get('log').textContent, /fake unplug/); assert.ok(e.ids.get('stop').disabled); }
  finally { await e.cleanup(); }
});
test('scene import stops active output and validates before replacing', async () => {
  const d = fakeDevice(), e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(20);
    const p = C.defaultProject(); p.settings.effect = 'meteor'; e.ids.get('importFile').files = [{ size: 500, async text() { return JSON.stringify(p); } }]; await e.ids.get('importFile').onchange();
    const count = d.sent.length; await pause(70); assert.equal(d.sent.length, count); assert.ok(e.ids.get('stop').disabled);
    e.ids.get('export').onclick(); assert.equal(JSON.parse(await e.exports[0].text()).settings.effect, 'meteor');
    e.ids.get('importFile').files = [{ size: 2, async text() { return '{}'; } }]; await e.ids.get('importFile').onchange(); e.ids.get('export').onclick(); assert.equal(JSON.parse(await e.exports[1].text()).settings.effect, 'meteor');
  } finally { await e.cleanup(); }
});
