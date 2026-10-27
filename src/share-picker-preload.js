'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerApi', {
  onSources: callback => {
    ipcRenderer.on('picker:sources', (event, sources) => callback(sources));
  },
  select: index => ipcRenderer.send('picker:select', index),
  cancel: () => ipcRenderer.send('picker:cancel'),
});
