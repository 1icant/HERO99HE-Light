'use strict';
// Fake child pipes only; never starts a global input listener.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createReactiveInput}=require('../reactive.cjs');
function rig(){
  const children=[],keys=[],states=[],details=[];let focused=false,tick;
  const service=createReactiveInput({helperPath:'C:/fake/HeroKeyInput.exe',isFocused:()=>focused,onKey:m=>keys.push(m),onStatus:m=>{states.push(m.state);details.push(m);},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{},
    spawn(file,args,options){assert.ok(['--listen','--listen-poll'].includes(args[0]));assert.equal(args.length,1);assert.equal(options.windowsHide,true);assert.equal(options.shell,false);
      const c=new EventEmitter();c.args=args;c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.commands=[];c.stdin.write=s=>c.commands.push(s);c.stdin.end=()=>{c.exitCode=0;};c.exitCode=null;c.kill=()=>{c.killed=true;};children.push(c);return c;}});
  return{service,children,keys,states,details,tick:()=>tick(),focus:v=>{focused=v;},line:m=>children.at(-1).stdout.emit('data',Buffer.from(JSON.stringify(m)+'\n'))};
}
test('Raw Input helper is off by default and starts only with opt-in AND active reactive output',()=>{
  const r=rig();r.service.setContext({enabled:false,active:true});r.service.setContext({enabled:true,active:false});assert.equal(r.children.length,0);
  r.service.setContext({enabled:true,active:true});r.service.setContext({enabled:true,active:true});assert.equal(r.children.length,1);
  r.line({type:'ready',devices:1});assert.equal(r.states.at(-1),'listening');r.service.dispose();
});
test('only known physical codes and boolean presses cross the pipe; foreground events are dropped',()=>{
  const r=rig();r.service.setContext({enabled:true,active:true});
  for(const m of [{type:'key',code:'KeyA',down:true},{type:'key',code:'KeyA',down:false}])r.line(m);
  assert.deepEqual(r.keys,[{code:'KeyA',down:true},{code:'KeyA',down:false}]);
  r.line({type:'key',code:'password',down:true});r.line({type:'key',code:'KeyA',down:'yes'});r.focus(true);r.line({type:'key',code:'KeyA',down:true});assert.equal(r.keys.length,2);
  r.service.dispose();assert.equal(r.keys.at(-1).reset,true);
});
test('Stop, opt-out and non-reactive output close the helper pipe; no stale events survive',()=>{
  const r=rig();r.service.setContext({enabled:true,active:true});const old=r.children[0];r.service.setContext({enabled:true,active:false});assert.ok(old.commands.includes('stop\n'));
  const n=r.keys.length;r.line({type:'key',code:'Escape',down:true});assert.equal(r.keys.length,n);
  r.service.setContext({enabled:true,active:true});assert.equal(r.children.length,2);r.service.setContext({enabled:false,active:true});assert.ok(r.children[1].commands.includes('stop\n'));r.service.dispose();
});
test('input startup failure never enters a restart loop and oversized output is rejected',()=>{
  const r=rig();r.service.setContext({enabled:true,active:true});r.children[0].emit('error',Error('fake missing binary'));
  for(let i=0;i<20;i++)r.service.setContext({enabled:true,active:true});assert.equal(r.children.length,1);assert.equal(r.states.at(-1),'error');
  r.service.setContext({enabled:false,active:false});r.service.setContext({enabled:true,active:true});assert.equal(r.children.length,2);
  r.children[1].stdout.emit('data',Buffer.alloc(8193));assert.equal(r.states.at(-1),'error');r.service.dispose();
});

test('closed stdin errors stop input without crashing the main process',()=>{
  const r=rig();r.service.setContext({enabled:true,active:true});
  r.children[0].stdin.write=()=>{throw Error('closed pipe');};r.children[0].stdin.end=()=>{throw Error('closed pipe');};
  assert.doesNotThrow(()=>r.tick());assert.equal(r.states.at(-1),'error');assert.doesNotThrow(()=>r.service.dispose());
});

test('multiple HERO Raw Input collections are accepted; counters are aggregate only',()=>{
  const r=rig();r.service.setContext({enabled:true,active:true});r.line({type:'ready',devices:3});assert.equal(r.states.at(-1),'listening');
  r.focus(true);r.line({type:'key',code:'Escape',down:true});r.focus(false);r.line({type:'key',code:'KeyA',down:true});r.tick();
  const d=r.details.at(-1);assert.equal(d.devices,3);assert.equal(d.nativeEvents,2);assert.equal(d.backgroundEvents,1);assert.ok(!JSON.stringify(d).includes('KeyA'));r.service.dispose();
});

test('backend switching starts only the selected explicit mode and retains bounded attempt summaries',()=>{
  const r=rig();r.service.setContext({enabled:true,active:true});r.line({type:'error',reason:'register',win32:5});
  assert.equal(r.details.at(-1).reason,'register');assert.equal(r.details.at(-1).win32,5);
  r.service.setContext({enabled:true,active:true,backend:'poll'});assert.deepEqual(r.children.at(-1).args,['--listen-poll']);
  r.line({type:'ready',devices:0});assert.equal(r.states.at(-1),'listening');assert.equal(r.details.at(-1).backend,'poll');
  assert.equal(r.details.at(-1).history[0].reason,'register');r.service.dispose();
});

test('missing helper, numeric exit code and untrusted free-form reason are distinguished safely',()=>{
  const r=rig();r.service.setContext({enabled:true,active:true});r.children[0].emit('error',Object.assign(Error('private path'),{code:'ENOENT'}));assert.equal(r.details.at(-1).reason,'missing-helper');
  r.service.setContext({enabled:false});r.service.setContext({enabled:true,active:true});r.children.at(-1).emit('exit',42);assert.equal(r.details.at(-1).exitCode,42);
  r.service.setContext({enabled:false});r.service.setContext({enabled:true,active:true});r.line({type:'error',reason:'private text'});assert.equal(r.details.at(-1).reason,'native');assert.ok(!JSON.stringify(r.details).includes('private'));r.service.dispose();
});
