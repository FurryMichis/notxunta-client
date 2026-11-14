"use strict";
// Se ejecuta al empaquetar cada instalador: apaga en el propio ejecutable de Electron las puertas traseras que no usamos
// (ejecutarlo como Node.js normal, NODE_OPTIONS, --inspect) y obliga a cargar la app solo desde su paquete .asar.
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const name = packager.appInfo.productFilename;
  let exe;
  if (electronPlatformName === "darwin") exe = path.join(appOutDir, `${name}.app`, "Contents", "MacOS", name);
  else if (electronPlatformName === "win32") exe = path.join(appOutDir, `${name}.exe`);
  else exe = path.join(appOutDir, packager.executableName);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === "darwin",   // en Apple Silicon el cambio invalida la firma ad-hoc; se rehace
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true   // la app carga su interfaz desde file://; se deja como está
  });
  console.log("Fuses de Electron aplicados a", exe);
};
