"use strict";
// Tablón de novedades: cada versión con sus funciones. Se muestra en «Novedades» (barra lateral del lanzador).
// kind: "new" = función nueva · "fix" = arreglo · "improve" = mejora
module.exports = [
  {
    version: "0.6.4", headline: "Actualización de seguridad",
    summary: "Revisión completa de seguridad: se cierran varios puntos débiles en descargas, inicio de sesión, datos de la nube y empaquetado. Se recomienda actualizar.",
    items: [
      { kind: "fix", title: "Archivos descargados más seguros", text: "Los apuntes y Archivos NotXunta ahora se guardan en una carpeta privada de tu usuario (no en la carpeta temporal compartida), con nombres de archivo saneados. En Windows se marcan como «descargados de Internet», así Office y SmartScreen los comprueban antes de abrirlos." },
      { kind: "fix", title: "Más tipos de archivo peligroso bloqueados", text: "Programas, scripts, accesos directos, instaladores, imágenes de disco y documentos con macros (.exe, .lnk, .ps1, .docm, .iso, .app, .sh…) nunca se abren solos: solo se muestran en su carpeta." },
      { kind: "fix", title: "Inicio de sesión con Google/Discord/GitHub más blindado", text: "La pequeña página local que recibe la respuesta del inicio de sesión ahora solo acepta peticiones de tu propio equipo, con cabeceras de seguridad, y descarta cualquier otra visita." },
      { kind: "fix", title: "Datos de la nube comprobados", text: "El aspecto (fondo, color, brillo), los avisos y los ajustes que llegan de la nube se validan uno a uno antes de aplicarse, para que un dato manipulado no pueda alterar la interfaz." },
      { kind: "fix", title: "Contraseña del aula protegida", text: "Las peticiones de inicio de sesión al aula ya no siguen redirecciones, para que la contraseña no pueda acabar en otro sitio. Imágenes del aula: solo formatos normales (sin SVG) y con tope de tamaño." },
      { kind: "fix", title: "Enlaces y ventanas", text: "Los enlaces con usuario y contraseña incrustados se rechazan; ninguna ventana puede incrustar contenido externo; y la app no concede cámara, micrófono ni ubicación a nadie." },
      { kind: "improve", title: "Electron actualizado y cerrado", text: "Se pasa a Electron 43 (la 35 ya no recibe parches de seguridad) y se desactivan en el ejecutable las opciones de depuración y de ejecutar como Node. Reglas CSP más estrictas en todas las pantallas." },
      { kind: "improve", title: "Servidor", text: "Esta versión incluye supabase/migration-0.6.4.sql (límites por cuenta: aulas vinculadas y archivos). Ejecútalo una vez en Supabase → SQL Editor." }
    ]
  },
  {
    version: "0.6.2", headline: "Arreglos: Amigos y Apariencia",
    summary: "Vuelven a funcionar las pestañas «Cuenta y amigos» y «Apariencia», y los archivos pasan a ser solo los de tu cuenta NotXunta.",
    items: [
      { kind: "fix", title: "La pestaña «Cuenta y amigos» salía vacía", text: "Solo se veía el título. Un error al dibujar el interruptor «Mostrar cuando estoy en línea» cortaba la pantalla entera. Ya se ve tu cuenta, tu foto y la lista de amigos con su estado en línea." },
      { kind: "fix", title: "La pestaña «Apariencia» no se abría", text: "Tenía el mismo fallo (un bloque colocado en la pantalla equivocada). Corregido." },
      { kind: "improve", title: "Si algo falla, ya no se queda en blanco", text: "Cuando una parte de «Cuenta y amigos» no se puede cargar, ahora aparece un aviso con el motivo en lugar de dejar la pantalla vacía." },
      { kind: "improve", title: "Solo Archivos NotXunta", text: "Se quita la gestión de los archivos privados del aula virtual original. «Archivos» ahora muestra únicamente tus Archivos NotXunta (los de tu cuenta), igual que en el menú del lanzador." }
    ]
  },
  {
    version: "0.6.1", headline: "Amigos en línea y archivos",
    summary: "Ves cuándo están conectados tus amigos y ya puedes gestionar tus archivos privados del aula y los de tu cuenta NotXunta.",
    items: [
      { kind: "new", title: "Amigos en línea", text: "En «Amigos» aparece un punto verde junto a quien tiene NotXunta Client abierto, o cuándo se le vio por última vez. Solo lo ven sus amigos y se puede desactivar en «Cuenta y amigos»." },
      { kind: "new", title: "Archivos privados del aula", text: "Nueva sección «Archivos»: ves, abres, subes y eliminas tus archivos privados del aula, con la barra del espacio usado y el límite que te da el aula." },
      { kind: "new", title: "Archivos NotXunta", text: "Tus propios archivos privados, guardados en tu cuenta NotXunta: los tienes en cualquier ordenador donde inicies sesión. También con barra de espacio." },
      { kind: "improve", title: "Servidor", text: "Esta versión necesita ejecutar supabase/migration-0.6.1.sql en Supabase (una sola vez). Sin eso la app funciona, pero el estado en línea y los Archivos NotXunta avisarán de que falta." }
    ]
  },
  {
    version: "0.6.0", headline: "Ahora también para Linux y Mac",
    summary: "NotXunta Client deja de ser solo para Windows: a partir de esta versión hay instaladores para Windows, Linux y macOS.",
    items: [
      { kind: "new", title: "Windows, Linux y Mac", text: "Instalador y portable para Windows, .dmg y .zip para macOS (Intel y Apple Silicon), AppImage y .deb para Linux." },
      { kind: "new", title: "Tablón de novedades", text: "Nueva sección «Novedades» con cada función y arreglo de cada versión. Aparece una marca «NUEVO» hasta que la abres." },
      { kind: "improve", title: "Atajos adaptados a cada sistema", text: "En Mac los atajos usan ⌘ en lugar de Ctrl (zoom, pestañas del overlay, ⌘+Mayús+Espacio) y la app tiene su menú de macOS." },
      { kind: "improve", title: "Contraseñas en Linux", text: "Se guardan con el llavero del sistema (GNOME Keyring / KWallet). Si no hay llavero, la app avisa en vez de guardarlas sin protección." },
      { kind: "improve", title: "Actualizaciones por sistema", text: "Windows y Linux (AppImage) se actualizan solos. En Mac y en Linux .deb la app te avisa de la versión nueva y abre la página de descarga." },
      { kind: "improve", title: "Bandeja y avisos", text: "Icono de bandeja y avisos emergentes adaptados a la barra de menú de macOS y a Linux." },
      { kind: "improve", title: "Archivos peligrosos", text: "Los apuntes con extensión de programa (.app, .sh, .AppImage, .deb, .dmg…) tampoco se abren automáticamente." },
      { kind: "new", title: "Compilación automática", text: "Flujo de GitHub Actions que genera los instaladores de los tres sistemas al publicar una versión." }
    ]
  },
  {
    version: "0.5.7", headline: "Arreglo de la cuenta",
    items: [
      { kind: "fix", title: "Cuenta y amigos sin la migración", text: "Si a Supabase le faltaba la migración 0.5.6, «Cuenta y amigos» dejaba de funcionar entero. Ahora funciona igualmente y avisa de lo que falta." }
    ]
  },
  {
    version: "0.5.6", headline: "Pantalla de inicio, foto de perfil y ajustes en la nube",
    items: [
      { kind: "new", title: "Pantalla de inicio", text: "Antes de abrir la app aparece un recuadro con el logo y «Buscando actualizaciones…», con barra de progreso y botón «Continuar sin actualizar»." },
      { kind: "new", title: "Foto de perfil", text: "Pon, cambia o quita la foto de tu cuenta NotXunta; se ve en tu perfil, en la barra superior y en las listas de amigos." },
      { kind: "new", title: "Ajustes sincronizados", text: "Fondo, oscurecimiento, color, sonido, IA, avisos, segundo plano y tus aulas se suben solos y se importan en otro ordenador. Las contraseñas nunca se suben." },
      { kind: "fix", title: "Texto «false» en Amigos y Apariencia", text: "Dejó de aparecer «false» cuando una sección estaba vacía." },
      { kind: "fix", title: "Apartados duplicados", text: "En «Cuenta y amigos» los apartados ya no se duplican al volver a entrar." }
    ]
  },
  {
    version: "0.5.5", headline: "Versión pública",
    items: [
      { kind: "improve", title: "Inicio de sesión con Google, Discord y GitHub", text: "Listo para usar, con números de versión unificados." }
    ]
  },
  {
    version: "0.5.4", headline: "Inicio de sesión con proveedores",
    items: [
      { kind: "improve", title: "Aviso de proveedor desactivado", text: "Si Google, Discord o GitHub no están activados en el servidor, la app lo dice antes de abrir el navegador." },
      { kind: "new", title: "Botón «Cancelar»", text: "Puedes cancelar la espera del inicio de sesión; el puerto local se cierra limpiamente." }
    ]
  },
  {
    version: "0.5.3", headline: "Cuentas, amigos y actualizaciones automáticas",
    items: [
      { kind: "new", title: "Cuenta NotXunta y amigos", text: "Cuenta propia (correo, Google, Discord o GitHub), pestaña «Participantes» en cada curso y solicitudes de amistad." },
      { kind: "new", title: "Actualizaciones automáticas", text: "La app busca versiones nuevas al abrir y cada 6 horas, y las instala al cerrar." },
      { kind: "new", title: "Overlay con pestañas", text: "Varias pestañas en el navegador del Shift+Tab (Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+L)." },
      { kind: "improve", title: "Apuntes más rápidos", text: "«Abriendo los apuntes…», descarga a disco, caché de 3 días y precarga de los documentos del tema." },
      { kind: "new", title: "Vídeo de fondo con sonido", text: "Activar/silenciar y volumen, y modo compatible para PCs donde el vídeo no se veía." },
      { kind: "fix", title: "Contador de mensajes", text: "El número de mensajes nuevos ya se quita al abrir el chat." },
      { kind: "new", title: "Avisos de mensajes", text: "Notificaciones de mensajes nuevos además de las novedades de los cursos." }
    ]
  },
  {
    version: "0.4.0", headline: "Segundo plano, overlay e iconos",
    items: [
      { kind: "new", title: "Avisos estilo Steam y segundo plano", text: "La app sigue en la bandeja y avisa de novedades con notificaciones emergentes." },
      { kind: "new", title: "Overlay con Shift+Tab", text: "Navegador a pantalla completa para Google, Gmail, tu IA y el aula original." },
      { kind: "new", title: "Iconos de instancia y tamaño de interfaz", text: "Emoji o imagen para cada cuenta y zoom de la interfaz." },
      { kind: "new", title: "Vídeo de fondo", text: "MP4/WebM como fondo, además de fondos animados, imagen o GIF." }
    ]
  },
  {
    version: "0.3.0", headline: "NotXunta Client",
    items: [
      { kind: "new", title: "Aula Virtual en tu escritorio", text: "Cursos, temas, documentos, enlaces, tareas, calendario, calificaciones y mensajes del aula de la Xunta." },
      { kind: "new", title: "Apariencia", text: "Fondos estáticos y animados, color de acento y banner del curso." }
    ]
  }
];
