"use strict";
// Pantalla de inicio: un recuadro sin marco con el logo y el estado («Buscando actualizaciones…») que se ve
// antes de abrir la ventana principal.

const { BrowserWindow, ipcMain, app } = require("electron");
const path = require("node:path");

let win = null, onSkip = () => {}, onClosed = () => {}, last = null;

function create() {
  win = new BrowserWindow({
    width: 380, height: 270, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    show: false, center: true, alwaysOnTop: true, hasShadow: false, title: "NotXunta Client",
    icon: path.join(__dirname, "..", "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "..", "splash", "splash-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", e => e.preventDefault());
  win.on("closed", () => { win = null; onClosed(); });
  ipcMain.removeAllListeners("splash:skip");
  ipcMain.on("splash:skip", e => { if (win && e.sender === win.webContents) onSkip(); });
  const shown = new Promise(res => {
    win.webContents.once("did-finish-load", () => {
      if (win) { win.show(); if (last) win.webContents.send("splash:state", last); }
      res();
    });
  });
  win.loadFile(path.join(__dirname, "..", "splash", "splash.html"));
  return shown;
}

// state: { text, percent (-1 = indeterminado), canSkip }
function update(state) {
  last = { ...state, version: app.getVersion() };
  if (win && !win.isDestroyed()) win.webContents.send("splash:state", last);
}

const open = () => create();
const close = () => { if (win && !win.isDestroyed()) win.destroy(); win = null; };
const isOpen = () => !!(win && !win.isDestroyed());
const setSkipHandler = fn => { onSkip = fn; };
const setClosedHandler = fn => { onClosed = fn; };

module.exports = { open, update, close, isOpen, setSkipHandler, setClosedHandler };
