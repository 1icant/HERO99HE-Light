'use strict';
const {ipcRenderer}=require('electron');
window.addEventListener('DOMContentLoaded',async()=>{
  const page={secure:window.isSecureContext,hid:typeof navigator.hid,getDevices:typeof navigator.hid?.getDevices,
    requestDevice:typeof navigator.hid?.requestDevice,keys:document.querySelectorAll('.key').length,effects:document.querySelectorAll('.effect').length,
    stripOptions:document.querySelectorAll('#stripMode option').length,
    printScreen:document.querySelector('[data-key="95"] .legend')?.textContent,
    fn:document.querySelector('[data-key="72"] .legend')?.textContent,
    gain:document.getElementById('sideGain')?.value,grantedCount:null};
  if(new URL(location.href).searchParams.has('benchmark')){
    const mode=new URL(location.href).searchParams.get('stripMode')||'follow';
    const worker=new Worker('hero-light://studio/benchmark-worker.js?stripMode='+encodeURIComponent(mode));
    worker.onmessage=event=>{worker.terminate();ipcRenderer.send('smoke:result',{ok:!event.data.error,benchmark:event.data});};
    worker.onerror=event=>ipcRenderer.send('smoke:result',{ok:false,error:event.message});
    return;
  }
  try { page.grantedCount=(await navigator.hid.getDevices()).length; }
  catch(error){page.hidError=error.message;}
  const coreWorker=new Worker('hero-light://studio/core.js?v=0.1.12');
  page.coreWorker=await new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(false),3000);
    coreWorker.onerror=()=>{clearTimeout(timer);resolve(false);};
    coreWorker.onmessage=event=>{if(event.data.id===1){clearTimeout(timer);resolve(event.data.ok===true);}};
    coreWorker.postMessage({id:1,type:'state',payload:{project:{format:'hero99-light/v1',layout:'hero99he-101/v1',settings:{effect:'static',brightness:0.6,speed:1,fps:20,color:[97,218,251],bg:[5,8,18],palette:[[97,218,251],[189,155,255]]},strip:{mode:'off',color:[0,160,255],brightness:2},paint:{},frames:[],frameMs:100},selectedFrame:-1,events:[],heat:{},time:0}});
  });
  coreWorker.terminate();
  // Read-only getDevices in an ungranted test profile; never request/open/send.
  const worker=new Worker('hero-light://studio/smoke-worker.js');
  worker.onmessage=event=>{
    worker.terminate(); const info=event.data;
    ipcRenderer.send('smoke:result',{...page,worker:info,ok:page.secure&&page.hid==='object'&&page.getDevices==='function'&&page.grantedCount===0&&page.coreWorker&&page.keys===101&&page.effects===32&&page.stripOptions===14&&page.printScreen==='PrtSc'&&page.fn==='Fn'&&page.gain==='100'&&info.hid==='object'&&info.grantedCount===0&&info.ticks>=30});
  };
  worker.onerror=event=>{ipcRenderer.send('smoke:result',{...page,ok:false,error:event.message});};
});
