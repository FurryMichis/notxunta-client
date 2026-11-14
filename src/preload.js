const { contextBridge, ipcRenderer, webFrame } = require("electron");

// API mínima: solo canales concretos. La interfaz nunca ve contraseñas ni tokens.
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("notxuntaClient", {
  version: "0.6.1",
  platform: process.platform,
  listAccounts: () => call("accounts:list"),
  addAccount: acc => call("accounts:add", acc),
  removeAccount: id => call("accounts:remove", id),
  setAccountIcon: (id, icon) => call("accounts:setIcon", id, icon),
  setAccountPassword: (id, pw) => call("accounts:setPassword", id, pw),
  getSettings: () => call("settings:get"),
  setSettings: patch => call("settings:set", patch),
  openOverlay: () => call("app:overlay"),
  pickVideo: () => call("media:pickVideo"),
  videoUrl: name => call("media:url", name),
  clearVideo: () => call("media:clearVideo"),
  // Tamaño de la interfaz (1 = 100 %). Se limita a 50 %–200 %.
  setZoom: f => { webFrame.setZoomFactor(Math.min(2, Math.max(0.5, Number(f) || 1))); },
  openInstance: id => call("instance:open", id),
  sync: id => call("instance:sync", id),
  closeInstance: id => call("instance:close", id),
  markSeen: (id, keys) => call("instance:markSeen", id, keys),
  image: (id, url) => call("instance:image", id, url),
  openFile: (id, url, filename, version) => call("instance:openFile", id, url, filename, version),
  prefetchFiles: (id, files) => call("instance:prefetch", id, files),
  relaunch: () => call("app:relaunch"),
  cloudStatus: () => call("cloud:status"),
  cloudSignUp: (email, pw) => call("cloud:signUp", email, pw),
  cloudSignIn: (email, pw) => call("cloud:signIn", email, pw),
  cloudOAuth: provider => call("cloud:oauth", provider),
  cloudOAuthCancel: () => call("cloud:oauthCancel"),
  cloudSignOut: () => call("cloud:signOut"),
  cloudCreateProfile: p => call("cloud:createProfile", p),
  cloudUpdateProfile: p => call("cloud:updateProfile", p),
  cloudDeleteAccount: () => call("cloud:deleteAccount"),
  cloudLookup: (accountId, ids) => call("cloud:lookup", accountId, ids),
  participants: (accountId, courseId) => call("participants", accountId, courseId),
  friendsList: () => call("friends:list"),
  friendFind: username => call("friends:find", username),
  friendRequest: userId => call("friends:request", userId),
  friendRespond: (id, accept) => call("friends:respond", id, accept),
  friendRemove: id => call("friends:remove", id),
  // Sincronización de ajustes con la cuenta NotXunta
  syncLook: (look, changed) => call("sync:look", look, !!changed),
  syncNow: () => call("sync:now"),
  syncInfo: () => call("sync:info"),
  onSyncApplied: cb => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on("sync:applied", fn);
    return () => ipcRenderer.removeListener("sync:applied", fn);
  },
  onCloudBadge: cb => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on("cloud:badge", fn);
    return () => ipcRenderer.removeListener("cloud:badge", fn);
  },
  // Archivos privados del aula (con su límite) y Archivos NotXunta (en tu cuenta)
  filesMoodleList: (id, dir) => call("files:moodleList", id, dir),
  filesMoodleUpload: id => call("files:moodleUpload", id),
  filesMoodleDelete: (id, filepath, filename) => call("files:moodleDelete", id, filepath, filename),
  nxList: () => call("nx:list"),
  nxUpload: () => call("nx:upload"),
  nxOpen: (id, name) => call("nx:open", id, name),
  nxSave: (id, name) => call("nx:save", id, name),
  nxDelete: id => call("nx:delete", id),
  updateStatus: () => call("update:status"),
  updateCheck: () => call("update:check"),
  updateInstall: () => call("update:install"),
  updateOpenReleases: () => call("update:openReleases"),
  changelog: () => call("app:changelog"),
  changelogSeen: () => call("app:changelogSeen"),
  platformInfo: () => call("app:platform"),
  onUpdate: cb => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on("update:status", fn);
    return () => ipcRenderer.removeListener("update:status", fn);
  },
  openExternal: url => call("instance:openExternal", url),
  calendar: id => call("api:calendar", id),
  grades: (id, courseId, userId) => call("api:grades", id, courseId, userId),
  conversations: (id, userId) => call("api:conversations", id, userId),
  thread: (id, userId, convId) => call("api:thread", id, userId, convId),
  send: (id, payload) => call("api:send", id, payload),
  markRead: (id, userId, convId, time) => call("api:markRead", id, userId, convId, time),
  notifications: (id, userId) => call("api:notifications", id, userId),
  // Mensajes nuevos detectados en segundo plano: { accountId, total, fresh: [{ name, text }] }
  onMessages: cb => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on("msg:update", fn);
    return () => ipcRenderer.removeListener("msg:update", fn);
  },
  // Clic en un aviso: { view, accountId }
  onNavigate: cb => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on("app:navigate", fn);
    return () => ipcRenderer.removeListener("app:navigate", fn);
  },
  onProgress: cb => {
    const fn = (_e, msg) => cb(msg);
    ipcRenderer.on("sync-progress", fn);
    return () => ipcRenderer.removeListener("sync-progress", fn);
  }
});
