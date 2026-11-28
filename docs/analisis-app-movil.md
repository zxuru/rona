# Análisis de viabilidad: app móvil para RoNa

**Fecha:** 2026-11-20. **Árbol analizado:** `0.11.1` (`package.json`). **Alcance:** sólo análisis; este
documento no cambia código ni configuración.

**Cómo se ha hecho.** Lectura del árbol real: arranque del CLI y del servidor, anfitrión de escritorio,
cargador de plugins, proxy HLS, motor de descargas, esquema de la base, guards de seguridad, hojas de
estilo, e2e y workflows. No se ha ejecutado la aplicación en un Android ni en un iPhone: **no hay
ninguna medición en dispositivo real en este documento**. Lo que no se puede deducir del código va
marcado como **suposición** o como **pendiente de medir**.

---

## 1. Resumen ejecutivo

**Recomendación: no portar el servidor. La app móvil debe ser un cliente de la instancia de escritorio
del usuario, y el primer vehículo debe ser una PWA servida por esa misma instancia** (la arquitectura
de la opción E, entregada como la opción B). Es lo único barato que conserva a la vez los plugins, el
proxy HLS, SQLite, las descargas y la biblioteca.

**En una frase:** Android sí, como cliente remoto (PWA hoy, envuelta nativa después si hace falta);
iOS sí como PWA instalada, no como app de tienda con el producto actual; **una app autocontenida que
funcione sin el PC no es viable en v1** (26–52+ semanas y cambio de modelo de plugins/contenido).

- **A (Tauri v2 móvil), C (Capacitor) y D (React Native) autocontenidas no son un port: son una
  reescritura.** Bun no compila para Android/iOS; Tauri no ejecuta *sidecars* en móvil; y los
  proveedores son módulos TypeScript que se importan en el proceso con APIs de Node/Bun
  (`node:fs`, `node:net`, `bun:sqlite`, `Bun.file`, `Bun.spawn`). Sin servidor propio, los plugins
  desaparecen o hay que inventar otro modelo.
- **La PWA servida por la instancia reutiliza el 100 % del servidor y de la UI**, mantiene el mismo
  origen (cookie `HttpOnly`, guards de `Origin`/`Host`, CSP) y no necesita tienda. Su coste real no
  está en el frontend: está en el **modo remoto** (escuchar en LAN, token, TLS, descubrimiento) y en
  lo que el navegador no puede hacer (descargas offline, segundo plano, PiP en iOS).
- **Android es viable ya** con Chrome + HTTPS. **iOS es viable como PWA instalada, con carencias
  concretas**: en iPhone no existe `Element.requestFullscreen()` (el botón de pantalla completa actual
  no haría nada), el PiP dentro de una PWA instalada está roto en WebKit, y no hay descargas en
  segundo plano ni almacenamiento grande y estable.
- **La tienda es el otro bloqueo, y no es técnico.** Apple 5.2.3 prohíbe guardar, convertir o
  descargar medios de terceros sin autorización; el streaming sin permiso entra por 5.2.2 y por la
  nota de la propia 5.2.3. Google Play nombra expresamente las apps de streaming que permiten
  descargar contenido con copyright. Un sistema de plugins que descarga y ejecuta código de GitHub
  choca además con Apple 2.5.2 y con la política de carga dinámica de Google. La PWA y el *sideload*
  evitan la tienda, no el problema legal.
- **Orden recomendado:** spike remoto (1–2 semanas) → MVP PWA (3–5 semanas) → sólo si hace falta,
  envuelta nativa Capacitor para segundo plano/PiP/offline (6–10 semanas) → app autocontenida, nunca
  en v1 (26–52+ semanas y cambio de producto).

---

## 2. Hallazgos del código

### 2.1 Cómo arranca el servidor Hono en escritorio

No está embebido en el proceso de Rust: **es un proceso hijo (sidecar)**, el mismo ejecutable de
consola que produce `scripts/package.ts`.

- El anfitrión de escritorio lanza el servidor con `--no-open` y lee su línea de arranque por
  `stdout`: `desktop/src-tauri/src/sidecar.rs:294-363`. La salida se drena siempre y sólo se queda la
  línea `RONA_BOOT`; el resto se tira. `stderr` va a un archivo.
- En Windows el servidor viaja **dentro** del `.exe` del anfitrión (`include_bytes!`), se extrae a
  `%LOCALAPPDATA%\rona-data\bin\<versión>\rona.exe` y se verifica con SHA-256:
  `desktop/src-tauri/src/embebido.rs:1-67`. En macOS y Linux vive al lado del anfitrión
  (`sidecar.rs:140-152`).
- El cierre se pide por `stdin` con `shutdown\n`, porque en Windows no hay `SIGTERM` de verdad:
  `sidecar.rs:38-39`, `sidecar.rs:119-137`; el CLI lo escucha en `packages/cli/src/lifecycle.ts`.
- El servidor es **Hono sobre `Bun.serve`**: `packages/server/src/index.ts:80-124`. El CLI monta la
  aplicación, migra, carga plugins y escucha: `packages/cli/src/index.ts:207-252`,
  `packages/cli/src/boot.ts:349-548`.
- La raíz de datos del anfitrión es `%LOCALAPPDATA%\rona-data` (Windows) o `~/.local/share/rona`
  (macOS/Linux), con `portable.txt` como excepción: `desktop/src-tauri/src/entorno.rs:121-234`,
  `packages/core/src/config.ts:167-220`. La base es `rona.db`; el CLI usa `%LOCALAPPDATA%\rona` y la
  ventana usa `rona-data` (README, «Dónde vive cada cosa»).

**Qué depende de Bun/Node/sistema de archivos.** No es una capa fina:

| Pieza | Dependencia | Archivo |
|---|---|---|
| Servidor HTTP | `Bun.serve` | `packages/server/src/index.ts:88` |
| Base de datos | `bun:sqlite` (WAL, `busy_timeout`, FKs) | `packages/catalog-store/src/db.ts:20-51` |
| Ejecutables | `Bun.spawn`, `Bun.which` (mpv, ffmpeg, navegador) | `packages/cli/src/index.ts:164-189`, `packages/media-proxy/src/mpv.ts`, `packages/media-proxy/src/download/ffmpeg.ts` |
| Archivos servidos | `Bun.file` (interfaz, descargas, segmentos, ajustes) | `packages/server/src/static-assets.ts:122-134`, `packages/server/src/routes/downloads.ts:441-603`, `packages/core/src/settings.ts:99` |
| Proxy de red | `node:http`/`node:https`/`node:net`/`node:tls`, DNS fijado | `packages/media-proxy/src/pinned-fetch.ts:31-41`, `packages/media-proxy/src/plugin-fetch.ts:31-39` |
| Sistema de archivos | `node:fs/promises`, `node:path`, `node:os` | `packages/cli/src/index.ts`, `packages/server/src/downloads/queue.ts`, `packages/server/src/downloads/dirs.ts`, `packages/server/src/party/lan.ts` |
| Recursos del binario | `Bun.embeddedFiles`, `--asset` | `packages/cli/src/index.ts:55-60`, `packages/cli/src/resources.ts` |

**Consecuencia:** el servidor no es «Hono + un par de rutas». Es un programa Bun con SQLite nativo,
sistema de archivos, sockets y procesos. Moverlo a un WebView o a Rust no es mover Hono; es reescribir
todo eso.

> **Nota de contexto.** El enunciado de la tarea menciona un instalador NSIS. El árbol actual ya no lo
> publica: `docs/estudio-tauri.md:19-22` declara que desde T251 sólo hay `.exe` único de Windows,
> `.zip` del `.app` de macOS y AppImage de Linux. No cambia nada del análisis móvil, pero conviene no
> planificar sobre NSIS.

### 2.2 Proveedores y plugins: código dinámico en el mismo proceso

- Un plugin es un archivo `.ts`, `.js` o `.mjs` que se importa con `import()` dinámico desde el
  directorio del usuario o desde un repositorio descargado:
  `packages/provider-sdk/src/loader.ts:30`, `:245-341` (la importación es `:301`). No hay build step
  ni proceso aparte.
- El cargador usa `node:fs/promises` para listar y `node:path`/`node:url` para resolver:
  `loader.ts:21-23`. Los plugins pueden importar archivos hermanos por ruta relativa (el repositorio
  descargado se conserva entero; ver `docs/providers.md:13-52`).
- **Se ejecutan sin sandbox**, con los permisos del proceso: lo dice `docs/providers.md:10`,
  `README.md:372-386` y `SECURITY.md`. El hub mantiene la lista viva y recarga sin reiniciar:
  `packages/server/src/provider-hub.ts:64-108`, `packages/server/src/app.ts:472-481`.
- La red de un plugin no es el `fetch` global: se le inyecta una capacidad con lista blanca de
  destinos, DNS fijado, topes de 8 MiB y 10 s, y redirecciones revalidadas:
  `packages/provider-sdk/src/call.ts:47-62`, `packages/media-proxy/src/plugin-fetch.ts:1-75`.
- Un plugin que falla no tumba a los demás; se rechaza con su motivo y el informe viaja a la UI:
  `loader.ts:281-341`, `packages/server/src/routes/providers.ts`.

**Viabilidad en móvil:** prácticamente nula con el modelo actual. No hay un runtime Bun oficial para
Android/iOS (Bun sólo compila para Linux, Windows y macOS: documentación de `bun build --compile`), y
un plugin necesita un sistema de archivos con `import()` dinámico, módulos hermanos y APIs de Node.
Meterlo en un WebView no sirve: el WebView no tiene `node:net` ni `node:fs`. Meterlo en un intérprete
JS embebido obliga a reimplementar esa capa y, además, choca con las reglas de código descargado de
las tiendas (ver §5).

### 2.3 Streaming HLS: todo pasa por el servidor

No hay reproducción directa contra el upstream. El flujo es:

1. `POST /api/stream/resolve` pide al plugin las fuentes y **emite un ticket opaco por cada una**; la
   URL del upstream y sus cabeceras se quedan en el proceso: `packages/server/src/routes/stream.ts:325-386`.
2. El cliente recibe `/stream/<ticket>` (`stream.ts:66-69`), no la URL real.
3. `GET /stream/:ticket` proxea los bytes con `Range`, sin acumular el cuerpo, con
   `Accept-Encoding: identity` y cabeceras de hotlink (`Sec-Fetch-Site: same-origin`, `Origin`
   derivado del `Referer`): `packages/media-proxy/src/byte-proxy.ts:191-371`, en particular
   `:249-268`.
4. Si lo que llega es una playlist, se reescribe para que cada segmento, sub-playlist, clave e
   inicializador apunten a `/stream/:ticket/seg/:index` y `/stream/:ticket/key/:index`:
   `packages/media-proxy/src/hls.ts:170-224`, `stream.ts:388-425`.
5. La lista blanca de destinos se aplica salto a salto; el DNS se fija a la dirección validada:
   `packages/media-proxy/src/destination-guard.ts`, `pinned-fetch.ts:31-50`.

En el cliente:

- `hls.js` se importa **dinámicamente** al reproducir HLS: `packages/web/src/features/player/usePlayer.ts:249-385`
  (importación en `:258`). Si `Hls.isSupported()` es falso, se usa el HLS nativo del navegador
  (`video.src = url`, `:262-274`). Ese camino es el de Safari/iOS y **no publica las pistas de
  subtítulos del manifiesto** (devuelve `sinMedio` y no hay `alDescubrirPistas`).
- Los tickets viven 600 s y hay un tope de 500: `packages/media-proxy/src/ticket-store.ts:25-29`.
  La caché de playlists vive lo que el ticket, no 10 s, porque una reproducción entera se sirve
  contra su índice: `packages/media-proxy/src/hls.ts:267-292`.
- El guard de sesión hace una excepción **sólo** con `/stream/:ticket`, porque `mpv` no tiene cookie:
  `packages/server/src/middleware/session-guard.ts:25-88`.
- La CSP es `media-src 'self' blob:`, `connect-src 'self'`, `worker-src 'none'`:
  `packages/server/src/middleware/security-headers.ts:20-36`. Es lo que obliga a que todo pase por el
  mismo origen y lo que rompería una UI empaquetada en `capacitor://` o `tauri://`.

**Lo que esto significa para móvil:** el reproductor no necesita CORS ni acceso directo al upstream;
necesita **el mismo origen del servidor**. Eso favorece a la PWA servida por la instancia y penaliza a
cualquier app que empaquete la UI con otro origen.

### 2.4 Descargas y almacenamiento

- **El motor de descargas vive en el servidor**, no en el navegador. La cola es persistente en
  SQLite, con concurrencia 2 por defecto, pausa/reanudación, reintentos y comprobación de espacio:
  `packages/server/src/downloads/queue.ts:95-180`, `packages/server/src/app.ts:544-639`.
- La ruta de cada descarga se sanea por segmentos y se comprueba contra la raíz con `resolve`:
  `packages/media-proxy/src/download/engine.ts:118-158`. El mínimo libre antes de empezar es 512 MiB:
  `engine.ts:30-31`.
- Los archivos se guardan bajo `<dataDir>/downloads` (o la carpeta elegida en Ajustes), y se sirven
  por id, no por ruta: `packages/server/src/routes/downloads.ts:522-580`. Los segmentos se sirven por
  una ruta propia y con nombre validado: `:582-611`. El remux a MP4 usa ffmpeg si está y `mux.js` si
  no: `:625-676`, `packages/media-proxy/src/download/engine.ts:298-342`.
- El selector de carpeta del escritorio es una **API del servidor** que enumera rutas absolutas:
  `packages/server/src/downloads/dirs.ts:97-157`, `routes/downloads.ts:383-395`. En Android eso no
  existe: el almacenamiento con alcance (scoped storage) no da rutas absolutas arbitrarias; se usan
  directorios privados de la app, `MediaStore` o el selector SAF. En iOS no hay rutas fuera del
  contenedor de la app.
- La base es SQLite con `bun:sqlite`, WAL, FKs y `busy_timeout`: `packages/catalog-store/src/db.ts:20-51`.
  Es el **único** paquete que abre SQLite (regla del repositorio). No hay una capa de repositorio
  portable a otro motor: hay migraciones SQL y repositorios sobre `Database` de Bun.
- Progreso, biblioteca, historial, ajustes y cola de descargas comparten esa única base. Si el móvil
  guardara algo por su cuenta, habría dos bases y un problema de sincronización que hoy no existe.

**Consecuencia:** una app autocontenida tendría que reimplementar el motor de descargas y el
almacenamiento con APIs nativas (Android: `MediaStore`/SAF/foreground service; iOS: contenedor +
`URLSession` en segundo plano). Una app remota no descarga en el teléfono: descarga en el equipo y
streamea; para verlo sin conexión hay que añadir una copia local en el móvil, que es fase 2.

### 2.5 Funciones de escritorio que no tienen equivalente móvil

| Función | Dónde está | Qué pasa en móvil | Sustituto |
|---|---|---|---|
| Bandeja del sistema | `desktop/src-tauri/src/tray.rs:54-127` | No existe en Android/iOS | Notificación persistente / foreground service (Android); sin equivalente iOS salvo reproducción en curso |
| La X oculta la ventana | `desktop/src-tauri/src/main.rs:201-229` | No aplica | Ciclo de vida de la app (background/suspend) |
| Instancia única | `desktop/src-tauri/src/main.rs:186-196` | No aplica igual | Una sola app; el servidor remoto ya es único |
| Actualizador | `desktop/src-tauri/src/actualizacion.rs`, `main.rs:170` | Tauri updater es sólo escritorio; en tiendas actualiza la tienda | PWA: recarga/actualiza sola; nativo: Play/App Store |
| Modo portable (`portable.txt`) | `desktop/src-tauri/src/entorno.rs:126-142` | No existe: sandbox de app | Datos en el contenedor de la app |
| `--diagnostico`, `--navegador` | `desktop/src-tauri/src/main.rs:549-590`, `:371-383` | No aplica | Logs compartidos / abrir en navegador |
| `mpv` externo | `packages/cli/src/index.ts:164-189`, `packages/media-proxy/src/mpv.ts` | No hay `mpv` en el teléfono | Reproductor nativo o intent externo (Android) |
| Discord Rich Presence | `packages/server/src/presence/service.ts:126-330`, `presence/ipc.ts` | No hay IPC de Discord | Quitar en móvil |
| Cast a TV / AirPlay | `packages/server/src/routes/cast.ts`, `packages/web/src/features/player/cast/` | El cast web exige contexto seguro y SDK de Chrome; iOS usa AirPlay | SDK nativo de Cast / AirPlay |
| Watch party LAN | `packages/server/src/party/`, `docs/watch-party.md` | El invitado necesita **su propia instancia**; un móvil sin servidor no puede unirse | Fuera del MVP; o el móvil como mando de una instancia |
| Modo extendido | `packages/web/src/features/player/usePlayerExtendido.ts` | **No es de escritorio**: es CSS y funciona en cualquier navegador | Ya sirve de *fullscreen* de reserva en iPhone |

**Notificaciones y segundo plano.** La app usa la `Notification` del navegador y sólo mientras la
página está abierta: `packages/web/src/features/downloads/useDownloads.ts:91-112`,
`DownloadButton.tsx:241-242`. No hay service worker, ni foreground service, ni push. En Android la
reproducción de audio puede sobrevivir con Media Session; en iOS el WebView se suspende al pasar a
segundo plano. Para notificaciones y descargas en segundo plano hace falta una envuelta nativa.

**PiP.** El reproductor ya soporta las dos puertas: `document.pictureInPictureEnabled` y
`webkitSetPresentationMode` (`packages/web/src/features/player/usePictureInPicture.ts:43-145`). En
WebView2 de escritorio está medido y funciona (`docs/desktop-pip.md`). En iOS, dentro de una PWA
instalada, WebKit tiene un fallo abierto: `requestPictureInPicture()` falla aunque
`document.pictureInPictureEnabled` diga `true` (bug 303885). El código actual enseñaría el botón y no
haría nada; hay que ocultarlo con `webkitSupportsPresentationMode('picture-in-picture')`.

### 2.6 Estado de la UI: sí es responsive, con huecos móviles concretos

**Lo que ya está:**

- Navegación inferior en pantallas estrechas, con los mismos destinos y `aria-current` que la
  cabecera: `packages/web/src/components/BarraInferior.tsx:1-56`, `packages/web/src/app.tsx:224-230`,
  `packages/web/src/nav.ts`.
- Puntos de corte reales: 600/640/700/820/1100/1400 px y `orientation: landscape and (max-height:
  520px)` para el teléfono tumbado: `packages/web/src/styles/vitrina.css:2095-2399`,
  `packages/web/src/styles/gestion.css:967-982`, `:1777-1917`, `packages/web/src/styles/base.css:351`.
- `safe-area-inset-*` para el recorte del teléfono: `packages/web/src/styles/base.css:86-88`,
  `packages/web/src/styles/gestion.css:1868-1913`, `packages/web/src/styles/vitrina.css:2010`.
- Mandos táctiles: doble toque en los bordes para ±10 s (`usePlayerGestos.ts:24-42`), umbrales de
  columna para mover el volumen al menú y esconder los saltos (`usePlayerMandos.ts:28-55`), y
  objetivos de 44 px (`PRODUCT.md:184`).
- e2e a 390×844 que comprueban barra inferior, ausencia de desbordes, reserva de alto y controles del
  reproductor: `packages/web/e2e/movil.e2e.ts:14-101`, `packages/web/e2e/paginas-movil.e2e.ts:14-116`.
- Media Session para pantalla de bloqueo/auriculares: `packages/web/src/features/player/useMediaSession.ts:1-364`.
- `playsInline` y controles propios: `packages/web/src/features/player/PlayerFrame.tsx:52-54`.

**Lo que falta o no está medido:**

- **Pantalla completa en iPhone.** El botón pide `requestFullscreen` sobre el escenario
  (`usePlayer.ts:808-821`). En iPhone Safari/WebKit no existe `Element.requestFullscreen()`; sólo
  `HTMLVideoElement.webkitEnterFullscreen()`, que entrega el vídeo al reproductor nativo y pierde los
  mandos propios. Hoy el botón no haría nada en iPhone. Hay que mapearlo al modo extendido (CSS) o a
  `webkitEnterFullscreen` como reserva.
- **Orientación y pantalla encendida.** No hay `screen.orientation.lock()` ni `navigator.wakeLock`.
  En vídeo largo, el teléfono puede apagar la pantalla; hay que medirlo y, si molesta, añadir Wake
  Lock (sólo contexto seguro) o una envuelta nativa.
- **Horizontal real.** El e2e mide 390×844 (vertical). El CSS tiene reglas para `landscape` en la
  home, pero el reproductor en 844×390 no está medido en dispositivo.
- **Descargas en el teléfono.** La pantalla de biblioteca funciona a 390 px, pero el archivo vive en
  el equipo; no hay copia local en el móvil.
- **PWA.** No hay `manifest.webmanifest` ni service worker: `packages/web/index.html` sólo tiene
  favicon, `apple-touch-icon` y `theme-color`; `packages/web/public/` sólo contiene `theme-boot.js` y
  los iconos. La CSP tiene `worker-src 'none'` y `docs/seguridad-mejoras.md:262` confirma que no hay
  `serviceWorker` en el árbol. Para una PWA hay que añadir manifiesto, iconos 192/512, service worker
  y abrir `worker-src 'self'`.

### 2.7 La frontera de seguridad que condiciona todas las opciones

Este es el hallazgo que más descarta alternativas:

- El cliente HTTP de la UI usa **rutas relativas** y `credentials: 'same-origin'`:
  `packages/web/src/api/client.ts:57-60`, `:127-133`. No hay una URL base configurable ni un token
  de portador.
- La sesión es una cookie `HttpOnly; SameSite=Strict` (`packages/server/src/auth.ts:89-94`). No hay
  cabecera `Authorization` ni forma de autenticar a un cliente nativo sin cookie.
- El guard de `Origin` sólo admite `http://127.0.0.1:<puerto>` y los orígenes extra del modo servidor;
  en modo red admite el mismo `Host` de la petición: `packages/server/src/middleware/origin-guard.ts:33-84`.
- La CSP es `default-src 'self'`, `connect-src 'self'`, `media-src 'self' blob:`,
  `frame-ancestors 'none'`: `packages/server/src/middleware/security-headers.ts:20-36`.
- El servidor **no tiene CORS**. No lo necesita porque la UI se sirve desde el mismo origen.

**Consecuencia práctica:** una UI empaquetada dentro de Capacitor (`capacitor://localhost`) o Tauri
(`tauri://localhost`) está en **otro origen**. No manda la cookie, el `Origin` no está admitido y la
CSP bloquea `connect-src`. Para que funcionara habría que añadir CORS, un token de portador, cambiar
la CSP y reescribir el modelo de amenaza: es un evento de seguridad, no un detalle de integración.
**La forma barata de evitarlo es que la UI se cargue desde el propio servidor** (PWA o WebView
apuntando a `https://<equipo>:<puerto>`), no desde los recursos de la app.

### 2.8 Lo que ya existe para un modo remoto

- El servidor ya sabe escuchar fuera de loopback: `RONA_HOST`, `RONA_PORT`, `RONA_TOKEN`,
  `RONA_PUBLIC_ORIGIN` (`packages/cli/src/server-env.ts:206-255`). Fuera de loopback **exige** token
  de al menos 16 caracteres y falla el arranque si falta.
- La política de red se calcula en `networkPolicy`: `server-env.ts:177-204`. Con `RONA_HOST=0.0.0.0`
  y sin `RONA_PUBLIC_ORIGIN` acepta cualquier `Host` y el mismo origen de la petición; con
  `RONA_PUBLIC_ORIGIN` lo cierra a ese origen.
- Ya hay un precedente de enumerar direcciones LAN para que otro dispositivo entre: `party/lan.ts:1-29`
  y `docs/watch-party.md`. Se puede reutilizar para el QR de conexión.
- El login del modo servidor ya existe: formulario en `/login` que cambia el token por la cookie
  (`packages/server/src/auth.ts:65-100`).

**Lo que falta:** una pantalla de «Acceso remoto» que encienda el modo, genere/rote el token, enseñe
la URL y un QR, y indique si hay TLS. Hoy eso se hace a mano por variables de entorno, y el anfitrión
de escritorio no lo ofrece: lanza el sidecar sin pasar `RONA_HOST` ni `RONA_TOKEN` y abre la ventana
en `127.0.0.1` (`desktop/src-tauri/src/main.rs:299-413`). **Suposición:** si se lanzara el `.exe` con
esas variables en el entorno, el sidecar las heredaría; no está medido y la ventana abriría la
pantalla de login, no la app.

---

## 3. Opciones evaluadas

> Las opciones no son disjuntas. A y D son **autocontenidas** (la app lleva el servidor). B y E son
> **remotas** (la app es cliente de una instancia). C puede ser las dos cosas, y por eso es la más
> fácil de plantear mal. «Autocontenida» significa «funciona sin el PC encendido».

### A. Tauri v2 móvil (Android/iOS) reutilizando el frontend

**Qué sería.** El mismo Rust/Tauri que ya envuelve la ventana, con `tauri android init` / `tauri ios
init`, la UI React en el WebView y el servidor dentro.

**El problema del servidor.** No hay forma de llevar el servidor actual:

- Tauri v2 tiene móvil, pero **no ejecuta sidecars en Android/iOS**: el plugin Shell en móvil sólo
  abre URLs; `externalBin` es de escritorio (issue tauri#9774; documentación de Tauri). El anfitrión
  actual es exactamente un lanzador de sidecar, así que no se traslada.
- Bun no compila para Android/iOS; sus objetivos son Linux, Windows y macOS. No hay `bun:sqlite`,
  `Bun.serve`, `Bun.file` ni `Bun.spawn` en el teléfono.
- Portar Hono a Rust es reescribir: rutas, guards, SQLite/migraciones, proxy de bytes con DNS fijado,
  reescritura HLS, AniList/AniSkip, descargas, cola, remux, presencia. Y los plugins TS se pierden:
  Rust no importa un `.ts` con `import()`.
- Portar Hono al cliente (WebView/Service Worker) tampoco: el navegador no tiene `node:net` ni
  `node:fs`, y el proxy necesita sockets, DNS y cabeceras que el navegador no deja poner.

**La única variante barata:** Tauri móvil como **cliente remoto** (WebView apuntando al servidor del
PC). Pero entonces Tauri no aporta nada sobre Capacitor o una PWA, y arrastra builds nativos y
tiendas. No se justifica.

**Pros.** UI reutilizada; binario pequeño; APIs nativas si se reescribe el backend; una sola base de
código de UI.
**Contras.** Servidor no portátil; plugins fuera; 26–52+ semanas si es autocontenida; iOS exige Mac;
tienda y legalidad. **No recomendado en v1.**

### B. PWA instalable (la opción más barata)

**Qué sería.** La UI actual, servida por la instancia de escritorio, con `manifest.webmanifest`,
iconos, service worker para el *shell* y instalación en la pantalla de inicio. No es una app
independiente: es el mismo servidor, con otra puerta.

**Lo que hay que añadir.** Manifiesto (`display: standalone`, `start_url`, iconos 192/512);
service worker que cachee el shell y sirva una página de «sin conexión»; `worker-src 'self'` en la
CSP; pantalla de conexión (URL + token + QR); TLS en LAN; y un botón de «Instalar» donde el navegador
lo permita.

**Ventajas.** Reutiliza el 100 % del servidor y de la UI. Mantiene el mismo origen, la cookie, los
guards y la CSP. No hay tienda, ni firma, ni build nativo. Los plugins siguen en el servidor, que es
donde ya están. Las actualizaciones son instantáneas. El HLS funciona igual que en escritorio.

**Límites duros.**
- **Contexto seguro.** El service worker y la instalación exigen HTTPS (o `localhost`). Una IP de LAN
  por HTTP no es contexto seguro: sin TLS no hay PWA instalable ni notificaciones. Hay que resolver
  certificados (Caddy con CA local, `mkcert`, o un túnel del usuario).
- **Offline real.** El shell se puede cachear; las descargas no. Cache Storage en iOS tiene un tope
  de ~50 MB y puede ser desalojado; no hay Background Sync ni Background Fetch. Para ver un episodio
  sin red en el teléfono hace falta una copia local nativa, no una PWA.
- **Segundo plano.** En Android, el audio puede seguir con Media Session; el vídeo y las descargas
  no. En iOS, el WebView se suspende al pasar a segundo plano; la reproducción se corta salvo que se
  use el reproductor nativo/PiP.
- **iOS.** En iPhone no hay `Element.requestFullscreen()`; el botón actual no funciona. El PiP dentro
  de una PWA instalada está roto en WebKit (bug 303885). La instalación es manual (Compartir → Añadir
  a inicio), sin `beforeinstallprompt`.
- **Dependencia del PC.** Si el equipo está apagado, no hay app. Es una decisión de producto, no un
  fallo.

**Esfuerzo.** 3–5 semanas para el MVP (manifiesto + SW + pantalla de conexión + TLS + ajustes
móviles), sin contar descargas offline. **La opción más barata con diferencia.**

### C. Capacitor envolviendo la UI de React

**Qué sería.** Un proyecto Android/iOS con el build de React dentro y plugins nativos (filesystem,
notificaciones, PiP, background). El servidor sigue sin caber; Capacitor no resuelve Bun ni los
plugins.

**Dos formas, y sólo una es barata:**

1. **Cargar la UI desde el servidor** (`server.url = https://<equipo>:<puerto>`). Es una WebView
   nativa apuntando al mismo origen: conserva cookie, guards y CSP. Los plugins nativos pueden añadir
   PiP, foreground service, descargas al almacenamiento de la app y notificaciones. Es la variante
   útil.
2. **Empaquetar la UI** en los recursos de la app. El origen pasa a `capacitor://localhost` (iOS) o
   `http://localhost` (Android); la cookie no viaja y el `Origin` no está admitido. Habría que añadir
   CORS, token de portador y exceptions en la CSP, o proxy nativo. Es más trabajo y más superficie.

**Pros.** UI reutilizada; plugins nativos resuelven segundo plano, PiP, descargas y notificaciones;
posible presencia en tiendas; un solo WebView.
**Contras.** Sigue necesitando el servidor remoto; si se empaqueta la UI, hay que cambiar la
autenticación y el modelo de amenaza; si se carga remota, la app es una WebView y la tienda puede
rechazarla por funcionalidad mínima (Apple 4.2); builds Android/iOS, firma y macOS; los plugins
nativos añaden mantenimiento. **Es la fase 2, no el primer paso.**

### D. React Native / Expo

**Qué sería.** Reescribir la UI en componentes nativos, reutilizar la lógica TypeScript pura
(`core` con zod, `recsys`, tipos del contrato) y usar `react-native-video` para HLS.

**Lo que se puede reutilizar de verdad.** Los esquemas y tipos de `@rona/core`, parte de `recsys`, y
la forma de los DTO. No la UI (React DOM/CSS), ni el servidor, ni los plugins.

**Pros.** Mejor experiencia nativa: PiP, segundo plano, descargas, notificaciones, gestos y
rendimiento. Una sola UI para Android/iOS. Posible presencia en tiendas.
**Contras.** 26–52+ semanas para paridad; dos UIs que mantener (web y móvil) o abandonar la web; el
servidor sigue necesitando un hogar (el PC o un backend); los plugins no se pueden ejecutar en el
teléfono; y el riesgo legal de tienda sigue igual. **No es una opción para v1.**

### E. Cliente móvil ligero contra la instancia de escritorio

**Qué sería.** La app móvil no lleva servidor: se conecta al RoNa que ya corre en el PC/NAS. La UI
puede ser la web actual (PWA o WebView remota) o una UI nativa que hable la API. El servidor sigue
siendo la única fuente de verdad: plugins, SQLite, proxy, descargas y biblioteca.

**Ventajas.** Es la única opción que conserva **todo** el producto sin reescribirlo. No hay dos
bases, ni dos motores de descarga, ni dos modelos de plugins. El esfuerzo se concentra en lo que hoy
no existe: modo remoto, TLS, autenticación, descubrimiento y carencias del navegador.

**Contras.** Requiere el equipo encendido y alcanzable. Si es por Internet, hay que añadir TLS,
túnel/VPN y un modelo de amenaza para exponer el servidor (hoy los plugins se ejecutan sin sandbox y
el servidor no está pensado para Internet). No hay descargas offline en el teléfono sin trabajo
extra. La latencia de la LAN es buena; la de un túnel remoto, no.

**Esfuerzo.** 3–5 semanas como PWA; 6–10 semanas como envuelta nativa con plugins; una UI nativa
propia, 12–20 semanas y dos UIs.

### F. La alternativa que recomiendo: «modo remoto» con PWA primero

No es una opción nueva: es **E con la entrega de B**. Se añade al producto un modo remoto explícito
(opt-in), se sirve la UI desde la instancia y se instala como PWA. Después, si los datos del spike
dicen que hacen falta segundo plano/PiP/offline/tienda, se envuelve con Capacitor **cargando la UI
remota** (el mismo origen), no empaquetándola.

Esto respeta las restricciones del producto: sigue sin servidor central, sin cuentas y sin telemetría.
El servidor sigue siendo local; lo que se abre es la puerta de la LAN, con token y TLS, y se declara
en `SECURITY.md`.

---

## 4. Tabla comparativa

Escala: **+++** muy bueno / **++** bueno / **+** aceptable con trabajo / **−** malo o inexistente.
Esfuerzo en semanas-persona, una persona, sin contar revisión legal ni despliegue de tienda; es una
**estimación**, no una medida.

| Criterio | A. Tauri v2 móvil | B. PWA servida por la instancia | C. Capacitor | D. React Native/Expo | E. Cliente remoto (PWA/nativo) |
|---|---|---|---|---|---|
| Reutilización del código actual | UI sí; servidor **no** | **UI + servidor 100 %** | UI sí; servidor **no** | UI no; lógica TS parcial | **Servidor 100 %**; UI sí si es PWA/WebView |
| Esfuerzo MVP | 26–52+ sem (autocontenida); 6–10 si es sólo cliente | **3–5 sem** | 6–10 sem (cliente remoto); 26–52+ autocontenida | 26–52+ sem | **3–5 sem PWA**; 6–10 nativa |
| HLS | +++ en Android; ++ en iOS (WKWebView/nativo) | +++ Android; ++ iOS (HLS nativo; sin pistas del manifiesto) | +++/++ igual que PWA; ++ con player nativo | +++ (`react-native-video`) | +++/++ igual que PWA |
| Descargas / offline | +++ si se reescribe el motor; hoy no existe | + sólo shell; **sin offline real**; iOS ~50 MB | +++ con plugins nativos | +++ | ++ desde el servidor; **sin copia local** salvo fase 2 |
| Plugins / proveedores | **−** no se pueden cargar | **+++** siguen en el servidor | **++** siguen en el servidor | **−** no se pueden cargar | **+++** siguen en el servidor |
| Segundo plano / PiP | +++ nativo | Android ++; **iOS −** | +++ con plugins | +++ | PWA: Android ++, iOS −; nativa: +++ |
| Mantenimiento a largo plazo | − (dos backends, Rust + TS) | **+++** (un servidor, una UI) | + (proyecto nativo + plugins) | − (dos UIs) | **+++** (un servidor) |
| CI / firma / builds | − Android + iOS + macOS + firma | **+++** ninguno | Medio-alto: Android + iOS + firma + macOS | − Android + iOS + EAS/firma | +++ PWA; + nativa |
| Cobertura iOS | ++ posible, cara | ++ PWA instalable, con carencias | ++ posible, riesgo de tienda | ++ posible, riesgo de tienda | ++ PWA; ++ nativa con riesgo |
| Veredicto | No en v1 | **Primer paso** | Fase 2, si hace falta | No en v1 | **Arquitectura recomendada** |

**Lectura de la tabla.** A y D compiten por «mejor app nativa» y pierden por coste y por plugins. C es
la única que puede dar paridad nativa sin reescribir la UI, pero sigue necesitando el servidor. B y E
no compiten: E es la arquitectura, B el primer vehículo. La combinación gana en reutilización,
mantenimiento y tiempo; pierde en offline y en segundo plano, que son precisamente lo que hay que
medir en el spike.

---

## 5. Riesgos y bloqueos

### 5.1 Técnicos

| Riesgo | Prob. | Impacto | Por qué | Mitigación |
|---|---|---|---|---|
| Bun no existe en Android/iOS | **Cierto** | Alto | `bun:sqlite`, `Bun.serve`, `Bun.file`, `Bun.spawn`; Bun no compila para móvil | No portar el servidor: cliente remoto |
| Tauri no ejecuta sidecars en móvil | **Cierto** | Alto | El anfitrión actual es un lanzador de sidecar; `externalBin` es de escritorio | Cliente remoto o reescritura en Rust |
| Plugins TS imposibles en el teléfono | **Cierto** | Alto | `import()` dinámico + `node:fs`/`node:net` + módulos hermanos | Dejarlos en el servidor |
| Origen distinto rompe cookie/CSP/CORS | **Alta** | Alto | `SameSite=Strict`, guard de `Origin`, `connect-src 'self'`; no hay CORS ni bearer | Servir la UI desde el servidor; no empaquetarla |
| TLS en LAN es obligatorio para PWA | **Alta** | Alto | Sin HTTPS no hay service worker, instalación ni notificaciones | Caddy/`mkcert`/túnel; documentar; QR |
| Fullscreen en iPhone | **Cierto** | Medio | No hay `Element.requestFullscreen()` en iPhone | Modo extendido o `webkitEnterFullscreen` |
| PiP en PWA iOS | **Alta** | Medio | Bug de WebKit en standalone (303885) | Ocultar el botón con `webkitSupportsPresentationMode`; nativo si es requisito |
| Descargas offline en el teléfono | **Alta** | Alto | El motor vive en el servidor; iOS no tiene Background Sync ni FS amplio | Fase 2 nativa; en MVP, streaming desde el equipo |
| Almacenamiento Android/iOS | **Alta** | Medio | Scoped storage, sandbox, permisos, `MediaStore`/SAF | Directorio privado + `MediaStore`/SAF; no rutas absolutas |
| Segundo plano iOS | **Alta** | Alto | WebView suspendido; sin `UIBackgroundModes` | Envuelta nativa con `audio`/PiP |
| Dos bases / sincronización | **Media** | Alto | Si el móvil guarda progreso/descargas localmente, hay dos verdades | Servidor autoritativo; sincronizar sólo progreso offline con un protocolo nuevo |
| Descubrimiento y firewall | **Media** | Medio | IP, puerto, token y TLS a mano; el firewall de Windows puede bloquear | QR, `lanUrls`, documentación, abrir regla de firewall |
| Rendimiento/batería | **Desconocida** | Medio | WebView + hls.js + proxy remoto; no medido | Spike con un episodio de 30 min y medición |
| Exponer el servidor a Internet | **Media** | Alto | Plugins sin sandbox, sin rate limit general, sin TLS propio; `SECURITY.md` no lo cubre | Sólo LAN en v1; túnel/VPN y modelo de amenaza para remoto |

**Coste de CI, en concreto.** Un paquete móvil dentro de `packages/` rompe dos supuestos del
repositorio: `scripts/workspaces.test.ts:79` espera **nueve** paquetes y `scripts/version.ts:5-18`
espera **diez** `package.json`. O se pone fuera de `packages/` (como `desktop/`, con su propio
listón) o se actualizan los dos. Además, Android necesita JDK + SDK + keystore y un `versionCode`;
iOS necesita un runner macOS, certificado, perfil de aprovisionamiento y una clave de App Store
Connect. Hoy `release.yml:236-254` ya compila macOS y Windows, y `ci.yml:347-373` prueba Windows,
pero no hay nada de Android. No es bloqueante; es coste y secretos.

### 5.2 Distribución en tiendas

- **Apple, 5.2.3 (Audio/Video Downloading):** prohíbe guardar, convertir o descargar medios de
  terceros sin autorización expresa. La app tiene descargas y reproduce fuentes de plugins. Es el
  bloqueo más directo.
- **Apple, 5.2.2 (Third-Party Sites/Services):** exige permiso de los servicios de terceros cuyos
  contenidos se acceden o muestran. Los plugins acceden a sitios de terceros.
- **Apple, 2.5.2 (Self-contained / executable code):** la app no puede descargar y ejecutar código que
  introduzca o cambie funcionalidad. Un sistema de plugins que baja `.ts` de GitHub y los ejecuta es
  exactamente eso, aunque el intérprete sea JavaScript. La excepción es para apps educativas, no para
  un catálogo de proveedores.
- **Apple, 4.2 (Minimum Functionality):** una app que sólo es un WebView del servidor del usuario
  puede rechazarse por no aportar funcionalidad propia; otra razón para no empezar por Capacitor.
- **Google Play, «Encouraging Infringement of Copyright»:** nombra expresamente las apps de streaming
  que permiten descargar copias locales de contenido con copyright sin autorización. La política de
  contenido se aplica a la app y a su descripción, no a un descargo de responsabilidad en el README.
- **Google Play, carga dinámica de código:** la documentación de Android advierte de que muchas formas
  de carga dinámica, sobre todo desde fuentes remotas, violan las políticas y pueden suspender la
  app. Un marketplace de plugins es el caso de riesgo.
- **Play, foreground service y datos:** una reproducción en segundo plano exige
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` y una notificación; la ficha de Data Safety tiene que declarar
  el acceso a red y a archivos. No es imposible, pero es trabajo y revisión.
- **PWA y sideload:** evitan la tienda, no la legalidad. Si el contenido no está autorizado, el
  riesgo de DMCA/CEASE & DESIST y de términos de los sitios sigue existiendo. La ventaja es que no
  hay un revisor de Apple/Google decidiendo; la desventaja es que la distribución y la confianza
  recaen en el usuario.

**Conclusión honesta:** con el modelo actual (plugins de terceros + descargas + fuentes no
autorizadas), **una app en App Store es improbable y una en Play es frágil**. Una PWA o un APK
sideload son las únicas vías que no dependen de convencer a un revisor, y aun así no eliminan el
riesgo legal. Si el producto quiere tienda, antes hay que cambiar el producto: contenido autorizado,
proveedores incluidos y auditados, o quitar las descargas.

### 5.3 Legales y de producto

- **El repositorio no pone las fuentes**, pero la app las ejecuta y las ofrece. El README dice «este
  repositorio no incluye scrapers» y separa los plugins reales; un revisor de tienda ve la capacidad,
  no la separación de repositorios.
- **AniList** se consulta con lista blanca, una petición cada 2 s y caché; sus términos se respetan
  en el servidor. Un cliente móvil que hablara AniList directamente duplicaría la cuota y rompería esa
  política. Otra razón para que el servidor siga siendo el único que sale a AniList.
- **AniSkip** es opcional y se apaga con un ajuste; en móvil debe seguir siendo opt-in.
- **Privacidad:** el modo local es una ventaja. El modo remoto convierte el equipo en un servidor de
  tu biblioteca; hay que decidir qué se expone, a quién y durante cuánto tiempo. No hay cuentas; el
  token es la única credencial.
- **Plugins sin sandbox:** en el escritorio el riesgo es del usuario. En el teléfono, ejecutar código
  de terceros con los permisos de la app sería peor y, además, es lo que las tiendas prohíben.

---

## 6. Plan por fases

### Fase 0 — Spike: el modo remoto, en un teléfono real (1–2 semanas)

**Objetivo:** validar lo más arriesgado antes de escribir UI: que un Android y un iPhone puedan
hablar con la instancia, autenticarse, reproducir HLS y sobrevivir al segundo plano. **Sin tocar
código de producto**: variables de entorno, un proxy TLS y el fixture.

**Cómo:**

1. Arrancar el servidor con `RONA_HOST=0.0.0.0`, `RONA_TOKEN=<32 bytes>` y, delante, un proxy TLS
   (Caddy con CA local o `mkcert`) o un túnel del usuario. `RONA_PUBLIC_ORIGIN` con el origen HTTPS.
2. Abrir `https://<ip>:<puerto>/login` desde Chrome Android y Safari iOS; canjear el token; comprobar
   que la cookie persiste al cerrar y reabrir el navegador.
3. Reproducir 30 minutos del fixture (HLS y `file`), con seeks, cambio de calidad, subtítulos y
   AniSkip. Medir: tiempo hasta el primer fotograma, cortes de más de 2 s, latencia de seek, memoria
   aproximada y batería.
4. Pasar a segundo plano 5 minutos: ¿sigue el audio? ¿se guarda el progreso? ¿se recupera al volver?
5. Probar pantalla completa, PiP y giro en Android; en iPhone, probar el botón actual (se espera que
   no haga nada) y el modo extendido como reserva.
6. Descargar un episodio en el servidor mientras se reproduce; abrir la descarga desde el móvil;
   comprobar el `Range` y la reproducción.
7. Cortar la red y volver; comprobar que el reproductor renueva el ticket y no se queda en negro.
8. Repetir con un proveedor real **sólo si hay autorización**; si no, el fixture es suficiente para
   medir la tubería.

**Criterios de éxito (medidos, no «va bien»):**

- 30 min sin cortes de más de 2 s; seek < 1,5 s; primer fotograma < 3 s en LAN.
- La sesión sobrevive a cerrar y reabrir el navegador; el token no aparece en la URL ni en un log.
- 5 min en segundo plano: el estado se conserva y el progreso no se pierde.
- Ningún 401/403 inesperado después de 10 min; el ticket se renueva solo.
- Sin desbordes horizontales a 320/390/430 px; mandos de 44 px.
- En iPhone: el modo extendido da una pantalla completa aceptable aunque no sea la API nativa.

**Criterio de abandono:** si el HLS no aguanta 30 min, si la cookie no persiste o si el segundo plano
pierde la posición de forma irrecuperable, no se sigue: se replantea el producto (o se va directo a
una envuelta nativa, que es más cara). **No hay nada que revertir:** el spike es entorno y un proxy.

### Fase 1 — MVP: «modo remoto» + PWA (3–5 semanas)

**Objetivo:** que el usuario pueda instalar RoNa en el móvil y ver su biblioteca desde el PC, con una
experiencia aceptable, sin tienda y sin tocar el motor.

**Entra:**

- **Ajustes → Acceso remoto:** interruptor opt-in, token generado/rotado, puerto, URL(s) LAN, QR,
  estado de TLS y aviso de seguridad. Reutiliza `lanUrls` (`party/lan.ts`) y el login existente.
- **Servidor:** flags/documentación para `RONA_HOST`, `RONA_TOKEN`, `RONA_PUBLIC_ORIGIN`; las rutas
  siguen siendo las mismas. Nada de CORS ni de bearer en esta fase.
- **PWA:** `manifest.webmanifest`, iconos 192/512, `display: standalone`, `theme-color`,
  service worker de shell + página offline; `worker-src 'self'` en la CSP; botón de instalación
  cuando exista.
- **Conexión:** pantalla de «Conectar con mi equipo» (URL + token + QR), manejo de 401 y de servidor
  caído, y persistencia de la sesión.
- **UI móvil:** reserva de `safe-area`, giro, 44 px, `hover: none`, y **reserva de pantalla completa
  en iPhone** (modo extendido o `webkitEnterFullscreen`).
- **Descargas:** se declara en la UI que viven en el equipo; se reproduce desde el servidor. **No hay
  offline en el teléfono en este MVP**, y se dice.
- **Pruebas:** e2e a 390×844 y 844×390; comprobación de que no hay desbordes; prueba manual en un
  Android y un iPhone; revisión de `SECURITY.md` y de la guía de instalación.

**Criterios de éxito:**

- Instalar en Android (Chrome) y en iOS (Safari → Añadir a inicio) y abrir sin barra de navegador.
- Login una vez; la sesión aguanta reinicio y 10 min en segundo plano.
- 30 min de reproducción con los mismos umbrales del spike; sin 401/403.
- Ningún texto de UI nuevo fuera de `packages/web/src/i18n/es.ts`.
- `typecheck`, `lint`, `bun test` y e2e en verde en los paquetes tocados; `docs.test.ts` sigue en
  verde.

**Vuelta atrás:** quitar el manifiesto/SW y la pantalla de acceso remoto deja el producto como está.
El servidor no cambia de contrato.

### Fase 2 — Envuelta nativa, sólo si hace falta (6–10 semanas)

**Decisión de entrada:** el spike y el MVP demuestran que los usuarios necesitan al menos dos de
estas cosas: segundo plano fiable, PiP, descargas offline en el teléfono, notificaciones, o presencia
en tienda. Si no, no se hace.

**Entra:**

- **Capacitor cargando la UI remota** (`server.url`), para conservar el mismo origen y no tocar
  cookie/CSP. No empaquetar la UI en esta fase.
- Plugins nativos: mantener pantalla encendida, PiP, audio en segundo plano (Android: foreground
  service `mediaPlayback`; iOS: `UIBackgroundModes: audio`), notificaciones locales, descarga al
  almacenamiento de la app, compartir/abrir enlaces.
- **Offline:** descargar el episodio al teléfono (Android: `MediaStore`/SAF o directorio privado;
  iOS: contenedor + `URLSession` en segundo plano), reproducirlo localmente y sincronizar el progreso
  al volver. Esto es un motor nuevo, no el de escritorio.
- **Distribución:** APK/AAB para Android; TestFlight/App Store para iOS **sólo con revisión legal
  previa**. Si no hay autorización de contenido, no se envía a tienda.

**Criterios de éxito:**

- 30 min en segundo plano sin cortes; PiP entra y sale; notificación de descarga terminada.
- Un episodio descargado se reproduce en modo avión; el progreso se sincroniza al reconectar.
- Sin fugas de token; sin permisos de más; `SECURITY.md` actualizado con la superficie nativa.
- Build reproducible y firmado en CI; `version:check` incluye el nuevo manifiesto si hay paquete
  nuevo.

**Vuelta atrás:** no publicar; la PWA sigue siendo el producto. La envuelta nativa es un extra.

### Fase 3 — App autocontenida (no recomendada en v1; 26–52+ semanas)

Sólo si el requisito es «funciona sin PC». Implica:

- Reescribir el servidor en Rust/Kotlin/Swift o embeker un runtime JS con SQLite, FS y red; mantener
  dos backends.
- Reescribir el motor de descargas y el almacenamiento para cada plataforma.
- Rediseñar el modelo de plugins: proveedores incluidos y auditados, o un servicio remoto; el
  marketplace de `.ts` no cabe en una app sandboxeada de tienda.
- Resolver la legalidad del contenido antes de invertir un mes.

**No lo recomiendo.** Si algún día se hace, que sea después de que la PWA/nativa remota demuestre
demanda y de que el producto tenga una respuesta legal.

---

## 7. Preguntas abiertas

Estas son las que cambian la decisión; ninguna la puede contestar el código.

1. **¿La app tiene que funcionar con el PC apagado?** Si sí, se descarta B/E y el coste salta a
   26–52+ semanas. Si no, el modo remoto es el camino.
2. **¿Android solo o también iOS?** Android con PWA es barato; iOS con PWA es aceptable pero con
   carencias; iOS con app de tienda es caro y legalmente frágil.
3. **¿Hace falta presencia en tiendas o vale PWA/APK?** La tienda añade firma, revisión, política de
   contenido y, en iOS, un Mac y 99 USD/año. La PWA no.
4. **¿Las descargas offline en el teléfono son un requisito?** Si lo son, la PWA no basta: hace falta
   una envuelta nativa y un motor de descarga nuevo.
5. **¿El segundo plano y el PiP son un requisito?** En Android la PWA puede defender audio; en iOS
   no. Si son requisito, la fase 2 no es opcional.
6. **¿Aceptas que el móvil necesite TLS y un token?** ¿Quién los configura: tú, el usuario, un
   instalador? ¿Vale un QR con Caddy o hace falta un túnel?
7. **¿El acceso remoto es sólo LAN o también por Internet?** Internet exige TLS, túnel/VPN, límite
   de peticiones y un modelo de amenaza; hoy el servidor no está pensado para ello.
8. **¿Los plugins pueden quedarse en el servidor?** Si el requisito es ejecutarlos en el teléfono,
   cambia el producto y choca con las tiendas.
9. **¿Qué contenido y con qué derechos?** Si no hay autorización, la tienda es una pérdida de tiempo;
   la PWA/sideload sigue teniendo riesgo legal.
10. **¿Cuánto tiempo y mantenimiento hay?** Una PWA son 3–5 semanas y un servidor; una app nativa son
    dos proyectos y dos CI para siempre.
11. **¿Qué Android/iOS mínimos?** WebView antiguo, codecs H.264/AAC variables y iOS < 16 cambian el
    alcance de las pruebas.
12. **¿Qué se hace con Discord, bandeja, `mpv` y portable en móvil?** Se quitan o se sustituyen; no
    hay que prometer paridad.

---

## 8. Anexo: qué se midió, qué es suposición y qué falta

**Medido en el árbol (lectura de código, no ejecución):** las rutas y líneas citadas; la existencia
de los e2e a 390×844; la ausencia de manifiesto y service worker; la CSP; el flujo de tickets HLS; el
cargador de plugins; el esquema SQLite; el arranque sidecar; los workflows de CI/release.

**Suposiciones declaradas:**

- Que el sidecar hereda `RONA_HOST`/`RONA_TOKEN` si se lanzan en el entorno del `.exe`; no medido.
- Que un proxy TLS delante del servidor no rompe los guards (debería, con `RONA_PUBLIC_ORIGIN` y
  `Host` correctos); no medido.
- Que el HLS del proxy aguanta 30 min en un móvil real; no medido.
- Que el rendimiento de hls.js en un Android medio es suficiente; no medido.
- Los esfuerzos en semanas; no medidos.

**Pendiente de medir en el spike:** latencia, cortes, memoria, batería, segundo plano, PiP,
pantalla completa en iPhone, persistencia de cookie, descarga desde el móvil, comportamiento con
pérdida de red, firewall de Windows y certificados en Android/iOS.

**Fuentes externas consultadas para los límites de plataforma:**

- Tauri: *Embedding External Binaries* (los sidecars son de escritorio) y la incidencia
  [tauri-apps/tauri#9774](https://github.com/tauri-apps/tauri/issues/9774) (Android/iOS no ejecutan
  sidecars).
- Bun: *Single-file executable* (objetivos Linux/Windows/macOS; no Android/iOS).
- Apple: *App Review Guidelines* 2.5.2 (código ejecutable), 5.2.2 (servicios de terceros) y 5.2.3
  (descarga de audio/vídeo).
- Google Play: *Developer Program Policy*, «Encouraging Infringement of Copyright»; documentación de
  Android sobre *Dynamic Code Loading*.
- WebKit: bug 206854 (Fullscreen API en iPhone) y bug 303885 (PiP en PWA instalada); compatibilidad
  de `Element.requestFullscreen` en iOS.
- Apple: *Adding Picture in Picture to your Safari media controls*.
