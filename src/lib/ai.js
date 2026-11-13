"use strict";
// Lista de IAs disponibles para el overlay y destinos rápidos. Vive solo en el
// proceso principal: la interfaz recibe únicamente id/nombre/dirección.

const AI_LIST = [
  { id: "chatgpt",    name: "ChatGPT",           url: "https://chatgpt.com/" },
  { id: "claude",     name: "Claude",            url: "https://claude.ai/" },
  { id: "gemini",     name: "Gemini",            url: "https://gemini.google.com/" },
  { id: "copilot",    name: "Microsoft Copilot", url: "https://copilot.microsoft.com/" },
  { id: "perplexity", name: "Perplexity",        url: "https://www.perplexity.ai/" },
  { id: "deepseek",   name: "DeepSeek",          url: "https://chat.deepseek.com/" },
  { id: "mistral",    name: "Le Chat (Mistral)", url: "https://chat.mistral.ai/" },
  { id: "grok",       name: "Grok",              url: "https://grok.com/" }
];

const SITES = {
  google: "https://www.google.com/",
  gmail: "https://mail.google.com/",
  search: "https://www.google.com/search?q="
};

const aiById = id => AI_LIST.find(a => a.id === id) || null;

// Convierte lo que escribe el usuario en una URL http(s) segura o en una búsqueda de Google.
function resolveInput(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try { return new URL(t).toString(); } catch { /* se trata como búsqueda */ }
  } else if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(t)) {
    try { return new URL("https://" + t).toString(); } catch { /* se trata como búsqueda */ }
  }
  return SITES.search + encodeURIComponent(t);
}

module.exports = { AI_LIST, SITES, aiById, resolveInput };
