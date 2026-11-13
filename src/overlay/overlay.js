"use strict";
// Interfaz del overlay. Todo el texto dinámico se inserta con textContent.
const api = window.overlayApi;
const $ = s => document.querySelector(s);
const SLOT = $("#slot");

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const setIcon = (el, icon, fallback) => {
  el.textContent = ""; el.style.backgroundImage = "";
  if (typeof icon === "string" && icon.startsWith("data:image/")) el.style.backgroundImage = `url("${icon}")`;
  else el.textContent = icon || fallback;
};

try {
  const a = JSON.parse(localStorage.getItem("nx-appearance") || "{}").accent;
  if (/^#[0-9a-f]{6}$/i.test(a)) document.documentElement.style.setProperty("--accent", a);
} catch { /* sin almacenamiento */ }

let data = null;              // { settings, accounts, ai, hotkey }
let ts = { tabs: [], active: null };   // pestañas (estado que manda el proceso principal)
let mode = "home";            // de la pestaña activa: "home" (inicio) | "web"
let homeMode = "main";        // "main" | "ai" | "aulas"
let page = { url: "", loading: false, canBack: false, canForward: false, error: "" };
let pendingHome = null, forceQ = false;
const activeT = () => ts.tabs.find(t => t.id === ts.active) || null;
const hostOf = u => { try { return new URL(u).host; } catch { return ""; } };
const MOD = () => (data && data.mod) || "Ctrl";
const wantsTab = e => !!(e && (e.ctrlKey || e.metaKey));   // Ctrl + clic = en pestaña nueva

function applyState(s) {
  const prev = ts.active;
  ts = s; page = s.page;
  const t = activeT();
  mode = t && !t.home ? "web" : "home";
  if (prev !== s.active) { homeMode = pendingHome || "main"; pendingHome = null; forceQ = true; }
  render();
  if (prev !== s.active && mode === "home") $("#q").focus();
}

// Pantallas de inicio (elegir IA / aula): si la pestaña activa ya tiene una página, se usa una pestaña nueva.
async function showHomeScreen(sub) {
  if (mode === "home") { homeMode = sub; render(); return; }
  pendingHome = sub;
  try { await api.tabNew(); } catch (e) { pendingHome = null; flash(e.message); }
}

function renderTabs() {
  const box = $("#tabs"); box.textContent = "";
  for (const t of ts.tabs) {
    const label = t.home ? "Nueva pestaña" : (t.title || hostOf(t.url) || "Cargando…");
    box.append(h("div", {
      class: `tab ${t.id === ts.active ? "active" : ""}`, role: "tab", title: label, "aria-selected": t.id === ts.active ? "true" : "false",
      onclick: () => api.tabSwitch(t.id).catch(() => {}),
      onauxclick: e => { if (e.button === 1) { e.preventDefault(); api.tabClose(t.id).catch(() => {}); } }
    },
      h("span", { class: `tdot ${t.loading ? "on" : ""}` }),
      h("span", { class: "t", text: label }),
      h("button", { class: "x", title: `Cerrar pestaña (${MOD()}+W)`, "aria-label": "Cerrar pestaña", text: "×",
        onclick: e => { e.stopPropagation(); api.tabClose(t.id).catch(() => {}); } })));
  }
  box.append(h("button", { id: "newtab", title: `Nueva pestaña (${MOD()}+T)`, "aria-label": "Nueva pestaña", text: "+",
    onclick: () => api.tabNew().catch(e => flash(e.message)) }));
  const act = box.querySelector(".tab.active");
  if (act) act.scrollIntoView({ inline: "nearest", block: "nearest" });
}

const aiName = () => { const a = data && data.ai.find(x => x.id === data.settings.ai); return a ? a.name : null; };

// ------------------------------------------------------------ colocación de la web integrada
function sendLayout() {
  const showWeb = mode === "web" && !page.error;
  const r = SLOT.getBoundingClientRect();
  api.layout({ visible: showWeb, rect: { x: r.left, y: r.top, width: r.width, height: r.height } }).catch(() => {});
}
new ResizeObserver(() => sendLayout()).observe(SLOT);
addEventListener("resize", sendLayout);

function render() {
  $("#home").hidden = mode === "web";
  $("#err").hidden = !(mode === "web" && page.error);
  $("#loadbar").hidden = !(mode === "web" && page.loading);
  $("#b-back").disabled = !page.canBack;
  $("#b-fwd").disabled = !page.canForward;
  $("#b-reload").disabled = mode !== "web";
  $("#b-ext").disabled = mode !== "web" || !page.url;
  if (forceQ || document.activeElement !== $("#q")) $("#q").value = mode === "web" ? page.url : "";
  forceQ = false;
  renderTabs();
  if (mode === "web" && page.error) {
    const e = $("#err"); e.textContent = "";
    e.append(h("b", { text: "No se pudo cargar la página" }), h("span", { text: page.error }),
      h("button", { class: "qbtn", text: "Reintentar", onclick: () => api.nav("reload") }));
  }
  if (mode === "home") renderHome();
  renderQuick();
  sendLayout();
}

// ------------------------------------------------------------ destinos
async function go(target, newTab = false) {
  try { await api.go(target, { newTab }); } // la pestaña pasa a "web" cuando llega el estado del proceso principal
  catch (e) { flash(e.message); }
}
function flash(msg) { $("#hint").textContent = msg; setTimeout(updateHint, 5000); }
function updateHint() { $("#hint").textContent = data ? `${data.hotkey} o Esc para cerrar · ${MOD()}+T pestaña nueva · ${MOD()}+W cerrar · Ctrl+Tab cambiar · ${MOD()}+clic abre en pestaña nueva · tu sesión se guarda solo en este overlay` : ""; }

function openAi(e) {
  if (!data.settings.ai) { showHomeScreen("ai"); return; }
  go({ kind: "ai" }, wantsTab(e));
}
function openAula(e) {
  const n = data.accounts.length;
  if (n === 0) { flash("Añade una cuenta en NotXunta Client para abrir su aula."); return; }
  if (n === 1) { go({ kind: "aula", id: data.accounts[0].id }, wantsTab(e)); return; }
  showHomeScreen("aulas");
}

function quickBtn(icon, label, onclick, extra = {}) {
  const ic = h("span", { class: "ic" }); setIcon(ic, icon, "•");
  return h("button", { class: `qbtn ${extra.on ? "on" : ""}`, onclick, disabled: extra.disabled ? "" : null }, ic, label);
}
function renderQuick() {
  const q = $("#quick"); q.textContent = "";
  q.append(
    quickBtn("🔎", "Google", e => go({ kind: "google" }, wantsTab(e))),
    quickBtn("✉️", "Gmail", e => go({ kind: "gmail" }, wantsTab(e))),
    quickBtn("🎓", "Aula virtual original", openAula),
    quickBtn("🤖", aiName() ? `IA: ${aiName()}` : "Elegir IA", openAi)
  );
}

// ------------------------------------------------------------ inicio del overlay
function tile(icon, title, sub, onclick, opts = {}) {
  const big = h("div", { class: "big" }); setIcon(big, icon, "•");
  return h("button", { class: `tile ${opts.selected ? "sel" : ""}`, onclick, "aria-disabled": opts.disabled ? "true" : null }, big, h("b", { text: title }), sub && h("small", { text: sub }));
}
function renderHome() {
  const root = $("#home"); root.textContent = "";
  if (homeMode === "ai") {
    root.append(h("button", { class: "back", text: "← Volver", onclick: () => { homeMode = "main"; render(); } }),
      h("h1", { text: "Elige tu IA" }),
      h("p", { text: "Se abrirá desde el botón de IA del overlay. Puedes cambiarla cuando quieras aquí o en Ajustes." }));
    const grid = h("div", { class: "tiles" });
    for (const a of data.ai) {
      grid.append(tile("🤖", a.name, a.host, async () => {
        try { data.settings = await api.setAi(a.id); await go({ kind: "ai" }); } catch (e) { flash(e.message); }
      }, { selected: data.settings.ai === a.id }));
    }
    root.append(grid); return;
  }
  if (homeMode === "aulas") {
    root.append(h("button", { class: "back", text: "← Volver", onclick: () => { homeMode = "main"; render(); } }),
      h("h1", { text: "Aula virtual original" }), h("p", { text: "¿Qué aula quieres abrir?" }));
    const grid = h("div", { class: "tiles" });
    for (const acc of data.accounts) {
      let host = acc.url; try { host = new URL(acc.url).host; } catch { /* tal cual */ }
      grid.append(tile(acc.icon || "🎓", acc.name, host, e => go({ kind: "aula", id: acc.id }, wantsTab(e))));
    }
    root.append(grid); return;
  }
  root.append(h("h1", { text: "¿Qué necesitas?" }),
    h("p", { text: "Busca arriba o abre uno de estos accesos. Todo se queda dentro del overlay." }));
  const grid = h("div", { class: "tiles" },
    tile("🔎", "Google", "Buscar en la web", e => go({ kind: "google" }, wantsTab(e))),
    tile("✉️", "Gmail", "Tu correo", e => go({ kind: "gmail" }, wantsTab(e))),
    tile("🎓", "Aula virtual original", data.accounts.length ? "El aula de Moodle tal cual, en el navegador" : "Añade una cuenta para usarlo", openAula, { disabled: !data.accounts.length }),
    tile("🤖", aiName() ? `Tu IA: ${aiName()}` : "Elegir una IA", aiName() ? "Pulsa para abrirla" : "Todavía no has elegido ninguna", openAi));
  root.append(grid);
  if (aiName()) root.append(h("p", { class: "gap" }, h("button", { class: "back", text: "Cambiar de IA", onclick: () => { homeMode = "ai"; render(); } })));
}

// ------------------------------------------------------------ eventos
$("#omni").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("#q").value.trim();
  if (text) { $("#q").blur(); go({ kind: "input", text }); }
});
$("#b-back").addEventListener("click", () => api.nav("back"));
$("#b-fwd").addEventListener("click", () => api.nav("forward"));
$("#b-reload").addEventListener("click", () => api.nav(page.loading ? "stop" : "reload"));
$("#b-home").addEventListener("click", () => showHomeScreen("main"));
$("#b-ext").addEventListener("click", () => api.external().catch(e => flash(e.message)));
$("#b-close").addEventListener("click", () => api.close());
$("#backdrop").addEventListener("mousedown", e => { if (e.target.id === "backdrop") api.close(); });
addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); api.close(); } });

api.onState(applyState);
api.onFlash(flash);
api.onFocusOmni(() => { $("#q").focus(); $("#q").select(); });
api.onShown(async () => {
  try { data = await api.init(); if (data.state) { forceQ = true; applyState(data.state); } } catch { /* se mantiene lo anterior */ }
  updateHint(); render();
  if (mode !== "web") $("#q").focus();
});

(async () => {
  data = await api.init();
  updateHint();
  applyState(data.state);
  $("#q").focus();
})();
