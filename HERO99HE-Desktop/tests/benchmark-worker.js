'use strict';
// All HID traffic below goes to this local fake device, never navigator.hid.
importScripts('core.js');
(async()=>{
  const writes=[],listeners=new Set();
  const caps=new Uint8Array(63);caps.set([130,9,0,1,0,26]);caps[24]=1;caps[62]=(255-9-caps.reduce((a,b)=>a+b,0))&255;
  const device={vendorId:0x372e,productId:0x103e,productName:'HERO 99 HE',opened:false,
    collections:[{usagePage:0xff60,usage:0x61,outputReports:[{reportId:9,items:[{reportCount:63,reportSize:8}]}],inputReports:[{reportId:9,items:[{reportCount:63,reportSize:8}]}]}],
    async open(){this.opened=true;},async close(){this.opened=false;},addEventListener(n,fn){listeners.add(fn);},removeEventListener(n,fn){listeners.delete(fn);},
    async sendReport(id,p){writes.push({time:performance.now(),command:p[0],index:p[4],count:p[3]});if(p[0]===130)for(const fn of listeners)fn({reportId:9,data:new DataView(caps.buffer)});}};
  const engine=HeroCore.createOutputEngine({keys:HeroKeys,hid:{async getDevices(){return[device];}},post:()=>{}});
  const mode=new URL(location.href).searchParams.get('stripMode')||'follow';
  if(!HeroCore.FRAME_STRIP_MODES.includes(mode))throw Error('Unsupported benchmark mode');
  const project=HeroCore.defaultProject();project.settings.effect='wave';project.strip.mode=mode;
  await engine.command('connect',device);await engine.command('inspect-lighting');
  await engine.command('state',{project,selectedFrame:-1,events:[],heat:{},time:0});
  const at=performance.now();await engine.command('start',{sideConsent:true});
  await new Promise(resolve=>setTimeout(resolve,3000));await engine.command('stop');
  const starts=writes.filter(w=>w.command===8&&w.index===0),side=writes.filter(w=>w.command===4);
  const gaps=starts.slice(1).map((w,i)=>w.time-starts[i].time).sort((a,b)=>a-b);
  postMessage({simulatedHid:true,mode,frames:starts.length,strip:side.length,elapsedMs:performance.now()-at,
    packetsPerFrame:[...new Set(starts.map(w=>w.count))],meanGapMs:gaps.reduce((a,b)=>a+b,0)/gaps.length,
    p95GapMs:gaps[Math.floor(gaps.length*0.95)],maxGapMs:Math.max(...gaps)});
})().catch(error=>postMessage({error:error.stack}));
