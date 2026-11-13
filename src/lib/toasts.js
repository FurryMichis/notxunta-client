"use strict";
// Avisos emergentes estilo Steam: una ventanita sin marco, siempre visible, que aparece
// en la esquina inferior derecha sin robar el foco y se esconde sola.

const { BrowserWindow, screen, ipcMain } = require("electron");
const path = require("node:path");

const W = 380, H = 112, MARGIN = 16, SHOW_MS = 6500;
let win = null, ready = false, busy = false, timer = null;
const queue = [];
let onClick = () => {};

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  ready = false;
  win = new BrowserWindow({
    width: W, height: H, show: false, frame: false, transparent: true, resizable: false,
    movable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "toast", "toast-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", e => e.preventDefault());
  win.webContents.once("did-finish-load", () => { ready = true; pump(); });
  win.on("closed", () => { win = null; ready = false; busy = false; });
  win.loadFile(path.join(__dirname, "..", "toast", "toast.html"));
  return win;
}

function place() {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({ x: wa.x + wa.width - W - MARGIN, y: wa.y + wa.height - H - MARGIN, width: W, height: H });
}

function pump() {
  if (busy || !ready || !queue.length || !win || win.isDestroyed()) return;
  busy = true;
  const item = queue.shift();
  place();
  win.showInactive();
  win.webContents.send("toast:show", item.payload);
  current = item;
  timer = setTimeout(hide, SHOW_MS);
}
let current = null;

function hide() {
  clearTimeout(timer);
  if (!win || win.isDestroyed()) { busy = false; return; }
  win.webContents.send("toast:hide");
  setTimeout(() => {
    if (win && !win.isDestroyed()) win.hide();
    busy = false; current = null;
    setTimeout(pump, 250);
  }, 380);
}

// payload: { title, body, icon?, action? }  (action: "app" | "overlay" | "messages:<idCuenta>")
function show(payload) {
  const clean = {
    title: String(payload.title || "NotXunta Client").slice(0, 80),
    body: String(payload.body || "").slice(0, 200),
    icon: typeof payload.icon === "string" ? payload.icon.slice(0, 200000) : "",
    action: payload.action === "overlay" ? "overlay" : payload.action === "update" ? "update" : payload.action === "releases" ? "releases" : payload.action === "friends" ? "friends" : /^messages:[\w-]{1,64}$/.test(String(payload.action)) ? String(payload.action) : "app"
  };
  queue.push({ payload: clean });
  ensureWindow();
  pump();
}

function init(clickHandler) {
  onClick = clickHandler;
  ipcMain.on("toast:click", e => {
    if (!win || e.sender !== win.webContents) return;
    const action = current ? current.payload.action : "app";
    hide();
    onClick(action);
  });
  ipcMain.on("toast:dismiss", e => { if (win && e.sender === win.webContents) hide(); });
  ipcMain.on("toast:hold", (e, hold) => {
    if (!win || e.sender !== win.webContents || !current) return;
    clearTimeout(timer);
    if (!hold) timer = setTimeout(hide, 2500);
  });
}

function destroy() { clearTimeout(timer); if (win && !win.isDestroyed()) win.destroy(); }

module.exports = { init, show, destroy };
