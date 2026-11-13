"use strict";
const $ = id => document.getElementById(id);
window.splashApi.onState(s => {
  $("status").textContent = String(s.text || "");
  if (s.version) $("ver").textContent = `v${s.version}`;
  const bar = $("bar");
  if (typeof s.percent === "number" && s.percent >= 0) { bar.classList.add("det"); $("fill").style.width = `${Math.min(100, s.percent)}%`; }
  else bar.classList.remove("det");
  $("skip").hidden = !s.canSkip;
});
$("skip").addEventListener("click", () => window.splashApi.skip());
