'use strict';
const began=performance.now();let ticks=0;
let grantedCount=null,hidError=null;
navigator.hid.getDevices().then(devices=>{grantedCount=devices.length;}).catch(error=>{hidError=error.message;});
const timer=setInterval(()=>{
  ticks++;
  if(performance.now()-began>=2000){clearInterval(timer);postMessage({secure:self.isSecureContext,hid:typeof navigator.hid,getDevices:typeof navigator.hid?.getDevices,grantedCount,hidError,ticks,elapsedMs:performance.now()-began});}
},50);
