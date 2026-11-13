"use strict";
// Overlay estilo Steam: ventana transparente a pantalla completa y siempre visible, con un
// navegador integrado (Google, Gmail, tu IA, el aula original). Se abre/cierra con Shift+Tab.

const { BrowserWindow, WebContentsView, screen, shell, session, ipcMain, globalShortcut } = require("electron");
const path = require("node:path");
const { AI_LIST, SITES, aiById, resolveInput } = require("./ai");

const PARTITION = "persist:nx-overlay-web"; // sesión propia: aquí se queda tu login de Google, etc.
const GLOBAL_KEYS = { "global-safe": "CommandOrControl+Shift+Space", "global-shift-tab": "Shift+Tab" };

const MAX_TABS = 12;
let win = null, deps = null, ipcReady = false, registered = null;
let tabs = [], activeId = null, nextId = 1, layout = { visible: false, rect: null };

const isHttp = u => { try { const p = new URL(u).protocol; return p === "https:" || p === "http:"; } catch { return false; } };
const alive = w => w && !w.isDestroyed();
const send = (ch, payload) => { if (alive(win)) win.webContents.send(ch, payload); };

function isToggleKey(input) {
  return input.type === "keyDown" && input.key === "Tab" && input.shift && !input.control && !input.alt && !input.meta;
}
// Úsalo en cualquier webContents de la app para que Shift+Tab abra/cierre el overlay.
function attachHotkey(webContents) {
  webContents.on("before-input-event", (e, input) => {
    if (isToggleKey(input)) { e.preventDefault(); toggle(); }
  });
}

// ------------------------------------------------------------ navegador integrado (con pestañas)
// Cada pestaña es una página web propia (WebContentsView). Una pestaña sin vista es la pantalla de inicio.
function newTabObj() {
  return { id: nextId++, view: null, title: "", url: "", loading: false, canBack: false, canForward: false, error: "" };
}
const tabAlive = t => !!(t && t.view && t.view.webContents && !t.view.webContents.isDestroyed());
const activeTab = () => tabs.find(t => t.id === activeId) || null;

function syncTab(t) {
  if (!tabAlive(t)) return;
  const wc = t.view.webContents, h = wc.navigationHistory;
  t.url = wc.getURL(); t.title = wc.getTitle(); t.loading = wc.isLoading();
  t.canBack = h ? h.canGoBack() : wc.canGoBack();
  t.canForward = h ? h.canGoForward() : wc.canGoForward();
}
function stateObj() {
  const t = activeTab();
  return {
    tabs: tabs.map(x => ({ id: x.id, title: x.title, url: x.url, loading: x.loading, home: !tabAlive(x), error: x.error })),
    active: activeId,
    page: t && tabAlive(t)
      ? { url: t.url, title: t.title, loading: t.loading, canBack: t.canBack, canForward: t.canForward, error: t.error }
      : { url: "", title: "", loading: false, canBack: false, canForward: false, error: "" }
  };
}
const pushState = () => send("overlay:state", stateObj());

// Solo la pestaña activa se ve; las demás siguen cargadas en segundo plano.
function applyLayout() {
  for (const t of tabs) {
    if (!tabAlive(t)) continue;
    if (layout.rect) t.view.setBounds(layout.rect);
    t.view.setVisible(t.id === activeId && layout.visible && !t.error && !!layout.rect);
  }
}
function activate(id) {
  if (!tabs.some(t => t.id === id)) return;
  activeId = id;
  applyLayout(); pushState();
}

function addTab() {
  if (tabs.length >= MAX_TABS) throw new Error(`Máximo ${MAX_TABS} pestañas abiertas.`);
  const t = newTabObj();
  tabs.push(t);
  return t;
}
function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  if (tabAlive(t)) {
    try { win.contentView.removeChildView(t.view); } catch { /* ya quitada */ }
    try { t.view.webContents.close(); } catch { /* ya cerrada */ }
  }
  if (!tabs.length) { const n = newTabObj(); tabs.push(n); activeId = n.id; }
  else if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)].id;
  applyLayout(); pushState();
}
function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex(t => t.id === activeId);
  activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}
function openNewTabAction() {
  try { const t = addTab(); activeId = t.id; applyLayout(); pushState(); send("overlay:focusOmni"); }
  catch (e) { send("overlay:flash", e.message); }
}

// Atajos de pestañas (solo con el overlay visible): Ctrl+T, Ctrl+W, Ctrl+Tab / Ctrl+Mayús+Tab, Ctrl+L.
function attachOverlayKeys(webContents) {
  webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !isVisible()) return;
    if (!(input.control || input.meta) || input.alt) return;
    const k = String(input.key).toLowerCase();
    if (k === "t" && !input.shift) { e.preventDefault(); openNewTabAction(); }
    else if (k === "w" && !input.shift) { e.preventDefault(); closeTab(activeId); }
    else if (k === "tab") { e.preventDefault(); cycleTab(input.shift ? -1 : 1); }
    else if (k === "l" && !input.shift) { e.preventDefault(); if (alive(win)) win.webContents.focus(); send("overlay:focusOmni"); }
  });
}

function ensureView(tab) {
  if (tabAlive(tab)) return tab.view;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // sin cámara, micrófono, ubicación…
  const view = new WebContentsView({
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  tab.view = view;
  const wc = view.webContents;
  // Google bloquea el inicio de sesión en navegadores "Electron": se usa un agente de Chrome normal.
  wc.setUserAgent(wc.getUserAgent().replace(/\s?Electron\/\S+/i, "").replace(/\s?notxunta-client\/\S+/i, ""));
  // Los enlaces que quieren abrir ventana nueva (target=_blank, window.open) se abren en una pestaña nueva.
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) {
      try { const t = addTab(); activeId = t.id; loadInTab(t, url); }
      catch { wc.loadURL(url).catch(() => {}); } // sin hueco para más pestañas: se abre en esta
    }
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => { if (!isHttp(e.url || url)) e.preventDefault(); });
  const upd = () => { if (tabs.includes(tab)) { syncTab(tab); pushState(); } };
  for (const ev of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-stop-loading"]) wc.on(ev, upd);
  wc.on("did-start-loading", () => { tab.error = ""; upd(); applyLayout(); });
  wc.on("did-fail-load", (_e, code, desc, _url, isMain) => {
    if (!isMain || code === -3) return;
    tab.error = desc || "No se pudo cargar la página.";
    syncTab(tab); applyLayout(); pushState();
  });
  attachHotkey(wc);
  attachOverlayKeys(wc);
  view.setVisible(false);
  win.contentView.addChildView(view);
  return view;
}
function loadInTab(tab, url) {
  const view = ensureView(tab);
  tab.error = "";
  view.webContents.loadURL(url).catch(() => { /* el error llega por did-fail-load */ });
  applyLayout(); pushState();
}

function resolveTarget(t) {
  if (!t || typeof t !== "object") return null;
  switch (t.kind) {
    case "google": return SITES.google;
    case "gmail": return SITES.gmail;
    case "input": return resolveInput(t.text);
    case "ai": { const a = aiById(deps.getSettings().ai); return a ? a.url : null; }
    case "aula": { const acc = deps.getAccounts().find(a => a.id === t.id); return acc ? acc.url : null; }
    default: return null;
  }
}

// ------------------------------------------------------------ ventana
function createWindow() {
  win = new BrowserWindow({
    show: false, frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, fullscreenable: false, title: "NotXunta Overlay",
    webPreferences: {
      preload: path.join(__dirname, "..", "overlay", "overlay-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", e => e.preventDefault());
  attachHotkey(win.webContents);
  attachOverlayKeys(win.webContents);
  win.on("blur", () => setTimeout(() => {
    // al pulsar dentro de la web integrada la ventana sigue activa; solo se oculta si se pierde el foco de verdad
    if (alive(win) && win.isVisible() && !win.isFocused() && !tabs.some(t => tabAlive(t) && t.view.webContents.isFocused())) hide();
  }, 200));
  win.on("closed", () => {
    for (const t of tabs) { try { if (tabAlive(t)) t.view.webContents.close(); } catch { /* nada */ } }
    win = null; tabs = []; activeId = null; layout = { visible: false, rect: null };
  });
  if (!tabs.length) { const t = newTabObj(); tabs.push(t); activeId = t.id; }
  win.loadFile(path.join(__dirname, "..", "overlay", "overlay.html"));
}

function reveal() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win.setBounds(d.bounds);
  win.show(); win.focus(); win.moveTop();
  send("overlay:shown");
}

function show() {
  if (!alive(win)) { createWindow(); win.once("ready-to-show", reveal); return; }
  reveal();
}
function hide() { if (alive(win) && win.isVisible()) win.hide(); }
function toggle() { if (alive(win) && win.isVisible()) hide(); else show(); }
const isVisible = () => alive(win) && win.isVisible();

// ------------------------------------------------------------ atajos globales (opcionales)
function applyHotkey(mode) {
  if (registered) { try { globalShortcut.unregister(registered); } catch { /* ya liberado */ } registered = null; }
  const acc = GLOBAL_KEYS[mode];
  if (!acc) return { ok: true };
  let ok = false;
  try { ok = globalShortcut.register(acc, toggle); } catch { ok = false; }
  if (ok) registered = acc;
  return ok ? { ok: true } : { ok: false, error: process.platform === "linux" ? `No se pudo registrar el atajo ${acc}: otro programa lo usa o tu escritorio (Wayland) no permite atajos globales. Usa la opción «Solo con NotXunta Client en primer plano».` : `No se pudo registrar el atajo ${acc}; otro programa lo está usando.` };
}

// ------------------------------------------------------------ IPC (solo desde la ventana del overlay)
function init(d) {
  deps = d;
  if (ipcReady) return;
  ipcReady = true;
  const on = (ch, fn) => ipcMain.handle(ch, (e, ...args) => {
    if (!alive(win) || e.sender !== win.webContents) throw new Error("Origen no permitido.");
    return fn(...args);
  });

  on("overlay:init", () => ({
    settings: deps.getSettings(),
    accounts: deps.getAccounts(),
    ai: AI_LIST.map(({ id, name, url }) => ({ id, name, host: new URL(url).host })),
    hotkey: deps.getSettings().overlayKey === "global-safe" ? (process.platform === "darwin" ? "⌘+Mayús+Espacio" : "Ctrl+Mayús+Espacio") : "Shift+Tab",
    mod: process.platform === "darwin" ? "⌘" : "Ctrl",
    state: stateObj()
  }));

  // target + { newTab: true } abre el destino en una pestaña nueva; si no, en la pestaña activa.
  on("overlay:go", (target, opts) => {
    const url = resolveTarget(target);
    if (!url || !isHttp(url)) throw new Error("No hay nada que abrir. Elige una IA en Ajustes o añade una cuenta.");
    let tab = activeTab();
    if (!tab || (opts && opts.newTab)) { tab = addTab(); activeId = tab.id; }
    loadInTab(tab, url);
    return true;
  });

  on("overlay:tabNew", () => { const t = addTab(); activeId = t.id; applyLayout(); pushState(); return t.id; });
  on("overlay:tabSwitch", id => { activate(Number(id)); return true; });
  on("overlay:tabClose", id => { closeTab(Number(id)); return true; });

  on("overlay:nav", action => {
    const t = activeTab();
    if (!tabAlive(t)) return false;
    const wc = t.view.webContents, h = wc.navigationHistory;
    if (action === "back") (h ? h.goBack() : wc.goBack());
    else if (action === "forward") (h ? h.goForward() : wc.goForward());
    else if (action === "reload") { t.error = ""; wc.reload(); }
    else if (action === "stop") wc.stop();
    return true;
  });

  on("overlay:layout", ({ visible, rect }) => {
    layout = {
      visible: !!visible,
      rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) } : layout.rect
    };
    applyLayout();
    return true;
  });

  on("overlay:external", async () => {
    const t = activeTab();
    const url = tabAlive(t) ? t.view.webContents.getURL() : "";
    if (!isHttp(url)) throw new Error("No hay ninguna página abierta.");
    await shell.openExternal(url);
    hide();
    return true;
  });

  on("overlay:setAi", id => { if (!aiById(id)) throw new Error("IA no válida."); return deps.setSettings({ ai: id, aiAsked: true }); });
  on("overlay:close", () => { hide(); return true; });
}

const destroy = () => { try { globalShortcut.unregisterAll(); } catch { /* nada */ } if (alive(win)) win.destroy(); };

module.exports = { init, show, hide, toggle, isVisible, attachHotkey, applyHotkey, destroy };
