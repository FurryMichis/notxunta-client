"use strict";
// Actualizaciones automáticas (electron-updater). Solo funcionan en la app instalada:
//  · Windows (instalador) y Linux (AppImage): comprueba al arrancar y cada 6 horas, descarga en segundo plano e instala al cerrar.
//  · macOS y Linux .deb: solo AVISA de la versión nueva y abre la página de descarga (en Mac instalar solo exige una app firmada
//    con cuenta de Apple Developer; sin ella la instalación automática falla).

const { app } = require("electron");

let autoUpdater = null, deps = null, timer = null;
let status = { state: "idle", version: "", message: "", percent: 0 };

const supported = () => app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR; // la versión portable no se actualiza sola
const manualOnly = () => process.platform === "darwin" || (process.platform === "linux" && !process.env.APPIMAGE);
const set = patch => { status = { ...status, ...patch }; if (deps && deps.onStatus) deps.onStatus(status); };

function init(d) {
  deps = d;
  if (!supported()) { set({ state: "unsupported", message: app.isPackaged ? "La versión portable no se actualiza sola: descarga la nueva." : "Las actualizaciones solo funcionan en la app instalada." }); return; }
  try { ({ autoUpdater } = require("electron-updater")); }
  catch { set({ state: "unsupported", message: "Falta el módulo de actualizaciones." }); return; }

  autoUpdater.autoDownload = !manualOnly();
  autoUpdater.autoInstallOnAppQuit = !manualOnly();
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => set({ state: "checking", message: "Buscando actualizaciones…" }));
  autoUpdater.on("update-not-available", () => set({ state: "uptodate", message: `Estás al día (v${app.getVersion()}).` }));
  autoUpdater.on("update-available", info => {
    if (manualOnly()) {
      set({ state: "available", version: info.version, percent: 0, message: `Hay una versión nueva: ${info.version}. Descárgala desde la página de versiones.` });
      deps.notify("Nueva versión disponible", `NotXunta Client ${info.version}: pulsa para abrir la página de descarga.`, "releases");
      return;
    }
    set({ state: "downloading", version: info.version, percent: 0, message: `Descargando la versión ${info.version}…` });
    deps.notify("Actualización disponible", `Descargando NotXunta Client ${info.version} en segundo plano.`, "app");
  });
  autoUpdater.on("download-progress", p => set({ state: "downloading", percent: Math.round(p.percent || 0), message: `Descargando la versión ${status.version}… ${Math.round(p.percent || 0)} %` }));
  autoUpdater.on("update-downloaded", info => {
    set({ state: "ready", version: info.version, percent: 100, message: `La versión ${info.version} está lista.` });
    deps.notify("Actualización lista", `NotXunta Client ${info.version}: pulsa para reiniciar e instalar (o se instalará al cerrar).`, "update");
  });
  autoUpdater.on("error", e => set({ state: "error", message: `No se pudo comprobar: ${(e && e.message || "error").split("\n")[0].slice(0, 160)}` }));
}

function check({ manual = false } = {}) {
  if (!autoUpdater) return Promise.resolve(status);
  if (status.state === "downloading" || status.state === "ready") return Promise.resolve(status);
  if (!manual && !deps.enabled()) return Promise.resolve(status);
  return autoUpdater.checkForUpdates().then(() => status).catch(() => status); // el error ya llega por el evento "error"
}

// firstDelayMs = null → no se hace la comprobación inicial (ya se hizo en la pantalla de inicio).
function schedule(firstDelayMs = 20000) {
  clearInterval(timer);
  if (!autoUpdater) return;
  if (firstDelayMs != null) setTimeout(() => check(), firstDelayMs);
  timer = setInterval(() => check(), 6 * 3600 * 1000);
}

// Comprobación al arrancar, con la pantalla de inicio delante. Resuelve con:
//   "skip"      no se comprueba (desactivado, portable o sin instalar)
//   "none"      estás al día
//   "ready"     hay versión nueva ya descargada (hay que instalarla)
//   "error" / "timeout"   no se pudo comprobar (sin conexión…): se abre la app igualmente
//   "available" hay versión nueva pero hay que descargarla a mano (macOS / Linux .deb)
//   "skipped"   el usuario ha pulsado «Continuar sin actualizar» durante la descarga (sigue en segundo plano)
// onProgress({ text, percent, canSkip }) va actualizando el texto de la pantalla de inicio.
function startupCheck(onProgress, { timeoutMs = 10000 } = {}) {
  return new Promise(resolve => {
    if (!autoUpdater || !deps.enabled()) { resolve("skip"); return; }
    let done = false, checkTimer = null;
    const handlers = {};
    const off = () => { for (const [ev, fn] of Object.entries(handlers)) autoUpdater.removeListener(ev, fn); };
    const finish = r => { if (done) return; done = true; clearTimeout(checkTimer); off(); resolve(r); };
    const on = (ev, fn) => { handlers[ev] = fn; autoUpdater.on(ev, fn); };

    on("update-not-available", () => finish("none"));
    on("error", () => finish("error"));
    on("update-available", info => {
      if (manualOnly()) { finish("available"); return; }   // en Mac / .deb no se descarga: solo se avisa
      clearTimeout(checkTimer);   // la descarga puede tardar: ya no corre el límite de la comprobación
      onProgress({ text: `Descargando la versión ${info.version}…`, percent: 0, canSkip: true });
    });
    on("download-progress", p => onProgress({ text: `Descargando la versión ${status.version}… ${Math.round(p.percent || 0)} %`, percent: Math.round(p.percent || 0), canSkip: true }));
    on("update-downloaded", () => finish("ready"));

    checkTimer = setTimeout(() => finish("timeout"), timeoutMs);
    onProgress({ text: "Buscando actualizaciones…", percent: -1, canSkip: false });
    autoUpdater.checkForUpdates().catch(() => finish("error"));
    startupSkip = () => finish("skipped");
  });
}
let startupSkip = null;
const skipStartup = () => { if (startupSkip) startupSkip(); };

// Instala ya (en silencio) y reabre la app.
function installSilently() {
  if (!autoUpdater) return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

function installNow() {
  if (!autoUpdater || status.state !== "ready") return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

module.exports = { init, check, schedule, installNow, startupCheck, skipStartup, installSilently, getStatus: () => status };
