'use strict';
const {ipcRenderer}=require('electron');
window.addEventListener('DOMContentLoaded',async()=>{
  const query=new URL(location.href).searchParams;
  const style=selector=>{const el=document.querySelector(selector);return el?getComputedStyle(el):null;};
  const grid=style('.workspace'),key=style('.key');
  const css={workspace:grid?.display,columns:grid?.gridTemplateColumns?.trim().split(/\s+/).length,
    keyPosition:key?.position,topbar:style('.topbar')?.display,background:style('body')?.backgroundColor};
  const styleOK=css.workspace==='grid'&&css.columns===(query.has('mobile')?1:2)&&
    css.keyPosition==='absolute'&&css.topbar==='flex'&&css.background==='rgb(16, 16, 20)';
  const page={secure:window.isSecureContext,hid:typeof navigator.hid,getDevices:typeof navigator.hid?.getDevices,
    css,styleOK,versionLabel:document.querySelector('.brand small span')?.textContent,
    requestDevice:typeof navigator.hid?.requestDevice,keys:document.querySelectorAll('.key').length,effects:document.querySelectorAll('.effect').length,
    stripOptions:[...document.querySelectorAll('#stripMode option')].map(o=>o.value).join(','),
    logoOptions:document.querySelectorAll('#logoMode option').length,
    noTestPanel:['testInterface','testEscLive','diagnostics'].every(id=>!document.getElementById(id)),
    separateControls:document.getElementById('applySideLight')?.textContent==='应用灯带'&&document.getElementById('applyLogo')?.textContent==='应用 Logo',
    paletteColors:document.querySelectorAll('#paletteEditor input[type="color"]').length,
    timelineTools:['duplicateFrame','moveFrameLeft','moveFrameRight','timelineSeek'].every(id=>Boolean(document.getElementById(id))),
    backgroundInputDefaultOff:document.getElementById('backgroundKeys')?.checked===false,
    grantedCount:null};
  if(query.has('benchmark')){
    const worker=new Worker('hero-light://studio/benchmark-worker.js');
    worker.onmessage=event=>{worker.terminate();ipcRenderer.send('smoke:result',{ok:!event.data.error,versionLabel:page.versionLabel,benchmark:event.data});};
    worker.onerror=event=>ipcRenderer.send('smoke:result',{ok:false,error:event.message});
    return;
  }
  try { page.grantedCount=(await navigator.hid.getDevices()).length; }
  catch(error){page.hidError=error.message;}
  const coreWorker=new Worker('hero-light://studio/core.js?v=0.1.26');
  page.coreWorker=await new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(false),3000);
    coreWorker.onerror=()=>{clearTimeout(timer);resolve(false);};
    coreWorker.onmessage=event=>{if(event.data.id===1){clearTimeout(timer);resolve(event.data.ok===true);}};
    coreWorker.postMessage({id:1,type:'state',payload:{project:{format:'hero99-light/v1',layout:'hero99he-101/v1',settings:{effect:'key-bloom',brightness:0.6,speed:1,fps:20,color:[97,218,251],bg:[5,8,18],palette:[[97,218,251],[189,155,255]]},strip:{mode:'native-neon',color:[0,160,255],brightness:2},paint:{},frames:[],frameMs:100},selectedFrame:-1,events:[],heat:{},time:0}});
  });
  coreWorker.terminate();
  const $=id=>document.getElementById(id),name='Electron 配色验证';
  if($('paletteSaveForm')){
    // Exercises the real renderer and its localStorage, in the smoke-only profile.
    localStorage.removeItem('hero99-light/palettes/v1');
    $('paletteName').value=name;$('paletteSaveForm').requestSubmit();
    $('stripMode').value='auto-color';$('stripMode').dispatchEvent(new Event('change'));
    page.autoStripStaging=$('sideColor').disabled&&!$('sideGain').disabled&&$('applySideLight').disabled;
    const saved=JSON.parse(localStorage.getItem('hero99-light/palettes/v1')||'[]');
    $('color').value='#112233';$('color').dispatchEvent(new Event('input'));
    $('applySavedPalette').click();
    page.savedPaletteFlow=saved.length===1&&saved[0].name===name&&$('savedPalettes').value===name&&$('color').value==='#61dafb';
  }
  // Read-only getDevices in an ungranted test profile; never request/open/send.
  const worker=new Worker('hero-light://studio/smoke-worker.js');
  worker.onmessage=event=>{
    worker.terminate(); const info=event.data;
    ipcRenderer.send('smoke:result',{...page,worker:info,ok:styleOK&&page.secure&&page.hid==='object'&&page.getDevices==='function'&&page.grantedCount===0&&page.coreWorker&&page.keys===101&&page.effects===56&&page.stripOptions==='off,solid,breathe,auto-color,native-neon,native-marquee'&&page.logoOptions===5&&page.noTestPanel&&page.separateControls&&page.paletteColors===3&&page.savedPaletteFlow&&page.autoStripStaging&&page.timelineTools&&page.backgroundInputDefaultOff&&info.hid==='object'&&info.grantedCount===0&&info.ticks>=30});
  };
  worker.onerror=event=>{ipcRenderer.send('smoke:result',{...page,ok:false,error:event.message});};
});
