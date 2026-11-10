'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('HeroDesktop', {
  version: '0.3.3',
  onStop(callback) {
    const listener = () => { void Promise.resolve().then(callback); };
    ipcRenderer.on('desktop:stop', listener);
    return () => ipcRenderer.removeListener('desktop:stop', listener);
  },
  stopped() { ipcRenderer.send('desktop:stopped'); },
  onPreviewVisibility(callback){
    const listener=(_event,value)=>callback(value===true);
    ipcRenderer.on('desktop:preview-visible',listener);
    ipcRenderer.send('desktop:preview-ready');
    return ()=>ipcRenderer.removeListener('desktop:preview-visible',listener);
  },
  setInputContext(value) { ipcRenderer.send('desktop:input-context',{enabled:value?.enabled===true,running:value?.running===true,reactive:value?.reactive===true,backend:value?.backend==='poll'?'poll':'raw'}); },
  onKey(callback) { const listener=(_event,value)=>callback(value);ipcRenderer.on('desktop:key',listener);return()=>ipcRenderer.removeListener('desktop:key',listener); },
  onInputStatus(callback) { const listener=(_event,value)=>callback(value);ipcRenderer.on('desktop:input-status',listener);return()=>ipcRenderer.removeListener('desktop:input-status',listener); }
});
