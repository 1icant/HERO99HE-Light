'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js'), keys = require('../layout.js');
function rig({ latency = 0, advance } = {}) {
  let time = 0; const writes = [];
  const clock = { now: () => time, sleep: async ms => { time += ms; advance?.(time); } };
  const device = { async sendReport(id, bytes) { assert.equal(id, 9); writes.push({ time, index: bytes[4], total: bytes[3], length: bytes.length }); time += latency; } };
  const sender = C.createSender(device, clock);
  return { clock, writes, sender };
}
function packets(effect = 'rainbow') { const p = C.defaultProject(); p.settings.effect = effect; return C.prepareOutput(C.render(p, keys, 0), keys).packets; }
test('packets are paced, frame order is intact, sustained four-packet output is <= 80 packets/s', async () => {
  const r = rig(), p = packets();
  for (let i = 0; i < 20; i++) assert.equal(await r.sender.sendFrame(p, 40), true);
  for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i].time - r.writes[i - 1].time >= 5);
  for (let frame = 0; frame < 20; frame++) {
    const writes = r.writes.slice(frame * 4, frame * 4 + 4); assert.deepEqual(writes.map(w => w.index), [0, 1, 2, 3]);
    assert.ok(writes.every(w => w.total === 4 && w.length === 63));
    if (frame) assert.ok(writes[0].time - r.writes[(frame - 1) * 4].time >= 50);
  }
  assert.equal(r.writes[76].time, 950);
});
test('slow HID completions receive a drain gap, with no catch-up burst', async () => {
  const r = rig({ latency: 30 }), p = packets();
  for (let i = 0; i < 3; i++) await r.sender.sendFrame(p, 40);
  for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i].time - r.writes[i - 1].time >= 35);
  assert.ok(r.writes[4].time >= r.writes[3].time + 30 + 8);
});
test('cancelling during a packet gap stops all remaining packets and next frame', async () => {
  let valid = true; const r = rig({ advance: time => { if (time >= 5) valid = false; } });
  assert.equal(await r.sender.sendFrame(packets(), 20, () => valid), false); assert.equal(r.writes.length, 1);
  assert.equal(await r.sender.sendFrame(packets(), 20, () => valid), false); assert.equal(r.writes.length, 1);
});
test('cancelling during an inter-frame wait cannot start a stale frame', async () => {
  let valid = true, armed = false; const r = rig({ advance: () => { if (armed) valid = false; } });
  await r.sender.sendFrame(packets(), 20, () => valid); armed = true;
  assert.equal(await r.sender.sendFrame(packets(), 20, () => valid), false); assert.equal(r.writes.length, 4);
});
test('restart on the same connection preserves packet spacing after a partial frame', async () => {
  let valid = true, armed = true; const r = rig({ advance: () => { if (armed) valid = false; } });
  assert.equal(await r.sender.sendFrame(packets(), 20, () => valid), false); assert.equal(r.writes.length, 1);
  armed = false; valid = true; await r.sender.sendFrame(packets(), 20, () => valid);
  assert.ok(r.writes[1].time >= 8); assert.deepEqual(r.writes.slice(1).map(w => w.index), [0, 1, 2, 3]);
});
test('concurrent frame submissions are rejected instead of interleaved', async () => {
  const r = rig(), first = r.sender.sendFrame(packets(), 20);
  await assert.rejects(r.sender.sendFrame(packets(), 20), /并发/); await first;
  assert.equal(r.writes.length, 4);
});
test('over-budget frames cannot bypass stable output', async () => {
  const r = rig(), input = Object.fromEntries(keys.map((k, i) => [k.id, [i, i * 2, i * 2 + 1]]));
  await assert.rejects(r.sender.sendFrame(C.buildPackets(input, keys), 20), /包数/); assert.equal(r.writes.length, 0);
});
test('transport errors do not wedge the queue or cause automatic retries', async () => {
  let fail = true, calls = 0, time = 0;
  const sender = C.createSender({ async sendReport() { calls++; if (fail) throw Error('unplugged'); } }, { now: () => time, sleep: async ms => { time += ms; } });
  await assert.rejects(sender.sendFrame(packets(), 20), /unplugged/); assert.equal(calls, 1);
  fail = false; assert.equal(await sender.sendFrame(packets(), 20), true); assert.equal(calls, 5);
});

test('native control can use idle key time without bypassing the shared packet budget', async () => {
  const r=rig(), native=C.buildSideLightEffect({mode:3,color:[1,2,3],brightness:2,speed:2});
  assert.equal(C.STRIP_POLICY.intervalMs,25); assert.equal(C.STRIP_POLICY.maxRefreshHz,40);
  await r.sender.sendFrame(packets(),5);
  assert.equal(r.sender.nextReadyAt(),200); assert.equal(r.sender.nextReadyAt(true),50);
  await r.sender.sendControl(native); assert.equal(r.writes[4].time,50);
  await r.sender.sendFrame(packets(),5); assert.equal(r.writes[5].time,200);
});

test('native tail follows all four key packets and shares their frame budget and packet gap', async () => {
  let time = 0; const writes = [], controls = [];
  const sender = C.createSender({ async sendReport(id,p) { writes.push({ time, command:p[0], index:p[4] }); } },
    { now:()=>time, sleep:async ms=>{time+=ms;}, onControl: ms=>controls.push(ms) });
  const native = C.buildSideLightEffect({mode:3,color:[10,20,30],brightness:2,speed:2});
  for(let i=0;i<16;i++) await sender.sendFrame(packets(),40,()=>true,native);
  assert.equal(controls.length,16); assert.ok(controls.every(ms=>ms===0));
  for(let i=0;i<16;i++) {
    const frame = writes.slice(i*5,i*5+5);
    assert.deepEqual(frame.map(w=>w.command),[8,8,8,8,4]);
    assert.deepEqual(frame.slice(0,4).map(w=>w.index),[0,1,2,3]);
    assert.equal(frame[0].time,i*62.5); assert.equal(frame[4].time,frame[0].time+20);
  }
  assert.ok(writes.every((w,i)=>!i || w.time-writes[i-1].time>=5));
});

test('stop in the final packet gap cancels the native tail before any write', async () => {
  let valid=true; const r=rig({advance:time=>{if(time>=20)valid=false;}});
  const native=C.buildSideLightEffect({mode:3,color:[10,20,30],brightness:2,speed:2});
  assert.equal(await r.sender.sendFrame(packets(),20,()=>valid,native),false);
  assert.equal(r.writes.length,4);
});
