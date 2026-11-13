"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { aiById } = require("./ai");

const DEFAULTS = {
  ai: null,               // IA elegida para el overlay (id) o null
  aiAsked: false,         // ya se mostró el selector de la primera vez
  overlayKey: "focus",    // focus | global-safe | global-shift-tab
  keepBackground: true,   // al cerrar la ventana, seguir en la bandeja
  bgSync: true,           // buscar novedades en segundo plano
  syncMinutes: 15,
  toasts: true,           // avisos estilo Steam
  msgNotify: true,        // avisar de mensajes nuevos (se comprueba cada minuto)
  autoUpdate: true,       // buscar e instalar actualizaciones automáticamente
  lastSeenVersion: "",   // última versión cuyo tablón de novedades ya se abrió
  videoCompat: false      // modo compatible del vídeo de fondo (sin decodificación por hardware; requiere reiniciar)
};
const OVERLAY_KEYS = ["focus", "global-safe", "global-shift-tab"];
const SYNC_CHOICES = [5, 15, 30, 60];

const file = () => path.join(app.getPath("userData"), "settings.json");
let cache = null;

function load() {
  if (cache) return cache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file(), "utf8")); } catch { /* primera vez */ }
  cache = sanitize({ ...DEFAULTS, ...raw });
  return cache;
}

function sanitize(s) {
  return {
    ai: aiById(s.ai) ? s.ai : null,
    aiAsked: !!s.aiAsked,
    overlayKey: OVERLAY_KEYS.includes(s.overlayKey) ? s.overlayKey : DEFAULTS.overlayKey,
    keepBackground: !!s.keepBackground,
    bgSync: !!s.bgSync,
    syncMinutes: SYNC_CHOICES.includes(Number(s.syncMinutes)) ? Number(s.syncMinutes) : DEFAULTS.syncMinutes,
    toasts: !!s.toasts,
    msgNotify: !!s.msgNotify,
    autoUpdate: s.autoUpdate !== false,
    videoCompat: !!s.videoCompat,
    lastSeenVersion: typeof s.lastSeenVersion === "string" ? s.lastSeenVersion.slice(0, 20) : ""
  };
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file());
  } catch { /* si no se puede guardar, se mantiene en memoria */ }
}

function get() { return { ...load() }; }

function set(patch) {
  const next = { ...load() };
  for (const k of Object.keys(DEFAULTS)) if (k in (patch || {})) next[k] = patch[k];
  cache = sanitize(next);
  save();
  return get();
}

module.exports = { get, set, DEFAULTS };
