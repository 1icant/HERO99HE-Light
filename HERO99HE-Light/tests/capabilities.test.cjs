'use strict';
// Query construction and simulated inputreports only; never accesses real HID.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js'), keys = require('../layout.js');
function report({ rows = 1, columns = 80, length = 26 } = {}) {
  const bytes = new Uint8Array(63); bytes.set([0x82, 9, 0, 1, 0, length]);
  const data = new Uint8Array(56); data[18] = 1; data[19] = 0; data[20] = 12;
  data[21] = rows >>> 8; data[22] = rows & 255; data[23] = columns >>> 8; data[24] = columns & 255; data[25] = 7;
  bytes.set(data.slice(0, Math.min(length, 56)), 6); bytes[62] = (255 - 9 - bytes.reduce((a, b) => a + b, 0)) & 255;
  return bytes;
}
function device() {
  const listeners = new Set(), writes = [];
  const d = { vendorId: 0x372e, productId: 0x103e, productName: 'HERO 99 HE', opened: true,
    collections: [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 9, items: [{ reportSize: 8, reportCount: 63 }] }], inputReports: [{ reportId: 9, items: [{ reportSize: 8, reportCount: 63 }] }] }],
    addEventListener(type, handler) { assert.equal(type, 'inputreport'); listeners.add(handler); },
    removeEventListener(type, handler) { assert.equal(type, 'inputreport'); listeners.delete(handler); },
    async sendReport(id, packet) { writes.push({ id, packet: [...packet] }); }, async open() { this.opened = true; }, async close() { this.opened = false; }
  };
  function emit(bytes, id = 9, offset = 0) {
    const padded = new Uint8Array(bytes.length + offset + 4); padded.set(bytes, offset);
    for (const handler of [...listeners]) handler({ reportId: id, data: new DataView(padded.buffer, offset, bytes.length) });
  }
  return { d, writes, listeners, emit };
}
test('capability request is exactly one non-mutating 82/09 packet with valid checksum', () => {
  const bytes = C.buildLightingQuery(); assert.equal(bytes.length, 63);
  assert.deepEqual([...bytes.slice(0, 6)], [0x82, 9, 0, 1, 0, 0]); assert.ok(bytes.slice(6, 62).every(n => n === 0));
  assert.equal(bytes[62], 106); assert.equal((9 + bytes.reduce((a, b) => a + b, 0)) & 255, 255);
});
test('capability fields use firmware-provided dimensions, not a guessed LED count', () => {
  const parsed = C.parseLightingCapabilities(report({ rows: 2, columns: 257 }));
  assert.equal(parsed.readOnly, true); assert.equal(parsed.sideLight, true); assert.equal(parsed.logoLight, false); assert.equal(parsed.sideLightCount, 12);
  assert.deepEqual(parsed.lightbox, { rows: 2, columns: 257, effectMask: 7, dimensionsValid: true });
  assert.equal(parsed.featureBytes.length, 26); assert.equal(parsed.rawReport.length, 63);
});
test('missing and malformed capability fields do not invent a working lightbox', () => {
  assert.equal(C.parseLightingCapabilities(report({ length: 21 })).lightbox, null);
  assert.equal(C.parseLightingCapabilities(report({ rows: 0, columns: 0 })).lightbox, null);
  assert.equal(C.parseLightingCapabilities(report({ rows: 0, columns: 80 })).lightbox.dimensionsValid, false);
  for (const mutate of [b => b[0] = 4, b => b[1] = 6, b => b[3] = 2, b => b[4] = 1, b => b[62] ^= 1, b => b[5] = 57]) {
    const b = report(); mutate(b); assert.throws(() => C.parseLightingCapabilities(b));
  }
  assert.throws(() => C.parseLightingCapabilities(new Uint8Array(62)));
  const short = C.parseLightingCapabilities(report({ length: 20 }));
  assert.equal(short.logoLight, false); assert.equal(short.sideLightCount, null); assert.equal(short.lightboxDimensionsReported, false);
  assert.equal(short.capabilityFieldsComplete, false);
});
test('zero empty ACK stays unknown; nonzero short replies still honor their declared length', () => {
  const empty = C.parseLightingCapabilities(report({ length: 0 })); assert.equal(empty.sideLight, null);
  for (const length of [1, 18]) {
    const bytes = report({ length }); bytes[6 + 18] = 1; bytes[6 + 24] = 80;
    bytes[62] = 0; bytes[62] = (255 - 9 - bytes.reduce((a, b) => a + b, 0)) & 255;
    const parsed = C.parseLightingCapabilities(bytes);
    assert.equal(parsed.declaredLength, length); assert.equal(parsed.sideLight, null); assert.equal(parsed.logoLight, null);
    assert.equal(parsed.sideLightCount, null); assert.equal(parsed.lightbox, null); assert.equal(parsed.lightboxDimensionsReported, false);
  }
});
test('real HERO 99 HE capability report uses the official fixed body despite declared length zero', () => {
  const raw = require('./fixtures/hero99he-capabilities.json'), parsed = C.parseLightingCapabilities(raw);
  assert.equal(parsed.declaredLength, 0); assert.equal(parsed.parsedLength, 56); assert.equal(parsed.payloadFormat, 'official-fixed-body');
  assert.equal(parsed.capabilityFieldsComplete, true); assert.equal(parsed.sideLight, true); assert.equal(parsed.logoLight, true);
  assert.equal(parsed.sideLightCount, 23); assert.equal(parsed.lightbox, null); assert.equal(parsed.lightboxDimensionsReported, true);
  assert.deepEqual(parsed.rawReport, raw);
});
test('fixed capability response completes in one packet without waiting for timeout or querying again', async () => {
  const r = device(), probe = C.createLightingProbe(r.d); r.emit(Uint8Array.from(require('./fixtures/hero99he-capabilities.json')));
  const result = await probe.promise; assert.equal(result.waitExpired, undefined); assert.equal(result.sideLightCount, 23);
  assert.equal(r.writes.length, 1); assert.equal(r.listeners.size, 0);
});
test('native atmosphere color packet is a single independent 04/06 command, never key RGB', () => {
  const p = C.buildSideLightEffect({ mode: 3, color: [0, 160, 255], brightness: 2, speed: 2 });
  assert.deepEqual([...p.slice(0, 13)], [4, 6, 0, 1, 0, 7, 3, 0, 0, 160, 255, 2, 2]);
  assert.equal(p.length, 63); assert.equal((9 + p.reduce((a, b) => a + b, 0)) & 255, 255); assert.ok(p.slice(13, 62).every(n => n === 0));
  for (const bad of [{ mode: 1, color: [1, 2, 3], brightness: 2, speed: 2 }, { mode: 3, color: [1, 2, 3], brightness: 5, speed: 2 }, { mode: 3, color: [999, 2, 3], brightness: 2, speed: 2 }]) assert.throws(() => C.buildSideLightEffect(bad));
});
test('native control uses one matching verified ACK and never retries after timeout', async () => {
  const r = device(); let timeout;
  const options = { operation: 'side-light', settings: { mode: 3, color: [255, 0, 0], brightness: 2, speed: 2 }, setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {} };
  const first = C.createLightingProbe(r.d, options);
  const ack = new Uint8Array(63); ack.set([4, 6, 0, 1, 0, 0]); ack[62] = (255 - 9 - ack.reduce((a, b) => a + b, 0)) & 255;
  r.emit(report()); assert.equal(r.listeners.size, 1); r.emit(ack, 9, 3);
  const result = await first.promise; assert.equal(result.acknowledged, true); assert.equal(result.queryCapture.readOnly, false); assert.equal(result.hardwareVerified, false);
  const second = C.createLightingProbe(r.d, options), failure = assert.rejects(second.promise, /可能已改变/); timeout(); await failure;
  assert.equal(r.writes.length, 2); assert.equal(r.listeners.size, 0);
});
test('engine requires this connection capability and explicit consent before native changes', async () => {
  const r = device(), hid = { async getDevices() { return [r.d]; }, addEventListener() {} }, engine = C.createOutputEngine({ keys, hid });
  const payload = { consent: true, settings: { mode: 3, color: [1, 2, 3], brightness: 2, speed: 2 } };
  await engine.command('connect', r.d); await assert.rejects(engine.command('set-side-light', payload), /先读取/); assert.equal(r.writes.length, 0);
  const read = engine.command('inspect-lighting'); await new Promise(resolve => setImmediate(resolve)); r.emit(Uint8Array.from(require('./fixtures/hero99he-capabilities.json'))); await read;
  await assert.rejects(engine.command('set-side-light', { ...payload, consent: false }), /明确允许/); assert.equal(r.writes.length, 1);
  const write = engine.command('set-side-light', payload); await new Promise(resolve => setImmediate(resolve)); assert.equal(r.writes.length, 2); assert.equal(r.writes[1].packet[0], 4);
  await assert.rejects(engine.command('start'), /查询期间/);
  const ack = new Uint8Array(63); ack.set([4, 6, 0, 1, 0, 0]); ack[62] = (255 - 9 - ack.reduce((a, b) => a + b, 0)) & 255; r.emit(ack);
  assert.equal((await write).acknowledged, true); await engine.command('disconnect');
  await engine.command('connect', r.d); await assert.rejects(engine.command('set-side-light', payload), /先读取/); await engine.command('disconnect');
});
test('stop cancels native ACK wait, drains the operation and never resends the setting', async () => {
  const r = device(), hid = { async getDevices() { return [r.d]; }, addEventListener() {} }, engine = C.createOutputEngine({ keys, hid });
  await engine.command('connect', r.d);
  const read = engine.command('inspect-lighting'); await new Promise(resolve => setImmediate(resolve)); r.emit(Uint8Array.from(require('./fixtures/hero99he-capabilities.json'))); await read;
  const setting = engine.command('set-side-light', { consent: true, settings: { mode: 3, color: [1, 2, 3], brightness: 2, speed: 2 } });
  const rejected = assert.rejects(setting, /已发出的设置不能撤回/); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.writes.length, 2); await engine.command('stop'); await rejected;
  assert.equal(r.listeners.size, 0); assert.equal(r.writes.length, 2); await engine.command('disconnect');
});
test('an empty reply preceding full capability data does not prematurely complete or resend', async () => {
  const r = device(), probe = C.createLightingProbe(r.d);
  r.emit(report({ length: 0 })); assert.equal(r.listeners.size, 1);
  r.emit(report()); const result = await probe.promise;
  assert.equal(result.capabilityFieldsComplete, true); assert.equal(result.queryCapture.totalMatchingResponses, 2);
  assert.equal(result.queryCapture.responses[0].declaredLength, 0); assert.equal(result.queryCapture.responses[1].declaredLength, 26);
  assert.equal(r.writes.length, 1); assert.equal(r.listeners.size, 0);
});
test('short-only replies are captured until the original timeout and returned as partial', async () => {
  const r = device(); let timeout;
  const probe = C.createLightingProbe(r.d, { setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {} });
  for (let n = 0; n < 12; n++) r.emit(report({ length: n === 0 ? 20 : 0 }));
  timeout(); const result = await probe.promise;
  assert.equal(result.waitExpired, true); assert.equal(result.declaredLength, 20); assert.equal(result.sideLightCount, null);
  assert.equal(result.queryCapture.totalMatchingResponses, 12); assert.equal(result.queryCapture.responses.length, 8);
  assert.equal(r.writes.length, 1); assert.equal(r.listeners.size, 0);
});
test('invalid matching lengths retain raw response and exact declared length on failure', async () => {
  const r = device(), probe = C.createLightingProbe(r.d), invalid = report({ length: 57 });
  const failed = assert.rejects(probe.promise, error => {
    assert.match(error.message, /57.*56/); assert.equal(error.details.responses[0].declaredLength, 57);
    assert.deepEqual(error.details.responses[0].rawReport, [...invalid]); assert.equal(error.details.responses[0].byteLength, 63);
    return true;
  });
  r.emit(invalid); await failed; assert.equal(r.writes.length, 1);
});
test('probe filters unrelated reports, handles a nonzero DataView offset and releases listener', async () => {
  const r = device(), probe = C.createLightingProbe(r.d);
  assert.equal(r.writes.length, 1); assert.equal(r.writes[0].id, 9); assert.equal(r.writes[0].packet[0], 0x82);
  r.emit(new Uint8Array([1, 2, 3])); r.emit(report(), 2); assert.equal(r.listeners.size, 1);
  r.emit(report(), 9, 5); const parsed = await probe.promise;
  assert.equal(parsed.lightbox.columns, 80); assert.equal(r.listeners.size, 0); assert.equal(r.writes.length, 1);
});
test('invalid input descriptors and wrong models refuse to query', () => {
  for (const mutate of [d => d.collections[0].inputReports = [], d => d.collections[0].inputReports[0].items[0].reportCount = 64, d => d.productName = 'HERO 68']) {
    const r = device(); mutate(r.d); assert.throws(() => C.createLightingProbe(r.d)); assert.equal(r.writes.length, 0); assert.equal(r.listeners.size, 0);
  }
});
test('timeout and explicit cancellation clean up and never retry', async () => {
  for (const cancel of [false, true]) {
    const r = device(); let timeout, cleared = false;
    const probe = C.createLightingProbe(r.d, { setTimeout(fn, ms) { assert.equal(ms, 2000); timeout = fn; return 12; }, clearTimeout(id) { assert.equal(id, 12); cleared = true; } });
    const rejected = assert.rejects(probe.promise, cancel ? /取消/ : /超时/);
    cancel ? probe.cancel() : timeout(); await rejected;
    assert.equal(cleared, true); assert.equal(r.listeners.size, 0); assert.equal(r.writes.length, 1);
  }
});
test('send errors and malformed matching responses reject without changing lighting', async () => {
  const r = device(); r.d.sendReport = async () => { throw Error('fake send error'); };
  const probe = C.createLightingProbe(r.d); await assert.rejects(probe.promise, /fake send error/); assert.equal(r.listeners.size, 0);
  const s = device(), other = C.createLightingProbe(s.d), rejected = assert.rejects(other.promise, /校验/);
  const bad = report(); bad[62] ^= 1; s.emit(bad); await rejected; assert.equal(s.listeners.size, 0); assert.equal(s.writes.length, 1);
});
test('engine query is explicit, disallows concurrent start, and stop cancels pending query', async () => {
  const r = device(), hid = { async getDevices() { return [r.d]; }, addEventListener() {} }, engine = C.createOutputEngine({ keys, hid });
  await engine.command('connect', r.d); assert.equal(r.writes.length, 0);
  const pending = engine.command('inspect-lighting'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.writes.length, 1); await assert.rejects(engine.command('start'), /查询期间/);
  const rejected = assert.rejects(pending, /取消/); await engine.command('stop'); await rejected;
  assert.equal(r.listeners.size, 0); assert.equal(r.writes.length, 1); await engine.command('disconnect');
});
