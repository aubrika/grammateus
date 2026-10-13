// The only things the editing screen may ask the desktop program to do.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desk", {
  initial: () => ipcRenderer.invoke("initial"),
  open: () => ipcRenderer.invoke("open"),
  save: (text, asNew, suggested) => ipcRenderer.invoke("save", text, asNew, suggested),
  pdf: (suggested) => ipcRenderer.invoke("pdf", suggested),
  onMenu: (handler) => ipcRenderer.on("menu", (_event, what) => handler(what)),
});
