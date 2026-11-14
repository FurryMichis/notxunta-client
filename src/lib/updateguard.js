"use strict";
// Freno contra bucles de actualización. Si la app se reinicia para instalar la versión X y al volver a abrir sigue siendo
// una versión anterior (el instalador publicado no coincide con lo que anuncia latest.yml, o la instalación falló), sin este
// freno volvería a descargar y reinstalar X una y otra vez al arrancar. Con él solo se intenta una vez cada 24 horas.

const fs = require("node:fs");
const path = require("node:path");

const WINDOW_MS = 24 * 3600 * 1000;
const file = dir => path.join(dir, "update-attempt.json");

function vcmp(a, b) { // compara versiones tipo 0.6.4 (devuelve <0, 0, >0)
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0), pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
function read(dir) { try { const a = JSON.parse(fs.readFileSync(file(dir), "utf8")); return a && typeof a.version === "string" ? a : null; } catch { return null; } }
function clear(dir) { try { fs.rmSync(file(dir), { force: true }); } catch { /* ya no existe */ } }

// Se llama justo antes de reiniciar para instalar.
function record(dir, version, now = Date.now()) {
  try { fs.writeFileSync(file(dir), JSON.stringify({ version: String(version), at: now })); } catch { /* sin freno si no se puede escribir */ }
}

// Se llama al arrancar. blocked = true → no se vuelve a instalar automáticamente (la última vez no funcionó).
function evaluate(dir, currentVersion, now = Date.now()) {
  const a = read(dir);
  if (!a) return { blocked: false };
  if (vcmp(currentVersion, a.version) >= 0) { clear(dir); return { blocked: false, installed: true, version: a.version }; } // se instaló bien
  if (now - Number(a.at || 0) < WINDOW_MS) return { blocked: true, failedVersion: a.version };
  clear(dir);                                                                                                                  // hace más de 24 h: se permite reintentar
  return { blocked: false };
}

module.exports = { vcmp, record, evaluate, clear };
