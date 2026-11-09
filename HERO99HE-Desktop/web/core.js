(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HeroCore = api;
  // The same allowlisted URL is also the Dedicated Worker entry point.
  // It owns the HID handle; the page owns only permission selection and UI.
  if (typeof document === 'undefined' && typeof importScripts === 'function' && typeof postMessage === 'function') {
    importScripts('layout.js?v=0.1.12');
    const engine = api.createOutputEngine({ keys: root.HeroKeys, hid: root.navigator.hid, post: message => root.postMessage(message) });
    root.onmessage = async event => {
      const { id, type, payload } = event.data || {};
      try { const result = await engine.command(type, payload); if (id) root.postMessage({ id, ok: true, result }); }
      catch (error) {
        if (!id) await engine.command('stop');
        root.postMessage(id ? { id, ok: false, error: error.message, details: error.details || null } : { event: 'fault', error: error.message });
      }
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const REPORT_ID = 9, REPORT_BYTES = 63, PAYLOAD_BYTES = 56;
  const OUTPUT_POLICY = Object.freeze({ maxFramePackets: 4, paletteColors: 24, packetGapMs: 5, frameGapMs: 8, packetsPerSecond: 80, keepAliveMs: 250 });
  // 101 IDs + up to 15 color headers (+ a possible split header) fit 3 packets,
  // leaving the fourth budget slot for the strip at the default 20FPS.
  const LINK_POLICY = Object.freeze({ maxFramePackets: 3, paletteColors: 15 });
  const EFFECTS = ['static', 'rainbow', 'wave', 'breathe', 'meteor', 'ripple', 'heatmap', 'studio', 'gradient', 'aurora', 'checker', 'scanner', 'twinkle', 'fire', 'radar', 'keyfade', 'paletteflow', 'verticalrainbow', 'diagonal', 'spiral', 'plasma', 'rain', 'cometpair', 'centerwave', 'curtain', 'diamond', 'ribbons', 'fireflies', 'orbit', 'sunset', 'sparkburst', 'keycross'];
  const FRAME_STRIP_MODES = Object.freeze(['follow', 'follow-dominant', 'follow-scan', 'follow-breathe', 'follow-complement', 'follow-split', 'follow-flash']);
  const TIMED_FRAME_STRIP_MODES = ['follow-scan', 'follow-breathe', 'follow-split', 'follow-flash'];
  const STRIP_MODES = ['off', 'solid', 'breathe', 'spectrum', 'palette', 'pulse', 'follow', 'react', ...FRAME_STRIP_MODES.slice(1)];
  const STRIP_POLICY = Object.freeze({ intervalMs: 25, maxRefreshHz: 40 });
  const PRESETS = [
    { name: '冰川蓝', color: [75,210,255], bg: [2,10,24], palette: [[20,70,200],[75,210,255],[210,250,255]] },
    { name: '赛博霓虹', color: [255,65,185], bg: [12,2,25], palette: [[255,30,160],[115,50,255],[0,220,255]] },
    { name: '极光森林', color: [90,255,170], bg: [2,15,13], palette: [[20,200,100],[80,255,210],[100,80,255]] },
    { name: '日落橘', color: [255,150,65], bg: [20,4,12], palette: [[255,65,95],[255,150,65],[255,220,140]] },
    { name: '樱花粉', color: [255,160,200], bg: [20,5,15], palette: [[255,100,170],[255,185,210],[210,155,255]] },
    { name: '深海', color: [40,160,240], bg: [1,5,18], palette: [[15,35,110],[20,110,200],[40,240,220]] },
    { name: '熔岩', color: [255,95,25], bg: [15,2,0], palette: [[150,10,5],[255,80,10],[255,215,65]] },
    { name: '薰衣草', color: [185,155,255], bg: [12,6,23], palette: [[100,80,190],[185,155,255],[245,180,230]] },
    { name: '暖白金', color: [255,225,170], bg: [15,10,5], palette: [[180,115,40],[255,210,130],[255,245,225]] },
    { name: '电竞红蓝', color: [255,55,75], bg: [3,4,18], palette: [[255,35,65],[110,35,210],[30,145,255]] },
    { name: '薄荷苏打', color: [115,255,205], bg: [2,15,11], palette: [[35,180,155],[115,255,205],[225,255,225]] },
    { name: '蓝莓酸奶', color: [165,145,255], bg: [9,5,23], palette: [[75,65,170],[165,145,255],[245,215,255]] },
    { name: '落日海岸', color: [255,175,120], bg: [15,7,20], palette: [[255,100,100],[255,190,120],[75,170,235]] },
    { name: '桃子汽水', color: [255,180,160], bg: [18,6,6], palette: [[255,130,135],[255,205,165],[255,235,205]] },
    { name: '月光银', color: [205,225,255], bg: [5,8,16], palette: [[85,110,160],[175,200,240],[245,250,255]] },
    { name: '酸性青柠', color: [200,255,45], bg: [8,15,0], palette: [[70,180,30],[180,255,45],[245,255,150]] },
    { name: '玫瑰荆棘', color: [245,70,125], bg: [19,1,9], palette: [[110,15,65],[245,70,125],[255,175,195]] },
    { name: '紫电', color: [175,70,255], bg: [8,1,22], palette: [[70,25,180],[175,70,255],[245,150,255]] },
    { name: '黑金', color: [245,185,65], bg: [0,0,0], palette: [[80,50,5],[210,145,30],[255,230,145]] },
    { name: '冰火', color: [65,200,255], bg: [3,3,12], palette: [[20,120,255],[60,235,255],[255,70,25]] },
    { name: '糖果屋', color: [255,135,220], bg: [18,5,20], palette: [[255,125,190],[130,215,255],[215,170,255],[255,220,130]] },
    { name: '抹茶拿铁', color: [180,220,140], bg: [9,13,5], palette: [[85,135,65],[180,220,140],[245,235,185]] },
    { name: '热带雨林', color: [35,230,115], bg: [0,13,6], palette: [[0,100,65],[25,220,105],[160,250,55]] },
    { name: '珊瑚礁', color: [255,135,110], bg: [3,12,18], palette: [[25,190,200],[255,135,110],[255,210,140]] },
    { name: '午夜霓虹', color: [100,105,255], bg: [1,0,10], palette: [[40,50,180],[150,40,255],[255,35,140]] },
    { name: '星云', color: [200,110,255], bg: [7,2,18], palette: [[35,70,175],[165,65,220],[245,125,200]] },
    { name: '琥珀', color: [255,185,55], bg: [18,7,0], palette: [[150,65,5],[255,160,25],[255,230,120]] },
    { name: '赤霞', color: [255,90,70], bg: [20,1,4], palette: [[140,10,40],[255,85,65],[255,180,120]] },
    { name: '孔雀蓝', color: [35,210,220], bg: [0,10,15], palette: [[15,85,145],[25,205,200],[95,240,170]] },
    { name: '棉花云', color: [225,205,255], bg: [12,9,20], palette: [[175,205,255],[245,190,220],[230,225,255]] }
  ];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const byte = n => Math.round(clamp(Number.isFinite(n) ? n : 0, 0, 255));
  function rgb(value) {
    if (!Array.isArray(value) || value.length !== 3 || value.some(n => !Number.isFinite(n) || n < 0 || n > 255)) throw Error('颜色必须是 0–255 的 RGB 三元组');
    return value.map(byte);
  }
  function hsv(h, s = 1, v = 1) {
    h = ((h % 1) + 1) % 1;
    const f = (n) => { const k = (n + h * 6) % 6; return byte(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))); };
    return [f(5), f(3), f(1)];
  }
  const mix = (a, b, t) => a.map((c, i) => byte(c + (b[i] - c) * clamp(t, 0, 1)));
  function paletteColor(colors, position) {
    const p = ((position % 1) + 1) % 1, at = p * colors.length, i = Math.floor(at);
    return mix(colors[i], colors[(i + 1) % colors.length], at - i);
  }
  function colorMap(value, keys, complete = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('键位颜色表格式错误');
    const valid = new Set(keys.map(k => String(k.id))), out = {};
    for (const [id, color] of Object.entries(value)) {
      if (!valid.has(id)) throw Error('配置包含不属于 HERO 99HE 的键号：' + id);
      out[id] = rgb(color);
    }
    if (complete && Object.keys(out).length !== keys.length) throw Error('动画帧必须包含全部 ' + keys.length + ' 个键');
    return out;
  }
  function buildPackets(frame, keys) {
    const colors = colorMap(frame, keys, true), groups = new Map();
    for (const key of keys) {
      if (!Number.isInteger(key.id) || key.id < 0 || key.id > 255) throw Error('无效硬件键号');
      const c = colors[key.id], packed = c[0] * 65536 + c[1] * 256 + c[2];
      if (!groups.has(packed)) groups.set(packed, []);
      groups.get(packed).push(key.id);
    }
    const stream = [];
    for (const [packed, ids] of groups) {
      for (let at = 0; at < ids.length; at += 52) {
        const part = ids.slice(at, at + 52);
        stream.push((packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255, part.length, ...part);
      }
    }
    const total = Math.ceil(stream.length / PAYLOAD_BYTES), packets = [];
    if (!total || total > 255) throw Error('灯光帧过长');
    for (let index = 0; index < total; index++) {
      const payload = stream.slice(index * PAYLOAD_BYTES, (index + 1) * PAYLOAD_BYTES);
      const packet = new Uint8Array(REPORT_BYTES);
      packet.set([8, 1, 0, total, index, payload.length]);
      packet.set(payload, 6);
      let sum = REPORT_ID;
      for (let i = 0; i < REPORT_BYTES - 1; i++) sum += packet[i];
      packet[62] = (255 - sum) & 255;
      packets.push(packet);
    }
    return packets;
  }
  // Keep the proven on-wire framing. Reduce only frames heavier than the
  // 2-4 packet effects reported working on the user's keyboard.
  function prepareOutput(frame, keys, policy = OUTPUT_POLICY) {
    if (!Number.isInteger(policy.maxFramePackets) || policy.maxFramePackets < 1 || policy.maxFramePackets > OUTPUT_POLICY.maxFramePackets || !Number.isInteger(policy.paletteColors) || policy.paletteColors < 1 || policy.paletteColors > OUTPUT_POLICY.paletteColors) throw Error('无效稳帧预算');
    const source = colorMap(frame, keys, true), originalPackets = buildPackets(source, keys);
    const histogram = new Map();
    for (const key of keys) {
      const color = source[key.id], packed = color[0] * 65536 + color[1] * 256 + color[2];
      const entry = histogram.get(packed);
      if (entry) entry.count++; else histogram.set(packed, { packed, color, count: 1 });
    }
    const sourceColors = histogram.size;
    if (originalPackets.length <= policy.maxFramePackets) return { frame: source, packets: originalPackets, sourceColors, colors: sourceColors, limited: false };
    // Deterministic weighted median cut; projects and captured frames retain
    // their original colors. Preserve real black (off) exactly.
    const entries = [...histogram.values()].sort((a, b) => a.packed - b.packed);
    const black = entries.find(entry => entry.packed === 0);
    const boxes = [entries.filter(entry => entry !== black)];
    const budget = policy.paletteColors - (black ? 1 : 0);
    function extent(box) {
      const lo = [255, 255, 255], hi = [0, 0, 0]; let weight = 0;
      for (const entry of box) { weight += entry.count; for (let axis = 0; axis < 3; axis++) { lo[axis] = Math.min(lo[axis], entry.color[axis]); hi[axis] = Math.max(hi[axis], entry.color[axis]); } }
      const ranges = hi.map((v, axis) => v - lo[axis]);
      const axis = ranges.indexOf(Math.max(...ranges));
      return { axis, score: box.length > 1 ? ranges[axis] * Math.sqrt(weight) : -1, weight };
    }
    while (boxes.length < budget) {
      let selected = -1, best = -1, bounds;
      for (let i = 0; i < boxes.length; i++) { const next = extent(boxes[i]); if (next.score > best) { selected = i; best = next.score; bounds = next; } }
      if (selected < 0) break;
      const box = boxes[selected].slice().sort((a, b) => a.color[bounds.axis] - b.color[bounds.axis] || a.packed - b.packed);
      let count = 0, cut = 1;
      for (let i = 0; i < box.length - 1; i++) { count += box[i].count; cut = i + 1; if (count >= bounds.weight / 2) break; }
      boxes.splice(selected, 1, box.slice(0, cut), box.slice(cut));
    }
    const replacements = new Map();
    if (black) replacements.set(0, [0, 0, 0]);
    for (const box of boxes) {
      const sum = [0, 0, 0]; let count = 0;
      for (const entry of box) { count += entry.count; entry.color.forEach((v, axis) => { sum[axis] += v * entry.count; }); }
      const color = sum.map(v => byte(v / count));
      for (const entry of box) replacements.set(entry.packed, color);
    }
    const result = {};
    for (const key of keys) { const c = source[key.id]; result[key.id] = [...replacements.get(c[0] * 65536 + c[1] * 256 + c[2])]; }
    const packets = buildPackets(result, keys);
    if (packets.length > policy.maxFramePackets) throw Error('复杂灯光帧超出稳定输出预算，已拒绝发送');
    return { frame: result, packets, sourceColors, colors: new Set(Object.values(result).map(c => c.join(','))).size, limited: true };
  }
  function frameInterval(fps, packets) {
    const target = Number.isFinite(fps) ? clamp(fps, 5, 40) : 20;
    return Math.max(1000 / target, Math.max(1, packets) * 1000 / OUTPUT_POLICY.packetsPerSecond);
  }
  function createSender(device, options = {}) {
    const clock = options.now || (() => performance.now());
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let nextPacketAt = 0, nextFrameAt = 0, nextBudgetAt = 0, busy = false;
    async function until(deadline, valid) {
      while (valid()) { const left = deadline - clock(); if (left <= 0) return true; await sleep(Math.max(1, Math.min(25, left))); }
      return false;
    }
    function nextReadyAt(control = false) { return Math.max(nextBudgetAt, control ? nextPacketAt : nextFrameAt); }
    async function ready(valid = () => true, control = false) { return until(nextReadyAt(control), valid); }
    async function sendFrame(packets, fps, valid = () => true, controlPacket = null) {
      if (busy) throw Error('不允许并发提交灯光帧');
      if (!packets.length || packets.length > OUTPUT_POLICY.maxFramePackets) throw Error('灯光帧超出稳定输出包数');
      busy = true;
      let completed = false;
      try {
        if (!await ready(valid)) return false;
        const began = clock();
        for (const packet of packets) {
          if (!await until(nextPacketAt, valid)) return false;
          await device.sendReport(REPORT_ID, packet);
          nextPacketAt = clock() + OUTPUT_POLICY.packetGapMs;
          options.onPacket?.();
        }
        // Append only AFTER the complete key frame. Account for the native tail
        // in this transaction rather than waiting out a second frame reservation.
        if (controlPacket) {
          if (!await until(nextPacketAt, valid)) return false;
          const controlBegan = clock();
          try { await device.sendReport(REPORT_ID, controlPacket); }
          catch (error) { error.details = { readOnly: false, query: '04/06', phase: 'stream-send', acknowledged: false }; throw error; }
          nextPacketAt = clock() + OUTPUT_POLICY.packetGapMs;
          options.onControl?.(clock() - controlBegan); options.onPacket?.();
        }
        nextFrameAt = began + frameInterval(fps, packets.length);
        nextBudgetAt = Math.max(began + (packets.length + (controlPacket ? 1 : 0)) * 1000 / OUTPUT_POLICY.packetsPerSecond, clock() + OUTPUT_POLICY.frameGapMs);
        completed = valid();
        return completed;
      } finally { if (!completed) nextBudgetAt = Math.max(nextBudgetAt, clock() + OUTPUT_POLICY.frameGapMs); busy = false; }
    }
    async function sendControl(packet, valid = () => true) {
      if (busy) throw Error('不允许并发提交灯光控制');
      busy = true; let began = clock();
      try {
        if (!await ready(valid, true) || !await until(nextPacketAt, valid)) return false;
        began = clock(); await device.sendReport(REPORT_ID, packet);
        options.onControl?.(clock() - began);
        options.onPacket?.(); return true;
      } finally {
        nextPacketAt = clock() + OUTPUT_POLICY.packetGapMs;
        nextBudgetAt = Math.max(nextBudgetAt, began + 1000 / OUTPUT_POLICY.packetsPerSecond, clock() + OUTPUT_POLICY.frameGapMs);
        busy = false;
      }
    }
    return { ready, nextReadyAt, sendFrame, sendControl };
  }
  function defaultProject() {
    return { format: 'hero99-light/v1', layout: 'hero99he-101/v1', settings: { effect: 'rainbow', brightness: 0.6, speed: 1, fps: 20, color: [97, 218, 251], bg: [5, 8, 18], palette: [[97,218,251],[189,155,255],[246,153,182]] }, strip: { mode: 'off', color: [0,160,255], brightness: 2, gain: 1 }, paint: {}, frames: [], frameMs: 100 };
  }
  function renderStrip(project, frame, t, events = [], keys = []) {
    const strip = project.strip, s = project.settings, time = t * s.speed;
    const mean = values => [0,1,2].map(axis => byte(values.reduce((sum, c) => sum + c[axis], 0) / Math.max(1, values.length)));
    const values = FRAME_STRIP_MODES.includes(strip.mode) ? Object.values(frame) : [];
    function dominant() {
      // Cluster similar colors, ignoring off keys so sparse effects stay vivid.
      const groups = new Map();
      for (const c of values) {
        const weight = Math.max(...c); if (weight < 8) continue;
        const id = c.map(n => Math.floor(n / 32)).join(',');
        if (!groups.has(id)) groups.set(id, { weight: 0, color: [0,0,0] });
        const g = groups.get(id); g.weight += weight;
        c.forEach((n, i) => { g.color[i] += n * weight; });
      }
      const best = [...groups.values()].sort((a,b) => b.weight - a.weight)[0];
      return best ? best.color.map(n => byte(n / best.weight)) : mean(values);
    }
    const keyColors = ['follow-scan', 'follow-split'].includes(strip.mode) ? keys.filter(k => frame[k.id]).map(k => ({ x: k.x + k.w / 2, color: frame[k.id] })) : [];
    let color = strip.color;
    switch (strip.mode) {
      case 'off': return null;
      case 'breathe': color = mix([0,0,0], color, (Math.sin(time * 2) + 1) / 2); break;
      case 'spectrum': color = hsv(time * 0.08, 0.85); break;
      case 'palette': color = paletteColor(s.palette, time * 0.09); break;
      case 'pulse': color = mix([0,0,0], color, Math.pow((Math.sin(time * 3) + 1) / 2, 3)); break;
      case 'follow': {
        // Caller supplies the pre-key-brightness color frame for follow mode.
        // The strip has its own hardware brightness; do not dim it twice.
        color = mean(values); break;
      }
      case 'follow-dominant': color = dominant(); break;
      case 'follow-scan': {
        if (!keyColors.length) { color = mean(values); break; }
        const lo = Math.min(...keyColors.map(k => k.x)), hi = Math.max(...keyColors.map(k => k.x));
        const width = Math.max(1, hi - lo), center = lo + width * (Math.sin(time * 0.9) + 1) / 2;
        let total = 0; const sums = [0,0,0];
        for (const k of keyColors) {
          const weight = Math.exp(-0.5 * Math.pow((k.x - center) / (width * 0.12), 2)); total += weight;
          k.color.forEach((n,i) => { sums[i] += n * weight; });
        }
        color = sums.map(n => byte(n / total)); break;
      }
      case 'follow-breathe': color = mix([0,0,0], mean(values), 0.15 + 0.85 * (Math.sin(time * 2) + 1) / 2); break;
      case 'follow-complement': {
        const base = dominant(), sum = Math.max(...base) + Math.min(...base);
        color = base.map(n => sum - n); break;
      }
      case 'follow-split': {
        if (!keyColors.length) { color = mean(values); break; }
        const mid = (Math.min(...keyColors.map(k => k.x)) + Math.max(...keyColors.map(k => k.x))) / 2;
        const left = keyColors.filter(k => k.x <= mid).map(k => k.color), right = keyColors.filter(k => k.x > mid).map(k => k.color);
        color = mix(mean(left), mean(right.length ? right : left), (Math.sin(time * 1.4) + 1) / 2); break;
      }
      case 'follow-flash': {
        let level = 0;
        for (const event of events) { const age = (t - event.t) * s.speed; if (age >= 0 && age < 1.5) level = Math.max(level, Math.exp(-age * 4)); }
        color = mix(mean(values).map(n => byte(n * 0.25)), dominant(), level); break;
      }
      case 'react': {
        let level = 0;
        for (const event of events) { const age = (t - event.t) * s.speed; if (age >= 0 && age < 1.5) level = Math.max(level, Math.exp(-age * 3)); }
        color = mix(s.bg, s.color, level); break;
      }
    }
    // Software-only gain, capped by the brightest channel to preserve hue and
    // keep black black. Hardware brightness remains the proven 0..4 range.
    const gain = Math.min(strip.gain ?? 1, 255 / Math.max(1, ...color));
    return { mode: 3, color: color.map(n => byte(n * gain)), brightness: strip.brightness, speed: 2 };
  }
  function buildLightingQuery() {
    // Public legacy lighting service: checkLightingSupported -> encode(0x82, 9, []).
    const packet = new Uint8Array(REPORT_BYTES);
    packet.set([0x82, 9, 0, 1, 0, 0]);
    packet[62] = (255 - REPORT_ID - packet.reduce((sum, value) => sum + value, 0)) & 255;
    return packet;
  }
  function parseLightingCapabilities(report) {
    if (!report || report.length !== REPORT_BYTES) throw Error('灯光能力响应长度不是 63 字节');
    const bytes = Uint8Array.from(report);
    if (bytes[0] !== 0x82 || bytes[1] !== 9 || bytes[3] !== 1 || bytes[4] !== 0) throw Error('不是预期的单包灯光能力响应');
    if (((REPORT_ID + bytes.reduce((sum, value) => sum + value, 0)) & 255) !== 255) throw Error('灯光能力响应校验失败');
    if (bytes[5] > PAYLOAD_BYTES) throw Error('灯光能力声明数据长度 ' + bytes[5] + ' 超过报告上限 ' + PAYLOAD_BYTES);
    // Unlike generic decode(), the official checkLightingSupported() explicitly
    // slices raw payload[6:62]. HERO 99 HE returns populated data with length=0.
    // Apply this exception ONLY to this checksummed 82/09 capability response.
    const fixedBody = bytes[5] === 0 && bytes.slice(6, 62).some(value => value !== 0);
    const data = bytes.slice(6, fixedBody ? 62 : 6 + bytes[5]), rows = data.length >= 25 ? (data[21] << 8) | data[22] : 0, columns = data.length >= 25 ? (data[23] << 8) | data[24] : 0;
    return { readOnly: true, query: '82/09', declaredLength: bytes[5], parsedLength: data.length, payloadFormat: fixedBody ? 'official-fixed-body' : 'declared-length', capabilityFieldsComplete: data.length >= 26, lightboxDimensionsReported: data.length >= 25,
      responseKind: data.length === 0 ? 'empty-reply' : data.length < 26 ? 'partial-capabilities' : 'capabilities',
      sideLight: data.length > 18 ? Boolean(data[18]) : null, logoLight: data.length > 19 ? Boolean(data[19]) : null, sideLightCount: data.length > 20 ? data[20] : null,
      lightbox: rows || columns ? { rows, columns, effectMask: data.length >= 26 ? data[25] : null, dimensionsValid: rows > 0 && columns > 0 } : null,
      featureBytes: Array.from(data), rawReport: Array.from(bytes) };
  }
  function buildSideLightEffect(settings) {
    if (!settings || settings.mode !== 3) throw Error('目前只允许已核对的氛围灯自定义常亮模式 3');
    for (const name of ['brightness', 'speed']) if (!Number.isInteger(settings[name]) || settings[name] < 0 || settings[name] > 4) throw Error('氛围灯参数必须为 0–4 的整数：' + name);
    const color = rgb(settings.color), packet = new Uint8Array(REPORT_BYTES);
    // Official setEffect(2): encode(4, 6, [mode, colorIndex, R,G,B, brightness,speed]).
    packet.set([4, 6, 0, 1, 0, 7, 3, 0, ...color, settings.brightness, settings.speed]);
    packet[62] = (255 - REPORT_ID - packet.reduce((sum, value) => sum + value, 0)) & 255;
    return packet;
  }
  function createLightingProbe(device, options = {}) {
    validateDevice(device);
    function hasInput(list) {
      return (list || []).some(c => (c.usagePage === 0xff60 && c.usage === 0x61 && (c.inputReports || []).some(r => r.reportId === REPORT_ID && (r.items || []).reduce((n, item) => n + item.reportCount * item.reportSize, 0) === REPORT_BYTES * 8)) || hasInput(c.children));
    }
    if (!hasInput(device.collections) || !device.addEventListener || !device.removeEventListener) throw Error('未找到 Report 9 / 63 字节的输入通道，未发送查询；请导出诊断');
    const native = options.operation === 'side-light';
    if (options.operation !== undefined && !native) throw Error('不支持的灯光操作');
    const request = native ? buildSideLightEffect(options.settings) : buildLightingQuery();
    const command = native ? 4 : 0x82, parameter = native ? 6 : 9;
    const setTimer = options.setTimeout || setTimeout, clearTimer = options.clearTimeout || clearTimeout;
    let cancel;
    const promise = new Promise((resolve, reject) => {
      let settled = false, timer, best = null;
      const responses = []; let totalMatchingResponses = 0;
      function details() { return { readOnly: !native, query: native ? '04/06' : '82/09', totalMatchingResponses, responses: responses.map(item => ({ ...item, rawReport: [...item.rawReport] })) }; }
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimer(timer); device.removeEventListener('inputreport', onReport);
        if (error) { error.details = details(); reject(error); }
        else resolve({ ...result, queryCapture: details() });
      };
      const onReport = event => {
        if (event.reportId !== REPORT_ID || !event.data || event.data.byteLength < 2) return;
        const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        if (bytes[0] !== command || bytes[1] !== parameter) return; // Ignore unrelated reports, including keyboard activity.
        totalMatchingResponses++;
        const captured = { receivedOrder: totalMatchingResponses, reportId: event.reportId, byteLength: bytes.length, declaredLength: bytes.length > 5 ? bytes[5] : null, rawReport: Array.from(bytes.slice(0, REPORT_BYTES)) };
        // Bound diagnostic memory even if a device repeatedly emits matching replies.
        if (responses.length < 8) responses.push(captured);
        try {
          if (native) {
            if (bytes.length !== REPORT_BYTES || bytes[3] !== 1 || bytes[4] !== 0 || bytes[5] > PAYLOAD_BYTES) throw Error('氛围灯设置回执格式异常；不会重试');
            if (((REPORT_ID + bytes.reduce((sum, value) => sum + value, 0)) & 255) !== 255) throw Error('氛围灯设置回执校验失败；不会重试');
            finish(null, { acknowledged: true, effect: { mode: 3, color: rgb(options.settings.color), brightness: options.settings.brightness, speed: options.settings.speed }, rawReport: Array.from(bytes), hardwareVerified: false }); return;
          }
          const parsed = parseLightingCapabilities(bytes);
          if (!best || parsed.declaredLength >= best.declaredLength) best = parsed;
          if (parsed.capabilityFieldsComplete) finish(null, parsed);
          // A short reply may be an acknowledgement preceding the actual data.
          // Keep listening within the original timeout, without sending again.
        } catch (error) { captured.parseError = error.message; finish(error); }
      };
      cancel = () => finish(Error(native ? '氛围灯设置等待已取消；已发出的设置不能撤回' : '灯光能力查询已取消'));
      device.addEventListener('inputreport', onReport);
      timer = setTimer(() => best ? finish(null, { ...best, waitExpired: true }) : finish(Error(native ? '氛围灯设置回执超时，灯效可能已改变；不会重试，请观察实物并导出诊断' : '灯光能力查询超时，未收到匹配响应；未设置任何灯效，请导出诊断')), options.timeoutMs || 2000);
      try { Promise.resolve((options.sendReport || ((id, packet) => device.sendReport(id, packet)))(REPORT_ID, request)).catch(error => finish(error)); }
      catch (error) { finish(error); }
    });
    return { promise, cancel: () => cancel?.() };
  }
  function createOutputEngine(options) {
    const { keys, hid } = options, post = options.post || (() => {});
    const clock = options.now || (() => performance.now());
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let device = null, sender = null, running = false, generation = 0, loopPromise = null, connecting = false;
    let lightingProbe = null, probing = false, lightingCapabilities = null, controlPromise = null;
    let sideConsent = false, lastSideAt = -Infinity, lastSideKey = '', sideUpdates = 0, sideAcks = 0, maxControlSendMs = 0;
    let keyboardEnabled = true, activeStrip = null, sideDirty = false, lastReference = null;
    const sideAck = event => {
      if (!sideConsent || event.reportId !== REPORT_ID || event.data?.byteLength !== REPORT_BYTES) return;
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      if (bytes[0] === 4 && bytes[1] === 6 && bytes[3] === 1 && bytes[4] === 0 && bytes[5] <= PAYLOAD_BYTES && ((REPORT_ID + bytes.reduce((sum,n) => sum+n,0)) & 255) === 255) sideAcks++;
    };
    let project = defaultProject(), selectedFrame = -1, events = [], heat = {}, epoch = clock(), time = 0;
    let sentFrames = 0, sentPackets = 0, lastSentAt = -Infinity, lastStatsAt = -Infinity, beganAt = 0, maxFrameGapMs = 0, previous = '', lastOutput = null;
    function state(value) {
      const validated = validateProject(value.project, keys), selected = value.selectedFrame;
      if (!Number.isInteger(selected) || selected < -1 || selected >= validated.frames.length) throw Error('后台动画帧索引无效');
      if (!Number.isFinite(value.time) || value.time < 0) throw Error('后台时间参数无效');
      if (!Array.isArray(value.events) || value.events.length > 60 || value.events.some(e => !e || ![e.t, e.x, e.y].every(Number.isFinite))) throw Error('后台按键事件无效');
      const nextHeat = {}, validIds = new Set(keys.map(k => String(k.id)));
      if (!value.heat || typeof value.heat !== 'object' || Array.isArray(value.heat)) throw Error('后台热力参数无效');
      for (const [id, count] of Object.entries(value.heat)) {
        if (!validIds.has(id) || !Number.isFinite(count) || count < 0) throw Error('后台热力键号无效');
        nextHeat[id] = count;
      }
      project = validated; selectedFrame = selected; events = value.events.map(e => ({ t: e.t, x: e.x, y: e.y })); heat = nextHeat;
      epoch = clock(); time = value.time;
    }
    function sample(scale = true, sampledAt = clock()) {
      if (selectedFrame >= 0) return Object.fromEntries(keys.map(k => [k.id, project.frames[selectedFrame][k.id].map(c => byte(c * (scale ? project.settings.brightness : 1)))]));
      return render(project, keys, time + (sampledAt - epoch) / 1000, events, heat, scale);
    }
    function stats(force = false) {
      if (!force && clock() - lastStatsAt < 250) return;
      lastStatsAt = clock();
      post({ event: 'stats', running, keyboardEnabled, sentFrames, sentPackets, maxFrameGapMs, maxControlSendMs, sideUpdates, sideAcks, stripMode: sideConsent ? activeStrip.mode : 'off', fps: sentFrames * 1000 / Math.max(1, clock() - beganAt),
        lastFrame: lastOutput ? { sourceColors: lastOutput.sourceColors, colors: lastOutput.colors, packets: lastOutput.packets.length, limited: lastOutput.limited } : null });
    }
    async function stop() {
      running = false; sideConsent = false; generation++;
      device?.removeEventListener?.('inputreport', sideAck);
      probing = false; lightingProbe?.cancel();
      if (controlPromise) await controlPromise.catch(() => {});
      if (loopPromise) await loopPromise;
      stats(true);
    }
    async function loop(token) {
      const valid = () => running && token === generation && Boolean(device);
      while (valid()) {
        // Independent key and native deadlines; low keyboard FPS must not hold
        // the strip behind the key frame timer. Both share the packet budget.
        const frameLinked = sideConsent && keyboardEnabled && FRAME_STRIP_MODES.includes(activeStrip.mode);
        const linkedAnimation = frameLinked && TIMED_FRAME_STRIP_MODES.includes(activeStrip.mode);
        const linkedLocked = frameLinked && !linkedAnimation;
        const nextAt = Math.min(keyboardEnabled ? sender.nextReadyAt() : Infinity,
          sideConsent && (!linkedLocked || sideDirty) ? Math.max(sender.nextReadyAt(true), lastSideAt + STRIP_POLICY.intervalMs) : Infinity);
        if (nextAt > clock()) { await sleep(Math.max(1, Math.min(25, nextAt - clock()))); continue; }
        const sampledAt = clock(), reference = sample(false, sampledAt);
        const frame = Object.fromEntries(keys.map(k => [k.id, reference[k.id].map(c => byte(c * project.settings.brightness))]));
        const output = prepareOutput(frame, keys, sideConsent && keyboardEnabled ? LINK_POLICY : OUTPUT_POLICY), key = JSON.stringify(output.frame);
        const keyChanged = key !== previous;
        const keyDue = keyboardEnabled && sampledAt >= sender.nextReadyAt() && (keyChanged || sampledAt - lastSentAt >= OUTPUT_POLICY.keepAliveMs);
        let settings = null, sideKey = '', controlPacket = null;
        const controlFits = !keyboardEnabled || !keyChanged || sampledAt + Math.max(1000 / OUTPUT_POLICY.packetsPerSecond, maxControlSendMs + OUTPUT_POLICY.frameGapMs) <= sender.nextReadyAt();
        const sideDue = sideConsent && sampledAt >= sender.nextReadyAt(true) && (keyDue ||
          (sampledAt - lastSideAt >= STRIP_POLICY.intervalMs && (!frameLinked || sideDirty || (linkedAnimation && !keyChanged)) && controlFits));
        if (sideDue) {
          const stripFrame = frameLinked && !keyDue ? (lastReference || reference) : reference;
          settings = renderStrip({ ...project, strip: activeStrip }, stripFrame, time + (sampledAt - epoch) / 1000, events, keys);
          sideKey = JSON.stringify(settings);
          if (keyDue || sideDirty || sideKey !== lastSideKey) controlPacket = buildSideLightEffect(settings);
          else lastSideAt = sampledAt; // Deduplication must not become a 1ms polling loop.
        }
        let frameSent = false;
        if (keyDue) {
          if (!await sender.sendFrame(output.packets, project.settings.fps, valid, controlPacket)) return;
          const completedAt = clock(); if (Number.isFinite(lastSentAt)) maxFrameGapMs = Math.max(maxFrameGapMs, completedAt - lastSentAt);
          lastSentAt = completedAt; previous = key; lastOutput = output; lastReference = reference; sentFrames++; frameSent = true; sideDirty = true; stats();
        }
        if (!valid()) return;
        if (controlPacket) {
          if (!frameSent) {
            try { if (!await sender.sendControl(buildSideLightEffect(settings), valid)) return; }
            catch (error) { error.details = { readOnly: false, query: '04/06', phase: 'stream-send', acknowledged: false }; throw error; }
          }
          if (!valid()) return;
          // Schedule from sampling/start, not native completion: variable key
          // packet offsets must not cause a target to skip alternate frames.
          lastSideAt = sampledAt; lastSideKey = sideKey; sideDirty = false; sideUpdates++; stats();
        }
        if (!frameSent && !controlPacket) await sleep(Math.max(1, Math.min(25,
          keyboardEnabled ? OUTPUT_POLICY.keepAliveMs - (clock() - lastSentAt) : 25,
          sideConsent && !linkedLocked && controlFits ? lastSideAt + STRIP_POLICY.intervalMs - clock() :
            keyboardEnabled && keyChanged ? sender.nextReadyAt() - clock() : 25)));
      }
    }
    hid?.addEventListener?.('disconnect', event => {
      if (event.device !== device) return;
      device.removeEventListener?.('inputreport', sideAck); sideConsent = false;
      device = null; sender = null; running = false; generation++;
      lightingCapabilities = null;
      probing = false; lightingProbe?.cancel();
      post({ event: 'disconnected' });
    });
    async function command(type, payload) {
      if (type === 'state') { state(payload); return true; }
      if (type === 'connect') {
        if (!hid?.getDevices) throw Error('浏览器未提供后台 WebHID；请使用新版 Chrome / Edge。不会退回依赖网页焦点的发送方式。');
        if (device || connecting) throw Error('后台设备已连接或正在连接');
        connecting = true; let chosen;
        try {
          const candidates = (await hid.getDevices()).filter(d => {
            if (d.vendorId !== payload.vendorId || d.productId !== payload.productId || d.productName !== payload.productName) return false;
            try { return validateDevice(d); } catch { return false; }
          });
          if (candidates.length !== 1) throw Error(candidates.length ? '检测到多把同型号已授权键盘，无法确定刚选择的设备；请只保留一把后重试' : '后台未找到刚授权的 HERO 99HE 灯光接口');
          chosen = candidates[0]; if (!chosen.opened) await chosen.open();
          device = chosen; sender = createSender(device, { now: clock, sleep, onPacket: () => { sentPackets++; }, onControl: ms => { maxControlSendMs = Math.max(maxControlSendMs, ms); } });
          lightingCapabilities = null;
          return { mode: 'dedicated-worker', productName: chosen.productName };
        } catch (error) { if (chosen?.opened && chosen !== device) await chosen.close().catch(() => {}); throw error; }
        finally { connecting = false; }
      }
      if (type === 'start') {
        if (!device || !sender) throw Error('后台设备尚未连接');
        if (probing) throw Error('灯光能力查询期间不能开始输出');
        if (running) throw Error('后台已在输出');
        if (project.strip.mode !== 'off' && (payload?.sideConsent !== true || lightingCapabilities?.sideLight !== true)) throw Error('灯带模式需要先读取本次能力并单独允许联动，或将灯带设为不联动');
        keyboardEnabled = payload?.keyboard !== false;
        sideConsent = project.strip.mode !== 'off' && payload?.sideConsent === true;
        if (!keyboardEnabled && !sideConsent) throw Error('没有需要启动的灯光');
        activeStrip = { ...project.strip, color: [...project.strip.color] };
        lastSideAt = -Infinity; lastSideKey = ''; sideDirty = false; lastReference = null; sideUpdates = 0; sideAcks = 0; maxControlSendMs = 0;
        if (sideConsent) device.addEventListener('inputreport', sideAck);
        sentFrames = 0; sentPackets = 0; previous = ''; lastOutput = null; lastSentAt = -Infinity; lastStatsAt = -Infinity; maxFrameGapMs = 0; beganAt = clock();
        running = true; const token = ++generation;
        loopPromise = loop(token).catch(error => { running = false; sideConsent = false; device?.removeEventListener?.('inputreport', sideAck); generation++; post({ event: 'fault', error: error.message, details: error.details || null }); });
        return true;
      }
      if (type === 'stop') { await stop(); return true; }
      if (type === 'inspect-lighting') {
        if (!device || !sender) throw Error('请先连接键盘');
        if (running || connecting || probing) throw Error('请先停止输出并等待当前操作完成');
        probing = true; lightingCapabilities = null; const selected = device;
        try {
          if (!await sender.ready(() => probing && device === selected, true)) throw Error('灯光能力查询已取消');
          lightingProbe = createLightingProbe(selected, { setTimeout: options.setTimeout, clearTimeout: options.clearTimeout });
          lightingCapabilities = await lightingProbe.promise;
          return lightingCapabilities;
        } finally { lightingProbe = null; probing = false; }
      }
      if (type === 'set-side-light') {
        if (!device || !sender) throw Error('请先连接键盘');
        if (running || connecting || probing) throw Error('请先停止输出并等待当前操作完成');
        if (payload?.consent !== true) throw Error('请明确允许更改原厂氛围灯');
        if (lightingCapabilities?.sideLight !== true) throw Error('请先读取本次连接的能力并确认支持侧灯/氛围灯');
        buildSideLightEffect(payload.settings); // Reject invalid settings before sending anything.
        probing = true; const selected = device;
        const operation = (async () => {
          try {
            if (!await sender.ready(() => probing && device === selected, true)) throw Error('氛围灯设置已取消');
            lightingProbe = createLightingProbe(selected, { operation: 'side-light', settings: payload.settings, setTimeout: options.setTimeout, clearTimeout: options.clearTimeout });
            return await lightingProbe.promise;
          } finally {
            await sleep(OUTPUT_POLICY.frameGapMs);
            lightingProbe = null; probing = false;
          }
        })();
        controlPromise = operation;
        try { return await operation; } finally { if (controlPromise === operation) controlPromise = null; }
      }
      if (type === 'disconnect') {
        await stop(); const closing = device; device = null; sender = null; lightingCapabilities = null;
        if (closing?.opened) await closing.close();
        return true;
      }
      throw Error('未知后台操作');
    }
    return { command };
  }
  function validateProject(value, keys) {
    if (!value || value.format !== 'hero99-light/v1') throw Error('不是 HERO99 Light 的配置文件');
    if (value.layout !== undefined && value.layout !== 'hero99he-101/v1') throw Error('配置的键位布局不受支持');
    const s = value.settings, d = defaultProject();
    if (!s || !EFFECTS.includes(s.effect)) throw Error('不支持的灯效');
    for (const [name, lo, hi] of [['brightness', 0, 1], ['speed', 0.1, 4], ['fps', 5, 40]]) {
      if (!Number.isFinite(s[name]) || s[name] < lo || s[name] > hi) throw Error('参数超出范围：' + name);
    }
    const palette = s.palette === undefined ? [s.color, s.bg] : s.palette;
    if (!Array.isArray(palette) || palette.length < 2 || palette.length > 8) throw Error('配色需要 2–8 个颜色');
    d.settings = { effect: s.effect, brightness: s.brightness, speed: s.speed, fps: Math.round(s.fps), color: rgb(s.color), bg: rgb(s.bg), palette: palette.map(rgb) };
    if (value.strip !== undefined) {
      const strip = value.strip;
      if (!strip || !STRIP_MODES.includes(strip.mode) || !Number.isInteger(strip.brightness) || strip.brightness < 0 || strip.brightness > 4) throw Error('灯带配置无效');
      const gain = strip.gain === undefined ? 1 : strip.gain;
      if (!Number.isFinite(gain) || gain < 1 || gain > 2) throw Error('灯带鲜亮增强须为 100–200%');
      d.strip = { mode: strip.mode, color: rgb(strip.color), brightness: strip.brightness, gain };
    }
    // v0.1/v0.1.1 used a different 99-position template. Migrate only that
    // exact legacy key set, never silently accept arbitrary incomplete frames.
    const legacy = value.layout === undefined;
    const legacyIds = new Set([...Array.from({ length: 94 }, (_, i) => String(i + 1)), '99', '100', '101', '102', '103']);
    function migrate(map, complete) {
      if (!legacy) return colorMap(map, keys, complete);
      if (!map || typeof map !== 'object' || Array.isArray(map)) throw Error('旧键位颜色表格式错误');
      const ids = Object.keys(map);
      if (ids.some(id => !legacyIds.has(id)) || (complete && ids.length !== legacyIds.size)) throw Error('旧配置键位不完整或包含未知键号');
      const result = {};
      for (const id of ids) result[id === '71' ? '72' : id === '72' ? '95' : id] = rgb(map[id]);
      if (complete) { result[96] = [...result[100]]; result[98] = [...result[99]]; }
      return colorMap(result, keys, complete);
    }
    d.paint = migrate(value.paint, false);
    if (!Array.isArray(value.frames) || value.frames.length > 120) throw Error('最多支持 120 帧动画');
    d.frames = value.frames.map(frame => migrate(frame, true));
    if (!Number.isFinite(value.frameMs) || value.frameMs < 25 || value.frameMs > 5000) throw Error('每帧时长须为 25–5000 毫秒');
    d.frameMs = Math.round(value.frameMs);
    return d;
  }
  function render(project, keys, t, events = [], heat = {}, scale = true) {
    const s = project.settings, time = t * s.speed, out = {}, maxX = Math.max(...keys.map(k => k.x + k.w));
    const studio = project.frames.length ? project.frames[Math.floor(time * 1000 / project.frameMs) % project.frames.length] : null;
    for (const key of keys) {
      const x = (key.x + key.w / 2) / maxX, y = (key.y + key.h / 2) / 325;
      let color = s.color;
      switch (s.effect) {
        case 'rainbow': color = hsv(x * 0.85 + y * 0.12 - time * 0.13); break;
        case 'wave': color = mix(s.bg, s.color, Math.pow((Math.sin(x * 11 + y * 3 - time * 3) + 1) / 2, 3)); break;
        case 'breathe': color = mix(s.bg, s.color, (Math.sin(time * 2) + 1) / 2); break;
        case 'meteor': {
          const distance = ((time * 0.32 - x) % 1.4 + 1.4) % 1.4;
          color = mix(s.bg, s.color, Math.max(0, 1 - distance / 0.24) ** 2); break;
        }
        case 'ripple': {
          let level = 0;
          for (const event of events) {
            const age = (t - event.t) * s.speed;
            if (age < 0 || age > 2) continue;
            const distance = Math.hypot((key.x - event.x) / 1103, (key.y - event.y) / 1103);
            level = Math.max(level, Math.max(0, 1 - Math.abs(distance - age * 0.6) / 0.10) * (1 - age / 2));
          }
          color = mix(s.bg, s.color, level); break;
        }
        case 'heatmap': color = mix(s.bg, [255, 67, 91], Math.min(1, (heat[key.id] || 0) / 12)); break;
        case 'gradient': color = paletteColor(s.palette, x * 0.65 + y * 0.15); break;
        case 'aurora': color = mix(s.bg, paletteColor(s.palette, x * 0.4 + y * 0.2 + time * 0.06), 0.25 + 0.75 * ((Math.sin(x * 8 + Math.sin(y * 4 + time) - time) + 1) / 2)); break;
        case 'checker': color = paletteColor(s.palette, (Math.floor(x * 12) + Math.floor(y * 5) + Math.floor(time * 0.8)) % 2 ? 0 : 0.5); break;
        case 'scanner': color = mix(s.bg, s.color, Math.max(0, 1 - Math.abs(x - (Math.sin(time * 1.4) + 1) / 2) / 0.18) ** 2); break;
        case 'twinkle': color = mix(s.bg, paletteColor(s.palette, key.id * 0.137), Math.pow((Math.sin(time * (0.5 + (key.id % 7) / 9) + key.id * 2.4) + 1) / 2, 9)); break;
        case 'fire': color = mix(s.bg, paletteColor(s.palette, 0.1 + 0.32 * ((Math.sin(key.id * 1.8 + time * 3) + 1) / 2)), clamp((1 - y) * 0.7 + 0.3 * Math.sin(x * 15 + time * 3) + 0.25, 0, 1)); break;
        case 'radar': {
          const angle = Math.atan2((y - 0.5) * 0.5, x - 0.5), distance = ((time * 1.6 - angle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          color = mix(s.bg, s.color, Math.max(0, 1 - distance / 1.1) ** 2); break;
        }
        case 'keyfade': {
          let level = 0;
          for (const event of events) { const age = (t - event.t) * s.speed; if (age >= 0 && age < 2 && Math.abs(key.x - event.x) < 1 && Math.abs(key.y - event.y) < 1) level = Math.max(level, Math.exp(-age * 2.5)); }
          color = mix(s.bg, s.color, level); break;
        }
        case 'paletteflow': color = paletteColor(s.palette, x * 0.7 - time * 0.12); break;
        case 'verticalrainbow': color = hsv(y * 0.8 - time * 0.13); break;
        case 'diagonal': color = paletteColor(s.palette, x * 0.6 + y * 0.5 - time * 0.13); break;
        case 'spiral': {
          const dx = x - 0.5, dy = (y - 0.5) * 0.45;
          color = paletteColor(s.palette, Math.atan2(dy, dx) / (2 * Math.PI) + Math.hypot(dx, dy) * 1.8 - time * 0.1); break;
        }
        case 'plasma': {
          const level = (Math.sin(x * 10 + time) + Math.sin(y * 7 - time * 1.4) + Math.sin((x + y) * 6 + time * 0.7) + 3) / 6;
          color = paletteColor(s.palette, level * 0.8 + time * 0.025); break;
        }
        case 'rain': {
          const column = Math.floor(x * 22), phase = column * 0.61803398875;
          const distance = ((time * (0.3 + (column % 4) * 0.07) + phase - y) % 1.6 + 1.6) % 1.6;
          color = mix(s.bg, paletteColor(s.palette, phase), Math.max(0, 1 - distance / 0.45) ** 2); break;
        }
        case 'cometpair': {
          const a = ((time * 0.3 - x) % 1.4 + 1.4) % 1.4, b = ((time * 0.3 + x - 0.5) % 1.4 + 1.4) % 1.4;
          color = mix(s.bg, paletteColor(s.palette, a < b ? 0 : 0.5), Math.max(0, 1 - Math.min(a, b) / 0.22) ** 2); break;
        }
        case 'centerwave': {
          const r = Math.hypot(x - 0.5, (y - 0.5) * 0.45);
          color = mix(s.bg, paletteColor(s.palette, r - time * 0.08), ((Math.sin(r * 22 - time * 4) + 1) / 2) ** 3); break;
        }
        case 'curtain': {
          const edge = (Math.sin(time * 1.3) + 1) / 2;
          color = mix(s.bg, paletteColor(s.palette, x * 0.6), clamp((edge - Math.abs(x - 0.5) * 2) * 8 + 0.5, 0, 1)); break;
        }
        case 'diamond': {
          const r = Math.abs(x - 0.5) + Math.abs(y - 0.5) * 0.45;
          color = mix(s.bg, s.color, ((Math.sin(r * 20 - time * 3) + 1) / 2) ** 4); break;
        }
        case 'ribbons': color = mix(s.bg, paletteColor(s.palette, y * 0.5 + time * 0.06), ((Math.sin(x * 16 + Math.sin(y * 5 + time) * 3 - time * 2) + 1) / 2) ** 3); break;
        case 'fireflies': {
          let level = 0;
          for (let i = 0; i < 5; i++) {
            const px = (Math.sin(time * (0.35 + i * 0.07) + i * 2.2) + 1) / 2, py = (Math.sin(time * 0.5 + i * 3) + 1) / 2;
            level = Math.max(level, Math.exp(-(Math.hypot(x - px, (y - py) * 0.45) ** 2) * 500));
          }
          color = mix(s.bg, paletteColor(s.palette, x * 0.4 + time * 0.03), level); break;
        }
        case 'orbit': {
          const px = 0.5 + Math.cos(time * 1.6) * 0.38, py = 0.5 + Math.sin(time * 1.6) * 0.38;
          color = mix(s.bg, s.color, Math.exp(-(Math.hypot(x - px, (y - py) * 0.45) ** 2) * 120)); break;
        }
        case 'sunset': color = mix(s.bg, paletteColor(s.palette, y * 0.4 + x * 0.12 + Math.sin(time * 0.45) * 0.12), 0.65 + Math.sin(time * 0.6 + x * 3) * 0.35); break;
        case 'sparkburst':
        case 'keycross': {
          let level = 0, phase = 0;
          for (const event of events) {
            const age = (t - event.t) * s.speed;
            if (age < 0 || age > 2.2) continue;
            const dx = Math.abs(key.x - event.x) / 1103, dy = Math.abs(key.y - event.y) / 1103;
            const next = s.effect === 'sparkburst'
              ? Math.max(0, 1 - Math.abs(Math.hypot(dx, dy) - age * 0.45) / 0.08) * (1 - age / 2.2)
              : Math.exp(-Math.min(dx, dy) * 100) * Math.exp(-Math.max(dx, dy) * 4) * Math.exp(-age * 2);
            if (next > level) { level = next; phase = event.x / 1103 + age * 0.1; }
          }
          color = mix(s.bg, paletteColor(s.palette, phase), level); break;
        }
        case 'studio': color = studio ? studio[key.id] : s.bg; break;
      }
      if (s.effect !== 'studio' && project.paint[key.id]) color = project.paint[key.id];
      out[key.id] = color.map(c => byte(c * (scale ? s.brightness : 1)));
    }
    return out;
  }
  function reports(collections, output = []) {
    for (const c of collections || []) { output.push(...(c.outputReports || [])); reports(c.children, output); }
    return output;
  }
  function vendorCollection(collections) {
    return (collections || []).some(c => (c.usagePage === 0xff60 && c.usage === 0x61) || vendorCollection(c.children));
  }
  function validateDevice(device) {
    if (device.vendorId !== 0x372e || device.productId !== 0x103e) throw Error('设备 VID/PID 不是 HERO 99HE 所用通道');
    const name = String(device.productName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^(AULA)?HERO99(HE)?$/.test(name)) throw Error('同一 VID/PID 被多种狼蛛键盘共用；产品名不是 HERO 99 / HERO 99 HE，已拒绝发送');
    if (!vendorCollection(device.collections)) throw Error('没有找到厂商灯光接口 0xFF60 / 0x61');
    const report = reports(device.collections).find(r => r.reportId === REPORT_ID);
    const bits = report?.items?.reduce((n, i) => n + i.reportSize * i.reportCount, 0);
    if (bits !== REPORT_BYTES * 8) throw Error('固件的 Report 9 长度与已分析协议不符，已拒绝发送');
    return true;
  }
  return { REPORT_ID, REPORT_BYTES, PAYLOAD_BYTES, OUTPUT_POLICY, LINK_POLICY, STRIP_POLICY, EFFECTS, STRIP_MODES, FRAME_STRIP_MODES, PRESETS, byte, rgb, hsv, mix, paletteColor, buildPackets, prepareOutput, frameInterval, createSender, buildLightingQuery, parseLightingCapabilities, buildSideLightEffect, createLightingProbe, createOutputEngine, defaultProject, validateProject, render, renderStrip, validateDevice };
});
