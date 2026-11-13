const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("toastApi", {
  onShow: cb => ipcRenderer.on("toast:show", (_e, p) => cb(p)),
  onHide: cb => ipcRenderer.on("toast:hide", () => cb()),
  click: () => ipcRenderer.send("toast:click"),
  dismiss: () => ipcRenderer.send("toast:dismiss"),
  hold: v => ipcRenderer.send("toast:hold", !!v)
});
