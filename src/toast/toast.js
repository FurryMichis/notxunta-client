"use strict";
const $ = id => document.getElementById(id);
const el = $("toast");
let accent = "#9b72f2";
try { accent = JSON.parse(localStorage.getItem("nx-appearance") || "{}").accent || accent; } catch { /* sin almacenamiento */ }
if (/^#[0-9a-f]{6}$/i.test(accent)) el.style.setProperty("--accent", accent);

window.toastApi.onShow(p => {
  $("title").textContent = p.title;
  $("body").textContent = p.body;
  $("hint").textContent = p.action === "overlay" ? "Pulsa para abrir el overlay"
    : p.action === "update" ? "Pulsa para reiniciar e instalar" : p.action === "releases" ? "Pulsa para abrir la página de descarga" : p.action === "friends" ? "Pulsa para ver tus solicitudes" : p.action.startsWith("messages:") ? "Pulsa para abrir tus mensajes" : "Pulsa para abrir NotXunta Client";
  const ico = $("ico");
  ico.textContent = ""; ico.style.backgroundImage = "";
  if (p.icon && p.icon.startsWith("data:image/")) ico.style.backgroundImage = `url("${p.icon}")`;
  else ico.textContent = p.icon || "🔔";
  el.classList.remove("out");
  void el.offsetWidth; // reinicia la animación
  el.classList.add("in");
});
window.toastApi.onHide(() => { el.classList.remove("in"); el.classList.add("out"); });
el.addEventListener("click", e => { if (e.target.id !== "x") window.toastApi.click(); });
$("x").addEventListener("click", e => { e.stopPropagation(); window.toastApi.dismiss(); });
el.addEventListener("mouseenter", () => window.toastApi.hold(true));
el.addEventListener("mouseleave", () => window.toastApi.hold(false));
