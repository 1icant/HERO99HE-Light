'use strict';
// Run with Electron, not node --test. Hidden local software smoke test only:
// reads only already-authorized device counts; never requests, opens or writes.
const {app,BrowserWindow,ipcMain,protocol,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const P=require('../policy.cjs');
const resultPath=process.argv.find(a=>a.startsWith('--result='))?.slice(9);
if(!resultPath) throw Error('Pass an explicit --result=absolute-path');
const webRoot=process.argv.find(a=>a.startsWith('--web-root='))?.slice(11)||path.join(__dirname,'../web');
const appRoot=path.dirname(webRoot);
const mobile=process.argv.includes('--mobile');
protocol.registerSchemesAsPrivileged([{scheme:'hero-light',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setPath('userData',path.join(path.dirname(resultPath),path.basename(resultPath,'.json')+'-profile'));
let win,requests=0;const permissionOrigins=[];
async function finish(result,code){
  await fs.writeFile(resultPath,JSON.stringify({...result,electron:process.versions.electron,chrome:process.versions.chrome,deviceRequests:requests,permissionOrigins},null,2));
  app.exit(code);
}
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionCheckHandler((wc,p,origin)=>{if(p==='hid')permissionOrigins.push(origin);return p==='hid'&&P.trustedOrigin(origin);});
  session.defaultSession.on('select-hid-device',(event,details,callback)=>{event.preventDefault();requests++;callback();});
  session.defaultSession.registerPreloadScript({type:'frame',filePath:path.join(appRoot,'preload.cjs')});
  await protocol.handle('hero-light',async request=>{
    const pathname=new URL(request.url).pathname;
    if(['/smoke-worker.js','/benchmark-worker.js'].includes(pathname))return new Response(await fs.readFile(path.join(__dirname,pathname.slice(1))),{headers:{'Content-Type':'text/javascript'}});
    const target=P.route(request.url,request.method); if(!target)return new Response('',{status:404});
    return new Response(await fs.readFile(path.join(webRoot,target[0])),{headers:{'Content-Type':target[1],'Content-Security-Policy':P.CSP}});
  });
  win=new BrowserWindow({show:false,width:mobile?680:1350,height:850,useContentSize:true,webPreferences:{preload:path.join(__dirname,'smoke-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.on('close',event=>{event.preventDefault();win.hide();});
  ipcMain.once('smoke:result',(event,result)=>{
    if(event.sender!==win.webContents)return;
    const desktopVersion=JSON.parse(require('node:fs').readFileSync(path.join(appRoot,'package.json'),'utf8')).version;
    const versionOK=result.versionLabel==='桌面版 v'+desktopVersion+' · Web v0.1.26';
    const ok=result.ok&&versionOK&&requests===0;
    void finish({...result,ok,desktopVersion,versionOK,windowRetained:!win.isDestroyed(),hidden:!win.isVisible()},ok?0:1);
  });
  win.webContents.on('did-finish-load',()=>win.close());
  win.webContents.on('render-process-gone',(event,details)=>{void finish({ok:false,crash:details.reason},1);});
  setTimeout(()=>{void finish({ok:false,error:'runtime smoke timeout'},1);},15000);
  const query=new URLSearchParams();
  if(mobile)query.set('mobile','1');
  if(process.argv.includes('--benchmark'))query.set('benchmark','1');
  await win.loadURL(P.ENTRY+'?'+query);
}).catch(error=>{void finish({ok:false,error:error.stack},1);});
