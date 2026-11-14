"use strict";
// Utilidades para archivos descargados (apuntes del aula y «Archivos NotXunta»):
//  · carpeta de caché PRIVADA del usuario (nunca la carpeta temporal compartida del sistema),
//  · nombres de archivo seguros,
//  · lista de extensiones que NUNCA se abren automáticamente,
//  · marca «descargado de Internet» (Mark-of-the-Web) en Windows, para que Office/SmartScreen apliquen su protección.

const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Programas, scripts, accesos directos, instaladores, imágenes de disco y documentos de Office con macros.
const DANGEROUS = new RegExp("\\.(" + [
  // Windows: programas y scripts
  "exe", "bat", "cmd", "com", "msi", "msp", "mst", "scr", "ps1", "ps1xml", "ps2", "ps2xml", "psc1", "psc2", "psm1", "vbs", "vbe", "vb",
  "js", "jse", "wsf", "wsh", "ws", "wsc", "sct", "hta", "jar", "jnlp", "reg", "dll", "pif", "cpl", "inf", "gadget", "msc", "chm",
  "application", "appref-ms", "xbap", "appx", "appxbundle", "msix", "msixbundle", "appinstaller", "diagcab", "theme", "themepack",
  // Windows: accesos directos y carpetas «trampa»
  "lnk", "url", "scf", "library-ms", "search-ms", "settingcontent-ms", "website",
  // Imágenes de disco
  "iso", "img", "vhd", "vhdx", "dmg",
  // macOS
  "app", "command", "pkg", "workflow", "action", "scpt", "scptd", "terminal", "webloc", "inetloc",
  // Linux y otros lenguajes que se ejecutarían con el intérprete asociado
  "sh", "bash", "zsh", "run", "bin", "appimage", "deb", "rpm", "desktop", "py", "pyw", "pl", "rb", "php", "ade", "adp", "mde",
  // Office con macros
  "docm", "dotm", "xlsm", "xltm", "xlam", "xll", "wll", "pptm", "potm", "ppam", "ppsm", "sldm"
].join("|") + ")$", "i");

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function safeName(n, max = 120) {
  let s = path.basename(String(n || "archivo"))
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f‪-‮⁦-⁩​-‏]/g, "_")  // incluye los caracteres que invierten el texto (disfrazan extensiones)
    .replace(/[. ]+$/, "")                                                                    // Windows ignora puntos y espacios finales
    .replace(/^\.+/, "_");
  if (RESERVED.test(s)) s = "_" + s;
  return s.slice(0, max) || "archivo";
}

// Caché en la carpeta de datos del usuario (permisos solo suyos). En /tmp (Linux) otro usuario del equipo podría
// crear antes esa carpeta o un enlace simbólico y redirigir lo que se descarga.
const cacheRoot = () => path.join(app.getPath("userData"), "cache");
const docsDir = () => path.join(cacheRoot(), "docs");

async function ensurePrivateDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await fs.promises.lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Carpeta de caché no válida.");
}

// Windows (NTFS): ZoneId=3 = «zona Internet». Office abre el archivo en Vista protegida y SmartScreen lo comprueba.
async function markWeb(file, hostUrl = "") {
  if (process.platform !== "win32") return;
  try {
    const host = /^https?:\/\/[^\s]{1,300}$/.test(hostUrl) ? hostUrl : "about:internet";
    await fs.promises.writeFile(`${file}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${host}\r\n`);
  } catch { /* sistema de archivos sin flujos alternativos: se sigue sin la marca */ }
}

module.exports = { DANGEROUS, safeName, cacheRoot, docsDir, ensurePrivateDir, markWeb };
