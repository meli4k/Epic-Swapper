const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  swapStart: () => ipcRenderer.invoke("desktop:swap-start"),
  swapDouble: () => ipcRenderer.invoke("desktop:swap-double"),
  swapCancel: () => ipcRenderer.invoke("desktop:swap-cancel"),
  swapConfirm: () => ipcRenderer.invoke("desktop:swap-confirm"),
  sessionStart: (force) => ipcRenderer.invoke("desktop:session-start", Boolean(force)),
  sessionCancel: () => ipcRenderer.invoke("desktop:session-cancel"),
  sessionLogout: () => ipcRenderer.invoke("desktop:session-logout"),
  lookup: (name) => ipcRenderer.invoke("desktop:lookup", String(name || "")),
  copy: (text) => ipcRenderer.invoke("desktop:copy", String(text || "")),
});
