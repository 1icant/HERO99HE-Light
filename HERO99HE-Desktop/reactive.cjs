'use strict';
const {spawn}=require('node:child_process');
const codes=new Set(require('./web/layout.js').map(k=>k.code).filter(Boolean));
const reasons=new Set(['register','denied','runtime','native','ambiguous']);
function createReactiveInput(options){
  let child=null,enabled=false,active=false,backend='raw',failed=false,buffer='',heartbeat=null,readyTimer=null;
  let snapshot={state:'disabled'},history=[];
  const schedule=options.setInterval||setInterval,unschedule=options.clearInterval||clearInterval;
  function status(state,details={}){snapshot={...snapshot,state,...details};options.onStatus({...snapshot,backend,history:[...history]});}
  const reset=()=>options.onKey({reset:true});
  function stop(){
    const old=child;child=null;buffer='';if(heartbeat)unschedule(heartbeat);heartbeat=null;clearTimeout(readyTimer);readyTimer=null;reset();
    if(old){history.push({...snapshot,backend});history=history.slice(-8);try{old.stdin?.write('stop\n');}catch{}try{old.stdin?.end();}catch{}const timer=setTimeout(()=>{if(old.exitCode===null)old.kill();},600);timer.unref?.();}
  }
  function start(){
    snapshot={state:'starting',reason:null,devices:null,nativeEvents:0,backgroundEvents:0};status('starting');let current;
    const fail=(reason,details={})=>{if(current&&child!==current)return;failed=true;snapshot={...snapshot,state:'error',reason,...details};stop();status('error');};
    const spawnFailure=error=>fail(error?.code==='ENOENT'?'missing-helper':error?.code==='EACCES'?'denied':'spawn');
    try{current=(options.spawn||spawn)(options.helperPath,[backend==='poll'?'--listen-poll':'--listen'],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});}
    catch(error){spawnFailure(error);return;}
    child=current;
    current.on('error',spawnFailure);current.stdin?.on('error',()=>fail('pipe'));
    current.on('exit',code=>fail('helper-exit',{exitCode:Number.isInteger(code)?code:null}));
    readyTimer=setTimeout(()=>fail('ready-timeout'),5000);readyTimer.unref?.();
    // Never log raw input; discard stderr rather than collecting typed events.
    current.stderr?.on('data',()=>{});
    current.stdout.on('data',chunk=>{
      if(child!==current)return;buffer+=chunk.toString();if(buffer.length>8192){fail('oversize');return;}
      let at;while((at=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let m;try{m=JSON.parse(line);}catch{continue;}
        if(m.type==='error'){fail(reasons.has(m.reason)?m.reason:'native',{win32:Number.isInteger(m.win32)?m.win32:null,nativeType:typeof m.nativeType==='string'&&/^[A-Za-z]{1,80}$/.test(m.nativeType)?m.nativeType:null});return;}
        if(m.type==='ready'&&Number.isInteger(m.devices)&&m.devices>=0&&m.devices<=4096){clearTimeout(readyTimer);readyTimer=null;status(backend==='poll'||m.devices?'listening':'waiting',{devices:m.devices});continue;}
        if(m.type==='reset'){reset();continue;}
        if(m.type==='key'&&enabled&&active&&typeof m.down==='boolean'&&codes.has(m.code)){snapshot.nativeEvents++;if(!options.isFocused()){snapshot.backgroundEvents++;options.onKey({code:m.code,down:m.down});}}
      }
    });
    heartbeat=schedule(()=>{if(child===current)try{current.stdin.write('ping\n');status(snapshot.state);}catch{fail('pipe');}},3000);heartbeat.unref?.();
  }
  function setContext(value){
    const nextEnabled=value?.enabled===true,nextActive=value?.active===true,nextBackend=value?.backend==='poll'?'poll':'raw';
    if(nextBackend!==backend){stop();backend=nextBackend;failed=false;}
    if((!enabled||!active)&&nextEnabled&&nextActive)failed=false;
    enabled=nextEnabled;active=nextActive;
    if(!enabled||!active){if(child)stop();status(enabled?'idle':'disabled');return;}
    if(!child&&!failed)start();
  }
  return {setContext,reset,dispose(){enabled=false;active=false;stop();}};
}
module.exports={createReactiveInput};
