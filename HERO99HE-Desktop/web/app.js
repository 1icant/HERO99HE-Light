'use strict';
(() => {
  const C = HeroCore, keys = HeroKeys, $ = id => document.getElementById(id);
  const byId = new Map(keys.map(k => [k.id, k])), byCode = new Map(keys.filter(k => k.code).map(k => [k.code, k]));
  const elements=new Map(),events=[],heat={},pressed=new Set(),presetButtons=[],keyVisuals=new Map();
  const startTime=performance.now();
  let project=C.defaultProject(),device=null,background=null,running=false,keyRunning=false,activeLogo='off';
  let halting=false,applying=false,actionToken=0,persistenceTimer,stateTimer,toastTimer,inputContext='';
  let studioOpen=false,selectedFrame=-1,paintMode=false,pointerDown=false,erasing=false;
  let clockOffset=0,resetEvents=false,previewFrame=null,previewTimer=null;
  let timelineRevision=0,sentTimeline=-1,desktopVisible=!window.HeroDesktop?.onPreviewVisibility,paletteKey='';
  let lastPressKey=new Set(),lastLogoPreview='',lastStripPreview='',logoPreviewAt=-Infinity;
  const timelineButtons=[],thumbnailCache=new WeakMap();
  let playhead=-1,timelineTotal=0;
  const PALETTE_STORAGE='hero99-light/palettes/v1';
  let savedPalettes=[],paletteLoadError='',sampledStripColor=null;
  let loadError='';
  try{const stored=localStorage.getItem('hero99-light/v1');if(stored)project=C.validateProject(JSON.parse(stored),keys);}
  catch(error){loadError='旧配置未载入：'+error.message;}
  try{const stored=localStorage.getItem(PALETTE_STORAGE);if(stored)savedPalettes=C.validatePaletteLibrary(JSON.parse(stored));}
  catch(error){paletteLoadError='配色库读取失败：'+error.message;}
  const now=()=>Math.max(0,(performance.now()-startTime)/1000+clockOffset);
  const hex=c=>'#'+c.map(n=>C.byte(n).toString(16).padStart(2,'0')).join('');
  const fromHex=s=>[1,3,5].map(n=>parseInt(s.slice(n,n+2),16));
  function log(message){$('lastLog').textContent=message;}
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},5000);}
  function sendState(){
    clearTimeout(stateTimer);stateTimer=null;
    if(!background)return;
    const reuseTimeline=sentTimeline===timelineRevision;
    const {frames,frameDurations,...scene}=project;
    background.state({project:reuseTimeline?scene:project,reuseTimeline,selectedFrame,time:now(),resetEvents});
    sentTimeline=timelineRevision;resetEvents=false;
  }
  function syncBackground(){
    if(running&&background&&stateTimer==null)stateTimer=setTimeout(sendState,25);
    updateInput();
  }
  function persist(){
    logoPreviewAt=-Infinity;requestPreview();syncBackground();
    clearTimeout(persistenceTimer);
    persistenceTimer=setTimeout(()=>{try{localStorage.setItem('hero99-light/v1',JSON.stringify(project));}catch(error){log('无法保存配置：'+error.message);}},250);
  }
  function status(){
    const className='status'+(running?' running':device?' connected':'');
    if($('status').className!==className){
      $('status').className=className;
      $('status').replaceChildren(document.createElement('i'),document.createTextNode(running?'已连接 · 正在输出':device?'已连接':'未连接 · 预览模式'));
    }
    const busy=halting||applying;
    $('connect').disabled=Boolean(device);$('disconnect').hidden=!device;
    $('start').disabled=!device||keyRunning||busy;
    $('stop').disabled=!running&&!applying;
    for(const id of ['applySideLight','applyLogo'])$(id).disabled=!device||busy;
    for(const id of ['stripMode','logoMode'])$(id).disabled=busy;
    const stripMode=project.strip.mode,firmwareColor=C.isNativeStrip(stripMode);
    $('sideColor').disabled=busy||firmwareColor||stripMode==='off'||stripMode==='auto-color';
    $('sideBrightness').disabled=busy||stripMode==='off';
    $('sideGain').disabled=busy||firmwareColor||stripMode==='off';
    $('logoColor').disabled=busy||!['solid','auto-color'].includes(project.logo.mode);
    $('logoBrightness').disabled=busy||project.logo.mode==='off';
    $('previewMode').textContent=selectedFrame>=0?'编辑第 '+(selectedFrame+1)+' 帧':'灯光预览';
    updateInput();
  }
  function updateInput(){
    // Status changes only update the native input helper, never clone a scene.
    const enabled=$('backgroundKeys').checked,backend=$('inputBackend').value;
    const reactive=(keyRunning&&selectedFrame<0&&C.REACTIVE_EFFECTS.has(project.settings.effect))||activeLogo==='keyflash'||
      activeLogo==='auto-color'&&selectedFrame<0&&C.REACTIVE_EFFECTS.has(project.settings.effect);
    const active=running&&!halting&&Boolean(device),signature=[enabled,backend,active,reactive].join('/');
    if(signature===inputContext)return;
    inputContext=signature;window.HeroDesktop?.setInputContext?.({enabled,backend,running:active,reactive});
  }
  function setActive(state){
    keyRunning=state?.keyboard===true;activeLogo=state?.logoMode||'off';running=keyRunning||activeLogo!=='off';status();
  }
  function createBackground(){
    if(typeof Worker!=='function')throw Error('浏览器不支持独立后台线程，请使用新版 Chrome / Edge');
    const worker=new Worker('core.js?v=0.1.26',{name:'HERO99HE-HID-output'}),pending=new Map();
    let sequence=0,alive=true;
    function fail(error){for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();}
    function close(error){
      if(!alive)return;
      alive=false;fail(error);worker.terminate();background=null;device=null;actionToken++;setActive(null);
      log(error.message);toast(error.message);
    }
    worker.onmessage=event=>{
      if(!alive)return;
      const message=event.data;
      if(message.id){
        const item=pending.get(message.id);if(!item)return;
        pending.delete(message.id);clearTimeout(item.timer);
        message.ok?item.resolve(message.result):item.reject(Error(message.error));return;
      }
      if(message.event==='fault'){actionToken++;setActive(null);log(message.error);toast('后台输出已停止：'+message.error);}
      if(message.event==='disconnected')close(Error('键盘已断开，不会自动重连'));
    };
    worker.onerror=event=>close(Error(event.message||'后台线程加载失败'));
    return {
      request(type,payload){
        if(!alive)return Promise.reject(Error('后台线程已关闭'));
        const id=++sequence;
        return new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>close(Error('后台灯光响应超时')),8000);
          pending.set(id,{resolve,reject,timer});
          try{worker.postMessage({id,type,payload});}catch(error){close(error);}
        });
      },
      state(payload){if(alive)worker.postMessage({type:'state',payload});},
      press(id,t){if(alive)worker.postMessage({type:'key-event',payload:{id,t}});},
      terminate(){alive=false;worker.terminate();fail(Error('后台线程已关闭'));}
    };
  }
  function syncControls() {
    const s = project.settings;
    $('color').value = hex(s.color); $('colorHex').textContent = hex(s.color).toUpperCase();
    $('bg').value = hex(s.bg); $('brightness').value = s.brightness * 100; $('brightnessValue').value = Math.round(s.brightness * 100) + '%';
    $('speed').value = s.speed * 100; $('speedValue').value = s.speed.toFixed(1) + '×';
    $('fps').value = s.fps; $('fpsValue').value = s.fps + ' FPS'; $('frameMs').value = selectedFrame>=0?C.frameDurations(project)[selectedFrame]:project.frameMs;
    $('stripMode').value = project.strip.mode; $('sideColor').value = hex(project.strip.color); $('sideBrightness').value = project.strip.brightness + 1;
    $('logoMode').value=project.logo.mode;$('logoColor').value=hex(project.logo.color);$('logoBrightness').value=project.logo.brightness;
    $('sideGain').value = Math.round(project.strip.gain * 100); $('sideGainValue').value = $('sideGain').value + '%';
    const nextPalette=JSON.stringify(s.palette);
    if(nextPalette!==paletteKey){
      paletteKey=nextPalette;
      $('palettePreview').replaceChildren();
      for(const color of s.palette){const chip=document.createElement('i');chip.style.background=hex(color);chip.title=hex(color);$('palettePreview').append(chip);}
      $('paletteEditor').replaceChildren();
      s.palette.forEach((color,index)=>{
      const label=document.createElement('label'),input=document.createElement('input');input.type='color';input.value=hex(color);input.setAttribute('aria-label','配色第'+(index+1)+'色');
      label.append(document.createTextNode('配色 '+(index+1)),input);$('paletteEditor').append(label);
      input.addEventListener('input',()=>{
        project.settings.palette[index]=fromHex(input.value);$('palettePreview').children[index].style.background=input.value;
        paletteKey=JSON.stringify(project.settings.palette);
        if(['rainbow','verticalrainbow','spectrum-sweep','heatmap'].includes(project.settings.effect)){project.settings.effect='gradient';document.querySelectorAll('.effect').forEach(button=>button.classList.toggle('active',button.dataset.effect==='gradient'));}
        for(const [button,preset]of presetButtons)button.classList.toggle('active',JSON.stringify(preset.palette)===JSON.stringify(project.settings.palette));
        persist();
      });
      });
    }
    for (const [button, preset] of presetButtons) button.classList.toggle('active', JSON.stringify(preset.palette) === JSON.stringify(s.palette));
    document.querySelectorAll('.effect').forEach(button => button.classList.toggle('active', button.dataset.effect === s.effect));
    $('paintMode').checked = paintMode; $('keyboard').classList.toggle('painting', paintMode);
    status();drawStripPreview();logoPreviewAt=-Infinity;requestPreview();syncBackground();
  }
  function drawStripPreview(){
    const mode=project.strip.mode,settings=C.renderStrip(project),level=(settings.brightness+1)/5;
    let css='#312b39';
    if(C.isNativeStrip(mode)){
      const colors=[[255,75,145],[255,181,62],[98,236,153],[80,168,255],[183,116,255]].map(color=>hex(color.map(c=>C.byte(c*level))));
      css='linear-gradient(90deg,'+colors.join(',')+')';
    }else if(mode!=='off'&&(mode!=='auto-color'||sampledStripColor)){
      css=hex((mode==='auto-color'?sampledStripColor:settings.color).map(c=>C.byte(c*level)));
    }
    if(css!==lastStripPreview){lastStripPreview=css;$('stripPreview').style.background=css;}
  }
  function displayFrame(scale=true,t=now()){
    if(selectedFrame>=0&&project.frames[selectedFrame]){
      const frame=project.frames[selectedFrame],brightness=scale?project.settings.brightness:1;
      return Object.fromEntries(keys.map(k=>[k.id,frame[k.id].map(c=>C.byte(c*brightness))]));
    }
    return C.render(project,keys,t,events,heat,scale);
  }
  function virtualPress(key){
    const t=now();
    C.recordPress(events,heat,key,t);
    if(running)background?.press(key.id,t);
    requestPreview();
  }
  function paint(key, erase) {
    if (!paintMode) return;
    if (selectedFrame >= 0) {
      const frame=project.frames[selectedFrame];frame[key.id]=erase?[0,0,0]:[...project.settings.color];
      thumbnailCache.delete(frame);timelineRevision++;
    }
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
  window.addEventListener('pointerup', () => { if(pointerDown&&studioOpen&&paintMode)renderTimeline();pointerDown=false; });
  window.addEventListener('blur', () => { pressed.clear(); pointerDown=false;requestPreview(); });
  window.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select') || !byCode.has(e.code)) return;
    if (e.target.closest('button') && ['Space', 'Enter', 'NumpadEnter'].includes(e.code)) return;
    const key = byCode.get(e.code); if (!e.repeat) virtualPress(key); pressed.add(key.id);
    $('hoverKey').textContent=key.label;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { const key=byCode.get(e.code);if(key&&pressed.delete(key.id))requestPreview(); });
  if(window.HeroDesktop?.onKey){
    $('desktopKeyControls').hidden=false;
    $('inputBackend').value='raw';
    $('inputBackend').onchange=()=>{
      if($('inputBackend').value==='poll'&&!confirm('兼容模式会响应所有键盘，不记录或上传输入。是否启用？'))$('inputBackend').value='raw';
      pressed.clear();requestPreview();updateInput();
    };
    $('backgroundKeys').onchange=()=>{pressed.clear();requestPreview();updateInput();};
    window.HeroDesktop.onKey(value=>{
      if(value?.reset){pressed.clear();requestPreview();return;}
      if(!running||halting||!$('backgroundKeys').checked||!byCode.has(value?.code)||typeof value.down!=='boolean')return;
      const key=byCode.get(value.code);
      if(value.down){if(!pressed.has(key.id))virtualPress(key);pressed.add(key.id);}else pressed.delete(key.id);
      requestPreview();
    });
    window.HeroDesktop.onInputStatus?.(value=>{
      const states={disabled:'后台按键响应已关闭',idle:'已开启，等待按键互动灯效开始输出',starting:'正在连接 HERO 按键输入…',waiting:'未找到 HERO 原始键盘接口，请检查有线连接',listening:'后台响应已就绪 · 仅 HERO 键盘 · 不保存输入',error:'后台输入启动失败，请关闭开关后重试；勿关闭安全防护'};
      const reasons={register:'原始输入注册失败',denied:'系统拒绝启动',runtime:'原生运行库缺失',native:'原生程序异常',ambiguous:'旧版多接口检查失败',spawn:'辅助程序启动失败','missing-helper':'缺少 resources/native/HeroKeyInput.exe',pipe:'输入管道已关闭','helper-exit':'辅助程序提前退出','ready-timeout':'辅助程序启动超时',oversize:'输入协议异常'};
      const label=value?.backend==='poll'&&value.state==='listening'?'后台兼容响应已就绪 · 全部键盘 · 不保存输入':states[value?.state]||'后台输入状态未知';
      $('inputStatus').textContent=(value?.backend==='poll'?'B / GetAsyncKeyState（全部键盘） · ':'A / Raw Input · ')+label+(value?.reason?' · '+(reasons[value.reason]||'未知原因'):'')+(Number.isInteger(value?.win32)?' · Win32 '+value.win32:'')+(Number.isInteger(value?.exitCode)?' · 退出码 '+value.exitCode:'')+(Number.isInteger(value?.devices)&&value.backend!=='poll'?' · 匹配 '+value.devices+' 个接口':'')+(Number.isInteger(value?.backgroundEvents)?' · 后台转发 '+value.backgroundEvents+' 次':'');
    });
  }
  const previewVisible=()=>desktopVisible&&document.visibilityState!=='hidden';
  function requestPreview(delay=0){
    if(delay===0&&previewTimer!==null){clearTimeout(previewTimer);previewTimer=null;}
    if(!previewVisible()||previewFrame!==null||previewTimer!==null)return;
    if(delay>0){previewTimer=setTimeout(()=>{previewTimer=null;requestPreview();},delay);return;}
    previewFrame=requestAnimationFrame(draw)??true;
  }
  function syncVisibility(){
    if(!previewVisible()){
      if(previewTimer!==null){clearTimeout(previewTimer);previewTimer=null;}
      if(previewFrame!==null){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(previewFrame);previewFrame=null;}
    }else requestPreview();
  }
  document.addEventListener?.('visibilitychange',syncVisibility);
  window.HeroDesktop?.onPreviewVisibility?.(visible=>{desktopVisible=visible===true;syncVisibility();});
  function draw(){
    previewFrame=null;
    if(!previewVisible())return;
    const t=now(),autoLogo=project.logo.mode==='auto-color'&&project.logo.brightness>0;
    const animated=C.isAnimated(project,selectedFrame,t,events);
    const sampleLogo=!autoLogo||t>=logoPreviewAt;
    const shared=autoLogo&&sampleLogo;
    const frame=displayFrame(!shared,t),brightness=shared?project.settings.brightness:1;
    if(sampleLogo){
      const logo=C.renderLogo(project,frame,t,events),color=logo?hex(logo.color.map(c=>C.byte(c*logo.brightness/4))):'#312b39';
      if(color!==lastLogoPreview){lastLogoPreview=color;$('logoPreview').style.background=color;}
      if(autoLogo)logoPreviewAt=t+0.3;
    }
    if(studioOpen)updatePlayhead(t);
    for(const {id} of keys){
      const c=frame[id],r=C.byte(c[0]*brightness),g=C.byte(c[1]*brightness),b=C.byte(c[2]*brightness);
      const packed=r*65536+g*256+b,el=elements.get(id);
      if(keyVisuals.get(id)!==packed){
        keyVisuals.set(id,packed);
        const css=r+','+g+','+b;
        el.style.background='linear-gradient(150deg,rgba('+css+',.55),rgba('+css+',.17)),#201d28';
        el.style.borderColor='rgba('+css+',.65)';
      }
      if(pressed.has(id)!==lastPressKey.has(id))el.classList.toggle('pressed',pressed.has(id));
    }
    lastPressKey=new Set(pressed);
    const flash=project.logo.mode==='keyflash'?(events.at(-1)?.t??-Infinity)+0.16-t:0;
    if(animated)requestPreview(1000/Math.min(24,project.settings.fps));
    else if(flash>0)requestPreview(Math.ceil(flash*1000)+1);
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
    ['keycross', '十字光痕', '', ['#333448','#63658c','#b9bde8','#63658c','#333448']],
    ...C.EXTRA_EFFECTS.map(([id,label,category,...colors])=>[id,label,'',colors,category])
  ];
  $('effectCount').textContent=String(effects.length);
  for (const [id, label, , colors, category] of effects) {
    const button = document.createElement('button'); button.className = 'effect'; button.dataset.effect = id;
    button.dataset.category = category||(C.REACTIVE_EFFECTS.has(id) ? 'reactive' : ['static','studio','gradient','breathe','twinkle','fireflies','sunset','fire','checker'].includes(id) ? 'ambient' : 'flow');
    const art = document.createElement('span'); art.className = 'effect-art'; colors.forEach(c => { const tile = document.createElement('i'); tile.style.background = c; art.append(tile); });
    const title = document.createElement('strong'); title.textContent = label; button.append(art, title);
    button.onclick = () => { project.settings.effect = id; selectedFrame = -1; syncControls(); persist(); if (button.dataset.category === 'reactive') toast(window.HeroDesktop?'更多设置可开启后台按键响应；点击预览键帽也可触发。':'按键响应仅在此页面获得焦点时有效；点击预览键帽也可触发。'); if (id === 'studio' && !project.frames.length) toast('还没有动画帧，请到“逐帧动画”捕获画面。'); };
    $('effects').append(button);
  }
  $('effectFilter').value = 'all';
  $('effectFilter').onchange = () => { for (const button of $('effects').children) button.hidden = $('effectFilter').value !== 'all' && button.dataset.category !== $('effectFilter').value; };
  for (const color of ['#61dafb', '#bd9bff', '#f699b6', '#efc57b', '#abdb9e', '#ffffff']) {
    const button = document.createElement('button'); button.className = 'swatch'; button.style.background = color; button.title = color; button.setAttribute('aria-label', '主色 ' + color);
    button.onclick = () => { project.settings.color = fromHex(color); syncControls(); persist(); }; $('swatches').append(button);
  }
  function applyPalette(preset){
    const s=project.settings;
    s.color=[...preset.color];s.bg=[...preset.bg];s.palette=preset.palette.map(color=>[...color]);
    if(['rainbow','verticalrainbow','spectrum-sweep','heatmap','studio'].includes(s.effect))s.effect='gradient';
    selectedFrame=-1;syncControls();persist();toast('已套用 '+preset.name);
  }
  function renderSavedPalettes(selected=''){
    const select=$('savedPalettes');
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=savedPalettes.length?'选择已保存的配色':'暂无保存的配色';
    select.replaceChildren(placeholder,...savedPalettes.map(preset=>{
      const option=document.createElement('option');option.value=preset.name;option.textContent=preset.name;return option;
    }));
    select.value=selected;select.disabled=!savedPalettes.length;select.onchange();
    $('savedPaletteCount').textContent=String(savedPalettes.length);
  }
  function storePalettes(next,selected=''){
    if(paletteLoadError)throw Error(paletteLoadError);
    const clean=C.validatePaletteLibrary(next);
    localStorage.setItem(PALETTE_STORAGE,JSON.stringify(clean));
    savedPalettes=clean;renderSavedPalettes(selected);
  }
  $('savedPalettes').onchange=()=>{
    const valid=savedPalettes.some(preset=>preset.name===$('savedPalettes').value);
    $('applySavedPalette').disabled=$('deleteSavedPalette').disabled=!valid;
  };
  $('paletteSaveForm').onsubmit=event=>{
    event.preventDefault();
    const name=$('paletteName').value.trim().normalize('NFC');
    const {color,bg,palette}=project.settings;
    try{storePalettes([...savedPalettes,{name,color,bg,palette}],name);$('paletteName').value='';toast('已保存配色：'+name);}
    catch(error){toast('未保存：'+error.message);}
  };
  $('applySavedPalette').onclick=()=>{
    const preset=savedPalettes.find(preset=>preset.name===$('savedPalettes').value);
    if(preset)applyPalette(preset);
  };
  $('deleteSavedPalette').onclick=()=>{
    const name=$('savedPalettes').value;
    if(!savedPalettes.some(preset=>preset.name===name)||!confirm('删除配色「'+name+'」？'))return;
    try{storePalettes(savedPalettes.filter(preset=>preset.name!==name));toast('已删除配色：'+name);}
    catch(error){toast('未删除：'+error.message);}
  };
  renderSavedPalettes();
  for (const preset of C.PRESETS) {
    const button = document.createElement('button'); button.className = 'preset'; button.title = preset.name;
    const art = document.createElement('span'); art.className = 'preset-art';
    for (const c of preset.palette) { const chip = document.createElement('i'); chip.style.background = hex(c); art.append(chip); }
    const label = document.createElement('span'); label.textContent = preset.name; button.append(art, label);
    button.onclick = () => applyPalette(preset);
    $('presets').append(button); presetButtons.push([button, preset]);
  }
  $('presetSearch').addEventListener('input', () => { const query = $('presetSearch').value.trim(); for (const [button, preset] of presetButtons) button.hidden = !preset.name.includes(query); });
  for (const id of ['stripMode', 'sideColor', 'sideBrightness', 'sideGain']) $(id).onchange = () => {
    if (applying || halting) return;
    const value = { ...project, strip: { mode: $('stripMode').value, color: fromHex($('sideColor').value), brightness: Number($('sideBrightness').value) - 1, gain: Number($('sideGain').value) / 100 } };
    try { project.strip=C.validateProject({...C.defaultProject(),strip:value.strip},keys).strip;sampledStripColor=null;syncControls();persist();$('sideResult').textContent=project.strip.mode==='auto-color'?'点击应用时，从当前键盘画面取一次主色。':'灯带设置尚未应用。'; }
    catch (error) { toast(error.message); syncControls(); }
  };
  for(const id of ['logoMode','logoColor','logoBrightness'])$(id).onchange=()=>{
    if(applying||halting)return;
    try{project.logo=C.validateProject({...C.defaultProject(),logo:{mode:$('logoMode').value,color:fromHex($('logoColor').value),brightness:Number($('logoBrightness').value)}},keys).logo;syncControls();persist();$('logoStatus').textContent='Logo 设置尚未应用。';}catch(error){toast(error.message);syncControls();}
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
    $('livePanel').hidden=studio;$('studioPanel').hidden=!studio;
    if(studio)renderTimeline();
    syncControls();
  }
  $('tabLive').onclick = () => showTab(false); $('tabStudio').onclick = () => showTab(true);
  function timelineControls(){
    $('frameCount').textContent=project.frames.length+' / 120';$('deleteFrame').disabled=selectedFrame<0;
    $('duplicateFrame').disabled=selectedFrame<0||project.frames.length>=120;$('moveFrameLeft').disabled=selectedFrame<=0;$('moveFrameRight').disabled=selectedFrame<0||selectedFrame>=project.frames.length-1;
    $('playStudio').textContent=project.settings.effect==='studio'&&selectedFrame<0?'暂停':'播放';$('playStudio').disabled=!project.frames.length;
    $('timelineSeek').disabled=!project.frames.length;$('timelineSeek').max=Math.max(0,project.frames.length-1);
    for(const [i,button] of timelineButtons.entries())button.classList.toggle('selected',i===selectedFrame);
  }
  function selectTimeline(at){
    selectedFrame=at;paintMode=true;timelineControls();updatePlayhead();syncControls();
  }
  function renderTimeline() {
    timelineRevision++;$('timeline').replaceChildren();timelineButtons.length=0;playhead=null;
    const durations=C.frameDurations(project);timelineTotal=durations.reduce((a,b)=>a+b,0)/1000;
    if (!project.frames.length) { const msg = document.createElement('span'); msg.className = 'muted small'; msg.textContent = '还没有动画帧，先捕获一个喜欢的画面。'; $('timeline').append(msg); }
    project.frames.forEach((frame, index) => {
      const button = document.createElement('button'); button.className = 'frame-chip' + (selectedFrame === index ? ' selected' : '');const image=document.createElement('img');image.className='frame-mini';image.alt='第'+(index+1)+'帧键盘缩略图';
      let thumb=thumbnailCache.get(frame);
      if(!thumb){
        // A tiny raster thumbnail avoids keeping a 101-element SVG per frame.
        const canvas=document.createElement('canvas');canvas.width=108;canvas.height=32;
        const ctx=canvas.getContext?.('2d');
        if(ctx){
          for(const k of keys){ctx.fillStyle=hex(frame[k.id]);ctx.fillRect(k.x/1103*108,k.y/325*32,k.w/1103*108,k.h/325*32);}
          thumb=canvas.toDataURL();thumbnailCache.set(frame,thumb);
        }
      }
      if(thumb){image.loading='lazy';image.decoding='async';image.src=thumb;}
      button.append(image,document.createTextNode(String(index+1).padStart(2,'0')+' · '+durations[index]+'ms'));
      button.onclick=()=>selectTimeline(index);$('timeline').append(button);timelineButtons.push(button);
    });
    timelineControls();updatePlayhead();
  }
  function updatePlayhead(t=now()){
    const at=selectedFrame>=0?selectedFrame:project.settings.effect==='studio'?C.studioFrameAt(project,t*project.settings.speed):-1;
    if(playhead===at)return;
    const before=timelineButtons[playhead],after=timelineButtons[at];
    before?.classList.toggle('playing',false);before?.setAttribute('aria-current','false');
    after?.classList.toggle('playing',true);after?.setAttribute('aria-current','true');playhead=at;
    if(at>=0)$('timelineSeek').value=at;
    $('timelinePosition').textContent=project.frames.length?(at>=0?'第 '+(at+1)+' 帧 · ':'')+'总长 '+timelineTotal.toFixed(2)+'s':'还没有帧';
  }
  $('capture').onclick = () => { if (project.frames.length >= 120) return toast('最多 120 帧。');project.frameDurations=C.frameDurations(project); project.frames.push(displayFrame(false));project.frameDurations.push(project.frameMs); selectedFrame = project.frames.length - 1; paintMode = true; renderTimeline(); syncControls(); persist(); };
  $('playStudio').onclick = () => {
    if(!project.frames.length)return toast('请先捕获一帧。');
    if(project.settings.effect==='studio'&&selectedFrame<0)selectedFrame=C.studioFrameAt(project,now()*project.settings.speed);
    else{const start=Math.max(0,selectedFrame),seconds=C.frameDurations(project).slice(0,start).reduce((a,b)=>a+b,0)/1000/project.settings.speed;clockOffset=seconds-(performance.now()-startTime)/1000;events.length=0;resetEvents=true;selectedFrame=-1;project.settings.effect='studio';}
    renderTimeline();syncControls();persist();
  };
  $('timelineSeek').addEventListener('input',()=>{const at=Number($('timelineSeek').value);if(Number.isInteger(at)&&at>=0&&at<project.frames.length)selectTimeline(at);});
  $('duplicateFrame').onclick=()=>{if(selectedFrame<0||project.frames.length>=120)return;project.frameDurations=C.frameDurations(project);const copy=Object.fromEntries(keys.map(k=>[k.id,[...project.frames[selectedFrame][k.id]]]));project.frames.splice(selectedFrame+1,0,copy);project.frameDurations.splice(selectedFrame+1,0,project.frameDurations[selectedFrame]);selectedFrame++;renderTimeline();syncControls();persist();};
  for(const [id,delta]of [['moveFrameLeft',-1],['moveFrameRight',1]])$(id).onclick=()=>{const next=selectedFrame+delta;if(selectedFrame<0||next<0||next>=project.frames.length)return;project.frameDurations=C.frameDurations(project);[project.frames[selectedFrame],project.frames[next]]=[project.frames[next],project.frames[selectedFrame]];[project.frameDurations[selectedFrame],project.frameDurations[next]]=[project.frameDurations[next],project.frameDurations[selectedFrame]];selectedFrame=next;renderTimeline();syncControls();persist();};
  $('deleteFrame').onclick = () => { if (selectedFrame < 0 || !confirm('删除当前帧？此操作不影响已导出的文件。')) return;project.frameDurations=C.frameDurations(project);project.frameDurations.splice(selectedFrame,1); project.frames.splice(selectedFrame, 1); selectedFrame = project.frames.length?Math.min(selectedFrame,project.frames.length-1):-1; renderTimeline(); syncControls(); persist(); };
  $('frameMs').onchange = () => { const value = Number($('frameMs').value); if (!Number.isFinite(value) || value < 25 || value > 5000) { toast('每帧时长须为 25–5000 毫秒。');syncControls(); return; }project.frameDurations=C.frameDurations(project);project.frameMs=Math.round(value);if(selectedFrame>=0)project.frameDurations[selectedFrame]=project.frameMs; renderTimeline(); persist(); };
  async function halt(message){
    halting=true;setActive(null);
    try{if(background)await background.request('stop');if(message)log(message);}
    catch(error){log(error.message);background?.terminate();background=null;device=null;}
    finally{halting=false;status();}
  }
  $('connect').onclick=async()=>{
    if(!navigator.hid||!window.isSecureContext)return toast('需要 Windows 的 Chrome / Edge 或桌面版');
    $('connect').disabled=true;
    try{
      const [chosen]=await navigator.hid.requestDevice({filters:[{vendorId:0x372e,productId:0x103e,usagePage:0xff60,usage:0x61}]});
      if(!chosen)return;
      C.validateDevice(chosen);background?.terminate();background=createBackground();
      await background.request('connect',{vendorId:chosen.vendorId,productId:chosen.productId,productName:chosen.productName});
      device=chosen;sentTimeline=-1;log('已连接，尚未发送灯光');toast('键盘已连接');
      sampledStripColor=null;drawStripPreview();
      $('sideResult').textContent='灯带设置尚未应用。';$('logoStatus').textContent='Logo 设置尚未应用。';
    }catch(error){log('连接失败：'+error.message);toast(error.message);background?.terminate();background=null;device=null;}
    finally{status();}
  };
  async function applyOutput(type,payload,resultText){
    if(!device||!background||halting||applying)return;
    const token=++actionToken;
    applying=true;status();
    try{
      sendState();
      const result=await background.request(type,payload);
      if(token!==actionToken)return;
      setActive(result);resultText?.(result);
    }catch(error){if(token===actionToken){log(error.message);toast(error.message);}}
    finally{applying=false;status();}
  }
  $('start').onclick=()=>applyOutput('start',undefined,()=>log('按键输出已启动'));
  $('stop').onclick=()=>{actionToken++;return halt('软件灯效已停止');};
  $('applySideLight').onclick=()=>{
    if(!device||!background||halting||applying)return;
    const mode=project.strip.mode;
    const sampledColor=mode==='auto-color'?C.dominantColor(displayFrame(false),project.settings.color):undefined;
    return applyOutput('apply-light',{channel:'strip',consent:true,sampledColor},result=>{
      if(mode==='auto-color'&&result.sampledColor){
        sampledStripColor=result.sampledColor;drawStripPreview();
        $('sideResult').textContent='已发送取色 '+hex(sampledStripColor).toUpperCase()+'。再次应用可重新取色。';
      }else $('sideResult').textContent=mode==='breathe'||C.isNativeStrip(mode)?'灯效设置已发送，由键盘播放。':mode==='off'?'关闭设置已发送。':'纯色设置已发送。';
    });
  };
  $('applyLogo').onclick=()=>applyOutput('apply-light',{channel:'logo',consent:true},result=>{
    $('logoStatus').textContent=result.submitted?'Logo 设置已发送。':'已停止接管 Logo。';
  });
  $('disconnect').onclick=async()=>{
    actionToken++;await halt();
    if(background){
      const closing=background;background=null;
      try{await closing.request('disconnect');}catch(error){log(error.message);}finally{closing.terminate();}
    }
    device=null;setActive(null);log('键盘已断开');
  };
  navigator.hid?.addEventListener('disconnect',event=>{
    if(event.device!==device)return;
    actionToken++;device=null;background?.terminate();background=null;setActive(null);log('键盘已断开');
  });
  function download(name, data) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('export').onclick = () => { download('HERO99HE-light.json', project); log('配置已导出到本地文件。'); };
  $('import').onclick = () => $('importFile').click();
  $('importFile').onchange = async () => {
    const file = $('importFile').files[0]; if (!file) return;
    try{
      if(file.size>1024*1024)throw Error('文件超过 1 MB');
      const value=C.validateProject(JSON.parse(await file.text()),keys);
      actionToken++;await halt();project=value;selectedFrame=-1;sampledStripColor=null;
      if(studioOpen)renderTimeline();else timelineRevision++;
      syncControls();sendState();persist();log('配置已导入，输出保持停止。');toast('配置已导入');
    }
    catch (e) { log('导入失败：' + e.message); toast('未修改当前配置：' + e.message); }
    $('importFile').value = '';
  };
  window.addEventListener('beforeunload',()=>{
    window.HeroDesktop?.setInputContext?.({enabled:false,running:false,reactive:false});
    background?.terminate();try{localStorage.setItem('hero99-light/v1',JSON.stringify(project));}catch{}
  });
  log(loadError||paletteLoadError||(navigator.hid?'就绪 · 未向硬件发送数据':'当前浏览器不支持 WebHID，仍可预览'));
  syncControls();timelineControls();
})();
