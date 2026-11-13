"use strict";
// Sincronización de ajustes entre ordenadores con la cuenta NotXunta (tabla user_settings en Supabase).
// Tres secciones independientes, cada una con su marca de tiempo (gana la modificación más reciente):
//   look     → fondo (imagen), oscurecimiento, color de acento, sonido
//   prefs    → ajustes de la app (IA elegida, avisos, segundo plano…)
//   accounts → aulas (nombre, enlace, usuario, icono). NUNCA contraseñas: en el otro PC piden la contraseña una vez.
// Lo que depende del equipo (tamaño de interfaz, atajo del overlay, modo compatible de vídeo, el archivo de vídeo) no se sincroniza.

const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cloud = require("./cloud");

const SECTIONS = ["look", "prefs", "accounts"];
const LOOK_KEYS = ["bg", "dim", "image", "accent", "sound", "volume"];
const PREF_KEYS = ["ai", "aiAsked", "keepBackground", "bgSync", "syncMinutes", "toasts", "msgNotify"];
const MAX_IMAGE = 1.3e6;      // una imagen de fondo más grande no se sube (el resto del fondo sí)
const MAX_ICON = 30000;       // idem para los iconos de aula subidos como imagen

let deps = null;
let state = null;             // { userId, at: {look,prefs,accounts}, dirty: {...}, known: [ids de aulas], lastLook }
let currentLook = null;       // último aspecto que ha comunicado la interfaz
let timer = null, periodic = null;
let busy = false, again = false;
const pending = new Set();    // secciones modificadas en este equipo que aún no se han marcado
const info = { lastRun: 0, error: "" };

const file = () => path.join(app.getPath("userData"), "sync-state.json");
function loadState(uid) {
  if (state && state.userId === uid) return state;
  let s = null;
  try { s = JSON.parse(fs.readFileSync(file(), "utf8")); } catch { /* primera vez */ }
  state = s && s.userId === uid ? s : { userId: uid, at: {}, dirty: {}, known: [] };
  state.at = state.at || {}; state.dirty = state.dirty || {}; state.known = state.known || [];
  return state;
}
function saveState() {
  try { fs.writeFileSync(file(), JSON.stringify(state)); } catch { /* se reintenta en la próxima */ }
}

// ------------------------------------------------------------------ valores locales
function pickLook(l) {
  const out = {};
  for (const k of LOOK_KEYS) if (l && l[k] !== undefined) out[k] = l[k];
  if (typeof out.image === "string" && out.image.length > MAX_IMAGE) out.image = "";
  return out;
}
const pickPrefs = p => { const out = {}; for (const k of PREF_KEYS) if (p && k in p) out[k] = p[k]; return out; };
function pickAccounts() {
  return deps.getAccounts().map(a => ({
    id: a.id, name: a.name, url: a.url, username: a.username,
    icon: typeof a.icon === "string" && a.icon.startsWith("data:image/") && a.icon.length > MAX_ICON ? "" : (a.icon || "")
  }));
}
function localValue(sec) {
  if (sec === "look") return pickLook(currentLook);
  if (sec === "prefs") return pickPrefs(deps.getPrefs());
  return pickAccounts();
}

// ------------------------------------------------------------------ aplicar lo remoto
function mergeLook(local, remote) {
  const next = { ...local };
  const r = pickLook(remote);
  for (const k of LOOK_KEYS) if (k in r) next[k] = r[k];
  // El archivo de vídeo es de este PC. Si el aspecto remoto es «vídeo» o «imagen» pero aquí no hay con qué, se conserva el fondo local.
  if (r.bg === "video") next.bg = local.video ? "video" : local.bg === "video" ? "none" : local.bg;
  if (r.bg === "image" && !r.image) { next.bg = local.bg === "video" && local.video ? "video" : local.bg; next.image = local.image || ""; }
  return next;
}

function applyRemote(sec, value, result) {
  if (sec === "look") {
    currentLook = mergeLook(currentLook || {}, value || {});
    state.lastLook = JSON.stringify(pickLook(currentLook));
    result.look = currentLook;
  } else if (sec === "prefs") {
    deps.applyPrefs(pickPrefs(value || {}));
    result.prefs = true;
  } else {
    deps.applyAccounts(Array.isArray(value) ? value : [], state.known);
    state.known = deps.getAccounts().map(a => a.id);
    result.accounts = true;
  }
}

async function pushSection(sec, value, at) {
  await cloud.rest("POST", "/rest/v1/user_settings?on_conflict=user_id", {
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { user_id: state.userId, [sec]: value, [`${sec}_at`]: at, updated_at: new Date().toISOString() }
  });
  state.at[sec] = at; state.dirty[sec] = false;
  if (sec === "look") state.lastLook = JSON.stringify(value);
  if (sec === "accounts") state.known = value.map(a => a.id);
}

// ------------------------------------------------------------------ ciclo de sincronización
async function run() {
  if (busy) { again = true; return null; }
  busy = true;
  const result = { look: null, prefs: false, accounts: false, ok: false };
  try {
    if (!cloud.configured() || !cloud.isSignedIn()) return result;
    const st = await cloud.status();
    if (!st.profile) return result;
    const s = loadState(st.profile.id);

    const rows = await cloud.rest("GET", `/rest/v1/user_settings?user_id=eq.${st.profile.id}&select=*`);
    const remote = (rows && rows[0]) || null;

    for (const sec of pending) {                       // cambios hechos en este equipo desde la última vez
      if (s.at[sec] > 0) { s.dirty[sec] = true; s.at[sec] = Date.now(); }
    }
    pending.clear();

    for (const sec of SECTIONS) {
      if (sec === "look" && !currentLook) continue;     // la interfaz aún no ha comunicado el aspecto actual
      const ra = remote ? Number(remote[`${sec}_at`]) || 0 : 0;
      const la = s.at[sec] || 0;
      if (ra > la) { applyRemote(sec, remote[sec], result); s.at[sec] = ra; s.dirty[sec] = false; }
      else if (ra < la || s.dirty[sec] || ra === 0) await pushSection(sec, localValue(sec), la || Date.now());
    }
    saveState();
    info.lastRun = Date.now(); info.error = ""; result.ok = true;
    if (result.look || result.prefs || result.accounts) deps.notifyApplied(result);
  } catch (e) {
    info.error = (e && e.message) || "Error de sincronización.";
  } finally {
    busy = false;
    if (again) { again = false; schedule(1500); }
  }
  return result;
}

function schedule(ms = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => { run(); }, ms);
}

// Algo ha cambiado en este equipo: se sube en unos segundos (varios cambios seguidos se juntan).
function touch(sec) {
  if (!SECTIONS.includes(sec)) return;
  pending.add(sec);
  if (cloud.isSignedIn()) schedule(2500);
}

// La interfaz comunica su aspecto actual. changed = true si lo acaba de modificar el usuario.
function reportLook(look, changed) {
  currentLook = look && typeof look === "object" ? look : currentLook;
  if (!changed || !currentLook) return;
  const json = JSON.stringify(pickLook(currentLook));
  if (state && json === state.lastLook) return;        // nada que sincronizar (p. ej. solo cambió el tamaño de interfaz)
  touch("look");
}

function init(d) {
  deps = d;
  clearInterval(periodic);
  periodic = setInterval(() => { if (cloud.isSignedIn()) run(); }, 10 * 60 * 1000);
}

// Al cerrar sesión o borrar la cuenta se olvida el estado: al volver a entrar manda lo que haya en la nube.
function forget() {
  state = null; pending.clear(); clearTimeout(timer);
  try { fs.rmSync(file(), { force: true }); } catch { /* ya no existe */ }
}

module.exports = { init, run, touch, schedule, reportLook, forget, getInfo: () => ({ ...info }), PREF_KEYS };
