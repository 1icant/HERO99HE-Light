'use strict';
// Pure rendering, fixtures and packet construction only. No hardware/browser access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js'), keys = require('../layout.js');
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
test('reactive key afterglow and strip react to the same event, then decay', () => {
  const p = C.defaultProject(); p.settings.effect = 'keyfade'; p.strip.mode = 'react'; p.settings.brightness = 1;
  const key = keys[30], events = [{ t: 1, x: key.x, y: key.y }];
  const hit = C.render(p, keys, 1, events), later = C.render(p, keys, 3.1, events);
  assert.deepEqual(hit[key.id], p.settings.color); assert.deepEqual(later[key.id], p.settings.bg);
  assert.deepEqual(C.renderStrip(p, hit, 1, events).color, p.settings.color);
  assert.deepEqual(C.renderStrip(p, later, 3.1, events).color, p.settings.bg);
});
test('follow strip uses prepared color composition and paint, independently of key brightness', () => {
  const p = C.defaultProject(); p.settings.effect = 'static'; p.settings.color = [100,80,60]; p.settings.brightness = 0.5; p.strip.mode = 'follow';
  const frame = C.prepareOutput(C.render(p, keys, 0, [], {}, false), keys).frame;
  assert.deepEqual(C.renderStrip(p, frame, 0).color, [100,80,60]);
  p.paint[keys[0].id] = [255,0,0];
  const painted = C.prepareOutput(C.render(p, keys, 0, [], {}, false), keys).frame, mean = [0,1,2].map(a => C.byte(Object.values(painted).reduce((n,c) => n+c[a],0) / keys.length));
  assert.deepEqual(C.renderStrip(p, painted, 0).color, mean);
});

test('strip modes retain full RGB at maximum hardware brightness regardless of key brightness', () => {
  const p=C.defaultProject(); p.strip.brightness=4; p.strip.color=[255,160,80];
  for(const mode of C.STRIP_MODES.filter(m=>m!=='off')) {
    p.strip.mode=mode;
    const results=[0,0.2,0.6,1].map(brightness=>{
      p.settings.brightness=brightness;
      const frame=C.prepareOutput(C.render(p,keys,0.7,[],{},false),keys).frame;
      return C.renderStrip(p,frame,0.7,[{t:0.7,x:0,y:0}]);
    });
    for(const result of results) assert.deepEqual(result,results[0],mode+' must not inherit key dimming');
    const packet=C.buildSideLightEffect(results[0]); assert.equal(packet[11],4); assert.equal(packet[12],2);
  }
  p.strip.mode='solid'; p.settings.brightness=0.1;
  assert.deepEqual(C.renderStrip(p,{},0).color,[255,160,80]);
});
test('every strip mode produces only the proven native constant color command; off does nothing', () => {
  const p = C.defaultProject(), frame = C.render(p, keys, 0);
  for (const mode of C.STRIP_MODES) {
    p.strip.mode = mode;
    const a = C.renderStrip(p, frame, 0.5, [{ t: 0.3, x: 0, y: 0 }]);
    if (mode === 'off') { assert.equal(a, null); continue; }
    const packet = C.buildSideLightEffect(a); assert.deepEqual([...packet.slice(0,8)], [4,6,0,1,0,7,3,0]);
    assert.ok(a.color.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
  }
});
test('old configuration migrates with strip off; invalid imported modes, palette or brightness are rejected', () => {
  const old = C.defaultProject(); delete old.strip; delete old.settings.palette;
  const migrated = C.validateProject(old, keys); assert.equal(migrated.strip.mode, 'off'); assert.equal(migrated.settings.palette.length, 2);
  for (const change of [p => p.strip.mode = 'unknown', p => p.strip.brightness = 5, p => p.strip.color = [999,0,0], p => p.settings.palette = [], p => p.settings.palette = Array(9).fill([1,2,3])]) {
    const p = C.defaultProject(); change(p); assert.throws(() => C.validateProject(p, keys));
  }
});
test('sixteen added effects have distinct output, animate and survive configuration export/import', () => {
  const signatures = new Set(), p = C.defaultProject(), key = keys[30], events = [{ t: 0.65, x: key.x, y: key.y }];
  assert.equal(C.EFFECTS.length, 32); assert.equal(C.PRESETS.length, 30);
  for (const effect of C.EFFECTS.slice(16)) {
    p.settings.effect = effect;
    const a = C.render(p, keys, 0.7, events), b = C.render(p, keys, 1.3, events);
    assert.notDeepEqual(a, b, effect + ' changes with time or event age');
    const signature = JSON.stringify([a,b]); assert.ok(!signatures.has(signature), effect + ' is not a renamed duplicate'); signatures.add(signature);
    const imported = C.validateProject(JSON.parse(JSON.stringify(p)), keys); assert.equal(imported.settings.effect, effect);
  }
});

test('linked palette fits three packets for every effect and preserves source scenes and true black', () => {
  for(const effect of C.EFFECTS)for(let i=0;i<12;i++){
    const p=C.defaultProject();p.settings.effect=effect;
    const frame=C.render(p,keys,i*0.137,[{t:0,x:keys[30].x,y:keys[30].y}]),saved=JSON.stringify(frame);
    frame[keys[0].id]=[0,0,0];
    const before=JSON.stringify(frame),out=C.prepareOutput(frame,keys,C.LINK_POLICY);
    assert.ok(out.packets.length<=3);assert.equal(JSON.stringify(frame),before);assert.deepEqual(out.frame[keys[0].id],[0,0,0]);
    for(const packet of out.packets)assert.equal((9+packet.reduce((a,b)=>a+b,0))&255,255);
    assert.ok(saved.length>0);
  }
  const crowded=Object.fromEntries(keys.map((k,i)=>[k.id,i<60?[250,0,0]:[i*2,255-i,i]]));
  assert.ok(C.prepareOutput(crowded,keys,C.LINK_POLICY).packets.length<=3,'large color groups split without overflowing');
});

test('six new frame-linked strip modes are distinct, frame-dependent and configuration-safe', () => {
  const p=C.defaultProject(), frame=Object.fromEntries(keys.map(k=>[k.id,k.x<480?[190,35,15]:[10,85,170]]));
  const saved=JSON.stringify(frame), signatures=new Set();
  assert.equal(C.STRIP_MODES.length,14); assert.equal(C.FRAME_STRIP_MODES.length,7);
  for(const mode of C.FRAME_STRIP_MODES.slice(1)){
    p.strip.mode=mode; p.strip.gain=1.35;
    const samples=[0.1,0.6,1.2,2].map(t=>C.renderStrip(p,frame,t,[{t:0.6,x:keys[20].x,y:keys[20].y}],keys));
    const signature=JSON.stringify(samples); assert.ok(!signatures.has(signature),mode); signatures.add(signature);
    for(const [index,sample] of samples.entries()){
      assert.deepEqual(sample,C.renderStrip(p,frame,[0.1,0.6,1.2,2][index],[{t:0.6,x:keys[20].x,y:keys[20].y}],keys));
      const packet=C.buildSideLightEffect(sample); assert.equal(packet.length,63); assert.equal(packet[6],3); assert.equal((9+packet.reduce((a,b)=>a+b,0))&255,255);
    }
    const different=Object.fromEntries(keys.map(k=>[k.id,[0,220,35]]));
    assert.notDeepEqual(C.renderStrip(p,frame,0.6,[],keys),C.renderStrip(p,different,0.6,[],keys),mode+' samples keyboard colors');
    const imported=C.validateProject(JSON.parse(JSON.stringify(p)),keys); assert.equal(imported.strip.mode,mode); assert.equal(imported.strip.gain,1.35);
  }
  assert.equal(JSON.stringify(frame),saved);
});

test('dominant linking avoids dark-key averaging and scan/split use physical keyboard geometry', () => {
  const p=C.defaultProject(), sparse=Object.fromEntries(keys.map((k,i)=>[k.id,i<4?[200,80,20]:[0,0,0]]));
  p.strip.mode='follow';const dim=C.renderStrip(p,sparse,0,[],keys).color;
  p.strip.mode='follow-dominant';assert.deepEqual(C.renderStrip(p,sparse,0,[],keys).color,[200,80,20]);assert.ok(dim[0]<20);
  const testKeys=[{id:2,x:0,w:50},{id:1,x:1000,w:50}], frame={1:[0,0,200],2:[200,0,0]};
  p.strip.mode='follow-scan';
  assert.deepEqual(C.renderStrip(p,frame,-Math.PI/2/0.9,[],testKeys).color,[200,0,0]);
  assert.deepEqual(C.renderStrip(p,frame,Math.PI/2/0.9,[],testKeys).color,[0,0,200]);
  p.strip.mode='follow-split';
  assert.deepEqual(C.renderStrip(p,frame,-Math.PI/2/1.4,[],testKeys).color,[200,0,0]);
  assert.deepEqual(C.renderStrip(p,frame,Math.PI/2/1.4,[],testKeys).color,[0,0,200]);
});

test('frame-linked breath and key flash animate and every mode keeps true black black', () => {
  const p=C.defaultProject(), frame=Object.fromEntries(keys.map(k=>[k.id,[150,90,30]]));
  p.strip.mode='follow-breathe';assert.notDeepEqual(C.renderStrip(p,frame,0,[],keys),C.renderStrip(p,frame,0.6,[],keys));
  p.strip.mode='follow-flash';const events=[{t:1,x:0,y:0}];
  assert.deepEqual(C.renderStrip(p,frame,1,events,keys).color,[150,90,30]);
  assert.deepEqual(C.renderStrip(p,frame,3,events,keys).color,[38,23,8]);
  const dark=Object.fromEntries(keys.map(k=>[k.id,[0,0,0]]));p.strip.gain=2;
  for(const mode of C.FRAME_STRIP_MODES){p.strip.mode=mode;assert.deepEqual(C.renderStrip(p,dark,1,events,keys).color,[0,0,0],mode);}
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
