'use strict';
// Simulated clocks/HID only. This file does not open a browser or real keyboard.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../core.js'), keys = require('../layout.js');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function rig({ nativeLatency = 0, core = C, hardware } = {}) {
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
      const custom=hardware?.(packet);
      if(custom!==undefined){for(const ack of custom)for(const fn of [...listeners])fn({reportId:9,data:new DataView(ack.buffer)});return;}
      if (!this.replies || ![0x82,4].includes(packet[0])) return;
      const ack = packet[0] === 0x82 ? Uint8Array.from(require('./fixtures/hero99he-capabilities.json')) : new Uint8Array(63);
      if (packet[0] === 4) { ack.set([4,packet[1],0,1,0,0]); ack[62] = (255 - 9 - ack.reduce((a,b) => a+b,0)) & 255; }
      for (const fn of [...listeners]) fn({ reportId: 9, data: new DataView(ack.buffer) });
    }
  };
  const hid = { async getDevices() { return [device]; }, addEventListener(name, handler) { handlers[name] = handler; } };
  const options = { keys, hid, post: m => messages.push(m), now: () => time, sleep,
    setTimeout(fn, ms) { const timer = { at: time + ms, resolve: fn }; timers.push(timer); return timer; },
    clearTimeout(timer) { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at,1); } };
  const engine = core.createOutputEngine(options);
  const set = (effect = 'rainbow') => { const project = C.defaultProject(); project.settings.effect = effect; return engine.command('state', { project, selectedFrame: -1, events: [], heat: {}, time: 0 }); };
  const connect = () => engine.command('connect', { vendorId: device.vendorId, productId: device.productId, productName: device.productName });
  const stop = async () => { const pending = engine.command('stop'); await advance(100); await pending; };
  const emit=p=>{for(const fn of [...listeners])fn({reportId:9,data:new DataView(p.buffer,p.byteOffset,p.byteLength)});};
  return { engine, device, hid, options, handlers, messages, writes, timers, set, connect, stop, advance, sleep, emit };
}

test('background authorization and connection alone produce no lighting reports', async () => {
  const r = rig(); await r.set(); await r.advance(500); assert.equal(r.device.opens, 0); assert.equal(r.writes.length, 0);
  assert.equal((await r.connect()).productName, r.device.productName); assert.equal(r.device.opens, 1);
  await r.advance(1000); assert.equal(r.writes.length, 0);
  await r.engine.command('disconnect'); assert.equal(r.device.opened, false);
});
test('animated output advances for a second without any UI redraw, focus event, or page message', async () => {
  const r = rig(); await r.connect(); await r.set('wave'); await r.engine.command('start'); await r.advance(1000);
  assert.ok(r.writes.length >= 72); const first = r.writes.slice(0, 4).map(x => x.packet), last = r.writes.slice(-4).map(x => x.packet);
  assert.notDeepEqual(first, last);
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
  await r.advance(5000); assert.equal(r.writes.length, count); await assert.rejects(r.engine.command('start'), /先连接/);
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
    postMessage: m => messages.push(m), setTimeout: r.options.setTimeout, clearTimeout: r.options.clearTimeout });
  context.importScripts = url => {
    imported.push(url); assert.equal(url, 'layout.js?v=0.1.26');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../layout.js'), 'utf8'), context, { timeout: 1000 });
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../core.js'), 'utf8'), context, { timeout: 1000 });
  assert.equal(context.document, undefined); assert.equal(context.window, undefined); assert.equal(imported.length, 1);
  await context.onmessage({ data: { id: 1, type: 'connect', payload: r.device } }); assert.equal(messages.find(m => m.id === 1).ok, true); assert.equal(r.writes.length, 0);
  await context.onmessage({ data: { id: 2, type: 'start' } }); await r.advance(200); assert.ok(r.writes.length > 0);
  const stopped = context.onmessage({ data: { id: 3, type: 'stop' } }); await r.advance(100); await stopped;
  const count = r.writes.length; await r.advance(1000); assert.equal(r.writes.length, count); assert.equal(messages.find(m => m.id === 3).ok, true);
});

const setScene=(r,project)=>r.engine.command('state',{project,selectedFrame:-1,time:0});
async function apply(r,channel,sampledColor){
  const op=r.engine.command('apply-light',{channel,consent:true,sampledColor});
  await r.advance(160);return op;
}
test('native breathing sends one setting while keys continue and Logo is untouched',async()=>{
  const r=rig();await r.connect();const p=C.defaultProject();p.strip.mode='breathe';p.logo.mode='keyflash';await setScene(r,p);
  await r.engine.command('start');await r.advance(500);
  assert.ok(r.writes.every(w=>w.packet[0]===8&&w.packet[1]===1));
  assert.equal((await apply(r,'strip')).keyboard,true);
  const i=r.writes.findIndex(w=>w.packet[0]===4);
  assert.deepEqual(r.writes[i].packet.slice(0,8),[4,6,0,1,0,7,4,0]);
  assert.ok(r.writes[i+1].time-r.writes[i].time>=60);
  const n=r.writes.length;await r.advance(1000);assert.ok(r.writes.length-n>=70);
  assert.equal(r.writes.filter(w=>w.packet[0]===4).length,1);await r.stop();
});
test('native multicolor and auto pick stay one-shot and do not issue sync or block subsequent key frames',async()=>{
  for(const [mode,id,index] of [['native-neon',2,7],['native-marquee',5,7],['auto-color',3,0]]){
    const r=rig();await r.connect();const p=C.defaultProject();p.strip.mode=mode;p.settings.effect='ocean';await setScene(r,p);
    await r.engine.command('start');await r.advance(80);
    if(mode==='auto-color')await assert.rejects(r.engine.command('apply-light',{channel:'strip',consent:true,sampledColor:[999,20,50]}),/RGB/);
    const result=await apply(r,'strip',[25,40,95]);assert.equal(result.keyboard,true);
    const i=r.writes.findIndex(w=>w.packet[0]===4);
    assert.deepEqual(r.writes[i].packet.slice(0,8),[4,6,0,1,0,index?4:7,id,index]);
    if(mode==='auto-color')assert.deepEqual(result.sampledColor,[25,40,95]);
    assert.ok(r.writes[i+1].time-r.writes[i].time>=60);
    const n=r.writes.length;
    await setScene(r,{...p,settings:{...p.settings,color:[255,80,25],effect:'spectrum-sweep'}});
    await r.engine.command('key-event',{id:43,t:0.2});await r.advance(1000);
    assert.ok(r.writes.length-n>=68);assert.ok(r.writes.every(w=>[[4,6],[0x82,9],[8,1]].some(([a,b])=>w.packet[0]===a&&w.packet[1]===b)));
    await r.stop();assert.equal(r.writes.filter(w=>w.packet[0]===4).length,1);
  }
});
test('standalone native breath and solid Logo leave no recurring timers',async()=>{
  const r=rig();await r.connect();const p=C.defaultProject();p.strip.mode='breathe';p.logo.mode='solid';await setScene(r,p);
  await apply(r,'strip');await apply(r,'logo');
  assert.deepEqual(r.writes.map(w=>w.packet.slice(0,2)),[[0x82,9],[4,6],[4,11]]);
  assert.equal(r.timers.length,0);await r.advance(30000);assert.equal(r.writes.length,3);
});
test('static key presses leave the next keepalive timer untouched',async()=>{
  const r=rig();await r.connect();await r.set('static');await r.engine.command('start');await r.advance(20);
  assert.equal(r.timers.length,1);const timer=r.timers[0];
  for(let i=0;i<40;i++)await r.engine.command('key-event',{id:43,t:0.02});
  assert.equal(r.timers[0],timer);
  await r.advance(1000);assert.deepEqual(r.writes.filter(w=>w.packet[4]===0).map(w=>w.time),[0,255,510,765,1020]);
  await r.stop();assert.equal(r.timers.length,0);
});
test('Logo keyflash only wakes on press and expiry',async()=>{
  const r=rig();await r.connect();const p=C.defaultProject();p.logo.mode='keyflash';await setScene(r,p);await apply(r,'logo');
  assert.equal(r.timers.length,0);
  await r.engine.command('key-event',{id:43,t:0.16});await r.advance(10);
  const lit=r.writes.at(-1);assert.deepEqual(lit.packet.slice(8,11),p.settings.color);
  await r.advance(200);const dark=r.writes.at(-1);
  assert.deepEqual(dark.packet.slice(8,11),[0,0,0]);assert.ok(dark.time-lit.time>=158&&dark.time-lit.time<=162);
  assert.equal(r.timers.length,0);
});
test('Stop during capability query prevents any lamp setting',async()=>{
  const r=rig();r.device.replies=false;await r.connect();
  await assert.rejects(r.engine.command('apply-light',{channel:'strip'}),/确认/);
  const op=assert.rejects(r.engine.command('apply-light',{channel:'strip',consent:true}),/取消/);
  await r.advance(50);await r.stop();await op;
  assert.deepEqual(r.writes.map(w=>w.packet.slice(0,2)),[[0x82,9]]);assert.equal(r.timers.length,0);
});
test('retired Esc and hardware test commands are unavailable',async()=>{
  const r=rig();await r.connect();
  for(const name of ['test-interface','test-esc-live','inspect-esc-beads','set-native-esc','start-esc-uniform'])
    await assert.rejects(r.engine.command(name,{consent:true}),/未知/);
  assert.equal(r.writes.length,0);
});
