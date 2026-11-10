(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HeroCore = api;
  // The same allowlisted URL is also the Dedicated Worker entry point.
  // It owns the HID handle; the page owns only permission selection and UI.
  if (typeof document === 'undefined' && typeof importScripts === 'function' && typeof postMessage === 'function') {
    importScripts('layout.js?v=0.1.26');
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
  const EXTRA_EFFECTS = Object.freeze([
    ['color-tide','彩潮入岸','flow','#325586','#5bcaba','#ffb596'],
    ['spectrum-sweep','棱镜扫光','flow','#ff758a','#bce17d','#8ccafa'],
    ['pinwheel','四色风车','flow','#ffb482','#c38ef1','#7ddcd8'],
    ['chase','接力光点','flow','#44305f','#f7b8e9','#7fd6f7'],
    ['splitwave','镜像浪涌','flow','#47b1f7','#2e3a55','#f985bc'],
    ['rowrelay','逐行接力','flow','#394353','#b3f2d1','#9277dd'],
    ['lasergrid','交织光栅','flow','#334057','#dba7f8','#89f6ff'],
    ['waterfall','落瀑流光','flow','#294868','#5aaaff','#8df3de'],
    ['duotone','左右撞色','ambient','#a583ff','#645d8f','#ffaf82'],
    ['topography','地形色阶','ambient','#425c8f','#6dd7b0','#edbf84'],
    ['embers','余烬微光','ambient','#3a2e40','#ba6751','#ffb37b'],
    ['moonphase','月相盈亏','ambient','#2c395c','#92ade2','#f3e8d9'],
    ['ocean','海面波纹','ambient','#2d4e7f','#3c97bf','#85eddc'],
    ['kaleido','万花镜','ambient','#a675da','#f7b0c8','#8bdbd7'],
    ['lanterns','暖灯游园','ambient','#3d364d','#e89e76','#f7d4a4'],
    ['heartwave','心跳余波','ambient','#3e314c','#b75687','#f9a9bb'],
    ['key-echo','按键回声','reactive','#423d64','#a296ed','#dce0ff'],
    ['column-flash','垂直光柱','reactive','#354658','#72bfc8','#c2faec'],
    ['row-flash','横向光迹','reactive','#463752','#c986b2','#ffc1dd'],
    ['key-comet','击键彗尾','reactive','#303852','#79adf3','#b6ebfd'],
    ['key-splash','指尖水花','reactive','#304f66','#56b9ce','#b2eff2'],
    ['key-spot','指尖聚光','reactive','#524463','#bf93ea','#f0d5ff'],
    ['key-confetti','彩纸弹射','reactive','#e280b9','#7ac7f5','#eed090'],
    ['key-bloom','四叶绽放','reactive','#3d4558','#81c79e','#c9efab']
  ]);
  const EFFECTS = Object.freeze(['static', 'rainbow', 'wave', 'breathe', 'meteor', 'ripple', 'heatmap', 'studio', 'gradient', 'aurora', 'checker', 'scanner', 'twinkle', 'fire', 'radar', 'keyfade', 'paletteflow', 'verticalrainbow', 'diagonal', 'spiral', 'plasma', 'rain', 'cometpair', 'centerwave', 'curtain', 'diamond', 'ribbons', 'fireflies', 'orbit', 'sunset', 'sparkburst', 'keycross', ...EXTRA_EFFECTS.map(([id])=>id)]);
  const NATIVE_STRIP_MODES=Object.freeze({'native-neon':2,'native-marquee':5});
  const isNativeStrip=mode=>Object.hasOwn(NATIVE_STRIP_MODES,mode);
  const STRIP_MODES=Object.freeze(['off','solid','breathe','auto-color',...Object.keys(NATIVE_STRIP_MODES)]);
  const REMOVED_STRIP_MODES=new Set(['spectrum','palette','pulse','react','follow','follow-dominant','follow-scan','follow-breathe','follow-complement','follow-split','follow-flash','native-sync']);
  const LOGO_MODES=Object.freeze(['off','solid','follow-color','keyflash','auto-color']);
  const LEGACY_LOGO_MODES=new Set(['breathe','spectrum','palette','pulse','react','follow','follow-dominant','follow-scan','follow-breathe','follow-complement','follow-split','follow-flash','follow-strip']);
  const EXTRA_REACTIVE=new Set(EXTRA_EFFECTS.filter(entry=>entry[2]==='reactive').map(([id])=>id));
  const REACTIVE_EFFECTS=new Set(['ripple','heatmap','keyfade','sparkburst','keycross',...EXTRA_REACTIVE]);
  const STATIC_EFFECTS=new Set(['static','gradient','heatmap','duotone','topography']);
  const LOGO_FLASH_MS=160, SIDE_QUIET_MS=60;
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
  const MAX_SAVED_PALETTES=60;
  function validatePaletteColors(palette) {
    if(!Array.isArray(palette)||palette.length<2||palette.length>8)throw Error('配色需要 2–8 个颜色');
    return palette.map(rgb);
  }
  function validateSavedPalette(value) {
    const name=typeof value?.name==='string'?value.name.trim().normalize('NFC'):'';
    if(!name||name.length>40||/[\u0000-\u001f\u007f]/.test(name))throw Error('配色名称须为 1–40 个字符');
    return {name,color:rgb(value.color),bg:rgb(value.bg),palette:validatePaletteColors(value.palette)};
  }
  function validatePaletteLibrary(value) {
    if(!Array.isArray(value)||value.length>MAX_SAVED_PALETTES)throw Error('配色库最多保存 '+MAX_SAVED_PALETTES+' 组');
    const list=value.map(validateSavedPalette);
    if(new Set(list.map(preset=>preset.name)).size!==list.length)throw Error('已有同名配色，请换一个名称');
    return list;
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
    return packValidatedColors(colorMap(frame,keys,true),keys);
  }
  function packValidatedColors(colors,keys) {
    const groups = new Map();
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
    const source = colorMap(frame, keys, true), originalPackets = packValidatedColors(source, keys);
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
    const boxes = [makeBox(entries.filter(entry => entry !== black))];
    const budget = policy.paletteColors - (black ? 1 : 0);
    function makeBox(box) {
      const lo = [255, 255, 255], hi = [0, 0, 0]; let weight = 0;
      for (const entry of box) { weight += entry.count; for (let axis = 0; axis < 3; axis++) { lo[axis] = Math.min(lo[axis], entry.color[axis]); hi[axis] = Math.max(hi[axis], entry.color[axis]); } }
      const ranges = hi.map((v, axis) => v - lo[axis]);
      const axis = ranges.indexOf(Math.max(...ranges));
      return { entries:box,axis,score:box.length>1?ranges[axis]*Math.sqrt(weight):-1,weight };
    }
    while (boxes.length < budget) {
      let selected = -1, best = -1, bounds;
      for (let i = 0; i < boxes.length; i++) { const next=boxes[i];if(next.score>best){selected=i;best=next.score;bounds=next;} }
      if (selected < 0) break;
      const box=bounds.entries.sort((a,b)=>a.color[bounds.axis]-b.color[bounds.axis]||a.packed-b.packed);
      let count = 0, cut = 1;
      for (let i = 0; i < box.length - 1; i++) { count += box[i].count; cut = i + 1; if (count >= bounds.weight / 2) break; }
      boxes.splice(selected,1,makeBox(box.slice(0,cut)),makeBox(box.slice(cut)));
    }
    const replacements = new Map();
    if (black) replacements.set(0, [0, 0, 0]);
    for (const {entries:box} of boxes) {
      const sum = [0, 0, 0]; let count = 0;
      for (const entry of box) { count += entry.count; entry.color.forEach((v, axis) => { sum[axis] += v * entry.count; }); }
      const color = sum.map(v => byte(v / count));
      for (const entry of box) replacements.set(entry.packed, color);
    }
    const result = {};
    for (const key of keys) { const c = source[key.id]; result[key.id] = [...replacements.get(c[0] * 65536 + c[1] * 256 + c[2])]; }
    const packets = packValidatedColors(result, keys);
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
    function nextReadyAt(control = false) { return Math.max(nextBudgetAt, nextPacketAt, control ? 0 : nextFrameAt); }
    async function ready(valid = () => true, control = false) { return until(nextReadyAt(control), valid); }
    async function sendFrame(packets, fps, valid = () => true) {
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
        }
        nextFrameAt = began + frameInterval(fps, packets.length);
        nextBudgetAt = Math.max(began + packets.length * 1000 / OUTPUT_POLICY.packetsPerSecond, clock() + OUTPUT_POLICY.frameGapMs);
        completed = valid();
        return completed;
      } finally { if (!completed) nextBudgetAt = Math.max(nextBudgetAt, clock() + OUTPUT_POLICY.frameGapMs); busy = false; }
    }
    async function sendControl(packet, valid = () => true) {
      if (busy) throw Error('不允许并发提交灯光控制');
      busy = true; let began = clock(), report;
      try {
        if (!await ready(valid, true) || !await until(nextPacketAt, valid)) return false;
        began=clock();report=packet;await device.sendReport(REPORT_ID,report);
        return valid();
      } finally {
        nextPacketAt = Math.max(nextPacketAt, clock() + OUTPUT_POLICY.packetGapMs, began + (report ? options.quietAfterControl?.(report) || 0 : 0));
        nextBudgetAt = Math.max(nextBudgetAt, began + 1000 / OUTPUT_POLICY.packetsPerSecond, clock() + OUTPUT_POLICY.frameGapMs);
        busy = false;
      }
    }
    return { ready, nextReadyAt, sendFrame, sendControl };
  }
  function defaultProject() {
    return { format: 'hero99-light/v1', layout: 'hero99he-101/v1', settings: { effect: 'rainbow', brightness: 0.6, speed: 1, fps: 20, color: [97, 218, 251], bg: [5, 8, 18], palette: [[97,218,251],[189,155,255],[246,153,182]] }, strip: { mode: 'off', color: [0,160,255], brightness: 2, gain: 1 },logo:{mode:'off',color:[0,160,255],brightness:2}, paint: {}, frames: [], frameMs: 100, frameDurations: [] };
  }
  function frameDurations(project) { return project.frames.map((_,i)=>project.frameDurations?.[i]??project.frameMs); }
  function studioFrameAt(project,seconds) {
    const durations=frameDurations(project),total=durations.reduce((a,b)=>a+b,0);if(!total)return -1;
    let at=((seconds*1000%total)+total)%total;
    for(let i=0;i<durations.length;i++){if(at<durations[i])return i;at-=durations[i];}
    return durations.length-1;
  }
  function renderStrip(project,sampledColor=null) {
    const {mode,color,brightness,gain=1}=project.strip;
    if(mode==='off')return {mode:0,color:[0,0,0],brightness:0,speed:2};
    // Keep the RGB slots used by the captured colorIndex=7 reports; firmware
    // owns the multicolor animation, so do not apply the software gain.
    if(isNativeStrip(mode))return {mode:NATIVE_STRIP_MODES[mode],color:[...color],brightness,speed:2};
    if(mode!=='solid'&&mode!=='breathe'&&mode!=='auto-color')throw Error('灯带模式无效');
    const chosen=mode==='auto-color'&&sampledColor?sampledColor:color;
    const boost=Math.min(gain,255/Math.max(1,...chosen));
    return {mode:mode==='breathe'?4:3,color:chosen.map(c=>byte(c*boost)),brightness,speed:2};
  }
  function buildLightingQuery(){return commandPacket(0x82,9);}
  function dominantColor(frame,fallback){
    const groups=new Map();
    for(const c of Object.values(frame)){
      const weight=Math.max(...c);if(weight<8)continue;
      const id=(c[0]>>5)*64+(c[1]>>5)*8+(c[2]>>5);
      let g=groups.get(id);if(!g){g={weight:0,sum:[0,0,0]};groups.set(id,g);}
      g.weight+=weight;for(let i=0;i<3;i++)g.sum[i]+=c[i]*weight;
    }
    let best;for(const g of groups.values())if(!best||g.weight>best.weight)best=g;
    return best?best.sum.map(v=>byte(v/best.weight)):[...fallback];
  }
  function renderLogo(project,frame,t,events=[]) {
    const logo=project.logo;
    if(logo.mode==='off')return null;
    let color=logo.color;
    if(logo.brightness===0)color=[0,0,0];
    else if(logo.mode==='auto-color')color=dominantColor(frame,logo.color);
    else if(logo.mode==='follow-color')color=project.settings.color;
    else if(logo.mode==='keyflash')color=events.some(e=>t>=e.t&&t-e.t<LOGO_FLASH_MS/1000)?project.settings.color:[0,0,0];
    return {mode:3,color:[...color],brightness:logo.brightness,speed:2};
  }
  function commandPacket(command,parameter,data=[],declaredLength=data.length) {
    if(data.length>PAYLOAD_BYTES)throw Error('控制报文超长');
    const packet=new Uint8Array(REPORT_BYTES);
    packet.set([command,parameter,0,1,0,declaredLength,...data]);
    packet[62]=(255-REPORT_ID-packet.reduce((sum,n)=>sum+n,0))&255;
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
  function buildLampPacket(parameter,settings,modes,multicolor=false) {
    if(!settings||!modes.includes(settings.mode))throw Error('灯光模式不支持');
    for(const name of ['brightness','speed'])if(!Number.isInteger(settings[name])||settings[name]<0||settings[name]>4)throw Error('亮度和速度须为 0–4 档');
    // Captured Legacy neon / marquee declare length 4, but carry 7 bytes.
    return commandPacket(4,parameter,[settings.mode,multicolor?7:0,...rgb(settings.color),settings.brightness,settings.speed],multicolor?4:7);
  }
  const SIDE_LIGHT_IDS=[0,2,3,4,5];
  function buildSideLightEffect(settings){return buildLampPacket(6,settings,SIDE_LIGHT_IDS,settings?.mode===2||settings?.mode===5);}
  function buildLogoLightEffect(settings){return buildLampPacket(11,settings,[3]);}
  function createLightingProbe(device, options={}) {
    validateDevice(device);
    function hasInput(list) {
      return (list||[]).some(c=>(c.usagePage===0xff60&&c.usage===0x61&&(c.inputReports||[]).some(r=>
        r.reportId===REPORT_ID&&(r.items||[]).reduce((n,i)=>n+i.reportCount*i.reportSize,0)===REPORT_BYTES*8))||hasInput(c.children));
    }
    if(!hasInput(device.collections)||!device.addEventListener||!device.removeEventListener)throw Error('灯光接口没有可用的设备响应通道');
    const setTimer=options.setTimeout||setTimeout,clearTimer=options.clearTimeout||clearTimeout;
    let cancel;
    const promise=new Promise((resolve,reject)=>{
      let timer,settled=false,best=null;
      function finish(error,value){
        if(settled)return;
        settled=true;clearTimer(timer);device.removeEventListener('inputreport',onReport);
        if(error)reject(error);else resolve(value);
      }
      function onReport(event){
        if(event.reportId!==REPORT_ID||!event.data||event.data.byteLength<2)return;
        const v=event.data,bytes=new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
        if(bytes[0]!==0x82||bytes[1]!==9)return;
        try{
          const parsed=parseLightingCapabilities(bytes);
          if(!best||parsed.parsedLength>=best.parsedLength)best=parsed;
          if(parsed.capabilityFieldsComplete)finish(null,parsed);
        }catch(error){finish(error);}
      }
      cancel=()=>finish(Error('灯光操作已取消'));
      device.addEventListener('inputreport',onReport);
      timer=setTimer(()=>best?finish(null,best):finish(Error('键盘没有返回灯光能力，未发送设置')),options.timeoutMs??2000);
      try{Promise.resolve((options.sendReport||((id,p)=>device.sendReport(id,p)))(REPORT_ID,buildLightingQuery())).catch(finish);}
      catch(error){finish(error);}
    });
    return {promise,cancel:()=>cancel?.()};
  }

  function isAnimated(project,selectedFrame,t,events,ignoreBrightness=false) {
    const {effect,brightness,speed}=project.settings;
    if(selectedFrame>=0||(!ignoreBrightness&&brightness===0)||STATIC_EFFECTS.has(effect))return false;
    if(effect==='studio')return project.frames.length>1;
    if(REACTIVE_EFFECTS.has(effect))return events.some(e=>t>=e.t&&(t-e.t)*speed<2.2);
    return true;
  }
  function recordPress(events,heat,key,t) {
    while(events.length&&(events.length>=60||events[0].t<t-22))events.shift();
    events.push({t,x:key.x,y:key.y});
    heat[key.id]=Math.min(12,(heat[key.id]||0)+1);
  }
  function sameFrame(a,b,keys) {
    return a===b||Boolean(a&&b&&keys.every(({id})=>a[id][0]===b[id][0]&&a[id][1]===b[id][1]&&a[id][2]===b[id][2]));
  }

  function createOutputEngine(options) {
    const {keys,hid}=options,byId=new Map(keys.map(k=>[k.id,k])),post=options.post||(()=>{});
    const clock=options.now||(()=>performance.now()),setTimer=options.setTimeout||setTimeout,clearTimer=options.clearTimeout||clearTimeout;
    const sleep=options.sleep||(ms=>new Promise(resolve=>setTimer(resolve,ms)));
    let device=null,sender=null,connecting=false,capabilities=null,probe=null,control=null,task=null,timer=null,generation=0;
    let keyboard=false,logo=null,events=[],heat={},project=defaultProject(),selectedFrame=-1,epoch=clock(),time=0;
    let keyAt=Infinity,logoAt=Infinity,lastKeyAt=-Infinity,lastLogoAt=-Infinity,keyDirty=false,wasAnimated=false;
    let sourceFrame=null,keyOutput=null,lastKeyFrame=null,lastLogoRGB=-1;
    const active=()=>({keyboard,logoMode:logo?.mode||'off'});
    const timeAt=at=>time+(at-epoch)/1000;
    const sample=(at,scale)=>selectedFrame>=0?Object.fromEntries(keys.map(k=>[k.id,
      project.frames[selectedFrame][k.id].map(c=>byte(c*(scale?project.settings.brightness:1)))])):
      render(project,keys,timeAt(at),events,heat,scale);
    function cancelTimer(){if(timer!==null){clearTimer(timer);timer=null;}}
    function schedule(){
      cancelTimer();
      if(!sender||control||task)return;
      const next=Math.min(keyboard?Math.max(keyAt,sender.nextReadyAt()):Infinity,logo?Math.max(logoAt,sender.nextReadyAt(true)):Infinity);
      if(Number.isFinite(next))timer=setTimer(drive,Math.max(0,Math.ceil(next-clock())));
    }
    const rgbKey=({color:[r,g,b]})=>r*65536+g*256+b;
    function logoSettings(config,at){
      return renderLogo({...project,logo:config},config.mode==='auto-color'?sample(at,false):{},timeAt(at),events);
    }
    function nextLogo(config,at){
      if(config.mode==='auto-color')return isAnimated(project,selectedFrame,timeAt(at),events,true)?at+300:Infinity;
      if(config.mode==='keyflash'){
        const age=timeAt(at)-(events.at(-1)?.t??-Infinity);
        return age<LOGO_FLASH_MS/1000?at+Math.max(1,LOGO_FLASH_MS-age*1000):Infinity;
      }
      return Infinity;
    }
    function dirtyLogo(){
      if(!logo)return;
      logoAt=Math.max(clock(),lastLogoAt+(logo.mode==='auto-color'?300:25));
    }
    async function tick(current,valid) {
      const at=clock();
      if(logo&&at>=Math.max(logoAt,current.nextReadyAt(true))){
        const settings=logoSettings(logo,at),color=rgbKey(settings);
        lastLogoAt=at;logoAt=nextLogo(logo,at);
        if(color!==lastLogoRGB){
          if(await current.sendControl(buildLogoLightEffect(settings),valid)&&valid())lastLogoRGB=color;
          return;
        }
      }
      if(!keyboard||at<Math.max(keyAt,current.nextReadyAt()))return;
      const animated=isAnimated(project,selectedFrame,timeAt(at),events);
      // Static keepalives reuse the encoded reports. Render the final idle
      // frame once when a reactive effect expires.
      if(keyDirty||animated||wasAnimated||!keyOutput){
        const frame=sample(at,true);
        if(!sameFrame(frame,sourceFrame,keys)){sourceFrame=frame;keyOutput=prepareOutput(frame,keys);}
        keyDirty=false;
      }
      wasAnimated=animated;
      const interval=frameInterval(project.settings.fps,keyOutput.packets.length);
      keyAt=animated?at+interval:Math.max(at+1,lastKeyAt+OUTPUT_POLICY.keepAliveMs);
      if(sameFrame(keyOutput.frame,lastKeyFrame,keys)&&at-lastKeyAt<OUTPUT_POLICY.keepAliveMs)return;
      const frame=keyOutput.frame;
      if(await current.sendFrame(keyOutput.packets,project.settings.fps,valid)&&valid()){
        lastKeyAt=clock();lastKeyFrame=frame;
        if(!animated&&!keyDirty)keyAt=lastKeyAt+OUTPUT_POLICY.keepAliveMs;
      }
    }
    function drive(){
      timer=null;
      const current=sender,token=generation,valid=()=>sender===current&&generation===token;
      if(!current||control)return;
      task=tick(current,valid).catch(error=>{
        if(valid()){keyboard=false;logo=null;keyAt=logoAt=Infinity;post({event:'fault',error:error.message});}
      }).finally(()=>{task=null;schedule();});
    }
    function exclusive(fn){
      if(!device||!sender)throw Error('请先连接键盘');
      if(control)throw Error('请等待当前灯光操作完成');
      cancelTimer();
      const selected=device,current=sender,token=generation,valid=()=>selected===device&&token===generation;
      const operation=(async()=>{
        await task;
        if(!valid())throw Error('灯光操作已取消');
        return fn(selected,current,valid);
      })();
      control=operation;
      return operation.finally(()=>{if(control===operation)control=null;schedule();});
    }
    async function stop(){
      generation++;keyboard=false;logo=null;keyAt=logoAt=Infinity;cancelTimer();probe?.cancel();
      await Promise.allSettled([task,control]);
      sourceFrame=keyOutput=lastKeyFrame=null;
      return active();
    }
    async function getCapabilities(selected,current,valid) {
      if(capabilities)return capabilities;
      if(!await current.ready(valid,true)||!valid())throw Error('灯光操作已取消');
      let submitted;
      probe=createLightingProbe(selected,{setTimeout:options.setTimeout,clearTimeout:options.clearTimeout,
        sendReport:(_id,packet)=>submitted=current.sendControl(packet,valid).then(ok=>{if(!ok)throw Error('灯光操作已取消');})});
      try{
        const reply=await probe.promise;await submitted;
        if(!valid())throw Error('灯光操作已取消');
        if(reply.sideLight!==null&&reply.logoLight!==null)capabilities={sideLight:reply.sideLight,logoLight:reply.logoLight};
        return reply;
      }finally{await submitted?.catch(()=>{});probe=null;}
    }
    hid?.addEventListener?.('disconnect',event=>{
      if(event.device!==device)return;
      void stop();device=sender=capabilities=null;post({event:'disconnected'});
    });
    async function command(type,payload) {
      if(type==='state'){
        const reuse=payload.reuseTimeline===true;
        const next=validateProject(reuse?{...payload.project,frames:[],frameDurations:[]}:payload.project,keys);
        if(reuse){next.frames=project.frames;next.frameDurations=project.frameDurations;}
        if(!Number.isInteger(payload.selectedFrame)||payload.selectedFrame<-1||payload.selectedFrame>=next.frames.length||
          !Number.isFinite(payload.time)||payload.time<0)throw Error('后台预览状态无效');
        if(payload.resetEvents)events=[];
        project=next;selectedFrame=payload.selectedFrame;time=payload.time;epoch=clock();
        keyDirty=true;keyAt=0;dirtyLogo();schedule();return true;
      }
      if(type==='key-event'){
        const key=byId.get(payload?.id),t=payload?.t;
        if(!key||!Number.isFinite(t)||t<0)throw Error('后台按键事件无效');
        const at=clock();
        if(t>timeAt(at)){time=t;epoch=at;}
        recordPress(events,heat,key,t);
        const keyChanges=keyboard&&selectedFrame<0&&REACTIVE_EFFECTS.has(project.settings.effect);
        if(keyChanges){keyDirty=true;keyAt=0;}
        const logoChanges=logo?.mode==='keyflash'||(logo?.mode==='auto-color'&&selectedFrame<0&&REACTIVE_EFFECTS.has(project.settings.effect));
        if(logoChanges)dirtyLogo();
        if(keyChanges||logoChanges)schedule();
        return true;
      }
      if(type==='connect'){
        if(!hid?.getDevices)throw Error('浏览器未提供后台 WebHID；请使用新版 Chrome / Edge。');
        if(device||connecting||control||task)throw Error('后台设备已连接或正在连接');
        connecting=true;
        try{
          const candidates=(await hid.getDevices()).filter(d=>{
            if(d.vendorId!==payload.vendorId||d.productId!==payload.productId||d.productName!==payload.productName)return false;
            try{return validateDevice(d);}catch{return false;}
          });
          if(candidates.length!==1)throw Error(candidates.length?'检测到多把同型号键盘，请只保留一把':'后台未找到刚授权的 HERO 99HE 灯光接口');
          const chosen=candidates[0];if(!chosen.opened)await chosen.open();
          device=chosen;capabilities=null;events=[];heat={};
          sender=createSender(device,{now:clock,sleep,quietAfterControl:p=>p[0]===4&&p[1]===6?SIDE_QUIET_MS:0});
          return {productName:device.productName};
        }finally{connecting=false;}
      }
      if(type==='start'){
        if(!device||!sender||control)throw Error('请先连接键盘并等待当前操作完成');
        if(!keyboard){
          keyboard=true;keyAt=0;lastKeyAt=-Infinity;sourceFrame=keyOutput=lastKeyFrame=null;keyDirty=true;
          schedule();
        }
        return active();
      }
      if(type==='apply-light'){
        const channel=payload?.channel;
        if(channel!=='strip'&&channel!=='logo')throw Error('未知灯光通道');
        if(payload.consent!==true)throw Error('请确认应用灯光设置');
        const config=project[channel],isStrip=channel==='strip';
        const auto=isStrip&&config.mode==='auto-color';
        const stripColor=auto?rgb(payload.sampledColor):null;
        return exclusive(async(selected,current,valid)=>{
          if(!isStrip&&config.mode==='off'){logo=null;logoAt=Infinity;return active();}
          const caps=await getCapabilities(selected,current,valid);
          if(caps[isStrip?'sideLight':'logoLight']!==true)throw Error('未确认键盘支持这路灯光，未发送设置');
          const at=clock(),settings=isStrip?renderStrip({strip:config},stripColor):logoSettings(config,at);
          if(!await current.sendControl(isStrip?buildSideLightEffect(settings):buildLogoLightEffect(settings),valid)||!valid())throw Error('灯光操作已取消');
          if(!isStrip){
            logo=config.brightness>0&&config.mode!=='solid'?config:null;
            lastLogoRGB=rgbKey(settings);lastLogoAt=at;logoAt=logo?nextLogo(logo,clock()):Infinity;
            if(logo?.mode==='keyflash'&&lastLogoRGB!==0&&!Number.isFinite(logoAt))logoAt=clock();
          }
          return {...active(),submitted:true,...(auto?{sampledColor:settings.color}:{})};
        });
      }
      if(type==='stop')return stop();
      if(type==='disconnect'){
        await stop();const closing=device;device=sender=capabilities=null;
        if(closing?.opened)await closing.close();
        return active();
      }
      throw Error('未知后台操作');
    }
    return {command};
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
    d.settings = { effect: s.effect, brightness: s.brightness, speed: s.speed, fps: Math.round(s.fps), color: rgb(s.color), bg: rgb(s.bg), palette: validatePaletteColors(palette) };
    if (value.strip !== undefined) {
      const strip = value.strip;
      if (!strip || (!STRIP_MODES.includes(strip.mode)&&!REMOVED_STRIP_MODES.has(strip.mode)) || !Number.isInteger(strip.brightness) || strip.brightness < 0 || strip.brightness > 4) throw Error('灯带配置无效');
      const gain = strip.gain === undefined ? 1 : strip.gain;
      if (!Number.isFinite(gain) || gain < 1 || gain > 2) throw Error('灯带鲜亮增强须为 100–200%');
      d.strip = { mode: REMOVED_STRIP_MODES.has(strip.mode)?'off':strip.mode, color: rgb(strip.color), brightness: strip.brightness, gain };
    }
    if(value.logo!==undefined){const logo=value.logo;if(!logo||(!LOGO_MODES.includes(logo.mode)&&!LEGACY_LOGO_MODES.has(logo.mode))||!Number.isInteger(logo.brightness)||logo.brightness<0||logo.brightness>4)throw Error('Logo配置无效：关闭或四档亮度');d.logo={mode:LEGACY_LOGO_MODES.has(logo.mode)?'solid':logo.mode,color:rgb(logo.color),brightness:logo.brightness};}
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
    const durations=value.frameDurations;
    if(durations!==undefined&&(!Array.isArray(durations)||(durations.length!==0&&durations.length!==d.frames.length)||durations.some(n=>!Number.isFinite(n)||n<25||n>5000)))throw Error('逐帧时长必须与动画帧一一对应，范围25–5000ms');
    d.frameDurations=d.frames.map((_,i)=>Math.round(durations?.[i]??d.frameMs));
    return d;
  }
  const geometryCache=new WeakMap();
  const TAU=2*Math.PI, unit=n=>n-Math.floor(n), osc=n=>(1+Math.sin(n))*0.5;
  const triangle=n=>1-Math.abs(unit(n)*2-1);
  const band=(d,width)=>Math.max(0,1-Math.abs(d)/width);
  function reactiveColor(s,key,impulses){
    let level=0, phase=0;
    for(const {x,y,age} of impulses){
      const dx=(key.x-x)/1103,dy=(key.y-y)/325,ax=Math.abs(dx),ay=Math.abs(dy);
      const fade=1-age/2.2;
      let light;
      switch(s.effect){
        case 'key-echo': {
          const r=Math.hypot(dx,dy*0.45),wave=age*0.46;
          light=Math.max(band(r-wave,0.07),0.54*band(r-wave+0.19,0.065));break;
        }
        case 'column-flash': light=band(dx,0.034)*band(ay-age*0.75,0.38);break;
        case 'row-flash': light=band(dy,0.12)*band(ax-age*0.55,0.19);break;
        case 'key-comet': light=band(dy,0.19)*band(dx-age*0.48,0.15+age*0.1);break;
        case 'key-splash': light=band(Math.abs(dx)-age*0.28,0.12)*band(dy+Math.sin(Math.min(age,1.6)*2)*0.38,0.28);break;
        case 'key-spot': light=band(Math.hypot(dx,dy*0.45),0.17+age*0.1)**2*fade;break;
        case 'key-confetti': {
          const drift=0.13+unit(x*0.021+y*0.009)*0.32;
          light=Math.max(band(dx+age*drift,0.09)*band(dy+age*0.36,0.26),
            band(dx-age*0.45,0.11)*band(dy-age*0.32,0.25),
            band(dx-age*0.05,0.08)*band(dy+Math.sin(age*2.5)*0.47,0.27));break;
        }
        case 'key-bloom': {
          const petal=Math.min(Math.abs(dx-dy*0.52),Math.abs(dx+dy*0.52));
          light=band(petal,0.075)*band(ax+ay*0.45-age*0.55,0.16);break;
        }
      }
      const next=light*fade;
      if(next>level){level=next;phase=x/1103+age*0.17+ax*0.44+ay*0.16;}
    }
    return level>0?mix(s.bg,paletteColor(s.palette,phase),level):s.bg;
  }
  function render(project, keys, t, events = [], heat = {}, scale = true) {
    const s = project.settings, time = t * s.speed, out = {};
    const studio=s.effect==='studio'&&project.frames.length?project.frames[studioFrameAt(project,time)]:null;
    const impulses=EXTRA_REACTIVE.has(s.effect)?events.slice(-16).map(e=>({...e,age:(t-e.t)*s.speed})).filter(e=>e.age>=0&&e.age<2.2):null;
    const brightness=scale?s.brightness:1;
    let geometry=geometryCache.get(keys);
    if(!geometry){
      const maxX=Math.max(...keys.map(k=>k.x+k.w));
      geometry=keys.map(key=>{
        const x=(key.x+key.w/2)/maxX,y=(key.y+key.h/2)/325,dx=x-0.5,dy=(y-0.5)*0.48;
        return {key,x,y,dx,dy,radius:Math.hypot(dx,dy),angle:Math.atan2(dy,dx)/TAU};
      });
      geometryCache.set(keys,geometry);
    }
    for (const {key,x,y,dx,dy,radius,angle} of geometry) {
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
        case 'color-tide': {
          const edge=0.12+osc(time*1.65)*0.88, shore=x+Math.sin(y*5+time)*0.1;
          color=mix(s.bg,paletteColor(s.palette,y*0.4+shore*0.36-time*0.07),clamp((edge-shore)*5+0.25,0.12,1));break;
        }
        case 'spectrum-sweep': {
          const head=triangle(time*0.25),beam=band(x-head,0.27);
          color=mix(s.bg,hsv(head*0.85+y*0.33+time*0.03),0.11+beam*0.89);break;
        }
        case 'pinwheel': {
          const spin=angle-time*0.13,blade=Math.floor(unit(spin)*4);
          color=mix(s.bg,paletteColor(s.palette,blade/4),0.18+0.82*triangle(spin*4));break;
        }
        case 'chase': {
          const lane=Math.min(4,Math.floor(y*5)),progress=(lane%2?1-x:x)*0.72+lane*0.2;
          color=mix(s.bg,paletteColor(s.palette,progress*0.8+time*0.13),Math.max(0,1-unit(time*0.63-progress)/0.21)**2);break;
        }
        case 'splitwave': {
          const wave=triangle(Math.abs(dx)*3.5+y*0.21-time*0.49);
          color=mix(s.bg,paletteColor(s.palette,(x<0.5?0:0.52)+y*0.24),0.1+0.9*wave**2);break;
        }
        case 'rowrelay': {
          const row=Math.min(4,Math.floor(y*5)),phase=time*0.55-row/5;
          color=mix(s.bg,paletteColor(s.palette,row/5+x*0.16),triangle(phase)**3);break;
        }
        case 'lasergrid': {
          const a=triangle(x*3+y*0.54-time*0.55)**5,b=triangle(y*1.7-x*0.7-time*0.46)**5;
          color=mix(s.bg,paletteColor(s.palette,a>=b?0.16:0.56),Math.max(a,b));break;
        }
        case 'waterfall': {
          const phase=y-time*0.58+0.11*Math.sin(x*22);
          color=mix(s.bg,paletteColor(s.palette,x*0.5+time*0.04),0.18+0.82*triangle(phase*1.8)**3);break;
        }
        case 'duotone': color=mix(s.palette[0],s.palette.at(-1),clamp(dx*12+0.5,0,1));break;
        case 'topography': {
          const height=0.55*osc(x*10+y*3)+0.45*osc(y*7-x*8),tier=Math.min(s.palette.length-1,Math.floor(height*s.palette.length));
          color=s.palette[tier];break;
        }
        case 'embers': {
          const drift=osc(time*0.87+key.id*1.77),glow=osc(time*0.57+x*8-y*6);
          color=mix(s.bg,paletteColor(s.palette,drift*0.48),0.1+0.8*drift**4*glow);break;
        }
        case 'moonphase': {
          const edge=(osc(time*0.86)*2-1)*0.28;
          color=mix(s.bg,paletteColor(s.palette,0.24+radius*0.58),band(radius,0.47)*clamp((dx-edge)*10+0.55,0.08,1));break;
        }
        case 'ocean': {
          const swell=(osc(y*9+x*4-time*1.2)+osc(y*5-x*11+time*0.85))/2;
          color=mix(s.bg,paletteColor(s.palette,swell*0.65),0.26+swell*0.65);break;
        }
        case 'kaleido': {
          const fold=triangle(angle*6);
          color=mix(s.bg,paletteColor(s.palette,fold*0.42+radius*1.35-time*0.11),0.45+0.55*triangle(radius*3-fold*0.32-time*0.17));break;
        }
        case 'lanterns': {
          const pole=Math.floor(x*5),phase=osc(time*0.96-pole*1.25);
          color=mix(s.bg,paletteColor(s.palette,pole*0.19),0.11+0.89*phase*band(y-0.43-0.16*Math.sin(time+pole),0.57));break;
        }
        case 'heartwave': {
          const phase=unit(time*0.84-radius*0.68),pulse=Math.max(band(phase-0.18,0.13),0.62*band(phase-0.42,0.15));
          color=mix(s.bg,paletteColor(s.palette,0.12+radius*0.65),0.11+pulse*0.76);break;
        }
        case 'key-echo': case 'column-flash': case 'row-flash': case 'key-comet':
        case 'key-splash': case 'key-spot': case 'key-confetti': case 'key-bloom':
          color=reactiveColor(s,key,impulses);break;
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
      out[key.id] = color.map(c => byte(c * brightness));
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
  return {REPORT_ID,REPORT_BYTES,PAYLOAD_BYTES,OUTPUT_POLICY,EFFECTS,EXTRA_EFFECTS,STRIP_MODES,LOGO_MODES,REACTIVE_EFFECTS,PRESETS,MAX_SAVED_PALETTES,validatePaletteLibrary,isNativeStrip,byte,rgb,hsv,mix,paletteColor,dominantColor,buildPackets,prepareOutput,frameInterval,frameDurations,studioFrameAt,createSender,buildLightingQuery,parseLightingCapabilities,buildSideLightEffect,buildLogoLightEffect,renderLogo,createLightingProbe,createOutputEngine,defaultProject,validateProject,render,renderStrip,validateDevice,isAnimated,recordPress};
});
