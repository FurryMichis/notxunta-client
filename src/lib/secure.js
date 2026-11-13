"use strict";
// Cifrado de secretos con el almacén del sistema: DPAPI (Windows), Llavero (macOS), GNOME Keyring / KWallet (Linux).
// En Linux, si no hay llavero Electron usa una clave fija ("basic_text"): eso NO es seguro, así que se trata como no disponible.

const { safeStorage } = require("electron");

function available() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function") {
      const b = safeStorage.getSelectedStorageBackend();
      if (b === "basic_text" || b === "unknown") return false;
    }
    return true;
  } catch { return false; }
}

const MISSING = process.platform === "linux"
  ? "No hay un llavero del sistema (GNOME Keyring o KWallet) y no se guardan contraseñas sin protección. Instala y abre uno (por ejemplo gnome-keyring) y vuelve a intentarlo."
  : "El cifrado seguro del sistema no está disponible; no se puede guardar la contraseña.";

module.exports = { available, MISSING };
