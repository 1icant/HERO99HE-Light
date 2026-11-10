'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const keys = require('../layout.js');
const frame = color => Object.fromEntries(keys.map(k => [k.id, [...color]]));
function unpack(packets) {
  const stream = packets.flatMap(p => Array.from(p.slice(6, 6 + p[5]))), out = {};
  for (let at = 0; at < stream.length;) {
    const c = stream.slice(at, at + 3), n = stream[at + 3]; at += 4;
    assert.ok(n > 0 && n <= 52);
    for (let i = 0; i < n; i++) { assert.equal(out[stream[at]], undefined); out[stream[at++]] = c; }
  }
  return out;
}
const device = () => ({ vendorId: 0x372e, productId: 0x103e, productName: 'HERO 99 HE', collections: [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 9, items: [{ reportCount: 63, reportSize: 8 }] }], children: [] }] });
test('101 physical positions match the supplied keyboard and keep Bytech IDs', () => {
  assert.equal(keys.length, 101); assert.equal(new Set(keys.map(k => k.id)).size, 101);
  for (const k of keys) { assert.ok(k.id > 0 && k.id <= 255); assert.ok(k.x >= 0 && k.y >= 0 && k.w > 0 && k.h > 0); }
  for (const [code, id] of [['Escape', 1], ['KeyA', 43], ['Space', 70], ['NumpadEnter', 83], ['NumLock', 78]]) assert.equal(keys.find(k => k.code === code).id, id);
});
test('navigation column is Del, Insert, PgUp, PgDn and top row matches the supplied image', () => {
  const column = ['Delete', 'Insert', 'PageUp', 'PageDown'].map(code => keys.find(k => k.code === code));
  assert.deepEqual(column.map(k => k.id), [99, 98, 102, 103]);
  assert.deepEqual(column.map(k => k.x), [833, 833, 833, 833]);
  assert.deepEqual(column.map(k => k.y), [0, 55, 110, 165]);
  assert.deepEqual(keys.filter(k => k.y === 0).slice(-5).map(k => k.label), ['Del', 'PrtSc', 'ScrLc', 'Home', 'End']);
  const fn = keys.find(k => k.label === 'Fn'); assert.equal(fn.id, 72); assert.equal(fn.code, ''); assert.equal(fn.y, 275);
  assert.equal(keys.find(k => k.code === 'PrintScreen').id, 95);
  const bottom = keys.filter(k => k.y === 275).sort((a,b) => a.x-b.x);
  assert.deepEqual(bottom.slice(0,6).map(k => k.label), ['L-Ctrl','L-Win/CMD','L-Alt/OPT','Space','Fn','R-Ctrl/OPT']);
  const e = keys.find(k => k.code === 'KeyE'), w = keys.find(k => k.code === 'KeyW'), r = keys.find(k => k.code === 'KeyR');
  assert.equal(e.x-w.x, r.x-e.x); // Equal spacing, previously E was shifted right.
  for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
    const p = keys[a], q = keys[b];
    assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, 'overlap: ' + p.label + '/' + q.label);
  }
});
test('Esc and Insert both survive encoding and multicolor preparation', () => {
  const p = C.defaultProject();
  for (const effect of C.EFFECTS) {
    p.settings.effect = effect;
    const output = C.prepareOutput(C.render(p, keys, 0.73), keys), decoded = unpack(output.packets);
    assert.deepEqual(decoded[1], output.frame[1]); assert.deepEqual(decoded[98], output.frame[98]);
    assert.equal(Object.keys(decoded).length, keys.length);
  }
});
test('v0.1 and v0.1.1 projects migrate without losing legacy physical colors', () => {
  const p = C.defaultProject(); delete p.layout;
  const oldIds = [...Array.from({ length: 94 }, (_, i) => i + 1), 99, 100, 101, 102, 103];
  p.paint = { 1: [10, 20, 30], 71: [40, 50, 60], 72: [70, 80, 90] };
  p.frames = [Object.fromEntries(oldIds.map(id => [id, [id, 100, 200]]))];
  const saved = JSON.stringify(p), migrated = C.validateProject(p, keys);
  assert.equal(JSON.stringify(p), saved); assert.equal(migrated.layout, 'hero99he-101/v1');
  assert.deepEqual(migrated.paint, { 1: [10, 20, 30], 72: [40, 50, 60], 95: [70, 80, 90] });
  const f = migrated.frames[0]; assert.equal(Object.keys(f).length, keys.length);
  for (const id of oldIds) assert.deepEqual(f[id === 71 ? 72 : id === 72 ? 95 : id], p.frames[0][id]);
  assert.deepEqual(f[96], f[100]); assert.deepEqual(f[98], f[99]);
  assert.deepEqual(C.validateProject(JSON.parse(JSON.stringify(migrated)), keys), migrated);
  delete p.frames[0][1]; assert.throws(() => C.validateProject(p, keys), /旧配置键位/);
});
test('uniform 101-position frame uses two packets, fixed header and golden first checksum', () => {
  const packets = C.buildPackets(frame([0, 160, 255]), keys);
  assert.equal(packets.length, 2);
  assert.deepEqual(packets.map(p => p[62]), [146, 239]);
  assert.deepEqual(Array.from(packets[0].slice(0, 10)), [8, 1, 0, 2, 0, 56, 0, 160, 255, 52]);
  assert.deepEqual(unpack(packets), frame([0, 160, 255]));
  for (const [index, packet] of packets.entries()) {
    assert.equal(packet.length, 63); assert.equal(packet[3], 2); assert.equal(packet[4], index);
    assert.equal((9 + packet.reduce((a, b) => a + b, 0)) & 255, 255);
    assert.ok(packet[5] <= 56);
    assert.ok(packet.slice(6 + packet[5], 62).every(n => n === 0));
  }
});
test('101 different colors round-trip across payload boundaries', () => {
  const input = Object.fromEntries(keys.map((k, i) => [k.id, [i, (i * 7) % 256, 255 - i]]));
  const packets = C.buildPackets(input, keys);
  assert.equal(packets.length, Math.ceil(keys.length * 5 / 56)); assert.deepEqual(unpack(packets), input);
});
test('repeated colors, black and maximal values round-trip', () => {
  for (let n = 0; n < 30; n++) {
    const input = Object.fromEntries(keys.map((k, i) => [k.id, [i % (n + 1), n % 2 ? 255 : 0, (i * n) % 256]]));
    const packets = C.buildPackets(input, keys); assert.deepEqual(unpack(packets), input);
    for (const p of packets) assert.equal((9 + p.reduce((a, b) => a + b, 0)) & 255, 255);
  }
});
test('incomplete, alien or malformed frames cannot be encoded', () => {
  assert.throws(() => C.buildPackets({}, keys)); const missing = frame([1, 2, 3]); delete missing[43]; assert.throws(() => C.buildPackets(missing, keys));
  assert.throws(() => C.buildPackets({ ...frame([1, 2, 3]), 255: [1, 2, 3] }, keys));
  for (const bad of [[-1, 0, 0], [256, 0, 0], [NaN, 0, 0], [0, 0], 'red']) assert.throws(() => C.buildPackets({ ...frame([1, 2, 3]), 43: bad }, keys));
});
test('strict device name, interface and report descriptor gate', () => {
  for (const name of ['HERO 99 HE', 'HERO 99', 'AULA HERO99HE']) { const d = device(); d.productName = name; assert.equal(C.validateDevice(d), true); }
  for (const mutation of [d => d.vendorId = 0x1ca2, d => d.productId = 0x1901, d => d.productName = 'HERO 68 HE', d => d.productName = 'Generic HERO99 Test', d => d.collections[0].usage = 1, d => d.collections[0].outputReports[0].reportId = 8, d => d.collections[0].outputReports[0].items[0].reportCount = 64]) {
    const d = device(); mutation(d); assert.throws(() => C.validateDevice(d));
  }
  const d = device(); d.collections = [{ usagePage: 1, usage: 6, children: d.collections }]; assert.equal(C.validateDevice(d), true);
});
test('all effects produce exactly 101 bounded RGB colors', () => {
  const p = C.defaultProject(); p.frames.push(frame([5, 127, 255]));
  for (const effect of C.EFFECTS) for (const t of [0, 0.1, 1, 9, 10000]) {
    p.settings.effect = effect;
    const rendered = C.render(p, keys, t, [{ t: 0, x: 102, y: 165 }], { 43: 100 });
    assert.equal(Object.keys(rendered).length, 101);
    for (const color of Object.values(rendered)) for (const n of color) assert.ok(Number.isInteger(n) && n >= 0 && n <= 255);
  }
});
test('brightness applies once; paint overlays non-studio effects only', () => {
  const p = C.defaultProject(); p.settings.brightness = 0.5; p.paint[43] = [200, 100, 20];
  assert.deepEqual(C.render(p, keys, 0)[43], [100, 50, 10]);
  assert.deepEqual(C.render(p, keys, 0, [], {}, false)[43], [200, 100, 20]);
  p.settings.effect = 'studio'; p.frames = [frame([10, 20, 30])]; assert.deepEqual(C.render(p, keys, 0)[43], [5, 10, 15]);
  p.settings.brightness = 0; assert.ok(Object.values(C.render(p, keys, 0)).every(c => c.every(n => n === 0)));
});
test('projects round-trip and are defensively copied', () => {
  const p = C.defaultProject(); p.paint[43] = [1, 2, 3]; p.frames.push(frame([4, 5, 6]));p.frameDurations=[100];
  const copy = C.validateProject(JSON.parse(JSON.stringify(p)), keys); assert.deepEqual(copy, p);
  copy.paint[43][0] = 255; assert.equal(p.paint[43][0], 1);
});
test('unsafe or excessive imports fail before changing project', () => {
  for (const mutate of [p => p.format = 'other', p => p.settings.fps = 1000, p => p.settings.speed = 0, p => p.settings.brightness = Infinity, p => p.settings.effect = 'eval', p => p.frameMs = 0, p => p.frames = Array(121).fill(frame([0, 0, 0])), p => p.frames = [{}], p => p.paint[255] = [1, 2, 3]]) {
    const p = C.defaultProject(); mutate(p);
    assert.throws(() => C.validateProject(p, keys));
  }
  const malicious = JSON.parse('{"__proto__":[1,2,3]}'); const p = C.defaultProject(); p.paint = malicious; assert.throws(() => C.validateProject(p, keys));
});

test('variable frame durations select exact boundaries, speed and legacy migration correctly',()=>{
  const p=C.defaultProject();p.settings.effect='studio';p.settings.brightness=1;p.frames=[frame([200,0,0]),frame([0,150,0])];p.frameDurations=[50,150];
  for(const [t,index]of [[0,0],[0.049,0],[0.05,1],[0.199,1],[0.2,0]]){assert.equal(C.studioFrameAt(p,t),index);assert.deepEqual(C.render(p,keys,t)[1],p.frames[index][1]);}
  p.settings.speed=2;assert.deepEqual(C.render(p,keys,0.025)[1],[0,150,0]);
  assert.deepEqual(C.validateProject(JSON.parse(JSON.stringify(p)),keys).frameDurations,[50,150]);
  delete p.frameDurations;p.frameMs=125;assert.deepEqual(C.validateProject(p,keys).frameDurations,[125,125]);
  for(const durations of [[10,100],[100],[100,6000],[100,'150'],null]){p.frameDurations=durations;assert.throws(()=>C.validateProject(p,keys),/逐帧时长/);}
});
test('working static, breathing and meteor frames keep exact original RGB and packets', () => {
  const p = C.defaultProject();
  for (const effect of ['static', 'breathe', 'meteor']) {
    p.settings.effect = effect;
    for (let i = 0; i < 180; i++) {
      const original = C.render(p, keys, i / 60), output = C.prepareOutput(original, keys);
      assert.equal(output.limited, false, effect + ' at ' + i);
      assert.deepEqual(output.frame, original); assert.deepEqual(output.packets, C.buildPackets(original, keys));
    }
  }
});
test('rainbow and wave frames shrink from 6-9 packets to at most four', () => {
  const p = C.defaultProject(); let totalError = 0, channels = 0;
  for (const effect of ['rainbow', 'wave']) {
    p.settings.effect = effect;
    for (let i = 0; i < 180; i++) {
      const original = C.render(p, keys, i / 60), saved = JSON.stringify(original), output = C.prepareOutput(original, keys);
      assert.ok(C.buildPackets(original, keys).length > 4); assert.equal(output.limited, true);
      assert.ok(output.packets.length <= 4); assert.ok(output.colors <= 24);
      assert.deepEqual(unpack(output.packets), output.frame); assert.equal(JSON.stringify(original), saved);
      for (const k of keys) for (let c = 0; c < 3; c++) { totalError += Math.abs(original[k.id][c] - output.frame[k.id][c]); channels++; }
    }
  }
  assert.ok(totalError / channels < 5, 'average RGB error remains small');
});
test('color reduction preserves off keys, is deterministic and keeps all 101 keys', () => {
  const input = Object.fromEntries(keys.map((k, i) => [k.id, [i * 2, (i * 7) % 256, (i * 13) % 256]])); input[43] = [0, 0, 0];
  const first = C.prepareOutput(input, keys), second = C.prepareOutput(input, keys);
  assert.ok(first.limited); assert.deepEqual(first, second); assert.deepEqual(first.frame[43], [0, 0, 0]);
  assert.equal(Object.keys(first.frame).length, 101); assert.deepEqual(unpack(first.packets), first.frame);
});
test('random complex scenes stay within four packets and maintain valid checksums', () => {
  let seed = 123456789; const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
  for (let i = 0; i < 300; i++) {
    const input = Object.fromEntries(keys.map(k => [k.id, [rand(), rand(), rand()]]));
    const result = C.prepareOutput(input, keys);
    assert.ok(result.packets.length <= 4); assert.ok(result.colors <= 24); assert.deepEqual(unpack(result.packets), result.frame);
    for (const packet of result.packets) assert.equal((9 + packet.reduce((a, b) => a + b, 0)) & 255, 255);
  }
});
test('packet-aware FPS cap does not slow two-packet scenes at 20 FPS', () => {
  assert.equal(C.frameInterval(20, 2), 50); assert.equal(C.frameInterval(20, 4), 50);
  assert.equal(C.frameInterval(40, 4), 50); assert.equal(C.frameInterval(40, 3), 37.5);
  assert.equal(C.frameInterval(40, 2), 25); assert.equal(C.frameInterval(5, 4), 200);
});
