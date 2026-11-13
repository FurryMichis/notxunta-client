# NotXunta Client 0.6.0

Cliente de escritorio para el Aula Virtual (Moodle) de la Xunta de Galicia. **Para Windows, Linux y macOS.**

## Generar los instaladores
Necesitas Node.js LTS e internet. Cada sistema se compila **desde ese mismo sistema** (un .dmg no se puede generar en Windows), o con GitHub Actions (más abajo).

| Sistema | Cómo | Resultado en `dist/` |
|---|---|---|
| Windows 10/11 | doble clic en `build.bat` (o `npm install` + `npm run dist`) | `NotXuntaClient-Setup.exe` (instalador), `NotXuntaClient-Portable.exe`, `latest.yml` y `.blockmap` |
| macOS | `./build.sh` (o `npm run dist:mac`) | `NotXuntaClient-Mac-x64.dmg` / `-arm64.dmg` y los `.zip` |
| Linux | `./build.sh` (o `npm run dist:linux`) | `NotXuntaClient-Linux-x64.AppImage` y `.deb` |

Para probar sin compilar: `npm start`.

## Uso
1. "Añadir cuenta": nombre, enlace de tu aula (p. ej. `https://centros.edu.xunta.gal/tu-centro/aulavirtual`), usuario y contraseña.
   La contraseña se valida contra el aula y se guarda cifrada con el almacén seguro de Windows (DPAPI).
2. "Abrir instancia": al abrir se sincroniza y se marcan como NUEVO los documentos, enlaces y tareas
   que no estaban la última vez (y aparece una notificación de Windows). El botón "Sincronizar" repite la comprobación.
3. Curso: banner de fondo, nombre, profesor con "Enviar mensaje" y los temas como botones;
   cada tema muestra Documentos, Enlaces y Actividades a entregar.
4. Apariencia: fondos estáticos y animados (nebulosa, atardecer, aurora, degradado vivo, galaxia con estrellas fugaces), imagen o GIF propio, **vídeo propio (MP4/WebM, en bucle y con sonido que puedes activar/silenciar con el botón 🔊 de la barra superior)**, oscurecimiento, color de acento y **tamaño de la interfaz** (botones − / + de la barra superior, Ctrl + «+» / «−» / «0» o Ctrl + rueda). Está en el lanzador y en la barra lateral de cada instancia.
5. Barra lateral: Mis cursos, Calendario, Tareas, Calificaciones, Mensajes, Notificaciones y Perfil.

6. Iconos de instancia: pulsa el icono de una cuenta (o «Icono» en Instancias) para elegir un emoji o subir una imagen.
7. **Overlay (Shift+Tab)**: capa a pantalla completa con navegador integrado: buscar en Google, Gmail, el aula virtual original y tu IA.
   Tiene **pestañas**: «+» o Ctrl+T para una nueva, Ctrl+W para cerrar, Ctrl+Tab / Ctrl+Mayús+Tab para cambiar, Ctrl+L para ir a la barra de direcciones,
   y Ctrl+clic en un acceso (Google, Gmail, aula, IA) lo abre en una pestaña nueva. Los enlaces que piden ventana nueva se abren en pestaña.
   Tu sesión de Google/IA se guarda solo dentro del overlay. Ajustes → «Overlay» permite hacerlo funcionar desde cualquier programa
   (Ctrl+Shift+Espacio, o Shift+Tab global, que bloquea Shift+Tab en el resto de programas).
8. **IA**: la primera vez que abres la app eliges una IA (ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, Le Chat, Grok).
   Se cambia en Ajustes y se abre con el botón de IA del overlay.
9. **Segundo plano**: al cerrar la ventana la app sigue en la bandeja del sistema, busca novedades cada cierto tiempo y avisa con
   notificaciones emergentes estilo Steam (configurable en Ajustes). Para salir del todo: bandeja → «Salir».
10. Mensajes: los chats muestran el nombre del contacto. El número de mensajes nuevos aparece junto a «Mensajes» y junto a cada chat, y desaparece al abrir el chat.
   Cada minuto se comprueban tus chats y, si llega un mensaje, salta un aviso (se puede desactivar en Ajustes); al pulsarlo se abre esa aula en «Mensajes».
   Las novedades de los cursos siguen avisando como antes.
11. Apuntes: al pulsar un documento aparece «Abriendo los apuntes…». Al entrar en un tema se precargan sus documentos (hasta 10, de hasta 25 MB cada uno) y los ya abiertos quedan en caché 3 días, así que vuelven a abrirse al instante. Calendario: si el aula no lo ofrece, se muestra «Calendario no disponible.».

## Notas
- Usa la API oficial de la app móvil de Moodle. Si tu centro la tiene desactivada o exige acceso solo por SSO,
  la app mostrará un aviso al conectar.
- Los documentos se descargan a una carpeta temporal y se abren con el programa predeterminado;
  los archivos ejecutables nunca se abren automáticamente.
- El vídeo de fondo se copia a la carpeta de datos de la app (máximo 1 GB); usa MP4 H.264 o WebM. Si en algún PC no se ve (H.265/HEVC, GPU o controladores problemáticos),
  activa «Modo compatible» en Ajustes o en Apariencia (desactiva la decodificación por hardware y reinicia la app). El vídeo se pausa si la ventana no se ve.
- Google puede pedir verificación extra al iniciar sesión dentro del overlay; el botón ↗ abre la página en tu navegador.
- Las tareas se abren en el navegador para entregarlas (no se suben archivos desde la app).

## Novedades de la 0.6.0 — compatibilidad con Windows, Linux y Mac
- **Windows, Linux y macOS**: instaladores para los tres sistemas (ver arriba).
- **Tablón «Novedades»** en la barra lateral: cada función y arreglo de cada versión (con marca «NUEVO» hasta que lo abres). Los datos están en `src/lib/changelog.js`: añade ahí una entrada cada vez que publiques una versión.
- Atajos adaptados: en Mac ⌘ en lugar de Ctrl (zoom, pestañas del overlay, ⌘+Mayús+Espacio) y menú de macOS (Salir, copiar/pegar).
- Contraseñas con el almacén del sistema: DPAPI (Windows), Llavero (macOS), GNOME Keyring / KWallet (Linux). En Linux sin llavero la app **no guarda contraseñas** y lo avisa.
- Actualizaciones: Windows (instalador) y Linux (AppImage) se actualizan solos; en Mac y Linux .deb la app avisa de la versión nueva y abre la página de descarga.
- Bandeja y avisos adaptados; los archivos con extensión de programa de Mac/Linux (.app, .sh, .AppImage, .deb, .dmg…) tampoco se abren automáticamente.
- Flujo de **GitHub Actions** (`.github/workflows/build.yml`) que compila los tres sistemas al subir una etiqueta.

## Novedades de la 0.5.6
- **Pantalla de inicio**: antes de abrir la app aparece un recuadro con el logo y «Buscando actualizaciones…». Si hay una versión nueva se descarga ahí mismo (con barra de progreso y botón «Continuar sin actualizar») y se instala sola al terminar. Sin conexión o con la app sin instalar (`npm start`, portable) se abre igualmente.
- **Foto de perfil** de la cuenta NotXunta: «Poner foto / Cambiar foto / Quitar foto» en «Cuenta y amigos». Se ve en tu perfil, en la barra superior del lanzador y en las listas de amigos.
- **Ajustes sincronizados con la cuenta NotXunta**: fondo (imagen), oscurecimiento, color de acento, sonido, IA elegida, avisos, segundo plano y tus aulas se suben solos y se importan al iniciar sesión en otro ordenador (gana siempre el cambio más reciente). **Las contraseñas del aula nunca se suben**: las aulas importadas piden su contraseña una vez en cada ordenador. No se sincronizan los ajustes que dependen del equipo: tamaño de la interfaz, atajo del overlay, modo compatible de vídeo ni el archivo del vídeo de fondo (pesa hasta 1 GB).
- Arreglado: en «Amigos» y en «Apariencia» aparecía el texto «false» (varias veces seguidas) cuando una sección estaba vacía.
- Arreglado: en «Cuenta y amigos» del lanzador los apartados salían duplicados al volver a entrar en la pestaña.
- **Actualiza el servidor antes de publicar**: ejecuta `supabase/migration-0.5.6.sql` en Supabase → SQL Editor (añade la foto y la tabla de ajustes). Sin esto la app sigue funcionando, pero la foto y la sincronización darán error.

## Novedades de la 0.5.5
- Versión pública: inicio de sesión con Google / Discord / GitHub listo para usar y números de versión unificados.

## Novedades de la 0.5.4
- Inicio de sesión con Google / Discord / GitHub: si el proveedor no está activado en Supabase, la app lo avisa antes de abrir el navegador; botón «Cancelar» durante la espera; cierre limpio del puerto local.

## Novedades de la 0.5.3
- Overlay con varias pestañas.
- «Abriendo los apuntes…» con círculo de carga, descarga en disco sin cargar el archivo en memoria, caché y precarga de los apuntes del tema.
- Vídeo de fondo con sonido (activar/silenciar y volumen) y modo compatible; el vídeo ya no se bloquea si Windows tiene las animaciones desactivadas.
- Arreglado el contador de mensajes nuevos que nunca se quitaba (ahora se marca el chat como leído en el aula y se recuerda en local).
- Avisos de mensajes nuevos además de las novedades de los cursos.

## Actualizaciones automáticas
La app instalada busca actualizaciones al abrir y cada 6 horas, las descarga en segundo plano y las instala al cerrar (o con «Reiniciar e instalar»). Ajustes → «Actualizaciones».
Usa GitHub Releases (gratis):
1. Crea un repositorio y pon tu usuario en `package.json` → `build.publish[0].owner` (y `repo` si lo llamas distinto).
2. Sube la versión en `package.json` (p. ej. `0.6.0`) y ejecuta `npm run dist`.
3. Crea una *Release* en GitHub con la etiqueta `v0.6.0` y sube de `dist/`: `NotXuntaClient-Setup.exe`, `NotXuntaClient-Setup.exe.blockmap` y `latest.yml`.
   (Alternativa automática: `set GH_TOKEN=tu_token` y `npm run release`.) Si el repositorio es privado, las actualizaciones no funcionan sin token: usa uno público.
4. Las apps instaladas con versión anterior se actualizan solas. **Esta versión (0.6.0) se actualiza sola desde la 0.5.5 en adelante; las anteriores a la primera con actualizador hay que instalarlas a mano una vez**; a partir de ahí, todo automático.

### Publicar los tres sistemas con GitHub Actions (recomendado)
1. Sube el proyecto (incluida la carpeta `.github/`) a tu repositorio de GitHub.
2. Pon la versión en `package.json` y súbela: `git tag v0.6.0` y `git push origin v0.6.0`.
3. En la pestaña **Actions** se compilan Windows, macOS y Linux y se publican los instaladores en una *Release* (borrador): revísala y pulsa **Publish release**. También puedes lanzarlo a mano (Run workflow) para obtener los instaladores como «artifacts» sin publicar.

### Notas por sistema
- **Windows**: sin firmar, SmartScreen mostrará «Windows protegió su PC» → *Más información → Ejecutar de todas formas*.
- **macOS**: la app no está firmada ni notarizada (hace falta una cuenta de Apple Developer, 99 USD/año). Al abrirla: clic derecho → *Abrir*. Si en un Mac con Apple Silicon sale «está dañada», ejecuta en la Terminal `xattr -cr "/Applications/NotXunta Client.app"`. Las actualizaciones no son automáticas: la app avisa y abre la página de descarga. No se ha probado en un Mac real: revisa especialmente la bandeja (barra de menú) y los avisos emergentes.
- **Linux**: AppImage (`chmod +x NotXuntaClient-Linux-x64.AppImage` y doble clic) o `.deb` (`sudo apt install ./NotXuntaClient-Linux-x64.deb`). En Ubuntu 23.10+/24.04 el AppImage puede negarse a arrancar por la restricción de «user namespaces»: ejecútalo con `--no-sandbox` o usa el `.deb`. Para guardar contraseñas necesitas un llavero (GNOME Keyring o KWallet, que casi todos los escritorios ya traen). El icono de bandeja en GNOME necesita la extensión *AppIndicator*. El atajo global (Shift+Tab / ⌃⇧Espacio «desde cualquier programa») no funciona en Wayland: usa «Solo con NotXunta Client en primer plano».

## Cuentas NotXunta y amigos
Cuenta propia de NotXunta Client, **independiente del aula virtual**: se crea con correo y contraseña o con Google / Discord / GitHub. Con ella:
- En cada curso hay una pestaña **Participantes**; junto a cada persona que también usa NotXunta Client aparece **＋ Añadir amigo** (las que no, indican «Sin NotXunta Client»).
- «Amigos» (barra lateral del aula) y «Cuenta y amigos» (pantalla principal): solicitudes recibidas/enviadas, lista de amigos y búsqueda por nombre de usuario. Avisa cuando llega una solicitud.
- Privacidad: solo se guarda correo, usuario, nombre para mostrar, tu foto de perfil, tus ajustes de apariencia/app, la lista de tus aulas (nombre, enlace y usuario) y, si lo permites, qué usuario eres en cada aula (para que te encuentren). **Nunca se envían contraseñas ni contenido del aula.** Se puede desactivar «Que mis compañeros me encuentren» y eliminar la cuenta desde la app.
- Limitación: el vínculo «esta cuenta es tal usuario del aula» lo declara la propia persona y no se verifica contra el aula; por eso se muestra también su @usuario de NotXunta.

### Puesta en marcha del servidor (una vez, gratis con Supabase)
_(Si ya lo tenías montado con la 0.5.5, basta con ejecutar `supabase/migration-0.5.6.sql` en el SQL Editor.)_
1. Entra en supabase.com → **New project** (elige región de la UE). Guarda la contraseña de la base de datos.
2. **SQL Editor → New query**: pega todo `supabase/schema.sql` y pulsa **Run**.
3. **Authentication → Providers → Email**: activado. Para probar rápido, desactiva «Confirm email» (el correo integrado de Supabase está muy limitado; para producción configura tu propio SMTP).
4. **Authentication → URL Configuration → Redirect URLs**: añade `http://127.0.0.1:53682/callback`.
5. (Opcional) **Google**: en Google Cloud crea credenciales OAuth «Aplicación web» con la URL de redirección `https://TU-PROYECTO.supabase.co/auth/v1/callback`, y pega Client ID y Secret en Supabase → Providers → Google. Discord y GitHub funcionan igual.
6. **Project Settings → API**: copia «Project URL» y la clave **anon public** en `src/lib/cloud-config.js` (nunca la `service_role`).
7. Compila (`build.bat`) y publica la Release como siempre.

**Proveedores (Google, Discord, GitHub)** — en cada uno la URL de redirección es siempre la de Supabase: `https://TU-PROYECTO.supabase.co/auth/v1/callback`.
- Google: Google Cloud → APIs y servicios → Credenciales → ID de cliente OAuth «Aplicación web» (Authorized redirect URI = la de arriba). Pantalla de consentimiento: publícala («En producción») o añade tus correos como usuarios de prueba.
- Discord: discord.com/developers → New Application → OAuth2 → Redirects = la de arriba; copia Client ID y Client Secret.
- GitHub: Settings → Developer settings → OAuth Apps → New → «Authorization callback URL» = la de arriba.
- En Supabase → Authentication → Providers activa cada uno y pega su Client ID/Secret (los secretos solo van ahí, nunca en la app).
- Supabase → URL Configuration → Redirect URLs debe contener exactamente `http://127.0.0.1:53682/callback`; si falta, el navegador acaba en la «Site URL» y la app se queda esperando.

Sin el paso 6 la app funciona igual, pero «Cuenta y amigos» avisa de que no hay servidor configurado.

## 0.5.7 (fix de la 0.5.6)
- Arreglo: si la base de datos de Supabase no tenía aplicado `supabase/migration-0.5.6.sql`, la app 0.5.6 no podía cargar el perfil y «Cuenta y amigos» dejaba de funcionar entera. Ahora la cuenta y los amigos funcionan igualmente y la app avisa de que falta ejecutar la migración (necesaria solo para la foto de perfil y la sincronización de ajustes).
