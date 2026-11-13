#!/usr/bin/env bash
# Genera el instalador de NotXunta Client para el sistema en el que lo ejecutes (macOS o Linux).
# Requiere Node.js LTS e internet. En Mac se genera el .dmg/.zip; en Linux el .AppImage y el .deb.
set -e
cd "$(dirname "$0")"
npm install
case "$(uname -s)" in
  Darwin) npm run dist:mac ;;
  Linux)  npm run dist:linux ;;
  *) echo "Usa build.bat en Windows."; exit 1 ;;
esac
echo
echo 'Listo. Los instaladores están en la carpeta "dist".'
