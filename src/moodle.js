"use strict";
// Cliente de la API de servicios web de Moodle (la misma que usa la app oficial
// "Moodle"). Sin dependencias de Electron para poder probarlo con Node.

const SERVICE = "moodle_mobile_app";
const CUT_MARKERS = [
  "/login/", "/my/", "/course/", "/mod/", "/user/", "/pluginfile.php",
  "/webservice/", "/index.php", "/calendar/", "/message/", "/grade/", "/enrol/"
];

function normalizeUrl(input, allowHttp = false) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new Error("Introduce una dirección web válida."); }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
    throw new Error("Por seguridad, utiliza una dirección HTTPS.");
  }
  let p = u.pathname;
  for (const m of CUT_MARKERS) {
    const i = p.indexOf(m);
    if (i >= 0) p = p.slice(0, i);
  }
  p = p.replace(/\/+$/, "");
  return u.origin + p;
}

function flatten(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === "object") flatten(x, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(x));
      });
    } else if (v !== null && typeof v === "object") flatten(v, key, out);
    else if (v !== undefined && v !== null) out.append(key, String(v));
  }
  return out;
}

async function pmap(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function friendlyLoginError(code, message) {
  switch (code) {
    case "invalidlogin": return "Usuario o contraseña incorrectos.";
    case "usernotallowed":
    case "servicenotavailable":
    case "enablewsdescription":
      return "Esta aula no permite el acceso desde aplicaciones externas (servicio móvil desactivado).";
    default: return message || "No se pudo iniciar sesión.";
  }
}

class MoodleClient {
  constructor(baseUrl, { allowHttp = false, fetchImpl } = {}) {
    this.base = normalizeUrl(baseUrl, allowHttp);
    this.token = null;
    this._fetch = fetchImpl || ((...a) => fetch(...a));
  }

  isSameHost(url) {
    try { return new URL(url).host === new URL(this.base).host; } catch { return false; }
  }

  // Añade el token a URLs de archivos del propio sitio (nunca a otros dominios).
  withToken(url) {
    if (!this.isSameHost(url)) throw new Error("La dirección no pertenece al aula.");
    const u = new URL(url);
    if (!u.pathname.includes("/webservice/pluginfile.php/")) {
      u.pathname = u.pathname.replace("/pluginfile.php/", "/webservice/pluginfile.php/");
    }
    u.searchParams.set("token", this.token);
    return u.toString();
  }

  async _post(path, body) {
    const res = await this._fetch(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "error",   // el aula no debe redirigir estas peticiones: si lo hiciera, la contraseña/token podrían acabar en otro sitio
      signal: AbortSignal.timeout(40000)
    }).catch(e => {
      if (e && e.name !== "TimeoutError" && e.cause && /redirect/i.test(String(e.cause.message || e.cause))) throw new Error("El aula redirige a otra dirección. Usa el enlace final y completo (con https://).");
      throw e;
    });
    if (!res.ok) throw new Error(`El aula respondió con el error HTTP ${res.status}.`);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new Error("Respuesta inesperada del aula. Comprueba que el enlace es el de Moodle."); }
  }

  async login(username, password) {
    const r = await this._post("/login/token.php", new URLSearchParams({ username, password, service: SERVICE }));
    if (r && r.token) { this.token = r.token; return; }
    const e = new Error(friendlyLoginError(r && r.errorcode, r && r.error));
    e.errorcode = r && r.errorcode;
    throw e;
  }

  async call(fn, params = {}) {
    const body = flatten(params);
    body.set("wstoken", this.token);
    body.set("wsfunction", fn);
    body.set("moodlewsrestformat", "json");
    const r = await this._post("/webservice/rest/server.php", body);
    if (r && r.exception) {
      const e = new Error(r.message || r.exception);
      e.errorcode = r.errorcode;
      throw e;
    }
    return r;
  }

  siteInfo() { return this.call("core_webservice_get_site_info"); }
  courses(userid) { return this.call("core_enrol_get_users_courses", { userid }); }
  courseContents(courseid) { return this.call("core_course_get_contents", { courseid }); }
  assignments(courseids) { return this.call("mod_assign_get_assignments", { courseids }); }

  async submissionStatus(assignid) {
    const r = await this.call("mod_assign_get_submission_status", { assignid });
    const s = r && r.lastattempt && r.lastattempt.submission && r.lastattempt.submission.status;
    return s === "submitted" ? "submitted" : s === "draft" ? "draft" : "pending";
  }

  async teachers(courseId) {
    try {
      const users = await this.call("core_enrol_get_enrolled_users", { courseid: courseId });
      const t = users.filter(u => (u.roles || []).some(r => ["editingteacher", "teacher"].includes(r.shortname)));
      if (t.length) {
        return t.map(u => ({ id: u.id, fullname: u.fullname, pic: u.profileimageurl || u.profileimageurlsmall || "" }));
      }
    } catch { /* sin permiso para ver participantes: probamos con los contactos del curso */ }
    try {
      const r = await this.call("core_course_get_courses_by_field", { field: "id", value: courseId });
      const contacts = (r.courses && r.courses[0] && r.courses[0].contacts) || [];
      if (!contacts.length) return [];
      const users = await this.call("core_user_get_users_by_field", { field: "id", values: contacts.map(c => c.id) });
      return users.map(u => ({ id: u.id, fullname: u.fullname, pic: u.profileimageurl || "" }));
    } catch { return []; }
  }

  // Participantes del curso (si el aula no deja verlos, lanza error).
  async participants(courseId) {
    const users = await this.call("core_enrol_get_enrolled_users", { courseid: courseId });
    return (Array.isArray(users) ? users : []).map(u => ({
      id: u.id, fullname: u.fullname || "", pic: u.profileimageurl || u.profileimageurlsmall || "",
      roles: (u.roles || []).map(r => r.shortname)
    })).sort((a, b) => a.fullname.localeCompare(b.fullname, "es"));
  }

  async sendMessage(toUserId, text) {
    const r = await this.call("core_message_send_instant_messages", {
      messages: [{ touserid: toUserId, text, textformat: 0 }]
    });
    if (r && r[0] && r[0].errormessage) throw new Error(r[0].errormessage);
    return true;
  }
  sendToConversation(conversationid, text) {
    return this.call("core_message_send_messages_to_conversation", {
      conversationid, messages: [{ text, textformat: 0 }]
    });
  }
  conversations(userid, limitnum = 50) { return this.call("core_message_get_conversations", { userid, limitnum }); }
  markConversationRead(userid, conversationid) {
    return this.call("core_message_mark_all_conversation_messages_as_read", { userid, conversationid });
  }
  thread(currentuserid, convid) {
    return this.call("core_message_get_conversation_messages", { currentuserid, convid, limitnum: 60, newest: 1 });
  }
  notifications(useridto) { return this.call("message_popup_get_popup_notifications", { useridto, limit: 40 }); }

  calendar() {
    const now = Math.floor(Date.now() / 1000);
    return this.call("core_calendar_get_action_events_by_timesort", {
      timesortfrom: now - 7 * 86400, timesortto: now + 90 * 86400, limitnum: 100
    });
  }

  grades(courseid, userid) { return this.call("gradereport_user_get_grade_items", { courseid, userid }); }
}

// ---------------------------------------------------------------------------
// Sincronización completa de una cuenta.

const DOC_MODS = new Set(["resource", "folder", "page", "book", "imscp"]);
const TASK_MODS = new Set(["assign"]);

function classify(modname) {
  if (DOC_MODS.has(modname)) return "doc";
  if (modname === "url") return "link";
  if (TASK_MODS.has(modname)) return "task";
  return "other";
}

async function syncAll(client, onProgress = () => {}) {
  onProgress("Leyendo tu perfil…");
  const info = await client.siteInfo();
  onProgress("Buscando tus asignaturas…");
  const courses = await client.courses(info.userid);

  const assignByCm = {};
  if (courses.length) {
    try {
      const r = await client.assignments(courses.map(c => c.id));
      for (const c of r.courses || []) for (const a of c.assignments || []) assignByCm[a.cmid] = a;
    } catch { /* la lista de tareas es opcional */ }
  }

  let done = 0;
  const outCourses = await pmap(courses, 4, async c => {
    const [contents, teachers] = await Promise.all([
      client.courseContents(c.id).catch(() => []),
      client.teachers(c.id)
    ]);
    const sections = [];
    for (const [idx, s] of contents.entries()) {
      const modules = [];
      for (const m of s.modules || []) {
        if (m.modname === "label" || m.uservisible === false) continue;
        const files = (m.contents || [])
          .filter(f => f.type === "file")
          .map(f => ({ filename: f.filename, fileurl: f.fileurl, filesize: f.filesize || 0, timemodified: f.timemodified || 0 }));
        const maxT = Math.max(0, ...(m.contents || []).map(f => f.timemodified || 0));
        const kind = classify(m.modname);
        const a = assignByCm[m.id];
        modules.push({
          id: m.id,
          key: `${m.id}@${maxT}`,
          name: m.name,
          modname: m.modname,
          kind,
          url: m.url || "",
          files,
          linkUrl: kind === "link" ? ((m.contents && m.contents[0] && m.contents[0].fileurl) || m.url || "") : "",
          due: a ? a.duedate || 0 : 0,
          assignId: a ? a.id : 0,
          status: "pending"
        });
      }
      sections.push({
        id: s.id,
        name: (s.name && s.name.trim()) || (idx === 0 ? "General" : `Tema ${idx}`),
        modules
      });
    }
    done++;
    onProgress(`Leyendo asignaturas (${done}/${courses.length})…`);
    return {
      id: c.id,
      fullname: c.fullname,
      shortname: c.shortname,
      banner: (c.overviewfiles && c.overviewfiles[0] && c.overviewfiles[0].fileurl) || "",
      progress: typeof c.progress === "number" ? c.progress : null,
      teachers: teachers.slice(0, 3),
      sections
    };
  });

  // Estado de entrega de cada tarea (con límite de peticiones simultáneas).
  const tasks = outCourses.flatMap(c => c.sections.flatMap(s => s.modules)).filter(m => m.kind === "task" && m.assignId);
  onProgress("Comprobando entregas…");
  await pmap(tasks, 6, async t => {
    try { t.status = await client.submissionStatus(t.assignId); } catch { /* se deja como pendiente */ }
  });

  return {
    site: { name: info.sitename, url: client.base },
    user: { id: info.userid, fullname: info.fullname, username: info.username, pic: info.userpictureurl || "" },
    courses: outCourses,
    syncedAt: Date.now()
  };
}

module.exports = { MoodleClient, normalizeUrl, flatten, syncAll, pmap };
