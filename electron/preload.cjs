// The only things the editing screen may ask the desktop program to do.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desk", {
  initial: () => ipcRenderer.invoke("initial"),
  open: () => ipcRenderer.invoke("open"),
  save: (text, asNew, suggested) => ipcRenderer.invoke("save", text, asNew, suggested),
  pdf: (suggested, bulletin) => ipcRenderer.invoke("pdf", suggested, bulletin),
  install: () => ipcRenderer.invoke("install"),
  downloads: () => ipcRenderer.invoke("downloads"),
  onUpdate: (handler) => ipcRenderer.on("update", (_event, text) => handler(text)),
  onMenu: (handler) => ipcRenderer.on("menu", (_event, what) => handler(what)),
});
