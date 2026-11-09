'use strict';
// Run with Electron, not node --test. Hidden local software smoke test only:
// reads only already-authorized device counts; never requests, opens or writes.
const {app,BrowserWindow,ipcMain,protocol,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const P=require('../policy.cjs');
const resultPath=process.argv.find(a=>a.startsWith('--result='))?.slice(9);
if(!resultPath) throw Error('Pass an explicit --result=absolute-path');
protocol.registerSchemesAsPrivileged([{scheme:'hero-light',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setPath('userData',path.join(path.dirname(resultPath),'smoke-profile'));
let win,requests=0;const permissionOrigins=[];
async function finish(result,code){
  await fs.writeFile(resultPath,JSON.stringify({...result,electron:process.versions.electron,chrome:process.versions.chrome,deviceRequests:requests,permissionOrigins},null,2));
  app.exit(code);
}
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionCheckHandler((wc,p,origin)=>{if(p==='hid')permissionOrigins.push(origin);return p==='hid'&&P.trustedOrigin(origin);});
  session.defaultSession.on('select-hid-device',(event,details,callback)=>{event.preventDefault();requests++;callback();});
  await protocol.handle('hero-light',async request=>{
    const pathname=new URL(request.url).pathname;
    if(['/smoke-worker.js','/benchmark-worker.js'].includes(pathname))return new Response(await fs.readFile(path.join(__dirname,pathname.slice(1))),{headers:{'Content-Type':'text/javascript'}});
    const target=P.route(request.url,request.method); if(!target)return new Response('',{status:404});
    return new Response(await fs.readFile(path.join(__dirname,'../web',target[0])),{headers:{'Content-Type':target[1],'Content-Security-Policy':P.CSP}});
  });
  win=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.on('close',event=>{event.preventDefault();win.hide();});
  ipcMain.once('smoke:result',(event,result)=>{
    if(event.sender!==win.webContents)return;
    void finish({...result,windowRetained:!win.isDestroyed(),hidden:!win.isVisible()},result.ok&&requests===0?0:1);
  });
  win.webContents.on('did-finish-load',()=>win.close());
  win.webContents.on('render-process-gone',(event,details)=>{void finish({ok:false,crash:details.reason},1);});
  setTimeout(()=>{void finish({ok:false,error:'runtime smoke timeout'},1);},15000);
  const mode=process.argv.find(a=>a.startsWith('--strip-mode='))?.slice(13)||'follow';
  await win.loadURL(P.ENTRY+(process.argv.includes('--benchmark')?'?benchmark=1&stripMode='+encodeURIComponent(mode):''));
}).catch(error=>{void finish({ok:false,error:error.stack},1);});
