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
function environment({ chosen, stored, storage:existingStorage, workerUnsupported = false, probeTimeoutMs, previewCore = C, previewPerformance = performance, desktop, confirmAction=()=>false } = {}) {
  const ids = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const timers = new Set(), storage = existingStorage||new Map(stored ? [['hero99-light/v1', stored]] : []), exports = [], messages=[];
  let pendingPreview=null;
  const runPreview=()=>{const cb=pendingPreview;pendingPreview=null;cb?.();};
  const doc = { handlers:{}, addEventListener(name,fn){this.handlers[name]=fn;}, getElementById: id => ids.get(id), createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }), querySelectorAll: selector => selector === '.effect' ? ids.get('effects').children : [] };
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
      messages.push({type:copy.type,frames:copy.type==='state'?copy.payload.project.frames?.length:undefined});
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
    requestAnimationFrame(fn) { pendingPreview=fn;return 1; }, cancelAnimationFrame(){pendingPreview=null;},draw:runPreview,confirm:confirmAction
  });
  ctx.window = { isSecureContext: true, HeroDesktop:desktop, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  vm.runInContext(code, ctx, { timeout: 1000 });
  return { ids, hid, ctx, storage, exports, messages, runPreview,get previewCount(){return Number(Boolean(pendingPreview));}, async cleanup() { await ids.get('disconnect').onclick(); for (const timer of timers) clearTimeout(timer); } };
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
    if (packet[0] !== 0x82 && !(packet[0] === 4 && packet[1] === 6) && !(packet[0] === 0x84 && packet[1] === 11)) return;
    const data = fixedBody && packet[0] === 0x82 ? Uint8Array.from(require('./fixtures/hero99he-capabilities.json')) : new Uint8Array(63);
    if (!(fixedBody && packet[0] === 0x82)) {
      data.set([packet[0], packet[1], 0, 1, 0, packet[0] === 4 ? 0 : length]);
      if(packet[0]===0x84){data[5]=7;data.set([3,0,255,80,40,4,2],6);}
      if (packet[0] === 0x82 && length > 0) { data[6 + 22] = 1; data[6 + 24] = 80; }
      data[62] = (255 - 9 - data.reduce((a, b) => a + b, 0)) & 255;
    }
    for (const fn of [...listeners]) fn({ reportId: 9, data: new DataView(data.buffer) });
  };
}
test('UI initializes 101 physical positions, 56 effects and thirty presets without HID writes', async () => {
  const d = fakeDevice(), e = environment({ chosen: d });
  try { assert.equal(e.ids.get('keyboard').children.length, 101); assert.equal(e.ids.get('effects').children.length, 56); assert.equal(e.ids.get('effectCount').textContent,'56'); assert.equal(e.ids.get('presets').children.length, 30); assert.ok(e.ids.get('start').disabled); e.ctx.draw(); assert.equal(d.sent.length, 0); assert.equal(d.opened, false); }
  finally { await e.cleanup(); }
});

test('Logo Apply after active keys commits staged settings and resumes keys without a refresh',async()=>{
  const d=fakeDevice();addCapabilities(d,0,true);const e=environment({chosen:d});try{
    await e.ids.get('connect').onclick();await e.ids.get('start').onclick();await pause(60);
    e.ids.get('logoMode').value='follow-color';e.ids.get('logoMode').onchange();e.ids.get('logoBrightness').value='4';e.ids.get('logoBrightness').onchange();
    assert.ok(!d.sent.some(p=>p[0]===4&&p[1]===11));await e.ids.get('applyLogo').onclick();await pause(150);
    assert.ok(d.sent.some(p=>p[0]===4&&p[1]===11&&p[11]===4));assert.equal(e.ids.get('start').disabled,true);assert.equal(e.ids.get('applyLogo').disabled,false);

    await e.ids.get('stop').onclick();const n=d.sent.length;await pause(90);assert.equal(d.sent.length,n);
  }finally{await e.cleanup();}
});

test('Logo-only fast keyflash enables opt-in background input and reacts while hidden without enabling key frames',async()=>{
  const handlers={},contexts=[],desktop={onKey:fn=>{handlers.key=fn;},onInputStatus(){},setInputContext:value=>contexts.push(value)};
  const d=fakeDevice();addCapabilities(d,0,true);const e=environment({chosen:d,desktop});try{
    await e.ids.get('connect').onclick();e.ids.get('logoMode').value='keyflash';e.ids.get('logoMode').onchange();
    e.ids.get('backgroundKeys').checked=true;e.ids.get('backgroundKeys').onchange();await e.ids.get('applyLogo').onclick();await pause(30);
    assert.equal(contexts.at(-1).reactive,true);assert.equal(contexts.at(-1).running,true);e.ctx.document.visibilityState='hidden';e.ctx.window.handlers.blur();
    handlers.key({code:'KeyA',down:true});await pause(100);
    assert.ok(d.sent.some(p=>p[0]===4&&p[1]===11&&p.slice(8,11).some(c=>c>0)));assert.ok(!d.sent.some(p=>p[0]===8));
    await e.ids.get('stop').onclick();assert.equal(contexts.at(-1).running,false);

  }finally{await e.cleanup();}
});

test('Logo adds automatic color without restoring old dynamic presets, and old scene load performs no writes',async()=>{
  const choices=[...html.match(/<select id="logoMode">([\s\S]*?)<\/select>/)[1].matchAll(/value="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(choices,['off','solid','follow-color','auto-color','keyflash']);
  const d=fakeDevice(),p=C.defaultProject();p.logo={mode:'breathe',color:[22,44,66],brightness:4};p.paint[43]=[255,0,0];const e=environment({chosen:d,stored:JSON.stringify(p)});try{
    assert.equal(e.ids.get('logoMode').value,'solid');assert.equal(e.ids.get('logoBrightness').value,4);await e.ids.get('connect').onclick();assert.equal(d.sent.length,0);
    e.ids.get('export').onclick();const out=JSON.parse(await e.exports[0].text());assert.equal(out.logo.mode,'solid');assert.deepEqual(out.logo.color,[22,44,66]);assert.deepEqual(out.paint,p.paint);
  }finally{await e.cleanup();}
});

test('each palette color is editable without losing painted keys or other palette entries',async()=>{
  const e=environment();try{
    assert.equal(e.ids.get('paletteEditor').children.length,3);
    for(const [i,color]of ['#ff0000','#00ff00','#0000ff'].entries()){
      const input=e.ids.get('paletteEditor').children[i].children[1];input.value=color;input.handlers.input();
    }
    e.ids.get('export').onclick();const saved=JSON.parse(await e.exports[0].text());
    assert.deepEqual(saved.settings.palette,[[255,0,0],[0,255,0],[0,0,255]]);assert.equal(saved.settings.effect,'gradient');
    assert.equal(e.ids.get('start').disabled,true);
  }finally{await e.cleanup();}
});

test('timeline duplicates independently, preserves per-frame duration on reorder and supports seek/pause',async()=>{
  const e=environment();try{
    e.ids.get('tabStudio').onclick();e.ids.get('capture').onclick();e.ids.get('duplicateFrame').onclick();
    e.ids.get('color').value='#ff0000';e.ids.get('color').handlers.input();
    e.ids.get('keyboard').children.find(el=>el.dataset.key===43).handlers.pointerdown({button:0,preventDefault(){}});
    e.ids.get('frameMs').value='350';e.ids.get('frameMs').onchange();e.ids.get('moveFrameLeft').onclick();
    e.ids.get('export').onclick();const saved=JSON.parse(await e.exports[0].text());
    assert.deepEqual(saved.frameDurations,[350,100]);assert.deepEqual(saved.frames[0]['43'],[255,0,0]);assert.notDeepEqual(saved.frames[0],saved.frames[1]);
    assert.match(e.ids.get('timelinePosition').textContent,/0.45s/);assert.equal(e.ids.get('timeline').children[0].children[0].tag,'img');
    e.ids.get('timelineSeek').value='1';e.ids.get('timelineSeek').handlers.input();e.ids.get('playStudio').onclick();assert.equal(e.ids.get('playStudio').textContent,'暂停');
    e.ids.get('playStudio').onclick();assert.equal(e.ids.get('playStudio').textContent,'播放');
    e.ctx.confirm=()=>true;e.ids.get('deleteFrame').onclick();assert.equal(e.ids.get('timeline').children.length,1);
  }finally{await e.cleanup();}
});

test('opt-in desktop key events trigger Worker lighting while hidden without DOM keydown',async()=>{
  const handlers={},contexts=[],desktop={onKey:fn=>{handlers.key=fn;},onInputStatus:fn=>{handlers.status=fn;},setInputContext:value=>contexts.push(value)};
  const d=fakeDevice(),e=environment({chosen:d,desktop});try{
    assert.equal(e.ids.get('desktopKeyControls').hidden,false);assert.equal(e.ids.get('backgroundKeys').checked,false);
    await e.ids.get('connect').onclick();e.ids.get('effects').children.find(b=>b.dataset.effect==='keyfade').onclick();await e.ids.get('start').onclick();await pause(60);
    handlers.key({code:'KeyA',down:true});e.ctx.draw();assert.doesNotMatch(e.ids.get('keyboard').children.find(k=>k.dataset.key===43).className,/pressed/);
    e.ids.get('backgroundKeys').checked=true;e.ids.get('backgroundKeys').onchange();assert.equal(contexts.at(-1).reactive,true);
    e.ctx.document.visibilityState='hidden';e.ctx.window.handlers.blur();const before=JSON.stringify(d.sent);
    handlers.key({code:'KeyA',down:true});await pause(80);assert.notEqual(JSON.stringify(d.sent),before);
    e.ctx.document.visibilityState='visible';e.ctx.draw();assert.match(e.ids.get('keyboard').children.find(k=>k.dataset.key===43).className,/pressed/);
    handlers.key({reset:true});e.ctx.draw();assert.doesNotMatch(e.ids.get('keyboard').children.find(k=>k.dataset.key===43).className,/pressed/);
    await e.ids.get('stop').onclick();assert.equal(contexts.at(-1).running,false);handlers.status({state:'listening'});assert.match(e.ids.get('inputStatus').textContent,/已就绪/);
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
    assert.deepEqual(saved.strip.color, C.defaultProject().strip.color); assert.equal(saved.strip.mode, 'off');
    assert.deepEqual(C.validateProject(saved, keys), saved);
  } finally { await e.cleanup(); }
});
test('key output first, then Apply strip, color edits and Apply again work without refresh', async () => {
  const d = fakeDevice(); addCapabilities(d, 0, true); const e = environment({ chosen: d });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(70);
    assert.ok(d.sent.some(p => p[0] === 8));
    e.ids.get('stripMode').value = 'breathe'; e.ids.get('stripMode').onchange();
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
  assert.doesNotMatch(html, /testInterface|escLiveKind|native-sync|follow-split|id="diagnostics"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('ack')); assert.ok(!ids.includes('sideConsent'));
  assert.ok(!html.includes('已关闭其他灯光软件，允许按键输出')); assert.ok(!html.includes('允许控制灯带；设备可能记忆设置'));
});
test('effect category filter shows all 13 reactive modes and restores all 56 modes', async () => {
  const e = environment();
  try {
    assert.deepEqual(e.ids.get('effects').children.map(b => b.dataset.effect).sort(), [...C.EFFECTS].sort());
    e.ids.get('effectFilter').value = 'reactive'; e.ids.get('effectFilter').onchange();
    assert.equal(e.ids.get('effects').children.filter(b => !b.hidden).length, 13);
    const selected = e.ids.get('effects').children.find(b => b.dataset.effect === 'keycross'); selected.onclick();
    e.ids.get('export').onclick(); const p = JSON.parse(await e.exports[0].text()); assert.equal(p.settings.effect, 'keycross');
    e.ids.get('effectFilter').value = 'all'; e.ids.get('effectFilter').onchange();
    assert.equal(e.ids.get('effects').children.filter(b => !b.hidden).length, 56);
  } finally { await e.cleanup(); }
});
test('custom palette survives reload; applying restores all colors without changing lamp settings',async()=>{
  const d=fakeDevice(),p=C.defaultProject();p.settings.effect='ocean';p.strip.mode='breathe';p.logo.mode='solid';
  const before=environment({chosen:d,stored:JSON.stringify(p)});
  const get=id=>before.ids.get(id);
  try{
    get('paletteName').value='  深夜蓝  ';get('color').value='#13579b';get('color').handlers.input();
    get('paletteSaveForm').onsubmit({preventDefault(){}});
    assert.equal(get('savedPaletteCount').textContent,'1');assert.equal(get('savedPalettes').value,'深夜蓝');
    const saved=JSON.parse(before.storage.get('hero99-light/palettes/v1'));
    assert.deepEqual(saved,[{name:'深夜蓝',color:[19,87,155],bg:p.settings.bg,palette:p.settings.palette}]);
    get('paletteName').value='深夜蓝';get('paletteSaveForm').onsubmit({preventDefault(){}});
    assert.match(get('toast').textContent,/同名/);assert.equal(get('savedPaletteCount').textContent,'1');
  }finally{await before.cleanup();}
  const after=environment({chosen:d,storage:before.storage,confirmAction:()=>true});
  const lookup=id=>after.ids.get(id);
  try{
    assert.equal(lookup('savedPaletteCount').textContent,'1');
    lookup('presets').children[0].onclick();
    lookup('savedPalettes').value='深夜蓝';lookup('savedPalettes').onchange();lookup('applySavedPalette').onclick();
    lookup('export').onclick();const applied=JSON.parse(await after.exports[0].text());
    assert.deepEqual(applied.settings.color,[19,87,155]);assert.deepEqual(applied.settings.bg,p.settings.bg);
    assert.deepEqual(applied.settings.palette,p.settings.palette);assert.equal(applied.settings.effect,'ocean');
    assert.deepEqual(applied.strip,p.strip);assert.deepEqual(applied.logo,p.logo);
    lookup('deleteSavedPalette').onclick();assert.equal(after.storage.get('hero99-light/palettes/v1'),'[]');
    assert.equal(lookup('applySavedPalette').disabled,true);assert.equal(d.sent.length,0);
  }finally{await after.cleanup();}
});
test('strip auto pick applies the staged frame once, not on later palette edits',async()=>{
  const d=fakeDevice();addCapabilities(d,0,true);
  const p=C.defaultProject();p.settings.effect='static';p.settings.color=[10,200,100];p.settings.brightness=0.1;
  const e=environment({chosen:d,stored:JSON.stringify(p)}),get=id=>e.ids.get(id);
  try{
    await get('connect').onclick();
    get('stripMode').value='auto-color';get('stripMode').onchange();
    assert.equal(get('sideColor').disabled,true);assert.equal(get('sideGain').disabled,false);assert.equal(d.sent.length,0);
    await get('applySideLight').onclick();
    assert.deepEqual(d.sent.at(-1).slice(6,11),[3,0,10,200,100]);assert.match(get('sideResult').textContent,/#0AC864/);
    get('color').value='#c87828';get('color').handlers.input();e.runPreview();await pause(80);
    assert.equal(d.sent.filter(packet=>packet[0]===4).length,1);
    await get('applySideLight').onclick();assert.deepEqual(d.sent.at(-1).slice(6,11),[3,0,200,120,40]);
    get('stripMode').value='native-marquee';get('stripMode').onchange();assert.equal(get('sideGain').disabled,true);
    await get('applySideLight').onclick();assert.deepEqual(d.sent.at(-1).slice(0,8),[4,6,0,1,0,4,5,7]);
  }finally{await e.cleanup();}
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
    assert.match(e.ids.get('hoverKey').textContent, /Esc/);
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
    assert.doesNotMatch(e.ids.get('lastLog').textContent, /旧配置未载入/);
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
  const p=C.defaultProject(); p.strip.mode='breathe';
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
    await pause(120); assert.ok(d.sent.length > count);
  } finally { await e.cleanup(); }
});
test('missing worker WebHID does not fall back to a foreground sender', async () => {
  const d = fakeDevice(), e = environment({ chosen: d, workerUnsupported: true });
  try {
    await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(40);
    assert.equal(d.opened, false); assert.equal(d.sent.length, 0); assert.match(e.ids.get('lastLog').textContent, /后台 WebHID/); assert.ok(e.ids.get('start').disabled);
  } finally { await e.cleanup(); }
});
test('all-keyboard polling requires a separate confirmation and is never stored in scene exports',async()=>{
  const contexts=[],desktop={onKey(){},onInputStatus(){},setInputContext:value=>contexts.push(value)};const e=environment({desktop});try{
    assert.equal(e.ids.get('inputBackend').value,'raw');e.ids.get('inputBackend').value='poll';e.ids.get('inputBackend').onchange();assert.equal(e.ids.get('inputBackend').value,'raw');
    e.ctx.confirm=()=>true;e.ids.get('inputBackend').value='poll';e.ids.get('inputBackend').onchange();assert.equal(contexts.at(-1).backend,'poll');assert.equal(contexts.at(-1).enabled,false);
    e.ids.get('export').onclick();assert.ok(!JSON.stringify(JSON.parse(await e.exports[0].text())).includes('inputBackend'));
  }finally{await e.cleanup();}
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
  try { assert.equal(e.ids.get('keyboard').children.length, 101); assert.match(e.ids.get('lastLog').textContent, /旧配置未载入/); assert.ok(e.ids.get('start').disabled); }
  finally { await e.cleanup(); }
});
test('failed transmission stops output without retrying indefinitely', async () => {
  const d = fakeDevice(); let calls = 0; d.sendReport = async () => { calls++; throw Error('fake unplug'); }; const e = environment({ chosen: d });
  try { await e.ids.get('connect').onclick(); await e.ids.get('start').onclick(); await pause(30); assert.equal(calls, 1); assert.match(e.ids.get('lastLog').textContent, /fake unplug/); assert.ok(e.ids.get('stop').disabled); }
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

test('static preview renders once and sleeps; hidden work is not rescheduled',async()=>{
  let renders=0;const p=C.defaultProject();p.settings.effect='static';
  const e=environment({stored:JSON.stringify(p),previewCore:{...C,render(...args){renders++;return C.render(...args);}}});
  try{
    e.runPreview();assert.equal(renders,1);assert.equal(e.previewCount,0);
    await pause(55);assert.equal(e.previewCount,0);
    e.ctx.document.visibilityState='hidden';e.ids.get('swatches').children[0].onclick();
    assert.equal(e.previewCount,0);
    e.ctx.document.visibilityState='visible';e.ctx.document.handlers.visibilitychange();e.runPreview();
    assert.equal(renders,2);assert.equal(e.previewCount,0);
  }finally{await e.cleanup();}
});

test('desktop tray visibility stops preview even when Chrome reports visible',async()=>{
  let notify,renders=0;
  const e=environment({desktop:{onPreviewVisibility(fn){notify=fn;}},previewCore:{...C,render(...args){renders++;return C.render(...args);}}});
  try{
    e.ctx.document.visibilityState='visible';assert.equal(e.previewCount,0);
    notify(true);assert.equal(e.previewCount,1);e.runPreview();assert.equal(renders,1);
    notify(false);e.ids.get('swatches').children[1].onclick();assert.equal(e.previewCount,0);
    await pause(60);assert.equal(e.previewCount,0);assert.equal(renders,1);
    notify(true);e.runPreview();assert.equal(renders,2);
  }finally{await e.cleanup();}
});

test('presses and ordinary edits do not resend a 120-frame timeline',async()=>{
  const d=fakeDevice(),p=C.defaultProject();p.settings.effect='static';
  p.frames=Array.from({length:120},()=>C.render(p,keys,0));
  const e=environment({chosen:d,stored:JSON.stringify(p)});
  try{
    await e.ids.get('connect').onclick();await e.ids.get('start').onclick();
    for(const code of ['KeyA','KeyB','KeyC'])e.ctx.window.handlers.keydown({code,target:new Element(),repeat:false,preventDefault(){}});
    e.ids.get('brightness').value='30';e.ids.get('brightness').handlers.input();await pause(70);
    assert.deepEqual(e.messages.filter(m=>m.type==='state').map(m=>m.frames),[120,undefined]);
    assert.equal(e.messages.filter(m=>m.type==='key-event').length,3);
    assert.ok(d.sent.length>0);
  }finally{await e.cleanup();}
});
