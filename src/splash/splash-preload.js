const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("splashApi", {
  onState: cb => ipcRenderer.on("splash:state", (_e, s) => cb(s)),
  skip: () => ipcRenderer.send("splash:skip")
});
