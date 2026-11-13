const { contextBridge, ipcRenderer } = require("electron");
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld("overlayApi", {
  init: () => call("overlay:init"),
  go: (target, opts) => call("overlay:go", target, opts),
  nav: action => call("overlay:nav", action),
  layout: payload => call("overlay:layout", payload),
  external: () => call("overlay:external"),
  setAi: id => call("overlay:setAi", id),
  close: () => call("overlay:close"),
  tabNew: () => call("overlay:tabNew"),
  tabSwitch: id => call("overlay:tabSwitch", id),
  tabClose: id => call("overlay:tabClose", id),
  onState: cb => ipcRenderer.on("overlay:state", (_e, s) => cb(s)),
  onShown: cb => ipcRenderer.on("overlay:shown", () => cb()),
  onFocusOmni: cb => ipcRenderer.on("overlay:focusOmni", () => cb()),
  onFlash: cb => ipcRenderer.on("overlay:flash", (_e, m) => cb(m))
});
