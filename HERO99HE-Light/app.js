'use strict';
(() => {
  const C = HeroCore, keys = HeroKeys, $ = id => document.getElementById(id);
  const byId = new Map(keys.map(k => [k.id, k])), byCode = new Map(keys.filter(k => k.code).map(k => [k.code, k]));
  const elements = new Map(), events = [], heat = {}, pressed = new Set(), logs = [], presetButtons = [];
  const startTime = performance.now();
  let project = C.defaultProject(), device = null, running = false, generation = 0, halting = false, background = null, workerStats = null;
  let studioOpen = false, selectedFrame = -1, paintMode = false, pointerDown = false, erasing = false;
  let sentFrames = 0, sentPackets = 0, persistenceTimer, toastTimer;
  let preparedKey = '', preparedOutput = null, lastLimited = null;
  let previewDirty = true, lastPreviewAt = -Infinity, lastPressed = '';
  let inspectingLighting = false, lightingInspection = null, sideApplication = null, applying = false, keyRunning = false, actionToken = 0;
  try { const stored = localStorage.getItem('hero99-light/v1'); if (stored) project = C.validateProject(JSON.parse(stored), keys); }
  catch (error) { log('旧配置未载入：' + error.message); }
  const now = () => (performance.now() - startTime) / 1000;
  const hex = c => '#' + c.map(n => C.byte(n).toString(16).padStart(2, '0')).join('');
  const fromHex = s => [1, 3, 5].map(n => parseInt(s.slice(n, n + 2), 16));
  function log(message) {
    logs.push(new Date().toLocaleTimeString() + '  ' + message);
    if (logs.length > 80) logs.shift();
    $('log').textContent = logs.join('\n'); $('lastLog').textContent = message;
  }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
  function persist() {
    previewDirty = true;
    syncBackground();
    clearTimeout(persistenceTimer);
    persistenceTimer = setTimeout(() => { try { localStorage.setItem('hero99-light/v1', JSON.stringify(project)); } catch (e) { log('浏览器无法保存配置，请导出备份：' + e.message); } }, 250);
  }
  function status() {
    $('status').className = 'status' + (running ? ' running' : device ? ' connected' : '');
    $('status').replaceChildren(Object.assign(document.createElement('i'), {}), document.createTextNode(running ? '已连接 · 正在输出' : device ? '已连接 · 尚未输出' : '未连接 · 预览模式'));
    $('connect').disabled = Boolean(device); $('disconnect').hidden = !device;
    const busy = halting || inspectingLighting || applying;
    $('start').disabled = !device || keyRunning || busy;
    for (const id of ['stripMode', 'sideColor', 'sideBrightness', 'sideGain']) $(id).disabled = busy;
    $('inspectLighting').disabled = !device || running || busy;
    $('applySideLight').disabled = !device || busy;
    $('applySideLight').textContent = applying ? '正在应用…' : '应用灯带';
    $('stop').disabled = !running && !busy;
    if (!running) $('stripOutput').textContent = '灯带联动未运行；停止只结束发送，不关闭或恢复硬件当前灯效。';
    $('previewMode').textContent = selectedFrame >= 0 ? '编辑第 ' + (selectedFrame + 1) + ' 帧' : '实时预览';
    $('backgroundState').textContent = device ? '独立后台线程已连接 · 切窗口继续发送 · 静态画面定期保活' : '连接后由独立后台线程发送，不依赖鼠标或网页预览刷新。';
    syncBackground();
  }
  function syncBackground() {
    background?.state({ project, selectedFrame, events, heat, time: now() });
  }
  function createBackground() {
    if (typeof Worker !== 'function') throw Error('浏览器不支持独立后台线程；请使用新版 Chrome / Edge');
    const worker = new Worker('core.js?v=0.1.12', { name: 'HERO99HE-HID-output' }), pending = new Map();
    let sequence = 0, alive = true;
    const fail = error => {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear();
    };
    worker.onmessage = event => {
      if (!alive) return;
      const message = event.data;
      if (message.id) {
        const item = pending.get(message.id); if (!item) return;
        pending.delete(message.id); clearTimeout(item.timer);
        message.ok ? item.resolve(message.result) : item.reject(Object.assign(Error(message.error), { details: message.details || null })); return;
      }
      if (message.event === 'stats') {
        workerStats = message; sentFrames = message.sentFrames; sentPackets = message.sentPackets;
        $('sentFrames').textContent = sentFrames; $('sentPackets').textContent = sentPackets; $('actualFps').textContent = message.fps.toFixed(1);
        $('stripOutput').textContent = message.stripMode !== 'off' ? '灯带模式：' + message.stripMode + ' · 已提交 ' + message.sideUpdates + ' 次 · 有效回执 ' + message.sideAcks + ' 次（不证明视觉生效）' : '灯带未运行。';
        if (message.lastFrame && lastLimited !== message.lastFrame.limited) {
          lastLimited = message.lastFrame.limited;
          log(lastLimited ? '后台多色稳帧：' + message.lastFrame.sourceColors + ' → ' + message.lastFrame.colors + ' 色，' + message.lastFrame.packets + ' 包/帧。' : '后台原色输出；静态画面也会定期保活。');
        }
      }
      if (message.event === 'fault') {
        if (message.details?.query === '04/06') sideApplication = { timestamp: new Date().toISOString(), ok: false, linked: true, error: message.error, details: message.details };
        running = false; keyRunning = false; generation++; log('后台输出已停止：' + message.error); toast('后台发送失败：' + message.error); status();
      }
      if (message.event === 'disconnected') {
        device = null; running = false; keyRunning = false; actionToken++; generation++; status(); log('后台灯光接口已断开，不会自动重连。');
        if (background) { const closing = background; background = null; closing.terminate(); }
      }
    };
    function abort(error) {
      if (!alive) return;
      fail(error); alive = false; worker.terminate(); background = null; device = null; running = false; keyRunning = false; actionToken++; generation++; log(error.message); toast(error.message); status();
    }
    worker.onerror = event => abort(Error(event.message || '后台线程加载失败'));
    return {
      request(type, payload) {
        if (!alive) return Promise.reject(Error('后台线程已关闭'));
        const id = ++sequence;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => abort(Error('后台响应超时：' + type)), 8000);
          pending.set(id, { resolve, reject, timer });
          try { worker.postMessage({ id, type, payload }); } catch (error) { abort(error); }
        });
      },
      state(payload) { if (alive) worker.postMessage({ type: 'state', payload }); },
      terminate() { alive = false; worker.terminate(); fail(Error('后台线程已关闭')); }
    };
  }
  function syncControls() {
    const s = project.settings;
    $('color').value = hex(s.color); $('colorHex').textContent = hex(s.color).toUpperCase();
    $('bg').value = hex(s.bg); $('brightness').value = s.brightness * 100; $('brightnessValue').value = Math.round(s.brightness * 100) + '%';
    $('speed').value = s.speed * 100; $('speedValue').value = s.speed.toFixed(1) + '×';
    $('fps').value = s.fps; $('fpsValue').value = s.fps + ' FPS'; $('frameMs').value = project.frameMs;
    $('stripMode').value = project.strip.mode; $('sideColor').value = hex(project.strip.color); $('sideBrightness').value = project.strip.brightness + 1;
    $('sideGain').value = Math.round(project.strip.gain * 100); $('sideGainValue').value = $('sideGain').value + '%';
    $('palettePreview').replaceChildren();
    for (const color of s.palette) { const chip = document.createElement('i'); chip.style.background = hex(color); chip.title = hex(color); $('palettePreview').append(chip); }
    for (const [button, preset] of presetButtons) button.classList.toggle('active', JSON.stringify(preset.palette) === JSON.stringify(s.palette));
    document.querySelectorAll('.effect').forEach(button => button.classList.toggle('active', button.dataset.effect === s.effect));
    $('paintMode').checked = paintMode; $('keyboard').classList.toggle('painting', paintMode);
    status();
  }
  function displayFrame(scale = true) {
    if (selectedFrame >= 0 && project.frames[selectedFrame]) {
      const frame = project.frames[selectedFrame], out = {};
      for (const key of keys) out[key.id] = frame[key.id].map(c => C.byte(c * (scale ? project.settings.brightness : 1)));
      return out;
    }
    return C.render(project, keys, now(), events, heat, scale);
  }
  function outputFrame() {
    const reference = displayFrame(false), frame = Object.fromEntries(keys.map(k => [k.id, reference[k.id].map(c => C.byte(c * project.settings.brightness))]));
    const policy = project.strip.mode === 'off' ? C.OUTPUT_POLICY : C.LINK_POLICY, key = policy.maxFramePackets + ':' + JSON.stringify(frame);
    if (key !== preparedKey) { preparedOutput = C.prepareOutput(frame, keys, policy); preparedKey = key; }
    preparedOutput.referenceFrame = reference;
    return preparedOutput;
  }
  function virtualPress(key) {
    previewDirty = true;
    events.push({ t: now(), x: key.x, y: key.y });
    heat[key.id] = (heat[key.id] || 0) + 1;
    if (events.length > 60) events.shift();
    syncBackground();
  }
  function paint(key, erase) {
    if (!paintMode) return;
    if (selectedFrame >= 0) project.frames[selectedFrame][key.id] = erase ? [0, 0, 0] : [...project.settings.color];
    else if (erase) delete project.paint[key.id];
    else project.paint[key.id] = [...project.settings.color];
    persist();
  }
  for (const key of keys) {
    const button = document.createElement('button'); button.className = 'key' + (key.label.length > 7 ? ' long-label' : ''); button.type = 'button';
    button.dataset.key = key.id; button.style.left = (key.x / 1103 * 100) + '%'; button.style.top = (key.y / 325 * 100) + '%';
    button.style.width = (key.w / 1103 * 100) + '%'; button.style.height = (key.h / 325 * 100) + '%';
    button.title = key.label + ' · 硬件键号 ' + key.id; button.setAttribute('aria-label', button.title);
    const legend = document.createElement('span'); legend.className = 'legend'; legend.textContent = key.label;
    const id = document.createElement('span'); id.className = 'key-id'; id.textContent = key.id;
    button.append(legend, id); $('keyboard').append(button); elements.set(key.id, button);
    button.addEventListener('pointerdown', e => { if (![0, 2].includes(e.button)) return; pointerDown = true; erasing = e.button === 2; virtualPress(key); paint(key, erasing); if (paintMode) e.preventDefault(); });
    button.addEventListener('pointerenter', () => { $('hoverKey').textContent = key.label + ' · 硬件键号 ' + key.id; if (pointerDown) paint(key, erasing); });
    button.addEventListener('contextmenu', e => e.preventDefault());
    button.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); virtualPress(key); paint(key, false); } });
  }
  window.addEventListener('pointerup', () => { pointerDown = false; if (studioOpen) renderTimeline(); });
  window.addEventListener('blur', () => { pressed.clear(); pointerDown = false; });
  window.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select') || !byCode.has(e.code)) return;
    if (e.target.closest('button') && ['Space', 'Enter', 'NumpadEnter'].includes(e.code)) return;
    const key = byCode.get(e.code); if (!e.repeat) virtualPress(key); pressed.add(key.id);
    if (e.code === 'Escape' || e.code === 'Insert') $('hoverKey').textContent = '收到实体 ' + key.label + ' · 灯光键号 ' + key.id;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { const key = byCode.get(e.code); if (key) pressed.delete(key.id); });
  function draw() {
    const stamp = performance.now(), pressedKey = [...pressed].join(',');
    if (document.visibilityState === 'hidden' || (!previewDirty && pressedKey === lastPressed && stamp - lastPreviewAt < 1000 / Math.min(30, project.settings.fps))) { requestAnimationFrame(draw); return; }
    lastPreviewAt = stamp; lastPressed = pressedKey; previewDirty = false;
    const prepared = outputFrame(), frame = prepared.frame;
    const stripFrame = prepared.referenceFrame;
    const strip = C.renderStrip(project, stripFrame, now(), events, keys);
    $('stripPreview').style.background = strip ? hex(strip.color.map(c => C.byte(c * (strip.brightness + 1) / 5))) : '#312b39';
    $('stripPreview').title = project.strip.mode === 'off' ? '灯带不联动（不代表关闭硬件灯光）' : '整条灯带颜色预览；不是逐灯地址图';
    const cap = Math.min(project.settings.fps, 1000 / C.frameInterval(project.settings.fps, prepared.packets.length));
    $('outputLoad').textContent = (prepared.limited ? '多色稳帧：' + prepared.sourceColors + ' → ' + prepared.colors + ' 色' : '原色输出：' + prepared.colors + ' 色') + ' · ' + prepared.packets.length + ' 包/帧 · 上限 ' + Math.round(cap) + ' FPS';
    for (const key of keys) {
      const color = frame[key.id], el = elements.get(key.id), css = color.join(',');
      el.style.background = 'linear-gradient(150deg,rgba(' + css + ',.55),rgba(' + css + ',.17)),#201d28';
      el.style.borderColor = 'rgba(' + css + ',.65)';
      el.style.boxShadow = '0 3px 0 #0c0b10,inset 0 0 12px rgba(' + css + ',.08),0 0 9px rgba(' + css + ',.08)';
      el.classList.toggle('pressed', pressed.has(key.id));
    }
    requestAnimationFrame(draw);
  }
  const effects = [
    ['static', '纯色常亮', 'A COLOR THAT IS YOU', ['#5f9aca','#70c3ed','#75c9ec','#80caee','#83d5f0']],
    ['rainbow', '彩虹流光', 'A LITTLE OF EVERYTHING', ['#e88c99','#e0b67e','#aacc8c','#73bfca','#a08bd7']],
    ['wave', '空间光波', 'RIDE THE LIGHT', ['#43334d','#6b4f8d','#c3a0ed','#795a9e','#40304c']],
    ['breathe', '柔和呼吸', 'SLOW DOWN & GLOW', ['#383440','#61516d','#9a81ba','#61516d','#383440']],
    ['meteor', '流星轨迹', 'MAKE A WISH', ['#272e36','#354e59','#568b9d','#9eddef','#f4f5f4']],
    ['ripple', '按键涟漪', 'EVERY TOUCH ECHOES', ['#343441','#58536c','#a19bb7','#58536c','#343441']],
    ['heatmap', '打字热力', 'LEAVE YOUR MARK', ['#514056','#9a526e','#dd7875','#b96478','#755064']],
    ['studio', '我的动画', 'MAKE IT YOUR OWN', ['#8b7d66','#c6b591','#95b1a6','#748ba4','#93829e']],
    ['gradient', '配色渐变', 'YOUR PALETTE', ['#ff429e','#aa4eef','#39c8ff','#aa4eef','#ff429e']],
    ['aurora', '极光漫游', 'NORTHERN LIGHTS', ['#145848','#37c58a','#63e6cf','#7794e4','#49446e']],
    ['checker', '双色棋盘', 'PLAY IN COLOR', ['#d761ad','#494b9e','#d761ad','#494b9e','#d761ad']],
    ['scanner', '往返扫描', 'BACK AND FORTH', ['#292c35','#40566c','#97d9fa','#40566c','#292c35']],
    ['twinkle', '繁星闪烁', 'A QUIET SKY', ['#302b43','#967ac8','#393047','#d4c6f2','#343044']],
    ['fire', '焰色跃动', 'PALETTE EMBERS', ['#6c2932','#c55335','#efaa51','#b85f38','#713440']],
    ['radar', '雷达环扫', 'ROUND AND ROUND', ['#263e35','#42795a','#8dda9b','#527d5e','#304638']],
    ['keyfade', '按键余辉', '', ['#302b40','#3c324e','#b49be5','#594a70','#352e43']],
    ['paletteflow', '霓虹渐流', '', ['#ff72bc','#bc75f7','#75b8fa','#68e0d5','#ff72bc']],
    ['verticalrainbow', '纵向彩虹', '', ['#ed8c9a','#e5c98b','#9dd29d','#80bfda','#b39bea']],
    ['diagonal', '斜向流光', '', ['#9cd6ea','#a3b3ed','#be96e5','#dd94c4','#f0b9b6']],
    ['spiral', '星云旋涡', '', ['#74538b','#a569a9','#d09cda','#a484cf','#645088']],
    ['plasma', '等离子', '', ['#8e6fc6','#dc87b8','#dbb48f','#85bdc9','#8e6fc6']],
    ['rain', '数字雨', '', ['#243c32','#3d6b52','#73bd85','#4d8a62','#2f493b']],
    ['cometpair', '双向彗星', '', ['#a4d5eb','#5a8397','#2f3545','#795c99','#c5a2e9']],
    ['centerwave', '中心扩散', '', ['#393146','#7e629f','#cfa8f0','#7e629f','#393146']],
    ['curtain', '光幕开合', '', ['#302b40','#8b76b2','#b59cd9','#8b76b2','#302b40']],
    ['diamond', '菱形脉冲', '', ['#2d303f','#665e8d','#b7a1e3','#665e8d','#2d303f']],
    ['ribbons', '丝带流光', '', ['#4a4166','#ad85c5','#d6a2ca','#9389c8','#4a4166']],
    ['fireflies', '萤火游弋', '', ['#27382d','#587a49','#b6d982','#4d6d45','#26372b']],
    ['orbit', '行星环绕', '', ['#3d354e','#615578','#c7b0e4','#615578','#3d354e']],
    ['sunset', '暮色潮汐', '', ['#8774aa','#ba91b7','#e4b0a5','#dbba9c','#b59cbd']],
    ['sparkburst', '按键烟花', '', ['#514365','#947ab3','#e0b4ea','#b28fca','#57476d']],
    ['keycross', '十字光痕', '', ['#333448','#63658c','#b9bde8','#63658c','#333448']]
  ];
  for (const [id, label, caption, colors] of effects) {
    const button = document.createElement('button'); button.className = 'effect'; button.dataset.effect = id;
    button.dataset.category = ['ripple','heatmap','keyfade','sparkburst','keycross'].includes(id) ? 'reactive' : ['static','studio','gradient','breathe','twinkle','fireflies','sunset','fire','checker'].includes(id) ? 'ambient' : 'flow';
    const art = document.createElement('span'); art.className = 'effect-art'; colors.forEach(c => { const tile = document.createElement('i'); tile.style.background = c; art.append(tile); });
    const title = document.createElement('strong'); title.textContent = label; button.append(art, title);
    button.onclick = () => { project.settings.effect = id; selectedFrame = -1; syncControls(); persist(); if (button.dataset.category === 'reactive') toast('按键响应仅在此页面获得焦点时有效；点击预览键帽也可触发。'); if (id === 'studio' && !project.frames.length) toast('还没有动画帧，请到“逐帧动画”捕获画面。'); };
    $('effects').append(button);
  }
  $('effectFilter').value = 'all';
  $('effectFilter').onchange = () => { for (const button of $('effects').children) button.hidden = $('effectFilter').value !== 'all' && button.dataset.category !== $('effectFilter').value; };
  for (const color of ['#61dafb', '#bd9bff', '#f699b6', '#efc57b', '#abdb9e', '#ffffff']) {
    const button = document.createElement('button'); button.className = 'swatch'; button.style.background = color; button.title = color; button.setAttribute('aria-label', '主色 ' + color);
    button.onclick = () => { project.settings.color = fromHex(color); syncControls(); persist(); }; $('swatches').append(button);
  }
  for (const preset of C.PRESETS) {
    const button = document.createElement('button'); button.className = 'preset'; button.title = preset.name;
    const art = document.createElement('span'); art.className = 'preset-art';
    for (const c of preset.palette) { const chip = document.createElement('i'); chip.style.background = hex(c); art.append(chip); }
    const label = document.createElement('span'); label.textContent = preset.name; button.append(art, label);
    button.onclick = () => {
      project.settings.color = [...preset.color]; project.settings.bg = [...preset.bg]; project.settings.palette = preset.palette.map(c => [...c]);
      if (['rainbow', 'verticalrainbow', 'heatmap', 'studio'].includes(project.settings.effect)) project.settings.effect = 'gradient';
      selectedFrame = -1;
      project.strip.color = [...preset.color]; syncControls(); persist();
      toast('已切换 ' + preset.name);
    };
    $('presets').append(button); presetButtons.push([button, preset]);
  }
  $('presetSearch').addEventListener('input', () => { const query = $('presetSearch').value.trim(); for (const [button, preset] of presetButtons) button.hidden = !preset.name.includes(query); });
  for (const id of ['stripMode', 'sideColor', 'sideBrightness', 'sideGain']) $(id).onchange = () => {
    if (applying || halting || inspectingLighting) return;
    const value = { ...project, strip: { mode: $('stripMode').value, color: fromHex($('sideColor').value), brightness: Number($('sideBrightness').value) - 1, gain: Number($('sideGain').value) / 100 } };
    try { project = C.validateProject(value, keys); syncControls(); persist(); }
    catch (error) { toast(error.message); syncControls(); }
  };
  $('sideGain').addEventListener('input', () => $('sideGain').onchange());
  for (const name of ['brightness', 'speed', 'fps', 'color', 'bg']) $('' + name).addEventListener('input', () => {
    project.settings[name] = ['color', 'bg'].includes(name) ? fromHex($(name).value) : Number($(name).value) / (name === 'fps' ? 1 : 100);
    syncControls(); persist();
  });
  $('paintMode').onchange = () => { paintMode = $('paintMode').checked; syncControls(); };
  $('clearPaint').onclick = () => { if (selectedFrame >= 0) { if (!confirm('将当前动画帧的全部键设为黑色？')) return; project.frames[selectedFrame] = Object.fromEntries(keys.map(k => [k.id, [0, 0, 0]])); renderTimeline(); } else project.paint = {}; persist(); };
  function showTab(studio) {
    studioOpen = studio; selectedFrame = -1;
    $('tabLive').classList.toggle('active', !studio); $('tabStudio').classList.toggle('active', studio);
    $('tabLive').setAttribute('aria-selected', String(!studio)); $('tabStudio').setAttribute('aria-selected', String(studio));
    $('livePanel').hidden = studio; $('studioPanel').hidden = !studio; renderTimeline(); status();
  }
  $('tabLive').onclick = () => showTab(false); $('tabStudio').onclick = () => showTab(true);
  function renderTimeline() {
    $('timeline').replaceChildren(); $('frameCount').textContent = project.frames.length + ' / 120 FRAMES'; $('deleteFrame').disabled = selectedFrame < 0;
    if (!project.frames.length) { const msg = document.createElement('span'); msg.className = 'muted small'; msg.textContent = '还没有动画帧，先捕获一个喜欢的画面。'; $('timeline').append(msg); }
    project.frames.forEach((frame, index) => {
      const button = document.createElement('button'); button.className = 'frame-chip' + (selectedFrame === index ? ' selected' : ''); const colors = document.createElement('span'); colors.className = 'frame-colors';
      for (let i = 0; i < keys.length; i += 12) { const swatch = document.createElement('i'); swatch.style.background = hex(frame[keys[i].id]); colors.append(swatch); }
      button.append(colors, document.createTextNode(String(index + 1).padStart(2, '0') + ' · ' + project.frameMs + 'ms'));
      button.onclick = () => { selectedFrame = index; paintMode = true; renderTimeline(); syncControls(); }; $('timeline').append(button);
    });
  }
  $('capture').onclick = () => { if (project.frames.length >= 120) return toast('最多 120 帧。'); project.frames.push(displayFrame(false)); selectedFrame = project.frames.length - 1; paintMode = true; renderTimeline(); syncControls(); persist(); };
  $('playStudio').onclick = () => { if (!project.frames.length) return toast('请先捕获一帧。'); selectedFrame = -1; project.settings.effect = 'studio'; renderTimeline(); syncControls(); persist(); };
  $('deleteFrame').onclick = () => { if (selectedFrame < 0 || !confirm('删除当前帧？此操作不影响已导出的文件。')) return; project.frames.splice(selectedFrame, 1); selectedFrame = -1; renderTimeline(); syncControls(); persist(); };
  $('frameMs').onchange = () => { const value = Number($('frameMs').value); if (!Number.isFinite(value) || value < 25 || value > 5000) { toast('每帧时长须为 25–5000 毫秒。'); $('frameMs').value = project.frameMs; return; } project.frameMs = Math.round(value); renderTimeline(); persist(); };
  async function halt(message) {
    halting = true; running = false; keyRunning = false; generation++; status();
    try { if (background) await background.request('stop'); if (message) log(message); }
    catch (error) { log('停止后台：' + error.message); background?.terminate(); background = null; device = null; }
    finally { halting = false; status(); }
  }
  $('connect').onclick = async () => {
    if (!navigator.hid || !window.isSecureContext) return toast('需要 Windows 的 Chrome / Edge，并通过启动脚本打开 localhost 页面。');
    $('connect').disabled = true;
    let chosen;
    try {
      [chosen] = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x372e, productId: 0x103e, usagePage: 0xff60, usage: 0x61 }] });
      if (!chosen) { log('已取消选择设备。'); return; }
      lightingInspection = null; sideApplication = null; $('lightingCapabilities').textContent = '尚未读取这次连接的灯光能力。停止输出后可点击查询。';
      C.validateDevice(chosen); background?.terminate(); background = createBackground();
      await background.request('connect', { vendorId: chosen.vendorId, productId: chosen.productId, productName: chosen.productName }); device = chosen;
      log('后台已连接 ' + device.productName + '；Report 9 / 63 字节匹配。未发送灯光。'); toast('已连接。点击“开始输出”或“应用灯带”即可。');
    } catch (e) { log('连接失败：' + e.message); toast(e.message); background?.terminate(); background = null; device = null; }
    finally { status(); }
  };
  async function ensureStripCapability(token) {
    if (project.strip.mode === 'off') return;
    if (lightingInspection?.sideLight !== true) await $('inspectLighting').onclick();
    if (token !== actionToken || !device) throw Error('操作已取消');
    if (lightingInspection?.sideLight !== true) throw Error(lightingInspection?.error || '未确认灯带能力，请检查连接');
  }
  async function activate(keyboard, token) {
    if (token !== actionToken || !device) throw Error('操作已取消');
    if (!keyboard && project.strip.mode === 'off') return;
    syncBackground();
    sentFrames = 0; sentPackets = 0; lastLimited = null; workerStats = null;
    // Reached only from an explicit Start/Apply click; never from connection,
    // page load, preview, import, or a staged strip edit.
    await background.request('start', { keyboard, sideConsent: project.strip.mode !== 'off' });
    if (token !== actionToken) { await halt(); throw Error('操作已取消'); }
    running = true; keyRunning = keyboard; generation++; status();
  }
  $('start').onclick = async () => {
    if (!device || keyRunning || halting || applying || inspectingLighting) return;
    const token = ++actionToken; applying = true; status();
    try {
      await halt(); await ensureStripCapability(token); await activate(true, token);
      log('已启动按键灯光' + (project.strip.mode !== 'off' ? '与灯带联动，共享80包/秒预算。' : '；保留原有稳帧和保活。'));
    } catch (error) { log(error.message); toast(error.message); }
    finally { applying = false; status(); }
  };
  $('stop').onclick = () => { actionToken++; return halt('已停止全部输出。'); };
  $('inspectLighting').onclick = async () => {
    if (!device || !background || running || halting || inspectingLighting) return;
    inspectingLighting = true; lightingInspection = null; status(); $('lightingCapabilities').textContent = '正在读取固件灯光能力…不会设置灯效。';
    try {
      const result = await background.request('inspect-lighting');
      lightingInspection = { timestamp: new Date().toISOString(), ok: true, ...result };
      const box = result.lightbox;
      const support = value => value === null ? '未知（未返回字段）' : value ? '支持' : '不支持';
      $('lightingCapabilities').textContent = (result.payloadFormat === 'official-fixed-body' ? '按原厂固定数据区解析（长度字段为 0）：' : result.capabilityFieldsComplete ? '固件报告：' : '收到短响应（' + result.declaredLength + ' 字节数据），未取得完整能力：') + '侧灯 ' + support(result.sideLight) + (result.sideLightCount === null ? '' : '（固件报告数量 ' + result.sideLightCount + '，不等于已核实的物理灯珠数）') + '；Logo 灯 ' + support(result.logoLight) + '；灯箱 ' + (box ? box.rows + ' × ' + box.columns + (box.dimensionsValid ? '' : '（尺寸异常，禁止输出）') : result.lightboxDimensionsReported ? '返回零尺寸' : '未知（未返回尺寸）') + '。原始响应已保留；本次查询不设置灯效。';
      log('灯光查询完成：仅发送一次 82/09；完整或部分响应已保留，没有设置/保存灯效。');
      toast(result.sideLight === true ? '灯带已连接。选择模式后点击“应用灯带”即可。' : '查询完成；未确认支持氛围灯，保持控制禁用。请导出诊断报告。');
    } catch (error) {
      lightingInspection = { timestamp: new Date().toISOString(), ok: false, error: error.message, details: error.details || null };
      $('lightingCapabilities').textContent = '读取失败：' + error.message; log('灯光能力查询：' + error.message); toast(error.message);
    } finally { inspectingLighting = false; status(); }
  };
  $('applySideLight').onclick = async () => {
    if (!device || !background || halting || applying || inspectingLighting) return;
    const resumeKeys = keyRunning, token = ++actionToken;
    applying = true; sideApplication = null; status();
    try {
      await halt(); await ensureStripCapability(token);
      await activate(resumeKeys, token);
      sideApplication = { timestamp: new Date().toISOString(), ok: true, delivery: 'stream', acknowledged: false, settings: { ...project.strip, color: [...project.strip.color] }, keyboard: resumeKeys };
      $('sideResult').textContent = project.strip.mode === 'off' ? '已停止接管灯带' : '灯带设置已提交';
      log('已应用灯带模式 ' + project.strip.mode + (resumeKeys ? '，按键输出已继续。' : '，独立灯带输出。'));
      toast(project.strip.mode === 'off' ? '已停止接管灯带' : '已应用灯带');
    } catch (error) {
      sideApplication = { timestamp: new Date().toISOString(), ok: false, error: error.message, details: error.details || null };
      $('sideResult').textContent = error.message; log('灯带应用：' + error.message); toast(error.message);
    } finally { applying = false; status(); }
  };
  $('disconnect').onclick = async () => { actionToken++; await halt(); if (background) { const closing = background; background = null; try { await closing.request('disconnect'); } catch (e) { log('关闭通道：' + e.message); } finally { closing.terminate(); } } device = null; status(); log('已断开。没有发送恢复或保存指令。'); };
  navigator.hid?.addEventListener('disconnect', event => { if (event.device === device) { actionToken++; device = null; background?.terminate(); background = null; running = false; keyRunning = false; generation++; status(); log('键盘已断开；不会自动重连或恢复输出。'); } });
  function download(name, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('export').onclick = () => { download('HERO99HE-light.json', project); log('配置已导出到本地文件。'); };
  $('import').onclick = () => $('importFile').click();
  $('importFile').onchange = async () => {
    const file = $('importFile').files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw Error('文件超过 1 MB'); const value = C.validateProject(JSON.parse(await file.text()), keys); actionToken++; await halt(); project = value; selectedFrame = -1; renderTimeline(); syncControls(); persist(); log('配置已导入，输出保持停止。'); toast('导入成功。需要控制硬件时请重新点击“开始输出”。'); }
    catch (e) { log('导入失败：' + e.message); toast('未修改当前配置：' + e.message); }
    $('importFile').value = '';
  };
  $('diagnostics').onclick = () => {
    const reportSummary = list => (list || []).map(r => ({ reportId: r.reportId, items: (r.items || []).map(i => ({ reportSize: i.reportSize, reportCount: i.reportCount })) }));
    const summarize = list => (list || []).map(c => ({ usagePage: c.usagePage, usage: c.usage, inputReports: reportSummary(c.inputReports), outputReports: reportSummary(c.outputReports), children: summarize(c.children) }));
    download('HERO99HE-diagnostics.json', { app: 'HERO99HE Light Lab v0.1.12', hardwareVerified: false, userFeedback: 'v0.1.12优化联动卡顿：复杂联动按键最多3包/15色，跟随灯带复用同帧原色，共享80包/秒；后台不绘制预览。32种灯效、30组色卡保留；仅软件验证，Esc未解决', timestamp: new Date().toISOString(), webhid: Boolean(navigator.hid), secureContext: window.isSecureContext, visibility: document.visibilityState, lightingInspection, sideApplication, device: device ? { productName: device.productName, vendorId: device.vendorId, productId: device.productId, collections: summarize(device.collections) } : null, output: { running, keyRunning, mode: 'dedicated-worker', sentFrames, sentPackets, maxFrameGapMs: workerStats?.maxFrameGapMs ?? null, maxControlSendMs: workerStats?.maxControlSendMs ?? null, policy: C.OUTPUT_POLICY, linkPolicy: C.LINK_POLICY, stripPolicy: C.STRIP_POLICY, strip: { ...project.strip, activation: 'explicit-start-or-apply', activeMode: workerStats?.stripMode || 'off', updates: workerStats?.sideUpdates || 0, observedAcks: workerStats?.sideAcks || 0, hardwareApplied: null }, lastFrame: workerStats?.lastFrame || null }, logs }); toast('诊断报告仅保存到本地，不含按键记录或序列号，也不会自动上传。');
  };
  window.addEventListener('beforeunload', () => { running = false; generation++; background?.terminate(); try { localStorage.setItem('hero99-light/v1', JSON.stringify(project)); } catch {} });
  log(navigator.hid ? '就绪 · 仅预览，未向硬件发送数据。按键响应仅限当前页面焦点。' : '当前浏览器不支持 WebHID；可预览，请换 Chrome / Edge 连接硬件。');
  syncControls(); renderTimeline(); requestAnimationFrame(draw);
})();
