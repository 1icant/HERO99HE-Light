'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('HeroDesktop', {
  version: '0.2.2',
  onStop(callback) {
    const listener = () => { void Promise.resolve().then(callback); };
    ipcRenderer.on('desktop:stop', listener);
    return () => ipcRenderer.removeListener('desktop:stop', listener);
  },
  stopped() { ipcRenderer.send('desktop:stopped'); },
  setRunning(running) { ipcRenderer.send('desktop:running', running === true); }
});
