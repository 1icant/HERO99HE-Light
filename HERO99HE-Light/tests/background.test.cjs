'use strict';
// Simulated clocks/HID only. This file does not open a browser or real keyboard.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js'), keys = require('../layout.js');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function rig({ nativeLatency = 0 } = {}) {
  let time = 0; const timers = [], writes = [], messages = [], handlers = {}, listeners = new Set();
  const sleep = ms => new Promise(resolve => timers.push({ at: time + ms, resolve }));
  async function advance(ms) {
    const end = time + ms; let count = 0;
    await flush();
    while (true) {
      timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break;
      assert.ok(++count < 5000, 'no busy loop'); const next = timers.shift(); time = next.at; next.resolve(); await flush();
    }
    time = end; await flush();
  }
  const device = { vendorId: 0x372e, productId: 0x103e, productName: 'HERO 99 HE', opened: false, opens: 0, closes: 0,
    collections: [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 9, items: [{ reportCount: 63, reportSize: 8 }] }], inputReports: [{ reportId: 9, items: [{ reportCount: 63, reportSize: 8 }] }] }],
    replies: true,
    addEventListener(name, fn) { assert.equal(name, 'inputreport'); listeners.add(fn); }, removeEventListener(name, fn) { assert.equal(name, 'inputreport'); listeners.delete(fn); },
    async open() { this.opened = true; this.opens++; }, async close() { this.opened = false; this.closes++; },
    async sendReport(id, packet) {
      assert.equal(id, 9); assert.ok(this.opened); writes.push({ time, packet: [...packet] });
      if (packet[0] === 4 && nativeLatency) await sleep(nativeLatency);
      if (!this.replies || ![0x82,4].includes(packet[0])) return;
      const ack = packet[0] === 0x82 ? Uint8Array.from(require('./fixtures/hero99he-capabilities.json')) : new Uint8Array(63);
      if (packet[0] === 4) { ack.set([4,6,0,1,0,0]); ack[62] = (255 - 9 - ack.reduce((a,b) => a+b,0)) & 255; }
      for (const fn of [...listeners]) fn({ reportId: 9, data: new DataView(ack.buffer) });
    }
  };
  const hid = { async getDevices() { return [device]; }, addEventListener(name, handler) { handlers[name] = handler; } };
  const options = { keys, hid, post: m => messages.push(m), now: () => time, sleep,
    setTimeout(fn, ms) { const timer = { at: time + ms, resolve: fn }; timers.push(timer); return timer; },
    clearTimeout(timer) { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at,1); } };
  const engine = C.createOutputEngine(options);
  const set = (effect = 'rainbow') => { const project = C.defaultProject(); project.settings.effect = effect; return engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 }); };
  const connect = () => engine.command('connect', { vendorId: device.vendorId, productId: device.productId, productName: device.productName });
  const stop = async () => { const pending = engine.command('stop'); await advance(100); await pending; };
  return { engine, device, hid, options, handlers, messages, writes, set, connect, stop, advance, sleep };
}
test('background authorization and connection alone produce no lighting reports', async () => {
  const r = rig(); await r.set(); await r.advance(500); assert.equal(r.device.opens, 0); assert.equal(r.writes.length, 0);
  assert.equal((await r.connect()).mode, 'dedicated-worker'); assert.equal(r.device.opens, 1);
  await r.advance(1000); assert.equal(r.writes.length, 0);
  await r.engine.command('disconnect'); assert.equal(r.device.opened, false);
});
test('animated output advances for a second without any UI redraw, focus event, or page message', async () => {
  const r = rig(); await r.connect(); await r.set('wave'); await r.engine.command('start'); await r.advance(1000);
  assert.ok(r.writes.length >= 72); const first = r.writes.slice(0, 4).map(x => x.packet), last = r.writes.slice(-4).map(x => x.packet);
  assert.notDeepEqual(first, last); assert.ok(r.messages.some(m => m.event === 'stats' && m.sentFrames >= 15));
  for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i].time - r.writes[i - 1].time >= 5);
  await r.stop();
});
test('unchanged solid frames are resent at the keepalive interval without flooding', async () => {
  const r = rig(); await r.connect(); await r.set('static'); await r.engine.command('start'); await r.advance(1000);
  const starts = r.writes.filter(w => w.packet[4] === 0);
  assert.equal(starts.length, 4); assert.equal(r.writes.length, 8);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i].time - starts[i - 1].time >= C.OUTPUT_POLICY.keepAliveMs);
    assert.ok(starts[i].time - starts[i - 1].time <= 300);
    assert.deepEqual(starts[i].packet, starts[0].packet);
  }
  await r.stop(); const count = r.writes.length; await r.advance(2000); assert.equal(r.writes.length, count);
});
test('stop cancels the rest of a partially sent frame and restart retains pacing', async () => {
  const r = rig(); await r.connect(); await r.set(); await r.engine.command('start'); await r.advance(1); assert.equal(r.writes.length, 1);
  await r.stop(); assert.equal(r.writes.length, 1);
  await r.engine.command('start'); await r.advance(50); assert.ok(r.writes.length >= 5); assert.equal(r.writes[1].packet[4], 0);
  assert.ok(r.writes[1].time - r.writes[0].time >= 8); await r.stop();
});
test('disconnect closes the worker-owned HID handle and cannot auto-resume', async () => {
  const r = rig(); await r.connect(); await r.set(); await r.engine.command('start'); await r.advance(100);
  const pending = r.engine.command('disconnect'); await r.advance(100); await pending;
  assert.equal(r.device.opened, false); assert.equal(r.device.closes, 1); const count = r.writes.length;
  await r.advance(5000); assert.equal(r.writes.length, count); await assert.rejects(r.engine.command('start'), /尚未连接/);
});
test('physical removal stops output and reports disconnection without reconnecting', async () => {
  const r = rig(); await r.connect(); await r.set(); await r.engine.command('start'); await r.advance(20);
  const count = r.writes.length; r.handlers.disconnect({ device: r.device }); await r.advance(1000);
  assert.equal(r.writes.length, count); assert.ok(r.messages.some(m => m.event === 'disconnected')); assert.equal(r.device.opens, 1);
});
test('unsupported worker WebHID and ambiguous same-model devices are rejected', async () => {
  const r = rig(), unsupported = C.createOutputEngine({ ...r.options, hid: undefined });
  await assert.rejects(unsupported.command('connect', r.device), /后台 WebHID/);
  r.hid.getDevices = async () => [r.device, { ...r.device }]; await assert.rejects(r.connect(), /多把/);
  assert.equal(r.device.opens, 0); assert.equal(r.writes.length, 0);
});
test('worker transmission faults stop rather than retry or silently fall back to the page', async () => {
  const r = rig(); let calls = 0; r.device.sendReport = async () => { calls++; throw Error('fake transport error'); };
  await r.connect(); await r.set(); await r.engine.command('start'); await r.advance(1000);
  assert.equal(calls, 1); assert.ok(r.messages.some(m => m.event === 'fault' && /fake transport/.test(m.error))); await r.stop();
});
test('real worker entry imports only the local layout and runs without document or window', async () => {
  const r = rig(), messages = [], imported = [];
  const context = vm.createContext({ navigator: { hid: r.hid }, performance: { now: r.options.now },
    postMessage: m => messages.push(m), setTimeout: (fn, ms) => r.sleep(ms).then(fn) });
  context.importScripts = url => {
    imported.push(url); assert.equal(url, 'layout.js?v=0.1.12');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../layout.js'), 'utf8'), context, { timeout: 1000 });
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../core.js'), 'utf8'), context, { timeout: 1000 });
  assert.equal(context.document, undefined); assert.equal(context.window, undefined); assert.equal(imported.length, 1);
  await context.onmessage({ data: { id: 1, type: 'connect', payload: r.device } }); assert.equal(messages.find(m => m.id === 1).ok, true); assert.equal(r.writes.length, 0);
  await context.onmessage({ data: { id: 2, type: 'start' } }); await r.advance(200); assert.ok(r.writes.length > 0);
  const stopped = context.onmessage({ data: { id: 3, type: 'stop' } }); await r.advance(100); await stopped;
  const count = r.writes.length; await r.advance(1000); assert.equal(r.writes.length, count); assert.equal(messages.find(m => m.id === 3).ok, true);
});
test('linked strip adapts to heavy key frames with one serial budget and no UI redraw', async t => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.settings.effect = 'aurora'; project.settings.fps = 40; project.strip.mode = 'follow';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  await assert.rejects(r.engine.command('start'), /单独允许/);
  const begin = r.writes.length; await r.engine.command('start', { sideConsent: true }); await r.advance(3000);
  const output = r.writes.slice(begin), side = output.filter(w => w.packet[0] === 4);
  t.diagnostic('Heavy 40FPS target: '+side.length+' strip updates/3s, '+output.length+' packets/3s');
  assert.ok(side.length >= 59 && side.length <= 61); assert.ok(output.length <= 244, 'shared sustained 80 packets/sec budget');
  for (let i = 1; i < output.length; i++) assert.ok(output[i].time - output[i-1].time >= 5, 'packet gap shared across channels');
  for (let i = 1; i < side.length; i++) assert.ok(side[i].time - side[i-1].time >= 25, 'no early native update');
  let remaining = 0;
  for (const w of output) {
    if (w.packet[0] === 4) assert.equal(remaining, 0, 'no native command inside a key frame');
    else { if (w.packet[4] === 0) { assert.equal(remaining, 0); remaining = w.packet[3]; } remaining--; }
  }
  assert.ok(r.messages.some(m => m.event === 'stats' && m.sideUpdates >= 7));
  await r.stop(); const count = r.writes.length; await r.advance(1000); assert.equal(r.writes.length, count);
});
test('static key keepalive marks strip dirty until its own due time, without blocking keyboard', async () => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.settings.effect = 'static'; project.strip.mode = 'solid';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  await r.engine.command('start', { sideConsent: true }); await r.advance(2000);
  const strip = r.writes.filter(w => w.packet[0] === 4); assert.ok(strip.length >= 6 && strip.length <= 8);
  const starts = r.writes.filter(w => w.packet[0] === 8 && w.packet[4] === 0);
  assert.ok(starts.length >= 6);
  assert.ok(Math.abs(starts.length - strip.length) <= 1);
  for (let i=1; i<starts.length; i++) assert.ok(starts[i].time - starts[i-1].time <= 320);
  for (let i=1; i<strip.length; i++) assert.ok(strip[i].time - strip[i-1].time >= 250);
  await r.stop();
});
test('missing native ACK during streaming does not block or falsely claim device application', async () => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.strip.mode = 'breathe';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  r.device.replies = false;
  await r.engine.command('start', { sideConsent: true }); await r.advance(1000);
  assert.ok(r.writes.filter(w => w.packet[0] === 4).length >= 3);
  assert.ok(r.writes.some(w => w.packet[0] === 8)); assert.ok(!r.messages.some(m => m.event === 'fault'));
  assert.ok(r.messages.some(m => m.event === 'stats' && m.sideUpdates >= 2 && m.sideAcks === 0));
  await r.stop(); const count = r.writes.length; await r.advance(2000); assert.equal(r.writes.length, count);
});
test('stop during linked streaming cancels promptly and new connection requires fresh capabilities', async () => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.strip.mode = 'react';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  r.device.replies = false; await r.engine.command('start', { sideConsent: true }); await r.advance(100);
  assert.ok(r.writes.filter(w => w.packet[0] === 4).length >= 1);
  await r.stop(); const count = r.writes.length; await r.advance(500); assert.equal(r.writes.length, count);
  await r.engine.command('disconnect'); await r.connect();
  await assert.rejects(r.engine.command('start', { sideConsent: true }), /先读取/);
});
test('standalone strip animation never writes keys and no ACK is needed to keep submitting colors', async () => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.strip.mode = 'spectrum';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 }); r.device.replies = false;
  const at = r.writes.length;
  await r.engine.command('start', { keyboard: false, sideConsent: true }); await r.advance(1000);
  const output = r.writes.slice(at); assert.ok(output.length >= 39 && output.length <= 41); assert.ok(output.every(w => w.packet[0] === 4));
  for (let i=1; i<output.length; i++) assert.ok(output[i].time - output[i-1].time >= 25);
  assert.ok(r.messages.some(m => m.event === 'stats' && m.keyboardEnabled === false && m.sideUpdates >= 2)); await r.stop();
});
test('native USB send failure stops both streams without retrying the failed report', async () => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.strip.mode = 'follow';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  const original = r.device.sendReport.bind(r.device); let failed = 0;
  r.device.sendReport = async (id,p) => { if (p[0] === 4) { failed++; throw Error('USB failed'); } return original(id,p); };
  await r.engine.command('start', { sideConsent: true }); await r.advance(1500);
  assert.equal(failed, 1); assert.ok(r.messages.some(m => m.event === 'fault' && m.details?.phase === 'stream-send'));
  const at = r.writes.length; await r.advance(2000); assert.equal(r.writes.length, at); await r.stop();
});
test('heavy linked frames fit three key packets plus strip at stable 20FPS within unchanged budget', async t => {
  async function measure(linked) {
    const r = rig(); await r.connect();
    if (linked) await r.engine.command('inspect-lighting');
    const project = C.defaultProject(); project.settings.effect = 'wave'; project.settings.fps = 20; project.strip.mode = linked ? 'follow' : 'off';
    await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
    const begin = r.writes.length; await r.engine.command('start', { sideConsent: linked }); await r.advance(5000);
    const writes = r.writes.slice(begin), starts = writes.filter(w => w.packet[0] === 8 && w.packet[4] === 0), side = writes.filter(w => w.packet[0] === 4);
    const maxGap = Math.max(...starts.slice(1).map((w,i) => w.time-starts[i].time)); await r.stop(); return { writes, starts, side, maxGap };
  }
  const baseline = await measure(false), linked = await measure(true);
  t.diagnostic('Simulated only: baseline '+baseline.starts.length+'/5s, linked '+linked.starts.length+'/5s, max linked frame-start gap '+linked.maxGap+'ms, strip '+linked.side.length+'/5s');
  assert.ok(linked.starts.length >= 100); assert.equal(linked.starts.length,baseline.starts.length);
  assert.equal(linked.maxGap,50); assert.ok(linked.side.length >= 99 && linked.side.length <= 101);
  assert.ok(linked.starts.every(w=>w.packet[3]===3));
  for(const side of linked.side){const at=linked.writes.indexOf(side);assert.equal(linked.writes[at-1].packet[0],8);assert.equal(linked.writes[at-1].packet[4],2);}
  assert.ok(linked.writes.length <= 405, '80 packets/sec shared over five seconds');
  for (let i=1; i<linked.writes.length; i++) assert.ok(linked.writes[i].time-linked.writes[i-1].time >= 5);
  for (let second=0; second<5; second++) assert.equal(linked.starts.filter(w => w.time >= second*1000 && w.time < (second+1)*1000).length,20);
});

test('two-packet 20FPS animation leaves spare bandwidth for a faster independent strip', async t => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.settings.effect = 'studio'; project.settings.brightness = 1; project.strip.mode = 'spectrum';
  project.frameMs = 50; project.frames = Array.from({length:120},(_,i)=>Object.fromEntries(keys.map(k=>[k.id,[i+10,100,200]])));
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  const at = r.writes.length; await r.engine.command('start', { sideConsent: true }); await r.advance(5000);
  const output = r.writes.slice(at), starts = output.filter(w => w.packet[0] === 8 && w.packet[4] === 0), side = output.filter(w => w.packet[0] === 4);
  t.diagnostic('Light combined animation: '+starts.length+' key frames and '+side.length+' strip updates/5s');
  assert.ok(starts.length >= 98 && starts.length <= 101); assert.ok(side.length >= 198 && side.length <= 201);
  assert.ok(output.length <= 405); assert.ok(starts.every(w => w.packet[3] === 2));
  for (let i=1; i<starts.length; i++) assert.ok(starts[i].time-starts[i-1].time <= 51);
  assert.ok(side.some(w=>output[output.indexOf(w)-1].packet[0]===4),'strip also updates between key deadlines');
  await r.stop();
});

test('independent solid strip is deduplicated even with the faster refresh target', async () => {
  const r = rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.strip.mode = 'solid';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  const at = r.writes.length; await r.engine.command('start', { keyboard: false, sideConsent: true }); await r.advance(2000);
  assert.equal(r.writes.length-at,1); assert.equal(r.writes[at].packet[0],4); await r.stop();
});

test('unchanged complex keyboard colors leave bandwidth available for animated strip', async () => {
  const r=rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project=C.defaultProject(); project.settings.effect='gradient'; project.strip.mode='spectrum';
  await r.engine.command('state',{project,selectedFrame:-1,events:[],heat:{},time:0});
  const at=r.writes.length; await r.engine.command('start',{sideConsent:true}); await r.advance(2000);
  const output=r.writes.slice(at), starts=output.filter(w=>w.packet[0]===8&&w.packet[4]===0), side=output.filter(w=>w.packet[0]===4);
  assert.ok(starts.every(w=>w.packet[3]===3)); assert.ok(starts.length>=6&&starts.length<=8);
  assert.ok(side.length>=60&&side.length<=81,'static keys must not reserve unused 20FPS bandwidth'); await r.stop();
});

test('follow strip never resamples ahead of the completed keyboard frame', async () => {
  const r=rig();await r.connect();await r.engine.command('inspect-lighting');
  const project=C.defaultProject();project.settings.effect='studio';project.settings.fps=5;project.settings.brightness=0.5;project.strip.mode='follow';
  project.frames=Array.from({length:12},(_,i)=>Object.fromEntries(keys.map(k=>[k.id,[20+i*15,80,120]])));project.frameMs=25;
  await r.engine.command('state',{project,selectedFrame:-1,events:[],heat:{},time:0});
  const at=r.writes.length;await r.engine.command('start',{sideConsent:true});await r.advance(1500);
  const output=r.writes.slice(at),starts=output.filter(w=>w.packet[0]===8&&w.packet[4]===0),side=output.filter(w=>w.packet[0]===4);
  assert.ok(side.length>=7);assert.ok(Math.abs(starts.length-side.length)<=1);
  for(const native of side){
    const index=output.indexOf(native),start=output.slice(0,index).findLast(w=>w.packet[0]===8&&w.packet[4]===0);
    const ref=project.frames[Math.floor(start.time/project.frameMs)%project.frames.length][keys[0].id];
    assert.deepEqual(native.packet.slice(8,11),ref,'strip belongs to exactly the same sampled studio frame');
    assert.equal(output[index-1].packet[0],8);
  }
  await r.stop();
});

test('all frame-linked modes stay at complete keyboard-frame boundaries under changing colors', async () => {
  for(const mode of C.FRAME_STRIP_MODES.slice(1)){
    const r=rig();await r.connect();await r.engine.command('inspect-lighting');
    const p=C.defaultProject();p.settings.effect='studio';p.settings.fps=5;p.strip.mode=mode;p.strip.gain=1.4;
    p.frames=Array.from({length:12},(_,i)=>Object.fromEntries(keys.map(k=>[k.id,[20+i*15,80,120]])));p.frameMs=25;
    await r.engine.command('state',{project:p,selectedFrame:-1,events:[],heat:{},time:0});
    const at=r.writes.length;await r.engine.command('start',{sideConsent:true});await r.advance(1500);
    const output=r.writes.slice(at),side=output.filter(w=>w.packet[0]===4);assert.ok(side.length>=7,mode);
    for(const native of side){
      const index=output.indexOf(native),start=output.slice(0,index).findLast(w=>w.packet[0]===8&&w.packet[4]===0);
      const ref=p.frames[Math.floor(start.time/p.frameMs)%p.frames.length];
      assert.deepEqual(native.packet.slice(8,11),C.renderStrip(p,ref,start.time/1000,[],keys).color,mode);
      assert.equal(output[index-1].packet[0],8,mode+' must follow all key packets');
    }
    for(let i=1;i<output.length;i++)assert.ok(output[i].time-output[i-1].time>=5);
    await r.stop();const n=r.writes.length;await r.advance(500);assert.equal(r.writes.length,n);
  }
});

test('timed frame-linked modes animate over static keys without extra keyboard frames', async () => {
  for(const mode of ['follow-scan','follow-breathe','follow-split','follow-flash']){
    const r=rig();await r.connect();await r.engine.command('inspect-lighting');
    const p=C.defaultProject();p.settings.effect='gradient';p.strip.mode=mode;
    await r.engine.command('state',{project:p,selectedFrame:-1,events:[{t:0,x:0,y:0}],heat:{},time:0});
    const at=r.writes.length;await r.engine.command('start',{sideConsent:true});await r.advance(1000);
    const output=r.writes.slice(at),side=output.filter(w=>w.packet[0]===4),starts=output.filter(w=>w.packet[0]===8&&w.packet[4]===0);
    assert.ok(side.length>=15,mode+' animates without 250ms stalls');assert.ok(starts.length<=4);
    assert.ok(output.length<=85);await r.stop();
  }
});

test('5FPS keyboard limit does not hold strip animation behind the 200ms key timer', async t => {
  const r=rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project=C.defaultProject(); project.settings.effect='wave'; project.settings.fps=5; project.strip.mode='spectrum';
  await r.engine.command('state',{project,selectedFrame:-1,events:[],heat:{},time:0});
  const at=r.writes.length; await r.engine.command('start',{sideConsent:true}); await r.advance(3000);
  const output=r.writes.slice(at), starts=output.filter(w=>w.packet[0]===8&&w.packet[4]===0),side=output.filter(w=>w.packet[0]===4);
  t.diagnostic('5FPS key target: '+starts.length+' key frames, '+side.length+' strip updates/3s');
  assert.ok(starts.length>=14&&starts.length<=16); assert.ok(side.length>=85&&side.length<=121);
  assert.ok(output.length<=245); await r.stop();
});

test('follow strip keeps full reference colors even when keyboard brightness is zero', async () => {
  const r=rig(); await r.connect(); await r.engine.command('inspect-lighting');
  const project=C.defaultProject(); project.settings.effect='static'; project.settings.brightness=0; project.settings.color=[200,100,50]; project.strip.mode='follow'; project.strip.brightness=4;
  await r.engine.command('state',{project,selectedFrame:-1,events:[],heat:{},time:0});
  await r.engine.command('start',{sideConsent:true}); await r.advance(500);
  const side=r.writes.filter(w=>w.packet[0]===4); assert.ok(side.length>=1);
  assert.ok(side.every(w=>JSON.stringify(w.packet.slice(8,12))===JSON.stringify([200,100,50,4])));
  const key=r.writes.find(w=>w.packet[0]===8); assert.deepEqual(key.packet.slice(6,9),[0,0,0]); await r.stop();
});
test('a slower native USB completion costs only that transfer, not an added 250ms global sleep', async t => {
  const r = rig({ nativeLatency: 40 }); await r.connect(); await r.engine.command('inspect-lighting');
  const project = C.defaultProject(); project.settings.effect = 'wave'; project.strip.mode = 'follow';
  await r.engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 });
  await r.engine.command('start', { sideConsent: true }); await r.advance(3000);
  const starts = r.writes.filter(w => w.packet[0] === 8 && w.packet[4] === 0);
  assert.ok(starts.length >= 40); const maxGap = Math.max(...starts.slice(1).map((w,i) => w.time-starts[i].time)); assert.ok(maxGap <= 80);
  assert.ok(r.messages.some(m => m.event === 'stats' && m.maxControlSendMs === 40));
  t.diagnostic('Simulated native latency 40ms: '+starts.length+'/3s, max frame-start gap '+maxGap+'ms'); await r.stop();
});
