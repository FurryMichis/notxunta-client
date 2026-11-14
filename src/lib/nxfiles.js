"use strict";
// «Archivos NotXunta»: archivos privados guardados en tu cuenta NotXunta (Supabase Storage, bucket privado «nx-files»).
// Se ven desde cualquier ordenador donde inicies sesión. Cada cuenta solo puede tocar su propia carpeta (reglas en
// supabase/migration-0.6.1.sql). Los límites (por archivo y por cuenta) los marca el servidor y la app solo los lee.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const cloud = require("./cloud");

const BUCKET = "nx-files";
const MAX_AT_ONCE = 20;
const MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", mp3: "audio/mpeg", mp4: "video/mp4"
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanName = n => path.basename(String(n || "archivo")).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim().slice(0, 180) || "archivo";
const mimeOf = name => MIME[path.extname(name).slice(1).toLowerCase()] || "application/octet-stream";
const mb = n => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const tempDir = () => path.join(os.tmpdir(), "notxunta-client-docs", "nx"); // la limpieza de apuntes antiguos también barre esto

async function storageError(res) {
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  const msg = String((data && (data.message || data.error)) || "");
  if (res.status === 413 || /exceeded the maximum|too large|payload/i.test(msg)) return new Error("El archivo supera el tamaño máximo permitido.");
  if (res.status === 401 || res.status === 403 || /row-level security|violates/i.test(msg)) return new Error("No se pudo guardar: has alcanzado tu límite de espacio o tu sesión no es válida.");
  if (res.status === 404 && /bucket/i.test(msg)) return new Error("Falta preparar el servidor: ejecuta supabase/migration-0.6.1.sql en el SQL Editor de Supabase.");
  return new Error(msg ? msg.slice(0, 160) : `Error del servidor (${res.status}).`);
}

const first = r => (Array.isArray(r) ? r[0] : r) || {};

async function overview() {
  const [usage, files] = await Promise.all([cloud.rpc("nx_files_usage"), cloud.rpc("nx_files_list")]);
  const u = first(usage);
  return {
    usage: { used: Number(u.used) || 0, quota: Number(u.quota) || 0, maxFile: Number(u.max_file) || 0 },
    files: (files || []).map(f => ({ id: f.id, name: f.name, mime: f.mime || "", size: Number(f.size) || 0, createdAt: f.created_at }))
  };
}

// Sube varios archivos (rutas locales). Devuelve { uploaded, errors[] }; un fallo no detiene los demás.
async function uploadMany(paths) {
  const { usage } = await overview();
  const out = { uploaded: 0, errors: [] };
  for (const file of paths.slice(0, MAX_AT_ONCE)) {
    const name = cleanName(path.basename(file));
    try {
      const st = await fs.promises.stat(file);
      if (!st.isFile()) throw new Error("no es un archivo");
      if (st.size === 0) throw new Error("está vacío");
      if (usage.maxFile && st.size > usage.maxFile) throw new Error(`pesa demasiado (máximo ${mb(usage.maxFile)} por archivo)`);
      if (usage.quota && usage.used + st.size > usage.quota) throw new Error(`no cabe (te quedan ${mb(Math.max(0, usage.quota - usage.used))})`);
      const id = crypto.randomUUID(), uid = cloud.userId(), mime = mimeOf(name);
      // Primero el nombre (la regla de espacio se comprueba aquí) y luego el contenido; si el contenido falla, se quita el nombre.
      await cloud.rest("POST", "/rest/v1/nx_files", { headers: { Prefer: "return=minimal" }, body: { id, user_id: uid, name, mime } });
      try {
        const res = await cloud.raw("POST", `/storage/v1/object/${BUCKET}/${uid}/${id}`, {
          body: await fs.promises.readFile(file), timeout: 300000,
          headers: { "Content-Type": mime, "x-upsert": "false", "Cache-Control": "max-age=3600" }
        });
        if (!res.ok) throw await storageError(res);
      } catch (e) {
        await cloud.rest("DELETE", `/rest/v1/nx_files?id=eq.${id}`, { headers: { Prefer: "return=minimal" } }).catch(() => {});
        throw e;
      }
      usage.used += st.size;
      out.uploaded++;
    } catch (e) { out.errors.push(`${name}: ${e.message}`); }
  }
  return out;
}

async function downloadTo(id, target) {
  if (!UUID.test(String(id))) throw new Error("Archivo no válido.");
  const res = await cloud.raw("GET", `/storage/v1/object/authenticated/${BUCKET}/${cloud.userId()}/${id}`, { timeout: 300000 });
  if (!res.ok) throw res.status === 404 ? new Error("El archivo ya no existe en el servidor.") : await storageError(res);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + ".part";
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp)); // en disco según llega
  await fs.promises.rename(tmp, target);
  return target;
}

// Descarga a la carpeta temporal (los archivos nunca cambian de contenido, así que se reutilizan).
async function download(id, name) {
  if (!UUID.test(String(id))) throw new Error("Archivo no válido.");
  const target = path.join(tempDir(), String(id), cleanName(name));
  try { if ((await fs.promises.stat(target)).size > 0) return target; } catch { /* aún no está */ }
  return downloadTo(id, target);
}

async function remove(id) {
  if (!UUID.test(String(id))) throw new Error("Archivo no válido.");
  const res = await cloud.raw("DELETE", `/storage/v1/object/${BUCKET}/${cloud.userId()}/${id}`);
  if (!res.ok && res.status !== 404) throw await storageError(res);
  await cloud.rest("DELETE", `/rest/v1/nx_files?id=eq.${id}`, { headers: { Prefer: "return=minimal" } });
  fs.promises.rm(path.join(tempDir(), String(id)), { recursive: true, force: true }).catch(() => {});
  return true;
}

// Antes de borrar la cuenta: el Storage no se borra en cascada, así que se vacía a mano.
async function purgeAll() {
  const { files } = await overview();
  for (const f of files) { try { await remove(f.id); } catch { /* se sigue con el resto */ } }
}

module.exports = { overview, uploadMany, download, downloadTo, remove, purgeAll, cleanName };
