'use strict';
// Pure rendering, fixtures and packet construction only. No hardware/browser access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js'), keys = require('../layout.js');

test('Logo migration defaults to no control and validates a defensive four-level configuration',()=>{
  const old=C.defaultProject();delete old.logo;const p=C.validateProject(old,keys);assert.equal(p.logo.mode,'off');
  for(const change of [p=>p.logo.mode='unknown',p=>p.logo.brightness=5,p=>p.logo.brightness=-1,p=>p.logo.brightness='2',p=>p.logo.color=[256,0,0]]){
    const bad=C.defaultProject();change(bad);assert.throws(()=>C.validateProject(bad,keys));
  }
  p.logo={mode:'follow-strip',color:[1,2,3],brightness:4};const clean=C.validateProject(p,keys);assert.equal(clean.logo.mode,'solid');p.logo.color[0]=9;assert.deepEqual(clean.logo.color,[1,2,3]);
  assert.deepEqual(C.validateProject(JSON.parse(JSON.stringify(clean)),keys).logo,clean.logo);
});

test('all Logo modes use only 04/0B constant RGB and keep native zero-off distinct from no-control',()=>{
  const p=C.defaultProject(),events=[{t:0.5,x:keys[30].x,y:keys[30].y}];p.settings.brightness=0;
  const frame=C.render(p,keys,0.7,events),strip={color:[99,80,40]};assert.equal(C.LOGO_MODES.length,5);
  for(const mode of C.LOGO_MODES){
    p.logo={mode,color:[255,160,80],brightness:4};const a=C.renderLogo(p,frame,0.7,events,keys,strip);
    if(mode==='off'){assert.equal(a,null);continue;}
    const packet=C.buildLogoLightEffect(a);assert.deepEqual([...packet.slice(0,8)],[4,11,0,1,0,7,3,0]);assert.equal(packet[11],4);
    assert.equal((9+packet.reduce((sum,n)=>sum+n,0))&255,255);
  }
  p.logo.mode='solid';assert.deepEqual(C.renderLogo(p,frame,0,[],keys).color,[255,160,80]);
  p.logo.brightness=0;assert.deepEqual(C.renderLogo(p,frame,0,[],keys),{mode:3,color:[0,0,0],brightness:0,speed:2});
});

test('single LED fast modes use current main color and a hard 160ms flash, never spatial averaging',()=>{
  const p=C.defaultProject();p.settings.color=[240,80,30];p.settings.brightness=0;p.logo={mode:'follow-color',color:[0,0,255],brightness:3};
  assert.deepEqual(C.renderLogo(p,{},1,[],keys).color,[240,80,30]);
  p.logo.mode='keyflash';const event={t:1,x:0,y:0};
  assert.deepEqual(C.renderLogo(p,{},1,[event],keys).color,[240,80,30]);assert.deepEqual(C.renderLogo(p,{},1.159,[event],keys).color,[240,80,30]);
  assert.deepEqual(C.renderLogo(p,{},1.161,[event],keys).color,[0,0,0]);assert.deepEqual(C.renderLogo(p,{},0.9,[event],keys).color,[0,0,0]);
  assert.equal(C.renderLogo(p,{},1,[event],keys).brightness,3);
});

test('all removed continuous Logo modes migrate to static without losing the rest of a scene',()=>{
  const removed=['breathe','spectrum','palette','pulse','react','follow','follow-dominant','follow-scan','follow-breathe','follow-complement','follow-split','follow-flash','follow-strip'];
  assert.deepEqual(C.LOGO_MODES,['off','solid','follow-color','keyflash','auto-color']);assert.equal(removed.length,13);
  for(const mode of removed){const p=C.defaultProject();p.logo={mode,color:[123,45,67],brightness:3};p.paint[43]=[20,40,80];
    const saved=JSON.stringify(p),out=C.validateProject(p,keys);assert.equal(JSON.stringify(p),saved);assert.deepEqual(out.logo,{mode:'solid',color:[123,45,67],brightness:3});assert.deepEqual(out.paint,p.paint);assert.deepEqual(out.strip,p.strip);assert.deepEqual(out.settings,p.settings);
  }
});

test('all new effects and presets are deterministic, complete and fit the existing output budget', () => {
  for (const preset of C.PRESETS) for (const effect of C.EFFECTS.slice(8)) {
    const p = C.defaultProject(); Object.assign(p.settings, { effect, color: [...preset.color], bg: [...preset.bg], palette: preset.palette.map(c => [...c]) });
    for (let i = 0; i < 20; i++) {
      const t = i * 0.173, events = [{ t: 0.2, x: keys[10].x, y: keys[10].y }];
      const frame = C.render(p, keys, t, events), output = C.prepareOutput(frame, keys);
      assert.deepEqual(C.render(p, keys, t, events), frame);
      assert.equal(Object.keys(frame).length, keys.length); assert.ok(output.packets.length <= 4);
      for (const packet of output.packets) assert.equal((9 + packet.reduce((a,b) => a+b,0)) & 255, 255);
    }
  }
});
test('old configuration migrates with strip off; invalid imported modes, palette or brightness are rejected', () => {
  const old = C.defaultProject(); delete old.strip; delete old.settings.palette;
  const migrated = C.validateProject(old, keys); assert.equal(migrated.strip.mode, 'off'); assert.equal(migrated.settings.palette.length, 2);
  for (const change of [p => p.strip.mode = 'unknown', p => p.strip.brightness = 5, p => p.strip.color = [999,0,0], p => p.settings.palette = [], p => p.settings.palette = Array(9).fill([1,2,3])]) {
    const p = C.defaultProject(); change(p); assert.throws(() => C.validateProject(p, keys));
  }
});
test('forty additional effects are distinct and survive configuration export/import', () => {
  const signatures = new Set(), p = C.defaultProject(), key = keys[30], events = [{ t: 0.65, x: key.x, y: key.y }];
  assert.equal(C.EFFECTS.length, 56); assert.equal(new Set(C.EFFECTS).size,56); assert.equal(C.PRESETS.length, 30);
  for (const effect of C.EFFECTS.slice(16)) {
    p.settings.effect = effect;
    const a = C.render(p, keys, 0.7, events), b = C.render(p, keys, 1.3, events);
    if(C.isAnimated(p,-1,0.7,events))assert.notDeepEqual(a,b,effect+' changes with time or event age');
    else assert.deepEqual(a,b,effect+' stays static');
    const signature = JSON.stringify([a,b]); assert.ok(!signatures.has(signature), effect + ' is not a renamed duplicate'); signatures.add(signature);
    const imported = C.validateProject(JSON.parse(JSON.stringify(p)), keys); assert.equal(imported.settings.effect, effect);
  }
});
test('new reactive effects rest when no events are live and do not redraw indefinitely',()=>{
  const p=C.defaultProject(),key=keys[34],events=[{t:1,x:key.x,y:key.y}];
  for(const [effect,,category] of C.EXTRA_EFFECTS){
    if(category!=='reactive')continue;
    p.settings.effect=effect;
    const idle=C.render(p,keys,0);
    assert.ok(C.REACTIVE_EFFECTS.has(effect));
    assert.deepEqual(C.render(p,keys,0.5,events),idle);
    assert.notDeepEqual(C.render(p,keys,1,events),idle);
    assert.deepEqual(C.render(p,keys,3.21,events),idle);
    assert.equal(C.isAnimated(p,-1,3.21,events),false);
  }
});
test('saved palettes preserve full colors, clone inputs and enforce names, bounds and duplicate protection',()=>{
  const input={name:'  我的蓝调  ',color:[20,140,250],bg:[3,10,24],palette:[[20,80,140],[70,120,170],[110,180,255]]};
  const validated=C.validatePaletteLibrary([input]);
  assert.deepEqual(validated,[{...input,name:'我的蓝调'}]);
  input.color[0]=99;input.palette[0][0]=4;assert.equal(validated[0].color[0],20);assert.equal(validated[0].palette[0][0],20);
  assert.throws(()=>C.validatePaletteLibrary([input,{...input,name:'我的蓝调'}]),/同名/);
  assert.throws(()=>C.validatePaletteLibrary([{...input,name:' '}]),/名称/);
  assert.throws(()=>C.validatePaletteLibrary([{...input,name:'x'.repeat(41)}]),/名称/);
  assert.throws(()=>C.validatePaletteLibrary([{...input,palette:[[999,1,2],[1,2,3]]}]),/RGB/);
  assert.throws(()=>C.validatePaletteLibrary(Array(C.MAX_SAVED_PALETTES+1).fill(input)),/最多/);
});

test('software strip gain raises midtones once without clipping hues or changing native brightness', () => {
  const p=C.defaultProject();p.strip.mode='solid';p.strip.color=[60,100,80];p.strip.brightness=4;p.strip.gain=2;
  assert.deepEqual(C.renderStrip(p,{},0).color,[120,200,160]);
  p.strip.color=[200,100,50];assert.deepEqual(C.renderStrip(p,{},0).color,[255,127,64]);
  p.strip.color=[255,255,255];assert.deepEqual(C.renderStrip(p,{},0).color,[255,255,255]);
  p.strip.color=[0,0,0];assert.deepEqual(C.renderStrip(p,{},0).color,[0,0,0]);
  const packet=C.buildSideLightEffect(C.renderStrip(p,{},0));assert.equal(packet[11],4);
  delete p.strip.gain;const old=C.validateProject(p,keys);assert.equal(old.strip.gain,1);
  for(const gain of [0.99,2.01,'2',null,NaN,Infinity]){p.strip.gain=gain;assert.throws(()=>C.validateProject(p,keys),/鲜亮增强/);}
});

test('legacy strip linkage migrates to off while retaining brightness and colors',()=>{
  for(const mode of ['follow','follow-split','follow-breathe','react','native-sync','follow-dominant']){
    const p=C.defaultProject();p.strip={mode,color:[123,45,67],brightness:3,gain:1.5};p.paint[43]=[20,40,80];
    const out=C.validateProject(p,keys);
    assert.deepEqual(out.strip,{...p.strip,mode:'off'});assert.deepEqual(out.paint,p.paint);
  }
});
test('original strip off, static and breathe keep their independent brightness and report format',()=>{
  const p=C.defaultProject();p.settings.brightness=0;p.strip.color=[120,0,150];p.strip.brightness=4;
  for(const [mode,id] of [['off',0],['solid',3],['breathe',4]]){
    p.strip.mode=mode;
    const packet=C.buildSideLightEffect(C.renderStrip(p));
    assert.deepEqual([...packet.slice(0,8)],[4,6,0,1,0,7,id,0]);
    assert.deepEqual([...packet.slice(8,12)],id===0?[0,0,0,0]:[120,0,150,4]);
    assert.equal((9+packet.reduce((a,b)=>a+b,0))&255,255);
  }
  p.strip.mode='follow-split';assert.throws(()=>C.renderStrip(p),/无效/);
});
test('firmware neon and marquee match each captured 64-byte USB report',()=>{
  const p=C.defaultProject();
  for(const [mode,id,checksum] of [['native-neon',2,'62'],['native-marquee',5,'5f']]){
    p.strip={mode,color:[200,175,255],brightness:4,gain:2};
    assert.equal(C.validateProject(p,keys).strip.mode,mode);
    const packet=C.buildSideLightEffect(C.renderStrip(p));
    const captured='090406000100040'+id+'07c8afff0402';
    assert.equal('09'+Buffer.from(packet).toString('hex'),captured.padEnd(126,'0')+checksum);
  }
});
test('one-shot strip color clusters the visible frame without scaling down by keyboard brightness',()=>{
  const p=C.defaultProject();p.settings.effect='static';p.settings.brightness=0;p.settings.color=[210,30,60];
  for(const {id} of keys.slice(0,10))p.paint[id]=[20,180,255];
  const sampled=C.dominantColor(C.render(p,keys,0,[],{},false),p.settings.color);
  assert.deepEqual(sampled,[210,30,60]);
  assert.deepEqual(C.dominantColor({1:[0,0,0]},p.settings.color),p.settings.color);
  p.strip={mode:'auto-color',color:[0,30,255],brightness:4,gain:2};
  const packet=C.buildSideLightEffect(C.renderStrip(p,sampled));
  assert.deepEqual([...packet.slice(6,13)],[3,0,255,36,73,4,2]);
});
