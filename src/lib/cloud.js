"use strict";
// Cuentas propias de NotXunta Client (independientes del aula virtual), sobre Supabase.
// Todo se hace desde el proceso principal; la interfaz solo recibe resultados.
// La sesión se guarda cifrada con el almacén seguro del sistema (DPAPI en Windows, Llavero en macOS, GNOME Keyring / KWallet en Linux).

const { app, safeStorage, shell } = require("electron");
const secure = require("./secure");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./cloud-config");

const OAUTH_PORT = 53682;                       // añade http://127.0.0.1:53682/callback a las Redirect URLs de Supabase
const PROVIDERS = ["google", "discord", "github"];
const sessionFile = () => path.join(app.getPath("userData"), "cloud-session.bin");
const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let session = null;        // { access_token, refresh_token, expires_at, user: { id, email } }
let profile;               // undefined = sin cargar · null = sin perfil · objeto = perfil
let oauthServer = null;
const linked = new Set();  // vínculos ya enviados en esta sesión

const configured = () => /^https:\/\/.+/i.test(config.url || "") && !!config.anonKey;

// ------------------------------------------------------------------ sesión en disco
let loaded = false;
const ensureLoaded = () => { if (!loaded) { loaded = true; loadSession(); } }; // se carga la primera vez que hace falta (con la app ya lista)
function loadSession() {
  try {
    if (!secure.available()) return;
    const raw = fs.readFileSync(sessionFile());
    session = JSON.parse(safeStorage.decryptString(raw));
  } catch { session = null; }
}
function saveSession() {
  try {
    if (!session) { fs.rmSync(sessionFile(), { force: true }); return; }
    if (secure.available()) fs.writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(session)));
  } catch { /* la sesión queda solo en memoria */ }
}
function setSession(r) {
  if (!r || !r.access_token || !r.user) throw new Error("Respuesta de inicio de sesión no válida.");
  session = {
    access_token: r.access_token, refresh_token: r.refresh_token,
    expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
    user: { id: r.user.id, email: r.user.email || "" }
  };
  profile = undefined; linked.clear();
  saveSession();
}
function clearSession() { session = null; profile = undefined; linked.clear(); saveSession(); }

// ------------------------------------------------------------------ errores legibles
function cloudError(status, data) {
  const code = data && (data.error_code || data.code);
  const msg = data && (data.msg || data.message || data.error_description || data.error) || "";
  const map = {
    invalid_credentials: "Correo o contraseña incorrectos.",
    email_not_confirmed: "Confirma tu correo (te hemos enviado un enlace) antes de entrar.",
    user_already_exists: "Ya existe una cuenta con ese correo.",
    email_exists: "Ya existe una cuenta con ese correo.",
    weak_password: "La contraseña es demasiado débil (mínimo 8 caracteres).",
    over_email_send_rate_limit: "Se han enviado demasiados correos. Espera un poco e inténtalo de nuevo.",
    over_request_rate_limit: "Demasiados intentos. Espera un poco e inténtalo de nuevo.",
    signup_disabled: "El registro está desactivado en el servidor.",
    validation_failed: "Revisa el correo y la contraseña.",
    "23505": "Ese nombre de usuario ya está en uso.",
    "23514": "El nombre de usuario solo puede tener letras minúsculas, números y _ (3 a 20 caracteres)."
  };
  if (map[code]) return new Error(map[code]);
  if (code === "42703" || code === "PGRST204" || code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(msg))
    return new Error("Falta actualizar la base de datos de Supabase: ejecuta supabase/migration-0.6.1.sql en el SQL Editor (y migration-0.5.6.sql si todavía no lo hiciste).");
  if (/provider is not enabled|Unsupported provider/i.test(msg)) return new Error("Ese método de inicio de sesión no está activado en el servidor.");
  return new Error(msg ? String(msg).slice(0, 200) : `Error del servidor (${status}).`);
}

// ------------------------------------------------------------------ peticiones
async function request(method, urlPath, { body, headers, auth = true, retry = true } = {}) {
  ensureLoaded();
  if (!configured()) throw new Error("El servidor de cuentas todavía no está configurado en esta versión de la app.");
  if (auth && session && Date.now() / 1000 > session.expires_at - 60) await refresh();
  if (auth && !session) throw new Error("Inicia sesión en tu cuenta NotXunta.");
  let res;
  try {
    res = await fetch(config.url.replace(/\/+$/, "") + urlPath, {
      method,
      headers: {
        apikey: config.anonKey,
        // Las claves nuevas «sb_publishable_…» no son un JWT: solo van en `apikey`. Las antiguas («eyJ…») sí van también aquí.
        ...(auth ? { Authorization: `Bearer ${session.access_token}` } : /^eyJ/.test(config.anonKey) ? { Authorization: `Bearer ${config.anonKey}` } : {}),
        "Content-Type": "application/json",
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch { throw new Error("No se pudo conectar con el servidor de cuentas. Revisa tu conexión."); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* sin cuerpo JSON */ }
  if (res.status === 401 && auth && retry && session) { await refresh(); return request(method, urlPath, { body, headers, auth, retry: false }); }
  if (!res.ok) throw cloudError(res.status, data);
  return data;
}

// Petición sin JSON (Storage: subir y bajar archivos). Devuelve el Response; quien llama revisa res.ok.
async function raw(method, urlPath, { body, headers, retry = true, timeout = 120000 } = {}) {
  ensureLoaded();
  if (!configured()) throw new Error("El servidor de cuentas todavía no está configurado en esta versión de la app.");
  if (session && Date.now() / 1000 > session.expires_at - 60) await refresh();
  if (!session) throw new Error("Inicia sesión en tu cuenta NotXunta.");
  let res;
  try {
    res = await fetch(config.url.replace(/\/+$/, "") + urlPath, {
      method, body,
      headers: { apikey: config.anonKey, Authorization: `Bearer ${session.access_token}`, ...headers },
      signal: AbortSignal.timeout(timeout)
    });
  } catch { throw new Error("No se pudo conectar con el servidor de cuentas. Revisa tu conexión."); }
  if (res.status === 401 && retry && session) { await refresh(); return raw(method, urlPath, { body, headers, retry: false, timeout }); }
  return res;
}

let refreshing = null;
function refresh() {
  if (!session || !session.refresh_token) { clearSession(); return Promise.reject(new Error("La sesión ha caducado. Vuelve a entrar.")); }
  if (!refreshing) {
    refreshing = request("POST", "/auth/v1/token?grant_type=refresh_token", { auth: false, body: { refresh_token: session.refresh_token } })
      .then(setSession)
      .catch(e => { clearSession(); throw new Error("La sesión ha caducado. Vuelve a entrar."); })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// ------------------------------------------------------------------ registro / entrada
const checkCreds = (email, password) => {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Escribe un correo válido.");
  if (String(password || "").length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
  return email;
};

async function signUp(email, password) {
  email = checkCreds(email, password);
  const r = await request("POST", "/auth/v1/signup", { auth: false, body: { email, password } });
  if (r && r.access_token) { setSession(r); return { needsConfirmation: false }; }
  return { needsConfirmation: true };
}
async function signIn(email, password) {
  email = checkCreds(email, password);
  setSession(await request("POST", "/auth/v1/token?grant_type=password", { auth: false, body: { email, password } }));
}

const CALLBACK_PAGE = ok => `<!doctype html><meta charset="utf-8"><title>NotXunta Client</title>
<body style="font-family:Segoe UI,sans-serif;background:#15121d;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>${ok ? "¡Listo!" : "No se pudo iniciar sesión"}</h2>
<p>${ok ? "Ya puedes cerrar esta pestaña y volver a NotXunta Client." : "Vuelve a NotXunta Client e inténtalo de nuevo."}</p></div>`;

// Google / Discord / GitHub: se abre el navegador del sistema y se recibe el código en un puerto local (PKCE).
const PROVIDER_NAMES = { google: "Google", discord: "Discord", github: "GitHub" };
let oauthAbort = null;
function cancelOAuth() { if (oauthAbort) oauthAbort(new Error("Inicio de sesión cancelado.")); }

async function signInOAuth(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error("Método de inicio de sesión no válido.");
  if (!configured()) throw new Error("El servidor de cuentas todavía no está configurado en esta versión de la app.");
  cancelOAuth();
  if (oauthServer) { try { oauthServer.close(); } catch { /* ya cerrado */ } oauthServer = null; }
  // Antes de abrir el navegador: ¿está activado este proveedor en Supabase? (así el error sale aquí y no como un JSON en el navegador)
  try {
    const st = await request("GET", "/auth/v1/settings", { auth: false });
    if (st && st.external && st.external[provider] === false)
      throw new Error(`${PROVIDER_NAMES[provider]} no está activado en Supabase (Authentication → Providers → ${PROVIDER_NAMES[provider]}: actívalo y pega su Client ID y Secret).`);
  } catch (e) { if (/no está activado/.test(e.message)) throw e; /* si falla la consulta, se intenta igualmente */ }
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const redirect = `http://127.0.0.1:${OAUTH_PORT}/callback`;

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(new Error("Se agotó el tiempo para iniciar sesión.")); }, 180000);
    oauthAbort = e => { done(); reject(e); };
    const server = http.createServer((req, res) => {
      // Solo se atiende al navegador del propio equipo: el Host debe ser exactamente 127.0.0.1:puerto (frena el «DNS rebinding»)
      // y solo se admite GET. Cualquier otra cosa se descarta sin tocar el inicio de sesión en curso.
      let u;
      try { u = new URL(req.url, "http://127.0.0.1"); } catch { res.writeHead(400); res.end(); return; }
      if (req.headers.host !== `127.0.0.1:${OAUTH_PORT}` || req.method !== "GET" || u.pathname !== "/callback") { res.writeHead(404, { Connection: "close" }); res.end(); return; }
      const c = u.searchParams.get("code");
      if (!c && !u.searchParams.has("error") && !u.searchParams.has("error_description")) { res.writeHead(404, { Connection: "close" }); res.end(); return; }  // p. ej. /favicon o visitas sueltas
      if (c && !/^[\w.~-]{8,512}$/.test(c)) { res.writeHead(400, { Connection: "close" }); res.end(); return; }
      const err = u.searchParams.get("error_description") || u.searchParams.get("error");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Connection: "close",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"
      });
      res.end(CALLBACK_PAGE(!!c));
      done();
      if (c) resolve(c); else reject(new Error(err ? String(err).slice(0, 160) : "Inicio de sesión cancelado."));
    });
    oauthServer = server;
    function done() { clearTimeout(timer); oauthAbort = null; try { server.close(); server.closeAllConnections(); } catch { /* ya cerrado */ } if (oauthServer === server) oauthServer = null; }
    server.on("error", e => { clearTimeout(timer); oauthAbort = null; reject(new Error(e.code === "EADDRINUSE" ? `El puerto ${OAUTH_PORT} está ocupado. Cierra otras ventanas de inicio de sesión e inténtalo de nuevo.` : e.message)); });
    server.listen(OAUTH_PORT, "127.0.0.1", () => {
      const q = new URLSearchParams({ provider, redirect_to: redirect, code_challenge: challenge, code_challenge_method: "s256" });
      shell.openExternal(`${config.url.replace(/\/+$/, "")}/auth/v1/authorize?${q}`);
    });
  });
  setSession(await request("POST", "/auth/v1/token?grant_type=pkce", { auth: false, body: { auth_code: code, code_verifier: verifier } }));
}

async function signOut() {
  ensureLoaded();
  if (session && configured()) { try { await request("POST", "/auth/v1/logout", { retry: false }); } catch { /* da igual */ } }
  clearSession();
}

// ------------------------------------------------------------------ perfil
const cleanName = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);

// Niveles del esquema: 0 = base · 1 = con foto/ajustes (0.5.6) · 2 = con estado «en línea» y Archivos NotXunta (0.6.1).
// Si la base de datos aún no está al día, el perfil se carga con lo que haya en lugar de dejar toda la cuenta inutilizable.
let schemaLevel = 2;
async function loadProfile() {
  const base = `/rest/v1/profiles?id=eq.${session.user.id}&select=id,username,display_name,discoverable`;
  const tiers = [[`${base},avatar,show_online`, 2], [`${base},avatar`, 1], [base, 0]];
  let rows, lastErr;
  for (const [url, level] of tiers) {
    try { rows = await request("GET", url); schemaLevel = level; lastErr = null; break; }
    catch (e) { lastErr = e; if (!/Falta actualizar la base de datos/.test(e.message)) throw e; }
  }
  if (lastErr) throw lastErr;
  profile = (rows && rows[0]) || null;
  return profile;
}
async function status() {
  ensureLoaded();
  const base = { configured: configured(), signedIn: false, email: "", profile: null };
  if (!base.configured || !session) return base;
  if (profile === undefined) await loadProfile();
  return { ...base, signedIn: true, email: session.user.email, profile, schemaOutdated: schemaLevel < 1, presenceOutdated: schemaLevel < 2, schemaLevel };
}
async function createProfile({ username, display_name, discoverable }) {
  username = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error("El usuario solo puede tener letras minúsculas, números y _ (de 3 a 20 caracteres).");
  const rows = await request("POST", "/rest/v1/profiles", {
    headers: { Prefer: "return=representation" },
    body: { id: session.user.id, username, display_name: cleanName(display_name) || username, discoverable: discoverable !== false }
  });
  profile = (rows && rows[0]) || null;
  return profile;
}
async function updateProfile(patch) {
  if (patch.avatar !== undefined && schemaLevel < 1) throw new Error("Para usar foto de perfil falta ejecutar supabase/migration-0.5.6.sql en Supabase.");
  if (patch.show_online !== undefined && schemaLevel < 2) throw new Error("Para el estado «en línea» falta ejecutar supabase/migration-0.6.1.sql en Supabase.");
  const body = {};
  if (patch.display_name !== undefined) body.display_name = cleanName(patch.display_name);
  if (patch.discoverable !== undefined) body.discoverable = !!patch.discoverable;
  if (patch.show_online !== undefined) body.show_online = !!patch.show_online;
  if (patch.avatar !== undefined) {   // foto de perfil: imagen pequeña en data URL, o null para quitarla
    if (patch.avatar === null || patch.avatar === "") body.avatar = null;
    else if (typeof patch.avatar === "string" && patch.avatar.length <= 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(patch.avatar)) body.avatar = patch.avatar;
    else throw new Error("La foto no es válida o es demasiado grande.");
  }
  const rows = await request("PATCH", `/rest/v1/profiles?id=eq.${session.user.id}`, { headers: { Prefer: "return=representation" }, body });
  profile = (rows && rows[0]) || profile;
  if (body.discoverable === false) { await unlinkAll(); }
  if (body.show_online === false) { try { await rpc("go_offline"); } catch { /* se ocultará igualmente */ } }
  return profile;
}
async function deleteAccount() {
  await request("POST", "/rest/v1/rpc/delete_my_account", { body: {} });
  clearSession();
}

// ------------------------------------------------------------------ vínculos con aulas y amigos
async function linkMoodle(siteKey, moodleUserId, fullname) {
  if (!session || !profile || !profile.discoverable) return;
  const key = `${session.user.id}|${siteKey}|${moodleUserId}`;
  if (linked.has(key)) return;
  await request("POST", "/rest/v1/moodle_links?on_conflict=site_key,moodle_user_id", {
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { site_key: siteKey, moodle_user_id: Number(moodleUserId), user_id: session.user.id, fullname: cleanName(fullname) }
  });
  linked.add(key);
}
async function unlinkAll() {
  linked.clear();
  await request("DELETE", `/rest/v1/moodle_links?user_id=eq.${session.user.id}`, { headers: { Prefer: "return=minimal" } });
}
const rpc = (fn, args) => request("POST", `/rest/v1/rpc/${fn}`, { body: args || {} });
const removeFriendship = id => request("DELETE", `/rest/v1/friendships?id=eq.${Number(id)}`, { headers: { Prefer: "return=minimal" } });


// ------------------------------------------------------------------ estado «en línea»
// Cada ~45 s la app avisa de que sigue abierta. Los amigos te ven «en línea» si el último aviso tiene menos de 2 minutos.
async function heartbeat() {
  if (!session || !profile || schemaLevel < 2 || profile.show_online === false) return false;
  await rpc("heartbeat");
  return true;
}
async function goOffline() {
  if (!session || !profile || schemaLevel < 2) return;
  await rpc("go_offline");
}

module.exports = {
  rest: request, raw, heartbeat, goOffline, userId: () => { ensureLoaded(); return session ? session.user.id : null; },
  configured, status, signUp, signIn, signInOAuth, cancelOAuth, signOut,
  createProfile, updateProfile, deleteAccount, linkMoodle, unlinkAll, rpc, removeFriendship,
  isSignedIn: () => { ensureLoaded(); return !!session; }, invalidateProfile: () => { profile = undefined; },
  getProfile: () => profile, UUID
};
