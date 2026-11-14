"use strict";
// Interfaz. Todo el contenido que viene del aula se inserta con textContent
// (helper h), nunca con innerHTML, para que un curso no pueda inyectar código.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const aula = window.notxuntaClient;
const IS_MAC = aula.platform === "darwin" || /Mac/i.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";   // tecla modificadora que se muestra en los textos

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clear = el => { el.textContent = ""; return el; };

async function api(fn, ...args) {
  const r = await aula[fn](...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

// ------------------------------------------------------------------ utilidades UI
const toastEl = $("#toast");
let toastTimer;
function notify(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

function showLoading(text) { $("#loading-text").textContent = text; $("#loading").hidden = false; }
function hideLoading() { $("#loading").hidden = true; }
aula.onProgress(msg => { $("#loading-text").textContent = msg; });

const fmtDate = ts => ts
  ? new Date(ts * 1000).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  : "";
const fmtDay = ts => new Date(ts * 1000).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
const fmtSize = n => !n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
// Icono de instancia: emoji/símbolo (texto) o imagen (data URL).
function paintIcon(el, icon, fallback = "M") {
  el.textContent = ""; el.style.backgroundImage = ""; el.classList.remove("has-img");
  if (typeof icon === "string" && icon.startsWith("data:image/")) { el.style.backgroundImage = `url("${icon}")`; el.classList.add("has-img"); }
  else el.textContent = icon || fallback;
  return el;
}
const initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

// Carga una imagen del aula (con token, desde el proceso principal) y la pone como fondo.
function loadImage(el, url, setter) {
  if (!url || !state.accountId) return;
  api("image", state.accountId, url).then(data => setter(el, data)).catch(() => {});
}
function avatar(url, name, cls = "") {
  const el = h("div", { class: `pic ${cls}`, text: initials(name) });
  loadImage(el, url, (e, data) => { e.style.backgroundImage = `url("${data}")`; e.textContent = ""; e.classList.add("has-img"); });
  return el;
}

function chip(text, kind) { return h("span", { class: `chip ${kind || ""}`, text }); }
function empty(icon, title, text) {
  return h("div", { class: "empty-panel" }, h("div", { class: "empty-icon", text: icon }), h("h2", { text: title }), text && h("p", { text }));
}
function pageTitle(eyebrow, title, sub) {
  return h("div", { class: "page-title" }, h("div", { class: "eyebrow", text: eyebrow }), h("h1", { text: title }), sub && h("p", { text: sub }));
}
const plainText = html => new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.trim();

// ------------------------------------------------------------------ estado
const state = {
  account: null, accountId: null, data: null, unseen: new Set(),
  view: "courses", courseId: null, sectionId: null, convId: null
};
const courseById = id => state.data.courses.find(c => c.id === id);

// Contador de mensajes sin leer junto a «Mensajes» en la barra lateral.
function setUnread(n) {
  state.unreadMsgs = Math.max(0, Number(n) || 0);
  const b = $("#badge-messages");
  b.textContent = state.unreadMsgs > 99 ? "99+" : String(state.unreadMsgs);
  b.hidden = state.unreadMsgs === 0;
}

// ------------------------------------------------------------------ lanzador
const accountDialog = $("#account-dialog");
const accountForm = $("#account-form");
const crumb = $("#crumb");

function showAccountError(msg) {
  const el = $("#account-error");
  el.textContent = msg || "";
  el.hidden = !msg;
}
function openAccountDialog() { accountForm.reset(); showAccountError(""); accountDialog.showModal(); }
function closeAccountDialog() { accountForm.reset(); accountDialog.close(); }

$("#cancel-account").addEventListener("click", closeAccountDialog);
$("#account-dialog .close").addEventListener("click", closeAccountDialog);
accountDialog.addEventListener("click", e => { if (e.target === accountDialog) closeAccountDialog(); });
$("#add-account").addEventListener("click", openAccountDialog);

accountForm.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#save-account");
  btn.disabled = true; btn.textContent = "Conectando…"; showAccountError("");
  try {
    await api("addAccount", {
      name: $("#instance-name").value,
      url: $("#instance-url").value,
      username: $("#instance-user").value,
      password: $("#instance-password").value
    });
    closeAccountDialog();
    notify("Cuenta guardada.");
    await renderAccounts();
  } catch (err) {
    showAccountError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Conectar y guardar";
  }
});

$$(".nav[data-view]").forEach(btn => btn.addEventListener("click", () => {
  $$(".nav[data-view]").forEach(n => n.classList.remove("active"));
  $$("#launcher-shell .view").forEach(v => v.classList.remove("active"));
  btn.classList.add("active");
  $(`#${btn.dataset.view}-view`).classList.add("active");
  const label = btn.cloneNode(true); label.querySelector(".nav-badge")?.remove();
  crumb.textContent = label.textContent.trim().replace(/^\S+\s+/, "").toUpperCase();
  if (btn.dataset.view === "cloud") renderCloud($("#cloud-view")).catch(e => notify(e.message));
  if (btn.dataset.view === "nxfiles") renderNxFiles($("#nxfiles-view")).catch(e => notify(e.message));
  if (btn.dataset.view === "news") renderNews($("#news-view")).catch(e => notify(e.message));
  if (btn.dataset.view === "appearance") renderAppearance($("#appearance-view"));
  if (btn.dataset.view === "settings") renderSettings($("#settings-view")).catch(e => notify(e.message));
}));

async function removeAccount(acc) {
  if (!confirm(`¿Eliminar "${acc.name}"? Se borrarán la contraseña guardada y los datos locales.`)) return;
  try { await api("removeAccount", acc.id); await renderAccounts(); notify("Cuenta eliminada."); }
  catch (e) { notify(e.message); }
}

async function renderAccounts() {
  let list = [];
  try { list = await api("listAccounts"); } catch (e) { notify(e.message); }
  const grid = clear($("#account-grid"));
  for (const acc of list) {
    let host = acc.url;
    try { host = new URL(acc.url).host; } catch { /* se muestra tal cual */ }
    grid.append(h("article", { class: "account-card" },
      h("div", { class: "card-top" }, paintIcon(h("button", { class: "moodle-icon editable", title: "Cambiar icono", "aria-label": "Cambiar icono", onclick: () => openIconDialog(acc) }), acc.icon), h("span", { class: "tag", text: "MOODLE" })),
      h("h3", { text: acc.name }),
      h("p", { class: "muted", text: `Usuario: ${acc.username}` }),
      h("div", { class: "account-meta" }, h("span", { text: "◉" }), host),
      h("button", { class: acc.needsPassword ? "primary" : "secondary", onclick: () => openInstance(acc) },
        acc.needsPassword ? "Introducir contraseña " : "Abrir instancia ", h("span", { text: acc.needsPassword ? "🔑" : "↗" }))
    ));
  }
  grid.append(h("button", { class: "add-card", onclick: openAccountDialog },
    h("span", { text: "＋" }), h("b", { text: "Añadir cuenta" }), h("small", { text: "Conecta un aula Moodle" })));

  const il = clear($("#instance-list"));
  if (!list.length) {
    il.append(h("div", { class: "empty-panel" }, h("div", { class: "empty-icon", text: "◈" }),
      h("h2", { text: "Aún no hay instancias conectadas" }), h("p", { text: "Añade una cuenta para crear tu primera instancia Moodle." }),
      h("button", { class: "primary", onclick: openAccountDialog, text: "＋ Añadir instancia" })));
  } else {
    for (const acc of list) {
      il.append(h("div", { class: "list-row" },
        h("div", { class: "row-main" }, paintIcon(h("span", { class: "moodle-icon sm" }), acc.icon),
          h("div", {}, h("b", { text: acc.name }), h("div", { class: "muted", text: `${acc.url} · ${acc.username}` }))),
        h("div", { class: "row-actions" },
          h("button", { class: "secondary small", onclick: () => openIconDialog(acc), text: "Icono" }),
          h("button", { class: "secondary small", onclick: () => openInstance(acc), text: acc.needsPassword ? "Contraseña" : "Abrir" }),
          h("button", { class: "secondary small danger", onclick: () => removeAccount(acc), text: "Eliminar" }))));
    }
  }
}

// ------------------------------------------------------------------ apariencia (fondos)
const BACKGROUNDS = [
  ["none", "Sólido"], ["nebula", "Nebulosa"], ["sunset", "Atardecer"],
  ["aurora", "Aurora ✦ animado"], ["vivid", "Degradado vivo ✦ animado"], ["galaxy", "Galaxia ✦ animado"],
  ["image", "Imagen propia"], ["video", "Vídeo propio"]
];
const ACCENTS = ["#9b72f2", "#579bfa", "#4ccfc3", "#ed78b8", "#f0985a", "#6fd67c"];
const DEFAULTS = { bg: "none", dim: 30, image: "", video: "", accent: "#9b72f2", zoom: 100, sound: true, volume: 60 };
const STORE_KEY = "nx-appearance";
let look = { ...DEFAULTS };
try { look = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { /* sin almacenamiento */ }

function saveLookLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(look)); return true; }
  catch { notify("No se pudo guardar (la imagen es demasiado grande)."); return false; }
}
// Guarda y avisa al proceso principal para que suba el aspecto a la cuenta NotXunta (si hay sesión iniciada).
function saveLook() {
  const ok = saveLookLocal();
  if (ok) aula.syncLook(look, true).catch(() => {});
  return ok;
}
aula.syncLook(look, false).catch(() => {}); // aspecto actual (sin cambios): lo usa la sincronización al arrancar

let starRaf = 0, starResize = null;
function stopStars() {
  cancelAnimationFrame(starRaf); starRaf = 0;
  if (starResize) { removeEventListener("resize", starResize); starResize = null; }
}
function startStars() {
  if (starRaf || starResize) return;
  const cv = $("#bg-canvas"), ctx = cv.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stars = [], shoot = null, nextShoot = performance.now() + 3000;
  const resize = () => {
    cv.width = innerWidth; cv.height = innerHeight;
    stars = Array.from({ length: Math.round(cv.width * cv.height / 5500) }, () => ({
      x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 1.4 + 0.3,
      p: Math.random() * 6.28, s: Math.random() * 0.03 + 0.005, v: Math.random() * 0.18 + 0.02,
      c: Math.random() < 0.2 ? "190,170,255" : Math.random() < 0.15 ? "150,200,255" : "255,255,255"
    }));
  };
  starResize = resize; addEventListener("resize", resize); resize();
  const frame = t => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const st of stars) {
      st.p += st.s; if (!still) st.x -= st.v; if (st.x < -2) st.x = cv.width + 2;
      ctx.fillStyle = `rgba(${st.c},${0.55 + 0.45 * Math.sin(st.p)})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
    }
    if (!still) {
      if (!shoot && t > nextShoot) {
        shoot = { x: Math.random() * cv.width * 0.8 + cv.width * 0.2, y: Math.random() * cv.height * 0.4, life: 0 };
        nextShoot = t + 4000 + Math.random() * 7000;
      }
      if (shoot) {
        const len = 140, k = shoot.life / 40;
        const x = shoot.x - shoot.life * 9, y = shoot.y + shoot.life * 4.5;
        const g = ctx.createLinearGradient(x, y, x + len, y - len / 2);
        g.addColorStop(0, `rgba(255,255,255,${1 - k})`); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y - len / 2); ctx.stroke();
        if (++shoot.life > 40) shoot = null;
      }
      starRaf = requestAnimationFrame(frame);
    }
  };
  starRaf = requestAnimationFrame(frame);
}

// Vídeo de fondo: en bucle, con sonido (se puede silenciar) y en pausa si la ventana no se ve.
// Ya no se respeta "reducir movimiento" de Windows para el vídeo: con las animaciones del sistema
// desactivadas (habitual en PCs modestos o de centros) el vídeo no arrancaba nunca.
const vid = $("#bg-video");
let videoName = "", videoFailed = "", needGesture = false;
const VIDEO_HINTS = {
  codec: "No se puede reproducir este vídeo en este PC (códec no admitido, p. ej. H.265/HEVC, o el archivo ya no existe). Usa MP4 H.264 o WebM, o vuelve a elegirlo.",
  decode: "Fallo al decodificar el vídeo en este PC. Activa el «modo compatible» en Apariencia o Ajustes y reinicia.",
  other: "No se pudo reproducir el vídeo de fondo. Vuelve a elegirlo o activa el «modo compatible» en Ajustes."
};

function applySound() {
  vid.muted = !look.sound || needGesture;
  vid.volume = Math.min(1, Math.max(0, look.volume / 100));
}
async function playVideo() {
  if (document.hidden || !vid.getAttribute("src")) return;
  applySound();
  try { await vid.play(); }
  catch (e) {
    if (e && e.name === "NotAllowedError" && !vid.muted) { // el sistema exige un clic antes de dejar sonar
      needGesture = true; applySound();
      try { await vid.play(); } catch { /* lo avisa el evento "error" */ }
    }
  }
}
async function syncVideo() {
  if (look.bg !== "video" || !look.video) {
    if (videoName) { vid.pause(); vid.removeAttribute("src"); vid.load(); videoName = ""; videoFailed = ""; }
    updateSoundUi();
    return;
  }
  if (videoName === look.video) { playVideo(); updateSoundUi(); return; }
  videoName = look.video; videoFailed = "";
  try {
    const url = await api("videoUrl", look.video);
    if (!url) throw new Error("vídeo no encontrado");
    vid.src = url;
    await playVideo();
  } catch { /* el evento "error" avisa */ }
  updateSoundUi();
}
vid.addEventListener("error", () => {
  if (!vid.getAttribute("src")) return;
  const code = vid.error ? vid.error.code : 0;
  videoFailed = code === 4 ? "codec" : code === 3 ? "decode" : "other";
  notify(VIDEO_HINTS[videoFailed]);
  refreshAppearance();
});
vid.addEventListener("loadeddata", () => { if (videoFailed) { videoFailed = ""; refreshAppearance(); } });
document.addEventListener("visibilitychange", () => {
  if (look.bg !== "video" || !vid.getAttribute("src")) return;
  if (document.hidden) vid.pause(); else playVideo();
});
// Si el sistema pidió un clic para dejar sonar, el primer gesto activa el sonido.
const unlockSound = () => { if (needGesture) { needGesture = false; applySound(); } };
addEventListener("pointerdown", unlockSound, true);
addEventListener("keydown", unlockSound, true);

function toggleSound() {
  look.sound = !look.sound;
  if (look.sound) needGesture = false;
  saveLook(); applySound(); playVideo(); updateSoundUi(); refreshAppearance();
}
function updateSoundUi() {
  const show = look.bg === "video" && !!look.video;
  $$(".sound-ctl").forEach(ctl => {
    ctl.hidden = !show;
    const b = ctl.firstElementChild;
    if (!b) return;
    b.textContent = look.sound ? "🔊" : "🔇";
    b.title = look.sound ? "Silenciar el vídeo de fondo" : "Activar el sonido del vídeo de fondo";
    b.setAttribute("aria-label", b.title);
  });
}
function refreshAppearance() { // vuelve a pintar la pantalla de Apariencia si está a la vista
  for (const el of $$("#appearance-view.active, #iv-appearance.active")) renderAppearance(el);
}

function applyLook() {
  const noMedia = (look.bg === "image" && !look.image) || (look.bg === "video" && !look.video);
  $("#bg-layer").dataset.bg = noMedia ? "none" : look.bg;
  syncVideo();
  applySound();
  $("#bg-art").style.backgroundImage = look.bg === "image" && look.image ? `url("${look.image}")` : "";
  $("#bg-dim").style.opacity = String(look.dim / 100);
  document.documentElement.style.setProperty("--accent", look.accent);
  if (look.bg === "galaxy") startStars(); else stopStars();
}

function readBackground(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Elige un archivo de imagen."));
    if (file.type === "image/gif" && file.size > 3.5e6) return reject(new Error("El GIF es demasiado grande (máximo 3,5 MB)."));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("No se pudo leer el archivo."));
    fr.onload = () => {
      if (file.type === "image/gif") return resolve(fr.result); // se conserva la animación
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo abrir la imagen."));
      img.onload = () => {
        const k = Math.min(1, 1920 / img.width), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", 0.85));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function soundPanel() {
  const cb = h("input", { type: "checkbox" }); cb.checked = look.sound;
  cb.addEventListener("change", () => { look.sound = cb.checked; if (look.sound) needGesture = false; saveLook(); applySound(); playVideo(); updateSoundUi(); });
  const volLabel = h("b", { text: `${look.volume}%` });
  const vol = h("input", { type: "range", min: "0", max: "100", step: "5", value: String(look.volume) });
  vol.addEventListener("input", () => { look.volume = Number(vol.value); volLabel.textContent = `${look.volume}%`; applySound(); });
  vol.addEventListener("change", saveLook);
  return h("div", { class: "settings-panel" }, h("h2", {}, "Sonido del vídeo ", volLabel),
    h("label", { class: "switch-row" }, h("span", {}, h("b", { text: "Reproducir con sonido" }),
      h("small", { text: "También con el botón 🔊 de la barra superior. Si no pulsas nada y el sistema bloquea el sonido, se activa en tu primer clic." })), cb),
    vol);
}

// Si el vídeo no se ve en un PC: modo compatible (sin decodificación por hardware), que se aplica al reiniciar.
function compatPanel() {
  const box = h("div", { class: "settings-panel wide" }, h("h2", { text: "¿El vídeo no se ve en este PC?" }),
    h("p", { text: "Algunos PCs no pueden decodificar ciertos vídeos por hardware (o el vídeo está en H.265/HEVC). Prueba el modo compatible o convierte el vídeo a MP4 H.264." }));
  if (videoFailed) box.append(h("div", { class: "video-warn", text: VIDEO_HINTS[videoFailed] }));
  api("getSettings").then(({ settings: st }) => {
    box.append(h("div", { class: "zoom-row" },
      h("button", { class: "secondary small", text: st.videoCompat ? "Desactivar el modo compatible y reiniciar" : "Activar el modo compatible y reiniciar", onclick: async () => {
        try { await api("setSettings", { videoCompat: !st.videoCompat }); await api("relaunch"); } catch (e) { notify(e.message); }
      } })));
  }).catch(() => {});
  return box;
}

function renderAppearance(root) {
  clear(root);
  root.append(pageTitle("PERSONALIZACIÓN", "Apariencia", "Elige un fondo (imagen, GIF o vídeo), el tamaño de la interfaz y el color principal de NotXunta Client."));

  const fileInput = h("input", { type: "file", accept: "image/*", hidden: "" });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0]; fileInput.value = "";
    if (!f) return;
    try {
      look.image = await readBackground(f); look.bg = "image";
      if (saveLook()) { applyLook(); renderAppearance(root); notify("Fondo cambiado."); }
    } catch (e) { notify(e.message); }
  });

  const tiles = h("div", { class: "bg-grid" });
  for (const [id, label] of BACKGROUNDS) {
    const prev = h("div", { class: `bg-prev prev-${id}` });
    if (id === "image" && look.image) prev.style.backgroundImage = `url("${look.image}")`;
    tiles.append(h("button", { class: `bg-tile ${look.bg === id ? "selected" : ""}`, onclick: async () => {
      if (id === "image") { fileInput.click(); return; }
      if (id === "video") {
        if (look.video && look.bg !== "video") { look.bg = "video"; saveLook(); applyLook(); renderAppearance(root); return; }
        showLoading("Copiando el vídeo…");
        try {
          const r = await api("pickVideo");
          if (r) { look.video = r.file; look.bg = "video"; if (saveLook()) { applyLook(); renderAppearance(root); notify("Vídeo de fondo cambiado."); } }
        } catch (e) { notify(e.message); }
        finally { hideLoading(); }
        return;
      }
      look.bg = id; saveLook(); applyLook(); renderAppearance(root);
    } }, prev, h("span", { text: id === "image" && look.image ? "Imagen propia ✓ (cambiar)" : id === "video" && look.video && look.bg === "video" ? "Vídeo propio ✓ (cambiar)" : label })));
  }

  const dim = h("input", { type: "range", min: "0", max: "85", value: String(look.dim) });
  const dimLabel = h("b", { text: `${look.dim}%` });
  dim.addEventListener("input", () => { look.dim = Number(dim.value); dimLabel.textContent = `${look.dim}%`; applyLook(); });
  dim.addEventListener("change", saveLook);

  const swatches = h("div", { class: "swatches" });
  for (const c of ACCENTS) {
    const b = h("button", { class: `swatch ${look.accent === c ? "selected" : ""}`, "aria-label": c, onclick: () => {
      look.accent = c; saveLook(); applyLook(); renderAppearance(root);
    } });
    b.style.background = c; swatches.append(b);
  }
  const custom = h("input", { type: "color", value: look.accent, title: "Color personalizado" });
  custom.addEventListener("input", () => { look.accent = custom.value; applyLook(); });
  custom.addEventListener("change", () => { saveLook(); renderAppearance(root); });
  swatches.append(custom);

  root.append(...[ // los paneles condicionales dan false: se filtran (append(false) escribiría «false» en pantalla)
    h("div", { class: "settings-panel wide" }, h("h2", { text: "Fondo" }),
      h("p", { text: "Los fondos animados se pausan solos si tu sistema tiene activada la reducción de movimiento. Con «Imagen propia» puedes usar una foto o un GIF animado y con «Vídeo propio» un MP4 o WebM (en bucle y con sonido, que puedes silenciar)." }),
      tiles, fileInput),
    look.bg === "video" && look.video && soundPanel(),
    look.bg === "video" && look.video && compatPanel(),
    h("div", { class: "settings-panel" }, h("h2", {}, "Tamaño de la interfaz ", h("b", { class: "zoom-val-page" })),
      h("p", { text: `También con ${MOD} + «+» / «−» / «0» o ${MOD} + rueda del ratón.` }),
      h("div", { class: "zoom-row" },
        h("button", { class: "secondary small", text: "−", onclick: () => zoomBy(-ZOOM_STEP) }),
        zoomSlider(),
        h("button", { class: "secondary small", text: "+", onclick: () => zoomBy(ZOOM_STEP) }),
        h("button", { class: "secondary small", text: "100 %", onclick: () => setZoom(100) }))),
    h("div", { class: "settings-panel" }, h("h2", {}, "Oscurecer fondo ", dimLabel),
      h("p", { text: "Más oscuro = más fácil de leer." }), dim),
    h("div", { class: "settings-panel" }, h("h2", { text: "Color de acento" }),
      h("p", { text: "Color principal de botones y detalles." }), swatches),
    h("button", { class: "secondary", text: "Restablecer apariencia", onclick: () => {
      look = { ...DEFAULTS }; api("clearVideo").catch(() => {}); saveLook(); applyLook(); setZoom(100); renderAppearance(root); notify("Apariencia restablecida.");
    } })
  
  ].filter(Boolean));
  updateZoomUi();
}
applyLook();

// ------------------------------------------------------------------ tamaño de la interfaz
const ZOOM_MIN = 50, ZOOM_MAX = 200, ZOOM_STEP = 10;
function updateZoomUi() {
  $$(".zoom-val, .zoom-val-page").forEach(e => { e.textContent = `${look.zoom} %`; });
  $$(".zoom-slider").forEach(e => { e.value = String(look.zoom); });
}
function setZoom(pct, save = true) {
  pct = Math.round(Number(pct) / 5) * 5;
  look.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(pct) ? pct : 100));
  aula.setZoom(look.zoom / 100);
  if (save) saveLook();
  updateZoomUi();
}
const zoomBy = d => setZoom(look.zoom + d);
function zoomSlider() {
  const sl = h("input", { type: "range", class: "zoom-slider", min: String(ZOOM_MIN), max: String(ZOOM_MAX), step: "5", value: String(look.zoom) });
  sl.addEventListener("input", () => setZoom(sl.value, false));
  sl.addEventListener("change", saveLook);
  return sl;
}
$$(".sound-ctl").forEach(ctl => ctl.append(h("button", { type: "button", text: "🔊", onclick: toggleSound })));
updateSoundUi();
$$(".zoom-ctl").forEach(ctl => ctl.append(
  h("button", { title: `Reducir la interfaz (${MOD} −)`, "aria-label": "Reducir la interfaz", text: "−", onclick: () => zoomBy(-ZOOM_STEP) }),
  h("button", { class: "zoom-val", title: `Restablecer al 100 % (${MOD} 0)`, onclick: () => setZoom(100) }),
  h("button", { title: `Ampliar la interfaz (${MOD} +)`, "aria-label": "Ampliar la interfaz", text: "+", onclick: () => zoomBy(ZOOM_STEP) })));
addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(ZOOM_STEP); }
  else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(-ZOOM_STEP); }
  else if (e.key === "0") { e.preventDefault(); setZoom(100); }
});
addEventListener("wheel", e => {
  if (!e.ctrlKey) return;
  e.preventDefault(); zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
}, { passive: false });
setZoom(look.zoom, false);

// ------------------------------------------------------------------ entrar / salir de una instancia
// Aula importada de la cuenta NotXunta: falta la contraseña en este ordenador (las contraseñas nunca se sincronizan).
const pwDialog = $("#pw-dialog");
let pwAcc = null;
function askPassword(acc) {
  pwAcc = acc;
  let host = acc.url;
  try { host = new URL(acc.url).host; } catch { /* se muestra tal cual */ }
  $("#pw-title").textContent = acc.name;
  $("#pw-text").textContent = `Esta aula viene de tu cuenta NotXunta. Para usarla en este ordenador escribe la contraseña de «${acc.username}» en ${host}. Se enviará solo a ese sitio.`;
  $("#pw-input").value = ""; $("#pw-error").hidden = true;
  pwDialog.showModal(); $("#pw-input").focus();
}
const closePw = () => { $("#pw-input").value = ""; pwDialog.close(); };
$("#pw-close").addEventListener("click", closePw);
$("#pw-cancel").addEventListener("click", closePw);
$("#pw-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#pw-save"), err = $("#pw-error");
  btn.disabled = true; btn.textContent = "Conectando…"; err.hidden = true;
  try {
    const updated = await api("setAccountPassword", pwAcc.id, $("#pw-input").value);
    closePw(); notify("Contraseña guardada.");
    await renderAccounts();
    openInstance(updated);
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = "Conectar y guardar"; }
});

async function openInstance(acc) {
  if (acc.needsPassword) { askPassword(acc); return; }
  showLoading(`Conectando con ${acc.name}…`);
  try {
    const data = await api("openInstance", acc.id);
    state.account = acc; state.accountId = acc.id;
    enterInstance(data);
  } catch (e) {
    notify(e.message);
  } finally { hideLoading(); }
}

function enterInstance(data) {
  state.data = data;
  state.unseen = new Set(data.unseen || []);
  state.courseId = null; state.sectionId = null; state.convId = null;
  setUnread(data.unreadMessages || 0);
  $("#launcher-shell").hidden = true;
  $("#instance-shell").hidden = false;
  $("#inst-name").textContent = state.account.name.toUpperCase();
  $("#inst-crumb-name").textContent = state.account.name.toUpperCase();
  paintIcon($("#inst-icon"), state.account.icon);
  const av = $("#inst-avatar");
  av.textContent = initials(data.user.fullname);
  av.style.backgroundImage = "";
  loadImage(av, data.user.pic, (e, img) => { e.style.backgroundImage = `url("${img}")`; e.style.backgroundSize = "cover"; e.textContent = ""; });
  const banner = $("#offline-banner");
  banner.hidden = !data.offline;
  if (data.offline) banner.textContent = `Sin conexión con el aula: se muestran los últimos datos guardados. (${data.error})`;
  $("#sync-status").textContent = `Sincronizado ${new Date(data.syncedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
  setIView("courses");
  if (data.newCount > 0) notify(`${data.newCount} ${data.newCount === 1 ? "novedad" : "novedades"} desde la última vez.`);
}

$("#back-launcher").addEventListener("click", async () => {
  if (state.accountId) api("closeInstance", state.accountId).catch(() => {});
  state.accountId = null; state.data = null;
  $("#instance-shell").hidden = true;
  $("#launcher-shell").hidden = false;
  await renderAccounts();
});

$("#sync-btn").addEventListener("click", async () => {
  showLoading("Buscando contenido nuevo…");
  try {
    const data = await api("sync", state.accountId);
    const keepCourse = state.courseId, keepSection = state.sectionId;
    enterInstance(data);
    if (keepCourse && courseById(keepCourse)) { state.courseId = keepCourse; state.sectionId = keepSection; setIView("courses"); }
    if (!data.newCount && !data.offline) notify("Todo al día. No hay contenido nuevo.");
  } catch (e) { notify(e.message); }
  finally { hideLoading(); }
});

const IVIEWS = {
  courses: ["MIS CURSOS", renderCourses],
  calendar: ["CALENDARIO", renderCalendar],
  tasks: ["TAREAS", renderTasks],
  grades: ["CALIFICACIONES", renderGrades],
  messages: ["MENSAJES", renderMessages],
  notifications: ["NOTIFICACIONES", renderNotifications],
  files: ["ARCHIVOS", renderNxFiles],
  friends: ["AMIGOS", renderCloud],
  profile: ["PERFIL", renderProfile],
  appearance: ["APARIENCIA", renderAppearance],
  settings: ["AJUSTES", renderSettings]
};

function setIView(name) {
  state.view = name;
  $$(".nav[data-iview]").forEach(n => n.classList.toggle("active", n.dataset.iview === name));
  $$("#instance-shell .view").forEach(v => v.classList.toggle("active", v.id === `iv-${name}`));
  $("#inst-crumb").textContent = IVIEWS[name][0];
  const target = $(`#iv-${name}`);
  clear(target);
  const p = IVIEWS[name][1](target);
  if (p && p.catch) p.catch(e => { clear(target); target.append(empty("!", "No se pudo cargar", e.message)); });
}
$$(".nav[data-iview]").forEach(btn => btn.addEventListener("click", () => {
  state.courseId = null; state.sectionId = null;
  setIView(btn.dataset.iview);
}));

// ------------------------------------------------------------------ marcas de contenido nuevo
const unseenIn = mods => mods.filter(m => state.unseen.has(m.key)).length;
const courseUnseen = c => c.sections.reduce((n, s) => n + unseenIn(s.modules), 0);
function markSeen(keys) {
  const fresh = keys.filter(k => state.unseen.has(k));
  if (!fresh.length) return;
  fresh.forEach(k => state.unseen.delete(k));
  api("markSeen", state.accountId, fresh).catch(() => {});
}

// ------------------------------------------------------------------ cursos
function renderCourses(root) {
  if (state.courseId) return renderCourse(root);
  root.append(pageTitle("TUS ASIGNATURAS", "Mis cursos", `${state.data.courses.length} asignaturas en ${state.account.name}`));
  if (!state.data.courses.length) { root.append(empty("▦", "Sin cursos", "No estás matriculado en ningún curso.")); return; }
  const grid = h("div", { class: "course-grid" });
  for (const c of state.data.courses) {
    const banner = h("div", { class: "course-card-banner" });
    loadImage(banner, c.banner, (e, d) => { e.style.backgroundImage = `url("${d}")`; });
    const n = courseUnseen(c);
    grid.append(h("button", { class: "course-card", onclick: () => { state.courseId = c.id; state.sectionId = null; setIView("courses"); } },
      banner,
      h("div", { class: "course-card-body" },
        h("h3", { text: c.fullname }),
        h("div", { class: "muted", text: (c.teachers[0] && c.teachers[0].fullname) || c.shortname }),
        n > 0 && chip(`${n} nuevo${n === 1 ? "" : "s"}`, "new"))));
  }
  root.append(grid);
}

function openCompose(teacher, course) {
  const dlg = $("#msg-dialog"), form = $("#msg-form"), err = $("#msg-error");
  form.reset(); err.hidden = true;
  $("#msg-title").textContent = `${teacher.fullname} · ${course.shortname || course.fullname}`;
  dlg.showModal();
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $("#msg-send");
    btn.disabled = true; err.hidden = true;
    try {
      await api("send", state.accountId, { toUserId: teacher.id, text: $("#msg-text").value });
      dlg.close(); notify("Mensaje enviado.");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  };
}
const closeMsg = () => $("#msg-dialog").close();
$("#msg-cancel").addEventListener("click", closeMsg);
$("#msg-close").addEventListener("click", closeMsg);

function renderCourse(root) {
  const c = courseById(state.courseId);
  if (!c) { state.courseId = null; return renderCourses(root); }

  // Cabecera: banner de fondo (translúcido), nombre, profesor y "Enviar mensaje"
  const bg = h("div", { class: "course-banner" });
  loadImage(bg, c.banner, (e, d) => { e.style.backgroundImage = `url("${d}")`; });
  const teachers = h("div", { class: "teacher-list" });
  for (const t of c.teachers) {
    teachers.append(h("div", { class: "teacher-row" },
      h("button", { class: "teacher-btn", title: "Ver perfil en el aula",
        onclick: () => api("openExternal", `${state.data.site.url}/user/view.php?id=${t.id}&course=${c.id}`).catch(e => notify(e.message)) },
        avatar(t.pic, t.fullname, "sm"), h("span", { text: t.fullname })),
      h("button", { class: "primary", onclick: () => openCompose(t, c), text: "✉ Enviar mensaje" })));
  }
  if (!c.teachers.length) teachers.append(h("div", { class: "muted", text: "El aula no indica el profesorado de este curso." }));

  root.append(h("div", { class: "course-hero" }, bg, h("div", { class: "course-hero-inner" },
    h("button", { class: "back-link", onclick: () => { state.courseId = null; state.sectionId = null; setIView("courses"); }, text: "← Mis cursos" }),
    h("h1", { text: c.fullname }), teachers)));

  // Pestañas del curso: Temas | Participantes
  if (state.courseTabFor !== c.id) { state.courseTab = "topics"; state.courseTabFor = c.id; }
  if (!state.sectionId) {
    const tabBtn = (key, text) => h("button", { class: state.courseTab === key ? "on" : "", text, onclick: () => { state.courseTab = key; setIView("courses"); } });
    root.append(h("div", { class: "course-tabs", role: "tablist" }, tabBtn("topics", "Temas"), tabBtn("people", "Participantes")));
    if (state.courseTab === "people") return renderParticipants(root, c);
  }

  const sections = c.sections.filter(s => s.modules.length);
  const section = sections.find(s => s.id === state.sectionId);
  if (!section) {
    root.append(h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Temas" }), h("p", { text: "Elige un tema para ver sus documentos, enlaces y actividades." }))));
    if (!sections.length) { root.append(empty("▤", "Sin contenido", "Este curso todavía no tiene contenido visible.")); return; }
    const grid = h("div", { class: "topic-grid" });
    for (const s of sections) {
      const n = unseenIn(s.modules);
      const count = k => s.modules.filter(m => m.kind === k).length;
      grid.append(h("button", { class: "topic-btn", onclick: () => { state.sectionId = s.id; setIView("courses"); } },
        h("div", { class: "topic-name", text: s.name }),
        h("div", { class: "topic-meta", text: `${count("doc")} docs · ${count("link")} enlaces · ${count("task")} tareas` }),
        n > 0 && chip(`${n} nuevo${n === 1 ? "" : "s"}`, "new")));
    }
    root.append(grid);
    return;
  }

  // Tema abierto: documentos / enlaces / actividades a entregar
  root.append(h("div", { class: "topic-head" },
    h("button", { class: "back-link", onclick: () => { state.sectionId = null; setIView("courses"); }, text: "← Temas" }),
    h("h2", { text: section.name })));
  const groups = [
    ["doc", "Documentos", "▤"],
    ["link", "Enlaces", "↗"],
    ["task", "Actividades a entregar", "✎"],
    ["other", "Otros recursos", "◇"]
  ];
  const wrap = h("div", { class: "topic-groups" });
  for (const [kind, title, icon] of groups) {
    const mods = section.modules.filter(m => m.kind === kind);
    if (!mods.length && kind === "other") continue;
    const list = h("div", { class: "item-list" });
    if (!mods.length) list.append(h("div", { class: "muted pad", text: "Nada en este apartado." }));
    for (const m of mods) list.append(...moduleRows(m, icon));
    wrap.append(h("details", { class: "group", open: "" },
      h("summary", {}, h("span", { class: "g-icon", text: icon }), h("b", { text: title }), h("span", { class: "g-count", text: String(mods.length) })),
      list));
  }
  root.append(wrap);
  markSeen(section.modules.map(m => m.key)); // las marcas se ven ahora y desaparecen al salir
  const pre = section.modules.filter(m => m.kind === "doc").flatMap(m => m.files)
    .map(f => ({ url: f.fileurl, filename: f.filename, version: f.timemodified }));
  if (pre.length) api("prefetchFiles", state.accountId, pre).catch(() => {}); // los apuntes del tema se descargan ya, en segundo plano
}

// ------------------------------------------------------------------ cuenta NotXunta y amigos
function setFriendBadge(n) {
  $$('[data-badge="friends"]').forEach(b => { b.textContent = n > 99 ? "99+" : String(n); b.hidden = !n; });
}
aula.onCloudBadge(p => setFriendBadge((p && p.pending) || 0));

function openFriends() {
  if (!$("#instance-shell").hidden) { state.courseId = null; state.sectionId = null; setIView("friends"); }
  else $('.nav[data-view="cloud"]').click();
}

const ROLE_NAMES = { student: "Alumno", editingteacher: "Profesor", teacher: "Profesor", manager: "Gestor", coursecreator: "Creador de cursos" };

async function renderParticipants(root, c) {
  const holder = h("div", { class: "people" });
  root.append(holder);
  holder.append(h("div", { class: "muted pad", text: "Cargando participantes…" }));
  let people;
  try { people = await api("participants", state.accountId, c.id); }
  catch { clear(holder); holder.append(empty("☺", "No se pueden ver los participantes", "El aula no permite consultar quién está matriculado en este curso.")); return; }

  let st = { configured: false, signedIn: false, profile: null }, lookup = {}, friends = [], offline = false;
  try { st = await api("cloudStatus"); } catch { offline = true; }
  const ready = st.configured && st.signedIn && !!st.profile && !offline;
  if (ready) {
    try { [lookup, friends] = await Promise.all([api("cloudLookup", state.accountId, people.map(p => p.id)), api("friendsList")]); }
    catch { offline = true; }
  }
  const canAct = ready && !offline;

  clear(holder);
  holder.append(h("div", { class: "section-heading" }, h("div", {}, h("h2", { text: "Participantes" }), h("p", { text: `${people.length} personas en este curso.` }))));
  if (st.configured && !offline && !canAct) {
    holder.append(h("div", { class: "people-banner" }, h("span", { text: "Crea tu cuenta NotXunta (o inicia sesión) para añadir amigos de tu curso." }),
      h("button", { class: "primary small", text: "Abrir cuenta", onclick: openFriends })));
  } else if (offline && st.configured) {
    holder.append(h("div", { class: "people-banner" }, h("span", { text: "No se pudo conectar con el servidor de NotXunta: los botones de amistad no están disponibles ahora." })));
  }

  const q = h("input", { type: "search", placeholder: "Buscar participante…" });
  const list = h("div", { class: "item-list" });
  let limit = 60;
  const more = h("button", { class: "secondary small", onclick: () => { limit += 60; draw(); } });
  holder.append(h("div", { class: "people-tools" }, q), list, h("div", { class: "pad" }, more));

  function personRow(p) {
    const info = lookup[p.id];
    const roles = [...new Set((p.roles || []).map(r => ROLE_NAMES[r]).filter(Boolean))];
    const sub = [roles.join(", "), canAct && info ? `NotXunta: @${info.username}` : ""].filter(Boolean).join(" · ");
    const act = h("div", { class: "acts" });
    const paint = () => {
      clear(act);
      if (p.id === state.data.user.id) { act.append(chip("TÚ")); return; }
      if (!canAct) return;
      if (!info) { act.append(h("span", { class: "muted", text: "Sin NotXunta Client" })); return; }
      if (info.user_id === st.profile.id) { act.append(chip("TÚ")); return; }
      const rel = friends.find(f => f.other_id === info.user_id);
      const reload = async () => { try { friends = await api("friendsList"); } catch { /* se queda como estaba */ } paint(); };
      if (!rel) {
        act.append(h("button", { class: "primary small", text: "＋ Añadir amigo", onclick: async e => {
          e.currentTarget.disabled = true;
          try { const r = await api("friendRequest", info.user_id); notify(r === "accepted" ? `Ya sois amigos: @${info.username}` : `Solicitud enviada a @${info.username}`); }
          catch (err) { notify(err.message); }
          await reload();
        } }));
      } else if (rel.status === "accepted") act.append(presenceBit(rel), chip("✓ AMIGOS", "ok"));
      else if (rel.i_requested) act.append(chip("SOLICITUD ENVIADA", "warn"));
      else act.append(h("button", { class: "primary small", text: "Aceptar solicitud", onclick: async e => {
        e.currentTarget.disabled = true;
        try { await api("friendRespond", rel.friendship_id, true); notify(`Ahora eres amigo de @${info.username}`); } catch (err) { notify(err.message); }
        await reload();
      } }));
    };
    paint();
    return h("div", { class: "friend-row" }, avatar(p.pic, p.fullname, "sm"),
      h("span", { class: "item-main" }, h("b", { text: p.fullname }), sub && h("span", { class: "muted", text: sub })), act);
  }
  function draw() {
    clear(list);
    const term = q.value.trim().toLowerCase();
    const rows = people.filter(p => !term || p.fullname.toLowerCase().includes(term));
    for (const p of rows.slice(0, limit)) list.append(personRow(p));
    if (!rows.length) list.append(h("div", { class: "muted pad", text: "Nadie coincide con la búsqueda." }));
    more.style.display = rows.length > limit ? "" : "none";
    more.textContent = `Mostrar más (${rows.length - limit} restantes)`;
  }
  q.addEventListener("input", () => { limit = 60; draw(); });
  draw();
}

// Pantalla de cuenta NotXunta: entrar / crear cuenta / perfil / amigos (sirve para el lanzador y para el aula).
// Cada llamada limpia el contenedor y, si mientras esperaba al servidor se ha lanzado otra, la antigua no pinta nada
// (antes, pulsar dos veces «Cuenta y amigos» o refrescar a la vez apilaba los apartados duplicados).
const cloudRenders = new WeakMap();
async function renderCloud(root) {
  const mine = (cloudRenders.get(root) || 0) + 1;
  cloudRenders.set(root, mine);
  const stale = () => cloudRenders.get(root) !== mine;
  const redo = () => { renderCloud(root).catch(e => { clear(root); root.append(empty("!", "No se pudo cargar", e.message)); }); };
  clear(root);
  root.append(pageTitle("COMUNIDAD", "Cuenta NotXunta y amigos", "Una cuenta propia de NotXunta Client, independiente de tus aulas virtuales."));
  let st;
  try { st = await api("cloudStatus"); }
  catch (e) { if (!stale()) root.append(empty("☁", "Sin conexión con el servidor", e.message)); return; }
  if (stale()) return;
  paintLauncherAvatar(st);
  if (!st.configured) {
    root.append(empty("☁", "Servidor de cuentas sin configurar", "Esta versión de la app no tiene todavía el servidor de cuentas NotXunta. Sigue la guía del README (Supabase) y vuelve a compilar."));
    return;
  }
  if (!st.signedIn) { root.append(authCard(redo)); return; }
  if (!st.profile) { root.append(profileSetupCard(redo, st)); return; }
  let card, panel;
  try { card = accountCard(redo, st); } catch (e) { card = empty("!", "No se pudo mostrar tu cuenta", e.message); }
  try { panel = await friendsPanel(redo); } catch (e) { panel = empty("!", "No se pudieron cargar tus amigos", e.message); }
  if (stale()) return;
  root.append(card);
  if (st.schemaOutdated || st.presenceOutdated) root.append(h("div", { class: "cloud-card" }, h("h2", { text: "Falta actualizar el servidor" }),
    h("p", { text: `Tu cuenta funciona, pero ${st.schemaOutdated ? "la foto de perfil, la sincronización de ajustes, " : ""}el estado «en línea» y los Archivos NotXunta necesitan una actualización de la base de datos de Supabase: abre el SQL Editor, pega el contenido de supabase/migration-0.6.1.sql${st.schemaOutdated ? " (y antes el de migration-0.5.6.sql)" : ""} y pulsa Run. No hace falta reinstalar la app.` })));
  root.append(panel);
}

// Foto de perfil de la cuenta NotXunta (una imagen pequeña que sube la propia app).
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cloudPic(p, cls = "") {
  const el = h("div", { class: `pic ${cls}`, text: initials(p.display_name || p.username) });
  if (typeof p.avatar === "string" && AVATAR_RE.test(p.avatar)) { el.style.backgroundImage = `url("${p.avatar}")`; el.textContent = ""; el.classList.add("has-img"); }
  return el;
}
function readAvatar(file) { // recorta al centro y reduce a 128×128 (unos pocos KB)
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("Elige un archivo de imagen."));
    if (file.size > 15e6) return reject(new Error("La imagen es demasiado grande."));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("No se pudo leer el archivo."));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo abrir la imagen."));
      img.onload = () => {
        const S = 128, k = Math.max(S / img.width, S / img.height), w = img.width * k, ht = img.height * k;
        const cv = document.createElement("canvas"); cv.width = cv.height = S;
        const cx = cv.getContext("2d"); cx.fillStyle = "#2a2238"; cx.fillRect(0, 0, S, S);
        cx.drawImage(img, (S - w) / 2, (S - ht) / 2, w, ht);
        resolve(cv.toDataURL("image/jpeg", 0.85));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
// Avatar de la barra superior del lanzador: tu foto de NotXunta si has iniciado sesión.
function paintLauncherAvatar(st) {
  const el = $("#launcher-avatar");
  if (!el) return;
  const p = st && st.signedIn && st.profile;
  el.style.backgroundImage = ""; el.textContent = p ? initials(p.display_name || p.username) : "AC";
  if (p && typeof p.avatar === "string" && AVATAR_RE.test(p.avatar)) { el.style.backgroundImage = `url("${p.avatar}")`; el.textContent = ""; }
}
api("cloudStatus").then(paintLauncherAvatar).catch(() => {});

function authCard(redo) {
  let mode = "in", info = "";
  const card = h("div", { class: "cloud-card" });
  const draw = () => {
    clear(card);
    const email = h("input", { type: "email", autocomplete: "email", placeholder: "tucorreo@ejemplo.com", required: "" });
    const pw = h("input", { type: "password", autocomplete: mode === "in" ? "current-password" : "new-password", placeholder: mode === "in" ? "Tu contraseña" : "Mínimo 8 caracteres", required: "" });
    const err = h("div", { class: "form-error", hidden: "" });
    const btn = h("button", { class: "primary", type: "submit", text: mode === "in" ? "Entrar" : "Crear cuenta" });
    const form = h("form", {}, h("label", {}, "Correo electrónico", email), h("label", {}, "Contraseña", pw), err,
      h("div", { class: "cloud-actions" }, btn));
    form.addEventListener("submit", async e => {
      e.preventDefault(); err.hidden = true; btn.disabled = true;
      try {
        if (mode === "in") { await api("cloudSignIn", email.value, pw.value); redo(); return; }
        const r = await api("cloudSignUp", email.value, pw.value);
        if (r.needsConfirmation) { info = "Cuenta creada. Te hemos enviado un correo: pulsa el enlace para confirmarla y luego entra aquí."; mode = "in"; draw(); }
        else redo();
      } catch (er) { err.textContent = er.message; err.hidden = false; btn.disabled = false; }
    });
    const oauth = h("div", { class: "oauth-row" });
    const wait = h("p", { class: "muted", hidden: "" }, "Completa el inicio de sesión en tu navegador… ",
      h("button", { type: "button", class: "secondary", text: "Cancelar", onclick: () => { api("cloudOAuthCancel").catch(() => {}); } }));
    for (const [prov, label] of [["google", "Google"], ["discord", "Discord"], ["github", "GitHub"]]) {
      oauth.append(h("button", { type: "button", class: "secondary", text: label, onclick: async () => {
        $$("button", oauth).forEach(b => { b.disabled = true; }); wait.hidden = false; err.hidden = true;
        try { await api("cloudOAuth", prov); redo(); }
        catch (er) { err.textContent = er.message; err.hidden = false; $$("button", oauth).forEach(b => { b.disabled = false; }); wait.hidden = true; }
      } }));
    }
    card.append(
      h("div", { class: "cloud-tabs" },
        h("button", { type: "button", class: mode === "in" ? "on" : "", text: "Entrar", onclick: () => { mode = "in"; info = ""; draw(); } }),
        h("button", { type: "button", class: mode === "up" ? "on" : "", text: "Crear cuenta", onclick: () => { mode = "up"; info = ""; draw(); } })),
      info && h("div", { class: "form-ok", text: info }),
      form, h("div", { class: "oauth-sep", text: "o continúa con" }), oauth, wait);
  };
  draw();
  return h("div", {}, h("div", { class: "cloud-card" }, h("h2", { text: "Tu cuenta NotXunta" }),
    h("p", { text: "Sirve para añadir amigos de tus cursos. No es la de tu aula virtual: tus contraseñas del aula nunca se envían a NotXunta." })), card);
}

function profileSetupCard(redo, st) {
  const guess = String(st.email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  const user = h("input", { value: guess, placeholder: "tu_usuario", autocomplete: "off", required: "", maxlength: "20" });
  const name = h("input", { placeholder: "Cómo quieres que te vean", maxlength: "40" });
  const cb = h("input", { type: "checkbox" }); cb.checked = true;
  const err = h("div", { class: "form-error", hidden: "" });
  const btn = h("button", { class: "primary", type: "submit", text: "Crear perfil" });
  const form = h("form", {},
    h("label", {}, "Nombre de usuario (único: letras minúsculas, números y _)", user),
    h("label", {}, "Nombre para mostrar", name),
    h("label", { class: "switch-row" }, h("span", {}, h("b", { text: "Que mis compañeros de aula me encuentren" }),
      h("small", { text: "Si lo dejas marcado, en la pestaña «Participantes» de tus cursos podrán ver que usas NotXunta Client (con tu usuario y nombre para mostrar) y enviarte solicitudes de amistad. Puedes cambiarlo cuando quieras." })), cb),
    err, h("div", { class: "cloud-actions" }, btn));
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    try { await api("cloudCreateProfile", { username: user.value, display_name: name.value, discoverable: cb.checked }); redo(); }
    catch (er) { err.textContent = er.message; err.hidden = false; btn.disabled = false; }
  });
  return h("div", { class: "cloud-card" }, h("h2", { text: "Crea tu perfil" }), h("p", { text: `Has entrado como ${st.email || "tu cuenta"}. Elige cómo te verán tus amigos.` }), form);
}

function accountCard(redo, st) {
  const p = st.profile;
  const cb = h("input", { type: "checkbox" }); cb.checked = !!p.discoverable;
  cb.addEventListener("change", async () => {
    cb.disabled = true;
    try { await api("cloudUpdateProfile", { discoverable: cb.checked }); notify(cb.checked ? "Tus compañeros ya pueden encontrarte." : "Ya no apareces ante tus compañeros."); }
    catch (e) { cb.checked = !cb.checked; notify(e.message); }
    cb.disabled = false;
  });
  const onlineCb = h("input", { type: "checkbox" }); onlineCb.checked = p.show_online !== false;
  onlineCb.addEventListener("change", async () => {
    onlineCb.disabled = true;
    try { await api("cloudUpdateProfile", { show_online: onlineCb.checked }); notify(onlineCb.checked ? "Tus amigos ya ven cuándo estás en línea." : "Tu estado en línea ya no es visible."); }
    catch (e) { onlineCb.checked = !onlineCb.checked; notify(e.message); }
    onlineCb.disabled = false;
  });
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: "" });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0]; fileInput.value = "";
    if (!f) return;
    try { await api("cloudUpdateProfile", { avatar: await readAvatar(f) }); notify("Foto de perfil actualizada."); redo(); }
    catch (e) { notify(e.message); }
  });
  const pic = cloudPic(p, "xl");
  pic.classList.add("editable"); pic.title = "Cambiar foto"; pic.setAttribute("role", "button");
  pic.addEventListener("click", () => fileInput.click());

  // Sincronización de ajustes (fondo, ajustes de la app y aulas sin contraseñas)
  const syncMsg = h("small", { class: "muted", text: "" });
  const paintSync = i => {
    syncMsg.textContent = i && i.error ? `No se pudo sincronizar: ${i.error}`
      : i && i.lastRun ? `Última sincronización: ${new Date(i.lastRun).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Aún no se ha sincronizado en esta sesión.";
  };
  api("syncInfo").then(paintSync).catch(() => {});
  const syncBtn = h("button", { class: "secondary small", text: "Sincronizar ahora", onclick: async () => {
    syncBtn.disabled = true;
    try { paintSync(await api("syncNow")); } catch (e) { notify(e.message); }
    syncBtn.disabled = false;
  } });

  return h("div", { class: "cloud-card" },
    h("div", { class: "cloud-who" }, pic,
      h("div", {}, h("b", { text: p.display_name || p.username }), h("span", { class: "muted", text: `@${p.username}${st.email ? " · " + st.email : ""}` }),
        h("div", { class: "avatar-actions" },
          h("button", { class: "secondary small", text: p.avatar ? "Cambiar foto" : "Poner foto", onclick: () => fileInput.click() }),
          p.avatar && h("button", { class: "secondary small", text: "Quitar foto", onclick: async () => {
            try { await api("cloudUpdateProfile", { avatar: null }); notify("Foto quitada."); redo(); } catch (e) { notify(e.message); }
          } }))), fileInput),
    h("div", { class: "switch-row" }, h("span", {}, h("b", { text: "Sincronización de ajustes" }),
      h("small", { text: "Tu fondo (imagen), color, ajustes de la app y tus aulas (nombre, enlace y usuario; nunca contraseñas) se guardan en tu cuenta y se importan al iniciar sesión en otro ordenador." }), syncMsg), syncBtn),
    h("label", { class: "switch-row" }, h("span", {}, h("b", { text: "Que mis compañeros de aula me encuentren" }),
      h("small", { text: "Si lo desactivas, no apareces en «Participantes» y se borran tus vínculos con las aulas." })), cb),
    !st.presenceOutdated && h("label", { class: "switch-row" }, h("span", {}, h("b", { text: "Mostrar cuando estoy en línea" }),
      h("small", { text: "Tus amigos (solo ellos) ven un punto verde mientras NotXunta Client está abierto en tu ordenador, o cuándo te conectaste por última vez. Si lo desactivas, nadie ve tu estado." })), onlineCb),
    h("div", { class: "cloud-actions" },
      h("button", { class: "secondary", text: "Cerrar sesión", onclick: async () => { try { await api("cloudSignOut"); redo(); } catch (e) { notify(e.message); } } }),
      h("button", { class: "secondary danger", text: "Eliminar mi cuenta", onclick: async () => {
        if (!confirm("¿Eliminar tu cuenta NotXunta? Se borrarán tu perfil, tus vínculos con aulas y tus amistades. No se puede deshacer.")) return;
        try { await api("cloudDeleteAccount"); notify("Cuenta eliminada."); redo(); } catch (e) { notify(e.message); }
      } })));
}

async function friendsPanel(redo) {
  const wrap = h("div", {});
  let rows;
  try { rows = await api("friendsList"); } catch (e) { wrap.append(empty("!", "No se pudieron cargar tus amigos", e.message)); return wrap; }
  const incoming = rows.filter(r => r.status === "pending" && !r.i_requested);
  const sent = rows.filter(r => r.status === "pending" && r.i_requested);
  const friends = rows.filter(r => r.status === "accepted").sort((a, b) => Number(!!b.online) - Number(!!a.online));
  const onlineN = friends.filter(r => r.online).length;
  setFriendBadge(incoming.length);

  const person = (r, ...acts) => h("div", { class: "friend-row" }, cloudPic(r, "sm"),
    h("span", { class: "item-main" }, h("b", { text: r.display_name || r.username }),
      h("span", { class: "muted" }, `@${r.username}`, r.status === "accepted" && presenceBit(r))), h("div", { class: "acts" }, ...acts));
  const act = (text, cls, fn) => h("button", { class: `${cls} small`, text, onclick: async e => {
    e.currentTarget.disabled = true;
    try { await fn(); redo(); } catch (er) { notify(er.message); e.currentTarget.disabled = false; }
  } });
  const section = (title, list, build, extra) => list.length > 0 && h("div", { class: "cloud-section" }, h("h3", { text: `${title} (${list.length})${extra ? " · " + extra : ""}` }),
    h("div", { class: "item-list" }, list.map(build)));

  // Añadir por nombre de usuario
  const input = h("input", { placeholder: "nombre_de_usuario", maxlength: "21", autocomplete: "off" });
  const result = h("div", { class: "item-list", hidden: "" });
  const find = async () => {
    result.hidden = true; clear(result);
    try {
      const u = await api("friendFind", input.value);
      result.hidden = false;
      if (!u) { result.append(h("div", { class: "muted pad", text: "No hay nadie con ese usuario (o no acepta solicitudes)." })); return; }
      result.append(person(u, h("button", { class: "primary small", text: "＋ Añadir amigo", onclick: async e => {
        e.currentTarget.disabled = true;
        try { const r = await api("friendRequest", u.id); notify(r === "accepted" ? "Ya sois amigos." : "Solicitud enviada."); redo(); }
        catch (er) { notify(er.message); e.currentTarget.disabled = false; }
      } })));
    } catch (e) { notify(e.message); }
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") find(); });
  wrap.append(h("div", { class: "cloud-section" }, h("h3", { text: "AÑADIR AMIGO POR USUARIO" }),
    h("div", { class: "friend-add" }, input, h("button", { class: "primary", text: "Buscar", onclick: find })), result,
    h("p", { class: "muted", text: "Para encontrar a tus compañeros de curso, entra en un curso y abre la pestaña «Participantes»." })));

  // section() devuelve false cuando una lista está vacía y append(false) escribe el texto «false» en pantalla: se filtran.
  wrap.append(...[
    section("SOLICITUDES RECIBIDAS", incoming, r => person(r,
      act("Aceptar", "primary", () => api("friendRespond", r.friendship_id, true)),
      act("Rechazar", "secondary", () => api("friendRespond", r.friendship_id, false)))),
    section("TUS AMIGOS", friends, r => person(r, act("Eliminar", "secondary", async () => {
      if (!confirm(`¿Dejar de ser amigo de @${r.username}?`)) throw new Error("Cancelado.");
      await api("friendRemove", r.friendship_id);
    })), onlineN ? `${onlineN} en línea` : ""),
    section("SOLICITUDES ENVIADAS", sent, r => person(r, act("Cancelar", "secondary", () => api("friendRemove", r.friendship_id))))
  ].filter(Boolean));
  // El estado «en línea» se refresca solo mientras esta pantalla siga abierta (sin volver a pintarla entera).
  const presenceTimer = setInterval(async () => {
    if (!wrap.isConnected) { clearInterval(presenceTimer); return; }
    try { for (const r of (await api("friendsList")).filter(x => x.status === "accepted")) $$(`[data-uid="${r.other_id}"]`, wrap).forEach(el => paintPresence(el, r)); }
    catch { /* sin conexión: se queda como estaba */ }
  }, 30000);
  if (!rows.length) wrap.append(empty("♥", "Todavía no tienes amigos", "Añade a alguien por su usuario o desde la pestaña «Participantes» de tus cursos."));
  return wrap;
}

// Ajustes traídos de la cuenta NotXunta desde otro ordenador (los aplica el proceso principal y avisa aquí).
aula.onSyncApplied(p => {
  if (!p) return;
  if (p.look) { look = { ...DEFAULTS, ...p.look }; saveLookLocal(); applyLook(); refreshAppearance(); }
  if (p.accounts) renderAccounts().catch(() => {});
  if (p.prefs) for (const el of $$("#settings-view.active, #iv-settings.active")) renderSettings(el).catch(() => {});
  notify("Ajustes importados de tu cuenta NotXunta.");
});

// Abrir apuntes: círculo de carga mientras se descarga/abre (si ya estaban en caché es casi instantáneo).
async function openDoc(f) {
  showLoading("Abriendo los apuntes…");
  const t0 = Date.now();
  try {
    const r = await api("openFile", state.accountId, f.fileurl, f.filename, f.timemodified);
    if (r.note) notify(r.note);
    const rest = 500 - (Date.now() - t0); // el aviso aguanta hasta que aparece el programa
    if (rest > 0) await new Promise(res => setTimeout(res, rest));
  } catch (e) { notify(e.message); }
  finally { hideLoading(); }
}

function openModuleUrl(m) {
  const url = m.linkUrl || m.url;
  if (url) api("openExternal", url).catch(e => notify(e.message));
}

function moduleRows(m, icon) {
  const fresh = state.unseen.has(m.key) && chip("NUEVO", "new");
  if (m.kind === "doc" && m.files.length) {
    return m.files.map((f, i) => h("button", { class: "item", onclick: () => openDoc(f) },
      h("span", { class: "item-icon", text: icon }),
      h("span", { class: "item-main" }, h("b", { text: m.files.length > 1 ? f.filename : m.name }),
        h("span", { class: "muted", text: [m.files.length > 1 ? m.name : f.filename, fmtSize(f.filesize)].filter(Boolean).join(" · ") })),
      i === 0 && fresh));
  }
  if (m.kind === "task") {
    const overdue = m.due && m.due * 1000 < Date.now();
    const st = m.status === "submitted" ? chip("Entregada", "ok") : overdue ? chip("Vencida", "bad") : chip(m.status === "draft" ? "Borrador" : "Pendiente", "warn");
    return [h("button", { class: "item", onclick: () => openModuleUrl(m) },
      h("span", { class: "item-icon", text: icon }),
      h("span", { class: "item-main" }, h("b", { text: m.name }), h("span", { class: "muted", text: m.due ? `Entrega: ${fmtDate(m.due)}` : "Sin fecha límite" })),
      fresh, st)];
  }
  return [h("button", { class: "item", onclick: () => openModuleUrl(m), title: "Se abre en el navegador" },
    h("span", { class: "item-icon", text: icon }),
    h("span", { class: "item-main" }, h("b", { text: m.name }), h("span", { class: "muted", text: m.kind === "link" ? (m.linkUrl || "").slice(0, 70) : m.modname })),
    fresh)];
}

// ------------------------------------------------------------------ calendario
async function renderCalendar(root) {
  root.append(pageTitle("PRÓXIMOS EVENTOS", "Calendario", "Entregas y eventos de los próximos 90 días."));
  root.append(h("div", { class: "muted pad", text: "Cargando…" }));
  let events;
  try { events = (await api("calendar", state.accountId)).sort((a, b) => a.time - b.time); }
  catch { // función desactivada en el aula, sin conexión, etc.
    clear(root).append(pageTitle("PRÓXIMOS EVENTOS", "Calendario"), empty("◷", "Calendario no disponible."));
    return;
  }
  clear(root).append(pageTitle("PRÓXIMOS EVENTOS", "Calendario", "Entregas y eventos de los próximos 90 días."));
  if (!events.length) { root.append(empty("◷", "Sin eventos", "No hay eventos próximos en tu calendario.")); return; }
  let day = "";
  let list;
  for (const ev of events) {
    const d = fmtDay(ev.time);
    if (d !== day) { day = d; root.append(h("h3", { class: "day-head", text: d })); list = h("div", { class: "item-list" }); root.append(list); }
    list.append(h("button", { class: "item", onclick: () => ev.url && api("openExternal", ev.url).catch(e => notify(e.message)) },
      h("span", { class: "item-icon", text: "◷" }),
      h("span", { class: "item-main" }, h("b", { text: ev.name }), h("span", { class: "muted", text: ev.course })),
      h("span", { class: "muted", text: new Date(ev.time * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) })));
  }
}

// ------------------------------------------------------------------ tareas
function renderTasks(root) {
  const tasks = state.data.courses.flatMap(c => c.sections.flatMap(s => s.modules)
    .filter(m => m.kind === "task").map(m => ({ ...m, course: c.fullname })));
  root.append(pageTitle("ACTIVIDADES A ENTREGAR", "Tareas", "Todas las tareas de tus asignaturas."));
  if (!tasks.length) { root.append(empty("✎", "Sin tareas", "No hay tareas en tus cursos.")); return; }
  const pending = tasks.filter(t => t.status !== "submitted").sort((a, b) => (a.due || 9e12) - (b.due || 9e12));
  const done = tasks.filter(t => t.status === "submitted").sort((a, b) => b.due - a.due);
  for (const [title, list] of [["Pendientes", pending], ["Entregadas", done]]) {
    if (!list.length) continue;
    root.append(h("h3", { class: "day-head", text: `${title} (${list.length})` }));
    const box = h("div", { class: "item-list" });
    for (const t of list) {
      const overdue = t.due && t.due * 1000 < Date.now() && t.status !== "submitted";
      box.append(h("button", { class: "item", onclick: () => openModuleUrl(t) },
        h("span", { class: "item-icon", text: "✎" }),
        h("span", { class: "item-main" }, h("b", { text: t.name }), h("span", { class: "muted", text: `${t.course} · ${t.due ? fmtDate(t.due) : "Sin fecha límite"}` })),
        t.status === "submitted" ? chip("Entregada", "ok") : overdue ? chip("Vencida", "bad") : chip("Pendiente", "warn")));
    }
    root.append(box);
  }
}

// ------------------------------------------------------------------ calificaciones
function renderGrades(root) {
  root.append(pageTitle("RENDIMIENTO", "Calificaciones", "Pulsa una asignatura para ver sus notas."));
  if (!state.data.courses.length) { root.append(empty("★", "Sin cursos", "No hay cursos.")); return; }
  for (const c of state.data.courses) {
    const body = h("div", { class: "item-list" });
    const det = h("details", { class: "group" }, h("summary", {}, h("span", { class: "g-icon", text: "★" }), h("b", { text: c.fullname })), body);
    let loaded = false;
    det.addEventListener("toggle", async () => {
      if (!det.open || loaded) return;
      loaded = true;
      body.append(h("div", { class: "muted pad", text: "Cargando…" }));
      try {
        const items = await api("grades", state.accountId, c.id, state.data.user.id);
        clear(body);
        if (!items.length) body.append(h("div", { class: "muted pad", text: "Sin calificaciones todavía." }));
        for (const i of items) body.append(h("div", { class: "item static" },
          h("span", { class: "item-main" }, h("b", { text: i.name }), i.feedback && h("span", { class: "muted", text: i.feedback })),
          h("span", { class: "grade", text: i.grade }), h("span", { class: "muted", text: i.range })));
      } catch (e) { loaded = false; clear(body).append(h("div", { class: "muted pad", text: e.message })); }
    });
    root.append(det);
  }
}

// ------------------------------------------------------------------ mensajes
async function renderMessages(root) {
  state.convId = null;
  root.append(pageTitle("COMUNICACIÓN", "Mensajes", "Tus chats del aula."));
  const convs = await api("conversations", state.accountId, state.data.user.id);
  setUnread(convs.reduce((n, cv) => n + cv.unread, 0)); // el contador sale siempre de la lista real
  const list = h("div", { class: "conv-list" });
  const thread = h("div", { class: "thread" }, h("div", { class: "muted pad", text: "Selecciona un chat." }));
  root.append(h("div", { class: "messages-layout" }, list, thread));
  if (!convs.length) { clear(list).append(h("div", { class: "muted pad", text: "No tienes chats." })); return; }

  async function openThread(cv, btn) {
    state.convId = cv.id;
    $$(".conv", list).forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    clear(thread).append(h("div", { class: "muted pad", text: "Cargando…" }));
    const msgs = await api("thread", state.accountId, state.data.user.id, cv.id);
    if (cv.unread > 0) { // el chat ya está abierto: se marca como leído y desaparece el número
      const n = cv.unread; cv.unread = 0;
      if (btn._chip) { btn._chip.remove(); btn._chip = null; }
      setUnread(state.unreadMsgs - n);
      api("markRead", state.accountId, state.data.user.id, cv.id, Math.max(cv.time || 0, ...msgs.map(m => m.time))).catch(() => {});
    }
    const box = h("div", { class: "bubbles" });
    for (const m of msgs) box.append(h("div", { class: `bubble ${m.from === state.data.user.id ? "mine" : ""}` },
      h("div", { text: m.text }), h("small", { text: fmtDate(m.time) })));
    const input = h("textarea", { rows: "2", placeholder: "Escribe un mensaje…" });
    const send = h("button", { class: "primary", text: "Enviar", onclick: async () => {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try { await api("send", state.accountId, { convId: cv.id, text }); input.value = ""; await openThread(cv, btn); }
      catch (e) { notify(e.message); }
      finally { send.disabled = false; }
    } });
    clear(thread).append(h("div", { class: "thread-head", text: cv.name }), box, h("div", { class: "composer" }, input, send));
    box.scrollTop = box.scrollHeight;
  }
  for (const cv of convs) {
    const unreadChip = cv.unread > 0 ? chip(String(cv.unread), "new") : null;
    const btn = h("button", { class: "conv" }, avatar(cv.pic, cv.name, "sm"),
      h("span", { class: "item-main" }, h("b", { text: cv.name }), h("span", { class: "muted", text: cv.last.slice(0, 60) })),
      unreadChip);
    btn._chip = unreadChip;
    btn.addEventListener("click", () => openThread(cv, btn).catch(e => notify(e.message)));
    list.append(btn);
  }
}

// ------------------------------------------------------------------ notificaciones
async function renderNotifications(root) {
  root.append(pageTitle("AVISOS", "Notificaciones", "Lo último que ha pasado en tu aula."));
  const items = await api("notifications", state.accountId, state.data.user.id);
  if (!items.length) { root.append(empty("⚑", "Sin notificaciones", "No tienes avisos recientes.")); return; }
  const box = h("div", { class: "item-list" });
  for (const n of items) {
    box.append(h("button", { class: "item", onclick: () => n.url && api("openExternal", n.url).catch(e => notify(e.message)) },
      h("span", { class: "item-icon", text: "⚑" }),
      h("span", { class: "item-main" }, h("b", { text: n.subject }), h("span", { class: "muted", text: n.text.slice(0, 140) })),
      !n.read && chip("NUEVA", "new"), h("span", { class: "muted", text: fmtDate(n.time) })));
  }
  root.append(box);
}

// ------------------------------------------------------------------ perfil
function renderProfile(root) {
  const u = state.data.user;
  root.append(pageTitle("CUENTA", "Perfil"));
  root.append(h("div", { class: "profile-card" }, avatar(u.pic, u.fullname, "lg"),
    h("div", {}, h("h2", { text: u.fullname }), h("div", { class: "muted", text: `Usuario: ${u.username}` }),
      h("div", { class: "muted", text: state.data.site.name || state.data.site.url }))));
  root.append(h("div", { class: "row-actions pad" },
    h("button", { class: "secondary", text: "Abrir el aula en el navegador", onclick: () => api("openExternal", state.data.site.url).catch(e => notify(e.message)) }),
    h("button", { class: "secondary", text: "Cambiar de cuenta", onclick: () => $("#back-launcher").click() })));
}

// ------------------------------------------------------------------ iconos de instancia
const EMOJIS = ["🎓", "📚", "📖", "✏️", "🧪", "🧮", "🌍", "🎨", "🎵", "💻", "🔬", "📐", "🧬", "⚽", "🏫", "🦉",
  "🐱", "🚀", "⭐", "🔥", "🌙", "🍀", "🎮", "🏆"];
const iconDialog = $("#icon-dialog");
let iconAcc = null, iconDraft = "";

function paintIconPreview() {
  paintIcon($("#icon-preview"), iconDraft);
  $$(".emoji-btn", iconDialog).forEach(b => b.classList.toggle("selected", b.textContent === iconDraft));
}
function openIconDialog(acc) {
  iconAcc = acc; iconDraft = acc.icon || "";
  $("#icon-title").textContent = `Icono de «${acc.name}»`;
  const grid = clear($("#emoji-grid"));
  for (const em of EMOJIS) grid.append(h("button", { type: "button", class: "emoji-btn", text: em, onclick: () => { iconDraft = em; paintIconPreview(); } }));
  paintIconPreview();
  iconDialog.showModal();
}
const closeIconDialog = () => iconDialog.close();
$("#icon-close").addEventListener("click", closeIconDialog);
iconDialog.addEventListener("click", e => { if (e.target === iconDialog) closeIconDialog(); });
$("#icon-remove").addEventListener("click", () => { iconDraft = ""; paintIconPreview(); });
$("#icon-upload").addEventListener("click", () => $("#icon-file").click());
$("#icon-file").addEventListener("change", () => {
  const f = $("#icon-file").files[0]; $("#icon-file").value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) return notify("Elige un archivo de imagen.");
  const fr = new FileReader();
  fr.onerror = () => notify("No se pudo leer la imagen.");
  fr.onload = () => {
    const img = new Image();
    img.onerror = () => notify("No se pudo abrir la imagen.");
    img.onload = () => { // recorte cuadrado de 128×128 (los GIF se guardan como imagen fija)
      const side = Math.min(img.width, img.height), cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      cv.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
      let out = cv.toDataURL("image/png");
      if (out.length > 150000) out = cv.toDataURL("image/jpeg", 0.85);
      iconDraft = out; paintIconPreview();
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(f);
});
$("#icon-save").addEventListener("click", async () => {
  try {
    const acc = await api("setAccountIcon", iconAcc.id, iconDraft);
    if (state.account && state.account.id === acc.id) { state.account = acc; paintIcon($("#inst-icon"), acc.icon); }
    closeIconDialog(); notify("Icono guardado.");
    await renderAccounts();
  } catch (e) { notify(e.message); }
});

// ------------------------------------------------------------------ ajustes (IA, overlay, segundo plano)
const OVERLAY_KEY_OPTIONS = [
  ["focus", "Solo con NotXunta Client en primer plano (Shift+Tab)"],
  ["global-safe", `Desde cualquier programa: ${MOD}+Mayús+Espacio (y Shift+Tab en la app)`],
  ["global-shift-tab", "Desde cualquier programa con Shift+Tab (bloquea Shift+Tab en el resto de programas)"]
];
const SYNC_OPTIONS = [[5, "cada 5 minutos"], [15, "cada 15 minutos"], [30, "cada 30 minutos"], [60, "cada hora"]];

async function renderSettings(root) {
  clear(root).append(pageTitle("PREFERENCIAS", "Ajustes", "IA del overlay, atajo de teclado y segundo plano."));
  const { settings: st, ai } = await api("getSettings");
  let cur = st;
  const patch = async p => {
    try { const r = await api("setSettings", p); cur = r.settings; if (r.warn) notify(r.warn); return true; }
    catch (e) { notify(e.message); return false; }
  };
  const again = () => renderSettings(root);

  // IA elegida
  const grid = h("div", { class: "ai-grid" });
  for (const a of ai) {
    grid.append(h("button", { class: `ai-btn ${cur.ai === a.id ? "selected" : ""}`, onclick: async () => {
      if (await patch({ ai: a.id, aiAsked: true })) { notify(`IA elegida: ${a.name}.`); again(); }
    } }, h("b", { text: a.name }), h("small", { text: a.host })));
  }
  root.append(h("div", { class: "settings-panel wide" }, h("h2", { text: "IA del overlay" }),
    h("p", { text: cur.ai ? "Esta es la IA que se abre con el botón de IA del overlay. Pulsa otra para cambiarla." : "Todavía no has elegido ninguna. Se abrirá con el botón de IA del overlay." }), grid));

  // Overlay
  const keySel = h("select", {}, OVERLAY_KEY_OPTIONS.map(([v, l]) => h("option", { value: v, text: l, selected: cur.overlayKey === v ? "" : null })));
  keySel.addEventListener("change", async () => { await patch({ overlayKey: keySel.value }); again(); });
  root.append(h("div", { class: "settings-panel wide" }, h("h2", { text: "Overlay (Shift+Tab)" }),
    h("p", { text: "Una capa sobre cualquier ventana con Google, Gmail, tu IA y el aula virtual original. Se abre y se cierra con Shift+Tab." }),
    h("div", { class: "zoom-row" }, keySel,
      h("button", { class: "secondary small", text: "Abrir ahora", onclick: () => api("openOverlay").catch(e => notify(e.message)) })),
    h("p", { class: "settings-note", text: "Si Shift+Tab es global, deja de funcionar como «tabulador inverso» en los demás programas mientras NotXunta Client esté abierto." })));

  // Segundo plano y avisos
  const row = (title, desc, key, after) => {
    const cb = h("input", { type: "checkbox" }); cb.checked = !!cur[key];
    cb.addEventListener("change", async () => { await patch({ [key]: cb.checked }); if (after) again(); });
    return h("label", { class: "switch-row" }, h("span", {}, h("b", { text: title }), h("small", { text: desc })), cb);
  };
  const intSel = h("select", {}, SYNC_OPTIONS.map(([v, l]) => h("option", { value: String(v), text: l, selected: cur.syncMinutes === v ? "" : null })));
  intSel.disabled = !cur.bgSync;
  intSel.addEventListener("change", () => patch({ syncMinutes: Number(intSel.value) }));
  root.append(h("div", { class: "settings-panel wide" }, h("h2", { text: "Segundo plano y avisos" }),
    row("Seguir en segundo plano al cerrar la ventana", "NotXunta Client se queda en la bandeja del sistema (junto al reloj, o en la barra de menú en Mac). Para salir del todo, usa «Salir» en su menú.", "keepBackground"),
    row("Buscar novedades en segundo plano", "Comprueba tus aulas sin tener la ventana abierta y te avisa si hay contenido nuevo.", "bgSync", true),
    h("div", { class: "switch-row" }, h("span", {}, h("b", { text: "Frecuencia de comprobación" }), h("small", { text: "Con menos comprobaciones se gasta menos batería y datos." })), intSel),
    row("Avisar de mensajes nuevos", "Comprueba tus chats cada minuto mientras NotXunta Client esté abierto (también en la bandeja) y te avisa cuando llega un mensaje.", "msgNotify"),
    row("Avisos emergentes estilo Steam", "Una notificación en la esquina de la pantalla. Si la desactivas se usan las notificaciones normales del sistema.", "toasts")));
  root.append(videoSettingsPanel(row));
  root.append(updatesPanel(row));
}

// (se añade al final de Ajustes) vídeo de fondo
function videoSettingsPanel(row) {
  return h("div", { class: "settings-panel wide" }, h("h2", { text: "Vídeo de fondo" }),
    row("Modo compatible", "Desactiva la decodificación por hardware del vídeo. Actívalo si el vídeo de fondo no se ve o va a tirones en este PC. Se aplica al reiniciar.", "videoCompat"),
    h("div", { class: "zoom-row" }, h("button", { class: "secondary small", text: "Reiniciar ahora", onclick: () => api("relaunch").catch(e => notify(e.message)) })));
}

// Actualizaciones automáticas
function updatesPanel(row) {
  const msg = h("small", { class: "muted", text: "…" });
  const btns = h("div", { class: "zoom-row" });
  const paint = st => {
    msg.textContent = st.message || `Versión instalada: ${aula.version}`;
    clear(btns);
    if (st.state === "ready") btns.append(h("button", { class: "primary small", text: "Reiniciar e instalar ahora", onclick: () => api("updateInstall").catch(e => notify(e.message)) }));
    else if (st.state === "available") btns.append(h("button", { class: "primary small", text: "Abrir página de descarga", onclick: () => api("updateOpenReleases").catch(e => notify(e.message)) }));
    else if (st.state !== "unsupported") btns.append(h("button", { class: "secondary small", text: "Buscar actualizaciones", disabled: st.state === "checking" || st.state === "downloading" ? "" : null,
      onclick: () => api("updateCheck").then(paint).catch(e => notify(e.message)) }));
  };
  api("updateStatus").then(paint).catch(() => {});
  const off = aula.onUpdate(st => { if (msg.isConnected) paint(st); else off(); });
  return h("div", { class: "settings-panel wide" }, h("h2", { text: `Actualizaciones · v${aula.version}` }),
    row("Buscar e instalar actualizaciones automáticamente", IS_MAC || aula.platform === "linux" ? "Se comprueba al abrir y cada 6 horas. En Windows y Linux (AppImage) se instala sola; en Mac y Linux .deb te avisa y abre la página de descarga." : "Se comprueba al abrir y cada 6 horas; se descarga en segundo plano y se instala al cerrar la app.", "autoUpdate"),
    h("div", { class: "pad" }, msg), btns);
}

// Primer inicio: elegir IA
const aiDialog = $("#ai-dialog");
async function maybeAskAi() {
  try {
    const { settings: st, ai } = await api("getSettings");
    if (st.aiAsked) return;
    const grid = clear($("#ai-grid"));
    for (const a of ai) {
      grid.append(h("button", { type: "button", class: "ai-btn", onclick: async () => {
        try { await api("setSettings", { ai: a.id, aiAsked: true }); notify(`IA elegida: ${a.name}. Ábrela desde el overlay (Shift+Tab).`); } catch (e) { notify(e.message); }
        aiDialog.close();
      } }, h("b", { text: a.name }), h("small", { text: a.host })));
    }
    aiDialog.showModal();
  } catch { /* se preguntará la próxima vez */ }
}
const skipAi = () => aiDialog.close();
$("#ai-close").addEventListener("click", skipAi);
$("#ai-skip").addEventListener("click", skipAi);
aiDialog.addEventListener("close", () => { api("setSettings", { aiAsked: true }).catch(() => {}); }); // no se vuelve a preguntar

// Botones para abrir el overlay
for (const id of ["#open-overlay", "#open-overlay-2"]) $(id).addEventListener("click", () => api("openOverlay").catch(e => notify(e.message)));

// ------------------------------------------------------------------ avisos que llegan del proceso principal
// Mensajes nuevos (comprobados cada minuto): actualiza el contador y, con la app delante, avisa dentro de ella.
aula.onMessages(p => {
  if (state.accountId && p.accountId === state.accountId) {
    setUnread(p.total);
    if (p.fresh.length && state.view === "messages" && !state.convId && !$("#msg-dialog").open) setIView("messages"); // lista al día
  }
  if (p.fresh.length && document.hasFocus()) {
    const f = p.fresh[0];
    notify(p.fresh.length > 1 ? `✉ ${p.fresh.length} mensajes nuevos` : `✉ ${f.name}: ${f.text}`.slice(0, 140));
  }
});
// Clic en un aviso de mensaje: abre esa aula en «Mensajes».
aula.onNavigate(async p => {
  try {
    if (p && p.view === "friends") { openFriends(); return; }
    if (!p || !IVIEWS[p.view]) return;
    if (state.accountId === p.accountId && state.data) { state.courseId = null; state.sectionId = null; setIView(p.view); return; }
    const acc = (await api("listAccounts")).find(a => a.id === p.accountId);
    if (!acc) return;
    if (state.accountId) api("closeInstance", state.accountId).catch(() => {});
    await openInstance(acc);
    if (state.accountId === acc.id) setIView(p.view);
  } catch (e) { notify(e.message); }
});

// ------------------------------------------------------------------ tablón de novedades
const KIND_LABEL = { new: "NUEVO", fix: "ARREGLO", improve: "MEJORA" };
async function renderNews(root) {
  const { versions, current, seen } = await api("changelog");
  clear(root).append(pageTitle("TABLÓN DE ACTUALIZACIONES", "Novedades", "Cada función y arreglo de cada versión de NotXunta Client."));
  versions.forEach((v, i) => {
    const isCur = v.version === current;
    root.append(h("div", { class: `news-card${i === 0 ? " latest" : ""}` },
      h("div", { class: "news-head" },
        h("span", { class: "news-ver", text: `v${v.version}` }),
        isCur && h("span", { class: "chip ok", text: "Tu versión" }),
        v.version === versions[0].version && seen !== current && h("span", { class: "chip", text: "Recién actualizada" })),
      h("h2", { text: v.headline }),
      v.summary && h("p", { class: "news-sum", text: v.summary }),
      h("ul", { class: "news-list" }, v.items.map(it => h("li", {},
        h("span", { class: `news-kind ${it.kind}`, text: KIND_LABEL[it.kind] || "" }),
        h("div", {}, h("b", { text: it.title }), h("small", { text: it.text })))))));
  });
  if (seen !== current) { await api("changelogSeen").catch(() => {}); setNewsBadge(false); }
}
function setNewsBadge(on) { $$('[data-badge="news"]').forEach(b => { b.hidden = !on; }); }
api("changelog").then(c => setNewsBadge(c.seen !== c.current)).catch(() => {});

// ------------------------------------------------------------------ arranque
renderAccounts();
maybeAskAi();


// ------------------------------------------------------------------ estado «en línea»
function agoText(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 2) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
}
function paintPresence(el, r) {
  const on = !!r.online;
  el.classList.toggle("on", on);
  el.title = on ? "En línea" : r.last_seen ? `Visto ${agoText(r.last_seen)}` : "Desconectado";
  el.lastChild.textContent = on ? "En línea" : r.last_seen ? `Visto ${agoText(r.last_seen)}` : "Desconectado";
}
function presenceBit(r) {
  const el = h("span", { class: "presence-bit", "data-uid": r.other_id }, h("i", { class: "presence-dot" }), h("span", {}));
  paintPresence(el, r);
  return el;
}

// ------------------------------------------------------------------ archivos
const fileExt = name => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(name || ""); return m ? m[1].toUpperCase() : "···"; };
const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB` : `${(n / 1073741824).toFixed(1)} GB`;

// Barra de espacio usado. quota = 0 → el servidor no indica límite.
function quotaBar(used, quota, label) {
  const pct = quota ? Math.min(100, Math.round(used / quota * 100)) : 0;
  const bar = h("div", { class: `quota-bar${pct >= 90 ? " full" : ""}` }, h("i", { style: `width:${pct}%` }));
  return h("div", { class: "quota" },
    h("div", { class: "quota-text" }, h("b", { text: quota ? `${fmtBytes(used)} de ${fmtBytes(quota)}` : `${fmtBytes(used)} usados` }),
      h("span", { class: "muted", text: quota ? `${label} · ${pct} % ocupado · quedan ${fmtBytes(Math.max(0, quota - used))}` : `${label} · el servidor no indica un límite` })),
    quota ? bar : null);
}

function fileRow(name, sub, ...acts) {
  return h("div", { class: "friend-row file-row" }, h("div", { class: "file-ico", text: fileExt(name) }),
    h("span", { class: "item-main" }, h("b", { text: name }), h("span", { class: "muted", text: sub })), h("div", { class: "acts" }, ...acts));
}
const fileBtn = (text, cls, fn) => h("button", { class: `${cls} small`, text, onclick: async e => {
  const b = e.currentTarget; b.disabled = true;
  try { await fn(); } catch (er) { if (er.message !== "Cancelado.") notify(er.message); }
  b.disabled = false;
} });

function uploadSummary(r, where) {
  if (r.canceled) return;
  if (r.uploaded) notify(`${r.uploaded} ${r.uploaded === 1 ? "archivo subido" : "archivos subidos"} a ${where}.`);
  if (r.errors && r.errors.length) setTimeout(() => notify(r.errors.slice(0, 2).join(" · ") + (r.errors.length > 2 ? ` (y ${r.errors.length - 2} más)` : "")), r.uploaded ? 3400 : 0);
}

// Pantalla «Archivos NotXunta» (la misma en el lanzador y dentro de cada aula; no depende de ningún aula).
async function renderNxFiles(root) {
  clear(root);
  root.append(pageTitle("TU CUENTA", "Archivos NotXunta", "Archivos privados guardados en tu cuenta NotXunta: los ves desde cualquier ordenador."));
  const body = h("div", {});
  root.append(body);
  await nxFilesPanel(body);
}

async function nxFilesPanel(root) {
  clear(root);
  let st;
  try { st = await api("cloudStatus"); } catch (e) { root.append(empty("☁", "Sin conexión con el servidor", e.message)); return; }
  if (!st.configured) { root.append(empty("☁", "Servidor de cuentas sin configurar", "Esta versión de la app no tiene el servidor de cuentas NotXunta.")); return; }
  if (!st.signedIn || !st.profile) {
    root.append(h("div", { class: "empty-panel" }, h("div", { class: "empty-icon", text: "☁" }), h("h2", { text: "Entra en tu cuenta NotXunta" }),
      h("p", { text: "Los Archivos NotXunta se guardan en tu cuenta para que los tengas en cualquier ordenador." }),
      h("button", { class: "primary", text: "Abrir cuenta", onclick: openFriends })));
    return;
  }
  if (st.presenceOutdated) { root.append(empty("!", "Falta actualizar el servidor", "Abre el SQL Editor de Supabase, pega supabase/migration-0.6.1.sql y pulsa Run. No hace falta reinstalar la app.")); return; }
  root.append(h("div", { class: "muted pad", text: "Cargando tus archivos…" }));
  let r;
  try { r = await api("nxList"); } catch (e) { clear(root); root.append(empty("!", "No se pudieron cargar tus archivos", e.message)); return; }
  clear(root);
  const reload = () => nxFilesPanel(root).catch(e => notify(e.message));
  root.append(quotaBar(r.usage.used, r.usage.quota, "de tu cuenta NotXunta"));
  root.append(h("p", { class: "muted files-note", text: `Solo tú puedes verlos. ${r.usage.maxFile ? `Máximo ${fmtBytes(r.usage.maxFile)} por archivo. ` : ""}Se sincronizan con tu cuenta: aparecen en cualquier ordenador donde inicies sesión.` }));
  root.append(h("div", { class: "files-toolbar" }, h("span", {}), h("div", { class: "acts" },
    fileBtn("＋ Subir archivos", "primary", async () => {
      showLoading("Subiendo archivos…");
      try { const res = await api("nxUpload"); uploadSummary(res, "Archivos NotXunta"); if (!res.canceled) await reload(); }
      finally { hideLoading(); }
    }),
    h("button", { class: "secondary small", text: "⟳ Actualizar", onclick: reload }))));
  if (!r.files.length) { root.append(empty("❐", "Todavía no tienes archivos", "Sube apuntes, documentos o lo que quieras tener siempre a mano en tu cuenta.")); return; }
  const list = h("div", { class: "item-list" });
  for (const f of r.files) {
    list.append(fileRow(f.name, [fmtBytes(f.size), new Date(f.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })].join(" · "),
      fileBtn("Abrir", "primary", async () => {
        showLoading("Abriendo el archivo…");
        try { const res = await api("nxOpen", f.id, f.name); if (res.note) notify(res.note); }
        finally { hideLoading(); }
      }),
      fileBtn("Guardar como…", "secondary", async () => {
        showLoading("Descargando…");
        try { if (await api("nxSave", f.id, f.name)) notify("Archivo guardado."); }
        finally { hideLoading(); }
      }),
      fileBtn("Eliminar", "secondary", async () => {
        if (!confirm(`¿Eliminar «${f.name}» de tus Archivos NotXunta? No se puede deshacer.`)) throw new Error("Cancelado.");
        await api("nxDelete", f.id); notify("Archivo eliminado."); await reload();
      })));
  }
  root.append(list);
}
