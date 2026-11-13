@echo off
REM Genera el .exe de NotXunta Client. Requiere Node.js LTS e internet.
cd /d "%~dp0"
call npm install || goto :error
call npm run dist || goto :error
echo.
echo Listo. Los .exe estan en la carpeta "dist".
explorer dist
pause
exit /b 0
:error
echo Ha ocurrido un error. Revisa los mensajes anteriores.
pause
exit /b 1
