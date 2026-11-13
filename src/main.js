"use strict";
const { app, BrowserWindow, ipcMain, safeStorage, shell, Notification, Tray, Menu, nativeImage, dialog, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { MoodleClient, normalizeUrl, syncAll } = require("./moodle");
const settings = require("./lib/settings");
const { AI_LIST } = require("./lib/ai");
const overlay = require("./lib/overlay");
const toasts = require("./lib/toasts");
const updater = require("./lib/updater");
const cloud = require("./lib/cloud");
const sync = require("./lib/sync");
const splash = require("./lib/splash");
const secure = require("./lib/secure");
const CHANGELOG = require("./lib/changelog");
const RELEASES_URL = "https://github.com/FurryMichis/notxunta-client/releases/latest";

app.setAppUserModelId("com.notxunta.client");
// Modo compatible del vídeo de fondo: sin decodificación por hardware (arregla vídeos que no se ven en algunos PCs/GPU).
if (settings.get().videoCompat) app.commandLine.appendSwitch("disable-accelerated-video-decode");
// Esquema propio para servir el vídeo de fondo desde la carpeta de datos (con soporte de "seek").
protocol.registerSchemesAsPrivileged([
  { scheme: "nx-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

// ---------------------------------------------------------------- almacenamiento
const userDir = () => app.getPath("userData");
const accountsFile = () => path.join(userDir(), "accounts.json");
const cacheFile = id => path.join(userDir(), `cache-${id.replace(/[^\w-]/g, "")}.json`);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const loadAccounts = () => readJson(accountsFile(), []);
const saveAccounts = list => writeJson(accountsFile(), list);
const publicAccount = a => ({ id: a.id, name: a.name, url: a.url, username: a.username, icon: a.icon || "", needsPassword: !!a.needsPassword });

// Icono de instancia: un emoji/símbolo corto o una imagen pequeña (data URL).
function cleanIcon(icon) {
  if (icon == null || icon === "") return "";
  icon = String(icon);
  if (icon.startsWith("data:image/")) {
    if (icon.length > 200000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon)) throw new Error("La imagen del icono no es válida o es demasiado grande.");
    return icon;
  }
  if ([...icon].length > 8) throw new Error("Icono no válido.");
  return icon;
}

function findAccount(id) {
  const acc = loadAccounts().find(a => a.id === id);
  if (!acc) throw new Error("La cuenta ya no existe.");
  return acc;
}

// La contraseña se cifra con el almacén de credenciales del sistema (DPAPI en Windows, Llavero en macOS, GNOME Keyring/KWallet en Linux).
function encryptPassword(pw) {
  if (!secure.available()) throw new Error(secure.MISSING);
  return safeStorage.encryptString(pw).toString("base64");
}
const decryptPassword = acc => safeStorage.decryptString(Buffer.from(acc.pw, "base64"));

// ---------------------------------------------------------------- sesiones Moodle
const sessions = new Map(); // accountId -> MoodleClient (el token nunca llega a la interfaz)

async function connect(acc) {
  if (acc.needsPassword || !acc.pw) { // aula importada de la cuenta NotXunta: la contraseña no se sincroniza
    throw Object.assign(new Error("Falta la contraseña de esta aula en este ordenador."), { errorcode: "nopassword" });
  }
  const client = new MoodleClient(acc.url);
  await client.login(acc.username, decryptPassword(acc));
  sessions.set(acc.id, client);
  return client;
}
async function clientFor(id) {
  return sessions.get(id) || connect(findAccount(id));
}
async function withClient(id, fn) {
  const client = await clientFor(id);
  try { return await fn(client); }
  catch (e) {
    if (e.errorcode === "invalidtoken") return fn(await connect(findAccount(id)));
    throw e;
  }
}

// ---------------------------------------------------------------- mensajes: estado local, contador y avisos
// Moodle no marca como leído un chat solo por pedir sus mensajes: se marca explícitamente y, además,
// se recuerda en local hasta qué mensaje se ha visto para que el contador nunca se quede "pegado".
const msgFile = id => path.join(userDir(), `msgstate-${id.replace(/[^\w-]/g, "")}.json`);
const msgStates = new Map();
function msgState(id) {
  if (!msgStates.has(id)) {
    const s = readJson(msgFile(id), {});
    msgStates.set(id, { baselined: !!s.baselined, notified: s.notified || {}, seen: s.seen || {} });
  }
  return msgStates.get(id);
}
const saveMsgState = id => { try { writeJson(msgFile(id), msgStates.get(id)); } catch { /* en memoria */ } };
const userIds = new Map();
async function userIdOf(id, c) {
  if (!userIds.has(id)) userIds.set(id, (await c.siteInfo()).userid);
  return userIds.get(id);
}

function mapConversations(r, userId, st) {
  return (r.conversations || []).map(cv => {
    // Los chats individuales no traen nombre: se usa el del otro participante.
    const members = cv.members || [];
    const others = members.filter(m => m.id !== userId);
    const who = others.length ? others : members;
    const lastMsg = cv.messages && cv.messages[0];
    const time = (lastMsg && lastMsg.timecreated) || 0;
    const seen = st.seen[cv.id] || 0;
    return {
      id: cv.id,
      name: cv.name || who.map(m => m.fullname).filter(Boolean).join(", ") || "Chat",
      unread: time && time <= seen ? 0 : (cv.unreadcount || 0),
      last: plain(lastMsg && lastMsg.text),
      time,
      from: (lastMsg && lastMsg.useridfrom) || 0,
      pic: cv.imageurl || (who[0] && (who[0].profileimageurl || who[0].profileimageurlsmall)) || ""
    };
  });
}

let msgTimer = null, msgBusy = false;
async function pollMessages() {
  if (msgBusy || !settings.get().msgNotify) return;
  msgBusy = true;
  try {
    const accounts = loadAccounts();
    for (const acc of accounts) {
      if (bgBlocked.has(acc.id) || acc.needsPassword) continue;
      try {
        const list = await withClient(acc.id, async c => {
          const uid = await userIdOf(acc.id, c);
          return mapConversations(await c.conversations(uid, 30), uid, msgState(acc.id));
        });
        const uid = userIds.get(acc.id), st = msgState(acc.id);
        const total = list.reduce((n, cv) => n + cv.unread, 0);
        const fresh = list.filter(cv => cv.unread > 0 && cv.from !== uid && cv.time > (st.notified[cv.id] || 0));
        for (const cv of fresh) st.notified[cv.id] = cv.time;
        const firstRun = !st.baselined; // la primera comprobación solo fija la referencia
        st.baselined = true;
        saveMsgState(acc.id);
        const shown = firstRun ? [] : fresh;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("msg:update", {
            accountId: acc.id, total,
            fresh: shown.map(cv => ({ name: cv.name, text: cv.last.slice(0, 120) }))
          });
        }
        if (shown.length) announceMessages(acc, accounts.length > 1, shown);
      } catch (e) {
        if (e && e.errorcode === "invalidlogin") bgBlocked.add(acc.id);
      }
    }
  } finally { msgBusy = false; }
}
function announceMessages(acc, multi, fresh) {
  const focused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
  if (focused) return; // con la app delante se avisa dentro de la propia interfaz
  const action = `messages:${acc.id}`;
  const suffix = multi ? ` · ${acc.name}` : "";
  if (fresh.length > 3) {
    announce(`${fresh.length} chats con mensajes nuevos${suffix}`, fresh.map(cv => cv.name).slice(0, 4).join(", "), acc.icon, action);
    return;
  }
  for (const cv of fresh) {
    const count = cv.unread > 1 ? `${cv.unread} mensajes nuevos · ` : "";
    announce(`Mensaje de ${cv.name}${suffix}`, `${count}${cv.last}`, acc.icon, action);
  }
}
function scheduleMessages(firstDelayMs) {
  clearTimeout(msgTimer);
  msgTimer = setTimeout(async () => { await pollMessages(); scheduleMessages(); }, firstDelayMs || 60000);
}

// ---------------------------------------------------------------- cuenta NotXunta (nube): vínculos y solicitudes de amistad
// Clave estable de un aula (host + ruta), igual para todos los usuarios de la misma aula.
function siteKey(url) {
  try { const u = new URL(url); return (u.host + u.pathname.replace(/\/+$/, "")).toLowerCase(); } catch { return String(url || "").toLowerCase(); }
}
async function linkAccountToCloud(accountId, user) {
  try {
    if (!cloud.isSignedIn() || !user || !user.id) return;
    const st = await cloud.status();
    if (!st.profile || !st.profile.discoverable) return;
    const acc = loadAccounts().find(a => a.id === accountId);
    if (acc) await cloud.linkMoodle(siteKey(acc.url), user.id, user.fullname || user.name || "");
  } catch { /* el vínculo se reintenta en la próxima sincronización */ }
}
async function linkAllAccounts() {
  for (const acc of loadAccounts()) {
    const c = readJson(cacheFile(acc.id), null);
    if (c && c.data && c.data.user) await linkAccountToCloud(acc.id, c.data.user);
  }
}
function afterCloudLogin() { cloud.invalidateProfile(); setTimeout(() => { linkAllAccounts(); pollFriends(); }, 1500); sync.schedule(1500); }

let knownIncoming = null, friendsTimer = null;
function sendFriendBadge(n) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("cloud:badge", { pending: n });
}
async function pollFriends() {
  try {
    if (!cloud.configured() || !cloud.isSignedIn()) { knownIncoming = null; sendFriendBadge(0); return; }
    const st = await cloud.status();
    if (!st.profile) { sendFriendBadge(0); return; }
    const incoming = (await cloud.rpc("list_friends")).filter(r => r.status === "pending" && !r.i_requested);
    sendFriendBadge(incoming.length);
    const focused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
    if (knownIncoming && !focused) {
      for (const r of incoming.filter(r => !knownIncoming.has(r.friendship_id)).slice(0, 3)) {
        announce(`${r.display_name || r.username} quiere ser tu amigo`, "Abre «Amigos» para aceptar o rechazar la solicitud.", "", "friends");
      }
    }
    knownIncoming = new Set(incoming.map(r => r.friendship_id));
  } catch { /* sin conexión: se reintenta */ }
}
function scheduleFriends() {
  clearInterval(friendsTimer);
  setTimeout(() => { pollFriends(); linkAllAccounts(); }, 25000);
  friendsTimer = setInterval(pollFriends, 3 * 60 * 1000);
}

// ---------------------------------------------------------------- ajustes sincronizados con la cuenta NotXunta
function dropAccountFiles(id) {
  sessions.delete(id); msgStates.delete(id); userIds.delete(id);
  try { fs.unlinkSync(cacheFile(id)); } catch { /* sin caché */ }
  try { fs.unlinkSync(msgFile(id)); } catch { /* sin estado de mensajes */ }
}
// Mezcla la lista de aulas de la nube con la local. Las aulas nuevas llegan SIN contraseña (needsPassword) y las que
// se borraron en otro equipo (estaban en la última sincronización y ya no están) se quitan también aquí.
function applyRemoteAccounts(remote, known) {
  const knownSet = new Set(known || []);
  const remoteIds = new Set(remote.map(r => r && r.id));
  const list = loadAccounts();
  const out = list.filter(a => remoteIds.has(a.id) || !knownSet.has(a.id));
  for (const a of list) if (!out.includes(a)) dropAccountFiles(a.id);
  for (const r of remote) {
    try {
      if (!r || typeof r.id !== "string" || !/^[\w-]{8,64}$/.test(r.id)) continue;
      const url = normalizeUrl(r.url);
      const name = String(r.name || "").trim().slice(0, 60);
      const username = String(r.username || "").trim().slice(0, 100);
      if (!name || !username) continue;
      let icon = ""; try { icon = cleanIcon(r.icon); } catch { /* icono no válido: se ignora */ }
      let a = out.find(x => x.id === r.id)
        || out.find(x => siteKey(x.url) === siteKey(url) && String(x.username).toLowerCase() === username.toLowerCase());
      if (a) {
        if (a.id !== r.id) { sessions.delete(a.id); a.id = r.id; }
        a.name = name;
        if (icon) a.icon = icon;
        else if (!a.icon || !String(a.icon).startsWith("data:") || a.icon.length <= 30000) delete a.icon;
      } else out.push({ id: r.id, name, url, username, pw: "", needsPassword: true, ...(icon ? { icon } : {}) });
    } catch { /* aula remota no válida: se ignora */ }
  }
  saveAccounts(out);
}
sync.init({
  getPrefs: settings.get,
  applyPrefs: patch => { settings.set(patch); scheduleBackground(); },
  getAccounts: loadAccounts,
  applyAccounts: applyRemoteAccounts,
  notifyApplied: r => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("sync:applied", { look: r.look, prefs: r.prefs, accounts: r.accounts }); }
});

// ---------------------------------------------------------------- sincronización y novedades
const bgBlocked = new Set(); // cuentas cuya contraseña falló: no se reintenta en segundo plano (evita bloqueos de cuenta)

async function doSync(id, sender, { background = false } = {}) {
  const acc = findAccount(id);
  const progress = msg => { try { if (sender) sender.send("sync-progress", msg); } catch { /* ventana cerrada */ } };
  const prev = readJson(cacheFile(id), null);

  let data;
  try {
    data = await withClient(id, c => syncAll(c, progress));
  } catch (e) {
    if (prev && prev.data) {
      return { ...prev.data, unseen: prev.unseen || [], offline: true, error: e.message, errorcode: e.errorcode };
    }
    throw e;
  }

  bgBlocked.delete(id);
  const current = new Set(data.courses.flatMap(c => c.sections.flatMap(s => s.modules.map(m => m.key))));
  const known = new Set(prev ? prev.keys : []);
  const unseen = new Set(prev ? prev.unseen : []);
  let newCount = 0;
  if (prev) { // la primera sincronización solo fija la referencia
    for (const k of current) if (!known.has(k)) { unseen.add(k); newCount++; }
  }
  for (const k of [...unseen]) if (!current.has(k)) unseen.delete(k);

  try { // contador de mensajes sin leer (opcional: si el aula no lo permite, se deja en 0)
    const uid = data.user.id; userIds.set(id, uid);
    const list = mapConversations(await withClient(id, c => c.conversations(uid, 30)), uid, msgState(id));
    data.unreadMessages = list.reduce((n, cv) => n + cv.unread, 0);
  } catch { data.unreadMessages = 0; }
  linkAccountToCloud(id, data.user);

  writeJson(cacheFile(id), { keys: [...current], unseen: [...unseen], data });
  data.unseen = [...unseen];
  data.newCount = newCount;

  if (newCount > 0 && (background || !(mainWindow && mainWindow.isFocused()))) {
    announce(acc.name, `${newCount} ${newCount === 1 ? "novedad" : "novedades"} en ${acc.name}`, acc.icon);
  }
  return data;
}

// ---------------------------------------------------------------- avisos (estilo Steam) y segundo plano
let mainWindow = null, tray = null, quitting = false, hintedTray = false;

function announce(title, body, icon, action = "app") {
  if (settings.get().toasts) toasts.show({ title, body, icon: icon || "🎓", action });
  else if (Notification.isSupported()) {
    const n = new Notification({ title, body });
    n.on("click", () => handleToastAction(action));
    n.show();
  }
}

function handleToastAction(action) {
  if (action === "overlay") { overlay.show(); return; }
  if (action === "update") { if (!updater.installNow()) showMain(); return; }
  if (action === "releases") { shell.openExternal(RELEASES_URL); return; }
  if (action === "friends") {
    showMain();
    const go = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:navigate", { view: "friends" }); };
    if (mainWindow && mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", go); else go();
    return;
  }
  showMain();
  if (typeof action === "string" && action.startsWith("messages:") && mainWindow) {
    const go = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:navigate", { view: "messages", accountId: action.slice(9) }); };
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", go); else go();
  }
}

let bgTimer = null, bgBusy = false;
async function backgroundSync() {
  if (bgBusy) return;
  bgBusy = true;
  try {
    for (const acc of loadAccounts()) {
      if (bgBlocked.has(acc.id) || acc.needsPassword) continue;
      try {
        const r = await doSync(acc.id, null, { background: true });
        if (r && r.offline && r.errorcode === "invalidlogin") bgBlocked.add(acc.id);
      } catch (e) {
        if (e && e.errorcode === "invalidlogin") bgBlocked.add(acc.id);
      }
    }
  } finally { bgBusy = false; }
}
function scheduleBackground(firstDelayMs) {
  clearTimeout(bgTimer);
  const s = settings.get();
  if (!s.bgSync) return;
  bgTimer = setTimeout(async () => { await backgroundSync(); scheduleBackground(); }, firstDelayMs || s.syncMinutes * 60000);
}

let booting = true; // mientras se ve la pantalla de inicio no se abre la ventana principal por otras vías
function showMain() {
  if (booting) return;
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

function createTray() {
  const size = process.platform === "linux" ? 24 : 16; // Windows/macOS 16 px; en Linux los paneles suelen pedir algo más grande
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.png")).resize({ width: size, height: size });
  tray = new Tray(icon);
  tray.setToolTip("NotXunta Client");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir NotXunta Client", click: showMain },
    { label: "Abrir overlay (Shift+Tab)", click: () => overlay.toggle() },
    { label: "Buscar novedades ahora", click: () => backgroundSync() },
    { label: "Buscar actualizaciones", click: () => updater.check({ manual: true }) },
    { type: "separator" },
    { label: "Salir", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", showMain);
}

// ---------------------------------------------------------------- vídeo de fondo
const VIDEO_TYPES = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg" };
const wallpaperDir = () => path.join(userDir(), "wallpaper");
const mediaUrl = name => `nx-media://wallpaper/${encodeURIComponent(name)}`;

function registerMediaProtocol() {
  protocol.handle("nx-media", async req => {
    const notFound = () => new Response("No encontrado", { status: 404 });
    try {
      const u = new URL(req.url);
      if (u.hostname !== "wallpaper") return notFound();
      const name = path.basename(decodeURIComponent(u.pathname));
      const m = /^wallpaper-\d+(\.\w+)$/.exec(name);
      const type = m && VIDEO_TYPES[m[1].toLowerCase()];
      if (!type) return notFound();
      const file = path.join(wallpaperDir(), name);
      const size = (await fs.promises.stat(file)).size;
      let start = 0, end = size - 1, status = 200;
      const headers = { "Content-Type": type, "Accept-Ranges": "bytes" };
      const rm = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
      if (rm) {
        if (rm[1] === "" && rm[2] !== "") start = Math.max(0, size - Number(rm[2]));
        else { start = Number(rm[1] || 0); if (rm[2] !== "") end = Math.min(end, Number(rm[2])); }
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        status = 206; headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      }
      headers["Content-Length"] = String(end - start + 1);
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
    } catch { return notFound(); }
  });
}

// ---------------------------------------------------------------- IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: "Origen no permitido." };
    try { return { ok: true, data: await fn(event, ...args) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

handle("accounts:list", () => loadAccounts().map(publicAccount));

handle("accounts:add", async (_e, { name, url, username, password }) => {
  name = String(name || "").trim();
  username = String(username || "").trim();
  if (!name || !username || !password) throw new Error("Rellena todos los campos.");
  const base = normalizeUrl(url);
  const client = new MoodleClient(base);
  await client.login(username, password); // valida las credenciales antes de guardar
  const list = loadAccounts();
  const dup = list.find(a => siteKey(a.url) === siteKey(base) && String(a.username).toLowerCase() === username.toLowerCase());
  if (dup) { // la misma aula ya está (p. ej. importada de tu cuenta NotXunta sin contraseña): se completa en lugar de duplicarla
    if (!dup.needsPassword) throw new Error("Esa cuenta ya está añadida.");
    dup.pw = encryptPassword(password); delete dup.needsPassword;
    saveAccounts(list); sessions.set(dup.id, client); bgBlocked.delete(dup.id);
    return publicAccount(dup);
  }
  const acc = { id: crypto.randomUUID(), name, url: base, username, pw: encryptPassword(password) };
  saveAccounts([...list, acc]);
  sessions.set(acc.id, client);
  sync.touch("accounts");
  return publicAccount(acc);
});

// Aula importada de la cuenta NotXunta: solo falta la contraseña de este ordenador.
handle("accounts:setPassword", async (_e, id, password) => {
  password = String(password || "");
  if (!password) throw new Error("Escribe la contraseña.");
  const list = loadAccounts();
  const acc = list.find(a => a.id === id);
  if (!acc) throw new Error("La cuenta ya no existe.");
  const client = new MoodleClient(acc.url);
  await client.login(acc.username, password); // se valida contra el aula antes de guardar
  acc.pw = encryptPassword(password); delete acc.needsPassword;
  saveAccounts(list); sessions.set(acc.id, client); bgBlocked.delete(id);
  return publicAccount(acc);
});

handle("accounts:remove", (_e, id) => {
  saveAccounts(loadAccounts().filter(a => a.id !== id));
  sessions.delete(id);
  try { fs.unlinkSync(cacheFile(id)); } catch { /* sin caché */ }
  try { fs.unlinkSync(msgFile(id)); } catch { /* sin estado de mensajes */ }
  msgStates.delete(id); userIds.delete(id);
  sync.touch("accounts");
  return true;
});

handle("accounts:setIcon", (_e, id, icon) => {
  const icon2 = cleanIcon(icon);
  const list = loadAccounts();
  const acc = list.find(a => a.id === id);
  if (!acc) throw new Error("La cuenta ya no existe.");
  if (icon2) acc.icon = icon2; else delete acc.icon;
  saveAccounts(list);
  sync.touch("accounts");
  return publicAccount(acc);
});

// ---- ajustes, overlay y vídeo de fondo
handle("settings:get", () => ({ settings: settings.get(), ai: AI_LIST.map(({ id, name, url }) => ({ id, name, host: new URL(url).host })) }));
handle("settings:set", (_e, patch) => {
  settings.set(patch);
  let warn = "";
  if (patch && "overlayKey" in patch) {
    const r = overlay.applyHotkey(settings.get().overlayKey);
    if (!r.ok) { warn = r.error; settings.set({ overlayKey: "focus" }); overlay.applyHotkey("focus"); }
  }
  if (patch && ("bgSync" in patch || "syncMinutes" in patch)) scheduleBackground();
  if (patch && sync.PREF_KEYS.some(k => k in patch)) sync.touch("prefs");
  return { settings: settings.get(), warn };
});
handle("app:overlay", () => { overlay.show(); return true; });
// Sincronización de ajustes: la interfaz comunica su aspecto; el resto lo gestiona el proceso principal.
handle("sync:look", (_e, look, changed) => { sync.reportLook(look, !!changed); return true; });
handle("sync:now", async () => { await sync.run(); return sync.getInfo(); });
handle("sync:info", () => sync.getInfo());
handle("cloud:status", () => cloud.status());
handle("cloud:signUp", async (_e, email, pw) => { const r = await cloud.signUp(email, pw); if (!r.needsConfirmation) afterCloudLogin(); return r; });
handle("cloud:signIn", async (_e, email, pw) => { await cloud.signIn(email, pw); afterCloudLogin(); return true; });
handle("cloud:oauth", async (_e, provider) => { await cloud.signInOAuth(provider); afterCloudLogin(); return true; });
handle("cloud:oauthCancel", () => { cloud.cancelOAuth(); return true; });
handle("cloud:signOut", async () => { await cloud.signOut(); sync.forget(); knownIncoming = null; sendFriendBadge(0); return true; });
handle("cloud:createProfile", async (_e, p) => { await cloud.createProfile(p || {}); setTimeout(linkAllAccounts, 500); sync.schedule(800); return cloud.status(); });
handle("cloud:updateProfile", async (_e, patch) => {
  await cloud.updateProfile(patch || {});
  if (patch && patch.discoverable === true) setTimeout(linkAllAccounts, 300);
  return cloud.status();
});
handle("cloud:deleteAccount", async () => { await cloud.deleteAccount(); sync.forget(); knownIncoming = null; sendFriendBadge(0); return true; });

// ¿Quién de los participantes de este curso usa NotXunta Client?
handle("cloud:lookup", async (_e, accountId, ids) => {
  const acc = loadAccounts().find(a => a.id === accountId);
  if (!acc) throw new Error("Cuenta no encontrada.");
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isSafeInteger);
  const out = {};
  for (let i = 0; i < list.length; i += 500) {
    const rows = await cloud.rpc("find_moodle_users", { p_site: siteKey(acc.url), p_ids: list.slice(i, i + 500) });
    for (const r of rows || []) out[r.moodle_user_id] = { user_id: r.user_id, username: r.username, display_name: r.display_name };
  }
  return out;
});
handle("participants", (_e, accountId, courseId) => withClient(accountId, c => c.participants(Number(courseId))));

handle("friends:list", async () => (await cloud.rpc("list_friends")) || []);
handle("friends:find", async (_e, username) => {
  const name = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,20}$/.test(name)) throw new Error("Escribe un nombre de usuario válido (letras, números y _).");
  const rows = await cloud.rpc("find_user", { p_username: name });
  return (rows && rows[0]) || null;
});
handle("friends:request", async (_e, userId) => {
  if (!cloud.UUID.test(String(userId))) throw new Error("Usuario no válido.");
  const r = await cloud.rpc("send_friend_request", { p_user: userId });
  setTimeout(pollFriends, 500);
  return r;
});
handle("friends:respond", async (_e, id, accept) => { await cloud.rpc("respond_friend_request", { p_id: Number(id), p_accept: !!accept }); setTimeout(pollFriends, 300); return true; });
handle("friends:remove", async (_e, id) => { await cloud.removeFriendship(id); setTimeout(pollFriends, 300); return true; });

handle("update:status", () => updater.getStatus());
handle("update:check", () => updater.check({ manual: true }));
handle("update:install", () => updater.installNow());
handle("update:openReleases", () => { shell.openExternal(RELEASES_URL); return true; });
handle("app:changelog", () => ({ versions: CHANGELOG, current: app.getVersion(), seen: settings.get().lastSeenVersion }));
handle("app:changelogSeen", () => { settings.set({ lastSeenVersion: app.getVersion() }); return true; });
handle("app:platform", () => ({ platform: process.platform, secure: secure.available() }));
handle("app:relaunch", () => { quitting = true; setTimeout(() => { app.relaunch(); app.quit(); }, 150); return true; });

handle("media:pickVideo", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Elige un vídeo para el fondo", properties: ["openFile"],
    filters: [{ name: "Vídeo (MP4, WebM)", extensions: ["mp4", "m4v", "webm", "ogv"] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0], ext = path.extname(src).toLowerCase();
  if (!VIDEO_TYPES[ext]) throw new Error("Formato no admitido. Usa MP4 (H.264) o WebM.");
  const size = (await fs.promises.stat(src)).size;
  if (size > 1e9) throw new Error("El vídeo pesa demasiado (máximo 1 GB).");
  await fs.promises.mkdir(wallpaperDir(), { recursive: true });
  const name = `wallpaper-${Date.now()}${ext}`;
  await fs.promises.copyFile(src, path.join(wallpaperDir(), name)); // copia propia: sigue funcionando si mueves el original
  for (const f of await fs.promises.readdir(wallpaperDir())) {
    if (f !== name && /^wallpaper-\d+\./.test(f)) await fs.promises.unlink(path.join(wallpaperDir(), f)).catch(() => {});
  }
  return { file: name, url: mediaUrl(name) };
});
handle("media:url", (_e, name) => (/^wallpaper-\d+\.\w+$/.test(String(name)) ? mediaUrl(name) : ""));
handle("media:clearVideo", async () => {
  try { for (const f of await fs.promises.readdir(wallpaperDir())) await fs.promises.unlink(path.join(wallpaperDir(), f)).catch(() => {}); } catch { /* sin carpeta */ }
  return true;
});

handle("instance:open", async (e, id) => doSync(id, e.sender));
handle("instance:sync", async (e, id) => doSync(id, e.sender));
handle("instance:close", (_e, id) => { sessions.delete(id); return true; });

handle("instance:markSeen", (_e, id, keys) => {
  const cache = readJson(cacheFile(id), null);
  if (!cache) return true;
  const drop = new Set(keys);
  cache.unseen = cache.unseen.filter(k => !drop.has(k));
  writeJson(cacheFile(id), cache);
  return true;
});

const imageCache = new Map();
handle("instance:image", async (_e, id, url) => {
  const cacheKey = `${id}|${url}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
  const data = await withClient(id, async c => {
    const res = await fetch(c.withToken(url), { signal: AbortSignal.timeout(30000) });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) throw new Error("Imagen no disponible.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error("Imagen demasiado grande.");
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  });
  imageCache.set(cacheKey, data);
  return data;
});

const DANGEROUS = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|vbe|js|jse|wsf|wsh|lnk|hta|jar|reg|dll|pif|cpl|app|command|sh|bash|zsh|run|bin|appimage|deb|rpm|dmg|pkg|desktop|workflow|action|scpt|scptd|terminal|webloc|inetloc)$/i;

// Los apuntes se guardan en una caché temporal: abrir de nuevo el mismo archivo es instantáneo y,
// al entrar en un tema, los documentos se descargan en segundo plano para que abran sin esperar.
const docsDir = () => path.join(os.tmpdir(), "notxunta-client-docs");
const docInflight = new Map();
const safeName = n => path.basename(String(n || "archivo")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120) || "archivo";

function docTarget(accountId, url, filename, version) {
  const hash = crypto.createHash("sha1").update(`${accountId}|${url}|${Number(version) || 0}`).digest("hex").slice(0, 16);
  return path.join(docsDir(), hash, safeName(filename));
}

async function ensureDoc(accountId, url, filename, version, maxBytes) {
  const target = docTarget(accountId, url, filename, version);
  try { if ((await fs.promises.stat(target)).size > 0) return target; } catch { /* aún no está en caché */ }
  if (docInflight.has(target)) return docInflight.get(target);
  const job = withClient(accountId, async c => {
    const res = await fetch(c.withToken(url), { signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`No se pudo descargar el archivo (HTTP ${res.status}).`);
    const type = res.headers.get("content-type") || "";
    const len = Number(res.headers.get("content-length")) || 0;
    if (maxBytes && len > maxBytes) { res.body && res.body.cancel().catch(() => {}); return null; }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + ".part";
    if (type.includes("json") && len < 4096) { // posible error del aula en lugar del archivo
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.toString().includes('"exception"')) throw new Error("El aula rechazó la descarga del archivo.");
      await fs.promises.writeFile(tmp, buf);
    } else {
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp)); // en disco según llega, sin cargarlo entero en memoria
    }
    await fs.promises.rename(tmp, target);
    return target;
  }).finally(() => docInflight.delete(target));
  docInflight.set(target, job);
  return job;
}

handle("instance:openFile", async (_e, id, url, filename, version) => {
  let file = await ensureDoc(id, url, filename, version, 0);
  if (!file) file = await ensureDoc(id, url, filename, version, 0); // una precarga omitida (archivo grande) no cuenta
  if (DANGEROUS.test(file)) { // nunca ejecutar programas descargados
    shell.showItemInFolder(file);
    return { note: "Archivo ejecutable: se ha descargado pero no se abre automáticamente." };
  }
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
  return {};
});

// Precarga en segundo plano (de uno en uno, solo archivos de hasta 25 MB y máximo 10 por tema).
handle("instance:prefetch", (_e, id, files) => {
  const list = (Array.isArray(files) ? files : []).slice(0, 10)
    .filter(f => f && typeof f.url === "string" && typeof f.filename === "string");
  (async () => {
    for (const f of list) {
      try { await ensureDoc(id, f.url, f.filename, f.version, 25e6); } catch { /* se descargará al pulsar */ }
    }
  })();
  return true;
});

async function purgeOldDocs() { // al arrancar: se borran los apuntes en caché con más de 3 días
  try {
    for (const d of await fs.promises.readdir(docsDir())) {
      const p = path.join(docsDir(), d);
      const st = await fs.promises.stat(p);
      if (Date.now() - st.mtimeMs > 3 * 86400000) await fs.promises.rm(p, { recursive: true, force: true });
    }
  } catch { /* sin caché */ }
}

handle("instance:openExternal", async (_e, url) => {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Enlace no permitido.");
  await shell.openExternal(u.toString());
  return true;
});

// ---- funciones del aula
const plain = html => String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

handle("api:calendar", (_e, id) => withClient(id, async c => {
  const r = await c.calendar();
  return (r.events || []).map(ev => ({
    id: ev.id, name: ev.name, time: ev.timesort, url: ev.url || "",
    course: (ev.course && ev.course.fullname) || "", type: ev.modulename || ""
  }));
}));

handle("api:grades", (_e, id, courseId, userId) => withClient(id, async c => {
  const r = await c.grades(courseId, userId);
  const g = (r.usergrades && r.usergrades[0]) || { gradeitems: [] };
  return g.gradeitems.map(i => ({
    name: i.itemname || (i.itemtype === "course" ? "Total del curso" : ""),
    grade: i.gradeformatted || "-", range: i.rangeformatted || "", pct: i.percentageformatted || "",
    feedback: plain(i.feedback)
  }));
}));

handle("api:conversations", (_e, id, userId) => withClient(id, async c => {
  return mapConversations(await c.conversations(userId), userId, msgState(id));
}));

handle("api:markRead", (_e, id, userId, convId, time) => withClient(id, async c => {
  const st = msgState(id), t = Number(time) || 0;
  if (t > (st.seen[convId] || 0)) { st.seen[convId] = t; saveMsgState(id); }
  await c.markConversationRead(userId, convId).catch(() => { /* el aula no lo permite: queda la marca local */ });
  return true;
}));

handle("api:thread", (_e, id, userId, convId) => withClient(id, async c => {
  const r = await c.thread(userId, convId);
  return (r.messages || []).map(m => ({ id: m.id, from: m.useridfrom, text: plain(m.text), time: m.timecreated }))
    .sort((a, b) => a.time - b.time);
}));

handle("api:send", (_e, id, { toUserId, convId, text }) => withClient(id, async c => {
  text = String(text || "").trim();
  if (!text) throw new Error("Escribe un mensaje.");
  if (convId) await c.sendToConversation(convId, text);
  else await c.sendMessage(toUserId, text);
  return true;
}));

handle("api:notifications", (_e, id, userId) => withClient(id, async c => {
  const r = await c.notifications(userId);
  return (r.notifications || []).map(n => ({
    id: n.id, subject: n.subject || "", text: plain(n.smallmessage || n.fullmessage),
    time: n.timecreated, read: !!n.read, url: n.contexturl || ""
  }));
}));

// ---------------------------------------------------------------- ventana
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#100e18",
    show: false, // se muestra cuando está pintada (y entonces se cierra la pantalla de inicio)
    title: "NotXunta Client",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required" // el vídeo de fondo puede sonar sin pulsar nada
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", e => e.preventDefault());
  overlay.attachHotkey(mainWindow.webContents); // Shift+Tab abre/cierra el overlay
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  const reveal = () => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); splash.close(); };
  mainWindow.once("ready-to-show", reveal);
  setTimeout(reveal, 8000); // por si acaso: nunca se queda la pantalla de inicio para siempre
  mainWindow.on("close", e => {
    if (quitting || !settings.get().keepBackground) return;
    e.preventDefault(); // se queda en la bandeja del sistema
    mainWindow.hide();
    if (!hintedTray) {
      hintedTray = true;
      announce("NotXunta Client", "Sigue en segundo plano. Pulsa Shift+Tab para abrir el overlay.", "", "overlay");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!settings.get().keepBackground) { quitting = true; app.quit(); }
  });
}

// Muestra la pantalla de inicio y, si la app está instalada, busca actualizaciones. Devuelve el resultado de la comprobación
// (ver updater.startupCheck) o "installing" si hay una versión nueva descargada y la app se va a reiniciar para instalarla.
async function startupScreen() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();
  try { await Promise.race([splash.open(), wait(4000)]); } catch { return "skip"; }
  splash.setClosedHandler(() => { if (booting && !quitting) { quitting = true; app.quit(); } }); // cerrar la pantalla de inicio (Alt+F4) = salir
  splash.update({ text: "Iniciando…", percent: -1, canSkip: false });
  splash.setSkipHandler(() => updater.skipStartup());
  const r = await updater.startupCheck(st => splash.update(st));
  if (r === "ready") {
    splash.update({ text: "Instalando la actualización…", percent: 100, canSkip: false });
    await wait(700);
    quitting = true;
    if (updater.installSilently()) return "installing";
    quitting = false;
  }
  const finalText = r === "none" ? "Todo al día. Iniciando…"
    : r === "available" ? "Hay una versión nueva. Iniciando…"
    : r === "error" || r === "timeout" ? "No se pudo buscar actualizaciones. Iniciando…"
    : "Iniciando…";
  splash.update({ text: finalText, percent: -1, canSkip: false });
  await wait(Math.max(500, 1600 - (Date.now() - t0))); // que se llegue a leer aunque la comprobación sea instantánea
  return r;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMain);
  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", () => { overlay.destroy(); toasts.destroy(); });
  app.whenReady().then(async () => {
    // Windows/Linux: sin menú (los atajos de zoom los gestiona la propia app). macOS necesita un menú mínimo (Salir, copiar/pegar).
    if (process.platform === "darwin") Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
      { label: "Edición", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "Ventana", submenu: [{ role: "minimize" }, { role: "close" }] }
    ]));
    else Menu.setApplicationMenu(null);
    registerMediaProtocol();
    overlay.init({
      getSettings: settings.get,
      setSettings: settings.set,
      getAccounts: () => loadAccounts().map(publicAccount)
    });
    toasts.init(handleToastAction);
    overlay.applyHotkey(settings.get().overlayKey);
    updater.init({
      enabled: () => settings.get().autoUpdate,
      notify: (title, body, action) => announce(title, body, "", action),
      onStatus: st => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update:status", st); }
    });

    // Pantalla de inicio con el logo: «Buscando actualizaciones…» antes de abrir la ventana principal.
    const result = await startupScreen();
    if (result === "installing") return; // la app se cierra para instalar la actualización y se vuelve a abrir sola

    booting = false;
    createTray();
    createWindow();
    scheduleBackground(30000); // primera búsqueda de novedades poco después de abrir
    scheduleMessages(20000);   // y la de mensajes nuevos (después, cada minuto)
    purgeOldDocs();
    updater.schedule(result === "error" || result === "timeout" ? 20000 : null); // si ya se comprobó al arrancar, no se repite enseguida
    scheduleFriends();
    sync.schedule(8000);       // trae los ajustes de tu cuenta NotXunta (si has iniciado sesión)
    setTimeout(() => {
      const keep = settings.get().keepBackground;
      announce("NotXunta Client", `${keep ? "Se mantiene en segundo plano. " : ""}Pulsa Shift+Tab para abrir el overlay.`, "", "overlay");
    }, 1800);
    app.on("activate", showMain);
  });
  // La app sigue viva (bandeja) aunque no haya ventanas visibles.
}
