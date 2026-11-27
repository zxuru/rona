# Plan móvil y TV: análisis y fases

**Estado:** Fase 0 entregada el 2026-11-27 sobre `0.11.4`. Este documento **no cambia código de la
aplicación**: fija la auditoría, la decisión de arquitectura, las fases y los presupuestos. Las
estimaciones son estimaciones, no medidas; lo que se ha leído del árbol va con su ruta.

**Punto de partida.** RoNa funciona en escritorio (Windows) con un sidecar Bun, SQLite nativo,
plugins TypeScript cargados en proceso y un proxy HLS. El objetivo es Android, después iOS y después
Android TV / Google TV, **sin duplicar lógica ni romper escritorio**.

> Hay un análisis previo, `docs/analisis-app-movil.md` (sin seguimiento en git al escribir esto), que
> concluye «cliente remoto, no portar el servidor». Su conclusión es correcta **si se intenta llevar
> el servidor tal cual**. Este plan parte de otra premisa: separar primero la lógica de aplicación de
> las APIs de Bun/Node y de la cáscara. Con esa separación, el núcleo TS sí cabe en el WebView y el
> servidor remoto pasa a ser un adaptador de red, no una arquitectura distinta.

---

## 1. Resumen ejecutivo

**Recomendación: núcleo TypeScript compartido dentro del WebView + cáscara Tauri delgada con
adaptadores nativos.** La UI y la lógica de aplicación son las mismas en escritorio, Android, iOS y
TV. Rust sólo implementa lo que el WebView no puede hacer con garantías: SQLite, transporte HTTP con
cabeceras y lista blanca, archivos, descargas en segundo plano y, si hace falta, reproducción nativa.

- **No se reescribe el servidor en Rust.** Serían dos implementaciones de la misma lógica, se
  perderían los plugins TS y el mantenimiento se duplicaría para siempre.
- **No se copia la UI por plataforma.** Se comparte `packages/web`; lo que cambia es el layout por
  capacidad (`platform`, `input`), no el componente.
- **El modo remoto no desaparece: se convierte en otro adaptador de red.** La misma aplicación puede
  hablar con su servidor local en proceso o con una instancia remota por HTTP. Sirve como atajo para
  publicar Android antes y como plan B si la migración local se atasca.
- **Coste realista:** 20–28 semanas-persona para el producto autocontenido completo (F1–F4), con un
  senior y contingencia. El atajo «Android como cliente remoto» son 3–5 semanas y no requiere tocar
  el motor.

**Bloqueos que no resuelve la arquitectura:**

1. **Plugins de usuario.** Un `.ts` descargado y ejecutado con `import()` dinámico no cabe en un
   WebView sandboxeado ni en las reglas de código dinámico de las tiendas. En móvil hay dos salidas:
   proveedores **incluidos en el build** (paquete de proveedores, no marketplace) o modo remoto. La
   instalación de plugins queda como función sólo de escritorio.
2. **Tiendas y legalidad.** Apple 5.2.3 y 2.5.2, y la política de Google sobre descargas y código
   dinámico, siguen aplicando. Un APK sideload o una PWA evitan al revisor, no el riesgo legal.
3. **iOS.** Requiere un Mac, Xcode y decidir el reproductor: HLS nativo de WKWebView o
   `ManagedMediaSource` + hls.js. No es «lo mismo que Android con otro icono».

**Puertas de decisión antes de F2** (las contesta producto, no el código):

- ¿La app tiene que funcionar con el PC apagado? Si no, el atajo remoto es la opción correcta.
- ¿Los proveedores pueden ir incluidos en el APK, sin instalación en runtime? Si no, no hay app
  autocontenida.
- ¿Hace falta tienda o vale APK/PWA? Si es tienda, el modelo de plugins actual no pasa.
- ¿Las descargas offline son requisito de F2 o de F3? Si son de F2, el motor de descargas móvil
  entra antes y el calendario sube.

---

## 2. Auditoría: qué depende de escritorio

### 2.1 Servidor, datos y red

| Pieza | Acoplamiento actual | Qué exige móvil | Disposición |
|---|---|---|---|
| Servidor HTTP | `Bun.serve` en `packages/server/src/index.ts:88` | No hay `Bun.serve` en WebView ni en Android/iOS | **Hono en proceso**: `createApp(...).fetch(request)`; el escritorio conserva `Bun.serve` |
| Base de datos | `bun:sqlite` en `packages/catalog-store/src/db.ts:20-51`; WAL, FKs, `busy_timeout` | SQLite nativo o WASM, con las mismas migraciones | **Puerto `SqlDatabase`**; escritorio `bun:sqlite`, móvil comando Rust `rusqlite` (o plugin SQL) |
| Repositorios | `import type { Database } from 'bun:sqlite'` en ~20 repositorios | Un tipo de conexión común | Cambiar el tipo por el puerto; la fachada `createCatalogStore` ya es `async` |
| Migraciones | `runMigrations` con `import.meta.dir` y `Bun.file`/`node:fs` | Leer los `.sql` del bundle, no del disco | Incluir el SQL en el build o pasar el runner por un `FileStore` |
| Archivos estáticos | `staticAssets` usa `Bun.file` (`packages/server/src/static-assets.ts:122-134`) | La cáscara Tauri sirve el bundle; no hace falta el middleware | No montar en móvil |
| Ajustes en disco | `packages/core/src/settings.ts:99` usa `Bun.file` | Ajustes ya viven en SQLite; el archivo es de arranque | Puerto `FileStore` o leer de SQLite |
| Red de plugins | `plugin-fetch.ts` usa `node:net`, `node:tls`, DNS fijado | Rust o plugin HTTP con lista blanca; el WebView no puede fijar DNS ni cabeceras prohibidas | **Puerto `HttpClient`**; implementación Rust para móvil |
| Proxy de bytes | `pinned-fetch.ts` usa `node:http`/`https`/`net`/`tls` | Transporte binario con `Range` y cabeceras de hotlink | **Puerto `MediaTransport`**; Rust para móvil; la reescritura HLS sigue en TS |
| HLS | `packages/media-proxy/src/hls.ts` reescribe playlists y emite tickets | Igual, pero el cliente no tiene un origen HTTP del servidor | Mantener TS; hls.js con *loader* propio o proxy local de sólo medios |
| `mpv` | `Bun.spawn` en `packages/media-proxy/src/mpv.ts:248-255` y `packages/cli/src/index.ts` | No existe en el teléfono | Función sólo de escritorio; en móvil, reproductor del sistema/adaptador |
| `ffmpeg` | `packages/media-proxy/src/download/ffmpeg.ts` | No existe; el remux móvil sería nativo o se evita | Descargas móviles en F3, no en F2 |
| Presencia Discord | `packages/server/src/presence/ipc.ts` usa `node:net` y named pipe | No hay IPC de Discord | **Función sólo de escritorio**; `no-op` en móvil |
| Cast / AirPlay | `packages/server/src/routes/cast.ts`, `packages/web/src/features/player/cast/` | Exige LAN, contexto seguro y SDK del sistema | Ocultar por capacidad; no es de F2 |
| Watch party LAN | `packages/server/src/party/`, `packages/server/src/party/lan.ts` (`node:os`) | El invitado necesita una instancia; el móvil sin servidor no puede | Fuera de F2; el móvil puede ser mando de una instancia |
| Descargas | `packages/server/src/downloads/`, `packages/server/src/routes/downloads.ts` (`node:fs`, `Bun.file`, `statfs`) | Almacenamiento de app, segundo plano, `MediaStore`/SAF | F3; en F2 la biblioteca es de datos, no de archivos |
| Rutas XDG/Windows | `packages/core/src/config.ts` | Directorios de app Android/iOS | Adaptador `Paths`; no reutilizar XDG en móvil |
| Auth/cookie | Cookie `HttpOnly; SameSite=Strict`, `originGuard`, CSP de mismo origen | En proceso no hay origen remoto; en remoto la cookie no cruza a `tauri://` | En proceso: sesión local y guard sintético. Remoto: bearer o cargar la UI del servidor |

### 2.2 Cáscara de escritorio

| Función | Dónde | En móvil |
|---|---|---|
| Bandeja | `desktop/src-tauri/src/tray.rs` | No existe; notificación/foreground service si hace falta |
| Instancia única | `desktop/src-tauri/src/main.rs:186-196` | No aplica; el sistema gestiona la app |
| Ventana / `main.rs` | `desktop/src-tauri/src/main.rs` | Otra cáscara, no la misma ventana |
| Auto-actualización | `desktop/src-tauri/src/actualizacion.rs`, plugin updater | **No soportada en móvil**; Play Store / App Store / APK |
| Modo portable | `desktop/src-tauri/src/entorno.rs:121-234` | No existe; sandbox de app |
| Servidor embebido / sidecar | `desktop/src-tauri/src/embebido.rs`, `sidecar.rs` | **Tauri no ejecuta sidecars en móvil** (issue #9774) |
| `--diagnostico`, `--navegador` | `desktop/src-tauri/src/main.rs` | No aplica; logs y enlaces del sistema |
| IPC `elegir_carpeta_descargas` | `desktop/src-tauri/src/main.rs:54` | No hay selector de carpetas absolutas; almacenamiento de app |

### 2.3 UI: lo que ya sirve y lo que falta

**Ya sirve, y no hay que rehacerlo:**

- Navegación inferior y cabecera que se apaga por debajo de 640 px:
  `packages/web/src/components/BarraInferior.tsx`, `packages/web/src/app.tsx:224-230`,
  `packages/web/src/styles/base.css:351`.
- Safe areas: `packages/web/src/styles/base.css:86-88`,
  `packages/web/src/styles/gestion.css:1868-1913`, `packages/web/src/styles/vitrina.css:2010`.
- Objetivos táctiles de 44 px y gestos del reproductor:
  `packages/web/src/features/player/usePlayerGestos.ts:24-42`,
  `packages/web/src/features/player/usePlayerMandos.ts:28-55`.
- `loading="lazy"` y `decoding="async"` en portadas: `packages/web/src/components/Cover.tsx:95-106`.
- e2e a 390×844: `packages/web/e2e/movil.e2e.ts`, `packages/web/e2e/paginas-movil.e2e.ts`.
- `<dialog>` nativo para modales, con foco atrapado y `Esc`: `PanelPieza.tsx`, `Confirmacion.tsx`,
  `SecurityNotice.tsx`, `DirectoryPicker.tsx`.

**Huecos reales:**

- **TV no existe como capacidad.** No hay navegación espacial ni foco inicial; las flechas sólo las
  consume el reproductor (`usePlayerTeclado.ts`). No hay `:focus-visible` en todos los controles ni
  un orden de foco declarado para D-pad.
- **Hover fuera de `@media (hover: hover)`.** Hay decenas de reglas `:hover` en `vitrina.css`,
  `obra.css`, `gestion.css` y `base.css`; algunas revelan acciones (`.pz__quitar`, `.pz__abrir`,
  `.card`). En TV y táctil hay que forzar su visibilidad, no depender del hover.
- **Listas largas sin virtualizar.** El mosaico y las filas pintan todo lo que llega. La búsqueda y
  la biblioteca pueden crecer; hace falta virtualización o `content-visibility`.
- **Pantalla completa en iPhone.** `usePlayer.ts:815-818` usa `requestFullscreen`, que no existe en
  iPhone. Hay que mapear a modo extendido o a `webkitEnterFullscreen`.
- **Orientación y pantalla encendida.** No hay `screen.orientation.lock()` ni `navigator.wakeLock`.
- **PWA.** No hay `manifest.webmanifest` ni service worker; la CSP tiene `worker-src 'none'`.
- **CSP y Tauri.** La CSP actual no contempla `ipc:`/`ipc.localhost` ni un proxy local de medios.
  `worker-src 'none'` también afecta a hls.js con worker y a SQLite WASM.

---

## 3. Tauri v2 en móvil: qué hay y qué falta

Estado consultado en la documentación oficial (noviembre de 2026) y en el catálogo de plugins.

### 3.1 Núcleo

- Android e iOS son objetivos estables de Tauri 2. Android exige SDK/NDK/JDK y `minSdkVersion` 24
  por defecto; iOS exige macOS, Xcode y CocoaPods. El proyecto actual no tiene nada de eso.
- **Android TV:** el CLI de Tauri incorpora soporte de TV desde 2024 (issue #10602). Aun así hay que
  revisar en el manifiesto generado `<uses-feature android:software.leanback>`, el banner y
  `CATEGORY_LEANBACK_LAUNCHER`; la documentación de TV de Tauri sigue siendo escasa.
- **Origen del WebView:** en iOS/macOS es `tauri://localhost`; en Windows/Android es
  `http://tauri.localhost` (o `https://` con `useHttpsScheme`). Esto **rompe** el modelo actual de
  cookie `SameSite=Strict`, `Origin` y CSP de mismo origen si la UI empaquetada llama a un servidor
  remoto. La arquitectura en proceso evita el problema; el modo remoto dentro de Tauri exigiría
  bearer/orígenes nuevos.
- **Sidecars:** no soportados en móvil. El anfitrión actual es un lanzador de sidecar; no se traslada.
- **Updater:** sólo escritorio. En móvil actualiza la tienda o se reinstala el APK.

### 3.2 Plugins oficiales que nos importan

| Necesidad | Plugin | Android | iOS | Nota |
|---|---|---|---|---|
| SQLite | `sql` | Sí | Sí | Asíncrono, `sqlx`; no es la API síncrona de `bun:sqlite` |
| HTTP sin CORS | `http` | Sí | Sí | `reqwest`; útil para JSON, pero el streaming binario pide comando propio |
| Archivos | `fs` | Sí | Sí | Sólo directorios de la app por defecto; en Android, permisos para almacenamiento externo |
| Ajustes clave-valor | `store` | Sí | Sí | Cifrado no; para secretos, Stronghold/Keychain |
| Notificaciones | `notification` | Sí | Sí | Hace falta permiso y foreground service para descargas |
| Deep links | `deep-link` | Sí | Sí | Para QR/login y abrir enlaces |
| Diálogos | `dialog` | Sí | Sí | En móvil no hay selector de carpetas |
| Shell | `shell` | Sólo URLs | Sólo URLs | No ejecuta comandos ni sidecars |
| Bandeja | `system-tray` | No | No | Sustituto: notificación |
| Instancia única | `single-instance` | No | No | No aplica |
| Estado de ventana | `window-state` | No | No | No aplica |
| Auto-actualización | `updater` | No | No | Tienda/APK |

**Conclusión:** Tauri cubre la cáscara y los datos, pero **no** resuelve el servidor, el proxy HLS,
los plugins ni el reproductor. Eso lo pone la capa de adaptadores.

### 3.3 Lo que falta o es inestable

- **Streaming binario por IPC.** El plugin HTTP devuelve respuestas, pero para segmentos HLS y
  `Range` conviene un comando Rust que devuelva bytes (`tauri::ipc::Response`) o un proxy local de
  sólo medios. Hay que medirlo: el puente JS↔Rust por segmento puede costar CPU y batería.
- **Reproductor nativo.** hls.js funciona en Android WebView (MSE), pero no es ExoPlayer: códecs,
  PiP, segundo plano y TV dependen del WebView del fabricante. En iOS, hls.js necesita
  `ManagedMediaSource` (iOS 17.1+) o el HLS nativo de WKWebView. Es un adaptador de reproductor, no
  una suposición.
- **Segundo plano.** Android necesita `FOREGROUND_SERVICE_MEDIA_PLAYBACK` y notificación; iOS necesita
  `UIBackgroundModes: audio` y reproduce con AVPlayer/PiP. Un WebView suspendido no basta.
- **Descargas.** El motor actual es de escritorio (`node:fs`, `ffmpeg`, `statfs`). En móvil hay que
  escribir otro adaptador (Rust/URLSession/DownloadManager) y decidir `MediaStore`/SAF.
- **Firma y CI.** Android necesita JDK, SDK, keystore y `versionCode`; iOS necesita runner macOS,
  certificado y perfil. Hoy el CI sólo compila Windows/Linux/macOS de escritorio.

---

## 4. Opciones para llevar la lógica del servidor

### A. Núcleo TS en el WebView + adaptadores nativos (recomendada)

**Qué es.** `packages/core` define puertos y capacidades; `packages/server` queda como capa de
aplicación plataforma-neutra (Hono y rutas). En móvil, el WebView ejecuta esa capa con `app.fetch()`
en proceso. Rust implementa SQLite, HTTP/medios, archivos y descargas. La UI no cambia de origen.

**Rendimiento.** El arranque paga el bundle JS y la apertura de SQLite; el playback puede delegarse a
un proxy local nativo y al decodificador del WebView. hls.js en JS consume más CPU que ExoPlayer,
pero evita duplicar la lógica HLS. La base de datos nativa evita WASM y mantiene la memoria baja.

**Batería.** Aceptable para reproducción; el coste grande es el WebView y el puente por segmento. Un
proxy local de medios y, en TV, un adaptador ExoPlayer bajan el consumo. Hay que medirlo antes de
prometer 30 min sin cortes.

**Seguridad.** Mejor que el escritorio en una cosa: **no hay puerto escuchando**, así que no hay CSRF
ni DNS rebinding desde otras apps. La frontera pasa a ser el comando HTTP nativo: lista blanca de
destinos, revalidación de redirecciones, sin loopback/privadas, topes de bytes y tiempo. Los plugins
de usuario no se ejecutan en móvil; los proveedores van incluidos y auditados en el build.

**Coste.** Alto: hay que separar ~15 k líneas de `server`, adaptar ~5 k de `catalog-store`, ~4,4 k de
`media-proxy` y los puntos de `core`. La ventaja es que **no se reescribe la lógica de negocio**.

### B. Comandos Rust con la lógica del servidor

**Qué es.** Rutas, SQLite, proxy, HLS y descargas en Rust; el WebView sólo pinta.

**Pros.** Rendimiento y batería nativos; streaming y segundo plano sencillos; ExoPlayer/AVPlayer.

**Contras.** Duplica la lógica que ya existe y está probada; pierde los plugins TS; obliga a mantener
dos servidores y dos juegos de tests. **No cumple «un solo núcleo»**. Es la opción que el análisis
previo descartó con razón.

### C. Servidor remoto

**Qué es.** La app móvil es cliente de la instancia de escritorio/NAS; el servidor sigue siendo Bun.

**Pros.** Reutiliza el 100 % del servidor, plugins, SQLite, proxy, descargas y biblioteca. Es la
opción más barata (3–5 semanas como PWA). No hay dos bases ni dos motores.

**Contras.** Necesita el PC encendido y alcanzable; TLS en LAN; sin copia local; el WebView empaquetado
tiene otro origen y exige bearer/orígenes nuevos; el servidor no está pensado para Internet.

**Rendimiento/batería.** El teléfono sólo decodifica; el servidor hace el proxy. La radio de red pesa
más que en local, sobre todo fuera de LAN. La batería no es el problema; la dependencia sí.

**Seguridad.** La superficie es la del servidor expuesto: token, TLS, rate limit y un modelo de
amenaza para Internet. Hoy `SECURITY.md` sólo cubre LAN y loopback.

### D. Híbrido por fases: remoto primero, local después

**Qué es.** F1 construye puertos y capacidades; F2a publica Android como cliente remoto; F2b añade el
núcleo local con los mismos puertos. Es la opción con menos riesgo de calendario.

**Pros.** Se ve producto antes; el adaptador de red remoto y el local comparten interface; si el
núcleo local se atasca, ya hay una app útil. **Contras.** Dos modos que mantener y explicar; no es
una app autocontenida hasta F2b.

### Comparativa

| Criterio | A. TS en WebView | B. Rust | C. Remoto | D. Híbrido |
|---|---|---|---|---|
| Reutiliza lógica | **Alta** (rutas/dominio) | Baja | **Total** | Alta |
| Autocontenida | **Sí** | Sí | No | Sí en F2b |
| Plugins de usuario | No (incluidos) | No | **Sí** | Sí en remoto |
| Rendimiento/batería | Medio | **Alto** | Alto en playback | Medio/alto |
| Coste | 20–28 sem | 26–52+ sem | **3–5 sem** | 6–10 sem hasta F2a |
| Mantenimiento | Un núcleo + adaptadores | Dos backends | Un servidor | Un núcleo + dos transportes |
| Riesgo de tienda | Alto | Alto | Medio | Medio |

**Decisión:** A como arquitectura objetivo, con C/D como transporte y atajo. Si producto responde
«no hace falta que funcione sin PC», se entrega C primero y A se pospone; el trabajo de F1 no se tira.

---

## 5. Arquitectura objetivo

### 5.1 Paquetes y responsabilidades

```
packages/core
  ├─ dominio, schemas Zod, i18n, errores
  ├─ capabilities.ts      platform | input | features
  └─ ports/               SqlDatabase, HttpClient, MediaTransport, FileStore,
                          KeyValueStore, Player, Presence, Downloader, Paths
packages/server           capa de aplicación compartida (Hono + rutas)
packages/catalog-store    implementación SQLite sobre el puerto
packages/media-proxy      HLS/bytes lógica TS + puerto de transporte
packages/web              UI + adaptadores de navegador
mobile/                   cáscara Tauri Android/iOS/TV (fuera de packages/)
desktop/                  cáscara Tauri de escritorio (sin cambios de contrato)
```

`packages/core` **no importa** `node:*`, `bun:*`, `hono` ni `@tauri-apps/*`. Los puertos son
interfaces; las implementaciones viven en `desktop/`, `mobile/` o en un paquete de adaptadores.

### 5.2 Capacidades, no plataformas

```ts
type Platform = 'desktop' | 'mobile' | 'tv'
type InputKind = 'mouse' | 'touch' | 'dpad'

interface Capabilities {
  platform: Platform
  input: InputKind
  features: {
    tray: boolean
    discordPresence: boolean
    extendedMode: boolean   // CSS: existe en todas; en escritorio es preferencia
    portable: boolean
    windowControls: boolean
    mpv: boolean
    downloads: boolean
    cast: boolean
    party: boolean
    pluginInstall: boolean
    remoteServer: boolean
    wakeLock: boolean
    orientationLock: boolean
  }
}
```

- `platform` lo decide la cáscara: Tauri móvil + `UiModeManager`/`FEATURE_LEANBACK` para TV.
- `input` se detecta con `matchMedia('(pointer: coarse)')`, `(hover: none)` y el primer `keydown` de
  flechas/Enter; en TV la cáscara lo declara `dpad`. Es reactivo: un mando conectado a una tablet
  cambia la UI sin recargar.
- La UI **no pregunta** `isMobile` ni `isTV`; pregunta capacidades. Un componente que no aplica se
  oculta o se sustituye, no se duplica.
- `features` se calcula una vez y se pasa por contexto. Las rutas de servidor que no aplican **no se
  registran** (`createApp` recibe `features`), así que una petición a ellas es 404, no un fallo raro.

### 5.3 Transporte: un núcleo, dos caminos

- **Local:** `createApp({...adapters}).fetch(request)` dentro del WebView. Sin `Bun.serve`, sin
  cookie, sin puerto. El cliente HTTP de la UI recibe un `RequestDeps` que llama a ese `fetch`.
- **Remoto:** el mismo cliente apunta a `https://<equipo>:<puerto>`; la app carga la UI desde el
  servidor o usa bearer. Es el adaptador `NetworkTransport`.
- **Escritorio:** no cambia: `Bun.serve` + sidecar + ventana. Los mismos puertos se implementan con
  Bun/Node.

### 5.4 Persistencia

- **Una base, un esquema, las mismas migraciones.** El móvil usa SQLite nativo en el directorio de la
  app. No se inventa un esquema móvil.
- **Progreso y biblioteca sobreviven a la actualización** porque la base vive en el contenedor de la
  app y las migraciones son las de `packages/catalog-store/src/migrations/`.
- **Copia y restauración:** exportar/importar el `.db` (o un JSON de biblioteca/progreso) desde
  Ajustes. Sirve para cambiar de dispositivo y para recuperar.
- **Sin doble verdad:** si el usuario conecta el móvil a una instancia remota, la base remota manda;
  la local es caché. No hay sincronización bidireccional en v1.

### 5.5 Plugins

- **Escritorio:** sin cambios (instalación y ejecución en proceso).
- **Móvil autocontenido:** registro de proveedores **incluido en el build**. Un paquete de
  proveedores se compila con la app; no se descarga ni se evalúa en runtime. La pantalla de alta de
  plugins desaparece por capacidad (`pluginInstall: false`).
- **Móvil remoto:** los plugins siguen en el servidor; el móvil no ejecuta ninguno.
- **Nunca** `new Function`, `eval` ni `import()` de una URL en móvil: rompe la CSP y las políticas de
  las tiendas.

---

## 6. Fases

Las estimaciones son semanas-persona de un senior, con revisión y pruebas; no incluyen tiempo de
tienda ni revisión legal. Cada fase termina con criterios medidos, dispositivos probados y pendientes.

### Fase 1 — Núcleo compartido y adaptadores (5–7 semanas)

**Entra**

- `packages/core`: `capabilities.ts`, `ports/`, tipos de `Platform`/`InputKind`/`Features`.
- `packages/server`: quitar `node:*`/`bun:*` de la composición; inyectar `SqlDatabase`, `HttpClient`,
  `MediaTransport`, `FileStore`, `Paths`, `Presence`, `Downloader`.
- `packages/catalog-store`: cambiar `Database` por `SqlDatabase`; adaptar el runner de migraciones a
  un `FileStore`; conservar WAL/FKs/busy_timeout en el adaptador.
- `packages/media-proxy`: separar lógica HLS de transporte; `pinned-fetch` queda como implementación
  de escritorio; el puerto define lista blanca, redirecciones, topes y `Range`.
- `createApp({ features })`: registrar sólo las rutas de la capacidad; `locked` deja de ser la única
  forma de apagar funciones.
- `packages/web`: `CapabilitiesProvider`, `useCapabilities`, feature flags; filtros de Ajustes;
  ocultar descargas/cast/party/plugins donde no aplique.
- Adaptador de escritorio **sin regresión**: mismas rutas, mismo `Bun.serve`, mismo sidecar.

**Criterios de aceptación**

- `bun run typecheck`, `bun run lint`, `bun test` y `bun run e2e` en verde en escritorio.
- Un test recorre las rutas registradas con `features` de móvil y comprueba que no existen
  `/api/play/mpv`, `/api/cast/*`, `/api/party/*`, `/api/downloads/*` ni el alta de proveedores.
- Un test abre la misma base con el adaptador de escritorio y con un doble del puerto móvil y obtiene
  las mismas filas para favoritos, historial y progreso.
- Ningún componente de `packages/web` importa `@tauri-apps/*` ni pregunta por `navigator.userAgent`.
- `bun run desktop:check` sigue verde (Rust de escritorio intacto).

**Riesgo principal:** el refactor toca casi todo el servidor. Se hace por pasos, con el listón verde
en cada commit; no se mezcla con F2.

### Fase 2 — Android funcional (6–8 semanas)

**Entra**

- `mobile/` con Tauri Android; `frontendDist` apunta al build de `packages/web`; `mobile/` fuera de
  `packages/` para no romper `scripts/workspaces.test.ts`.
- Adaptadores Android:
  - `SqlDatabase` con comando Rust `rusqlite` (WAL, FKs, `busy_timeout`, transacciones).
  - `HttpClient` con `reqwest` + lista blanca + revalidación de redirecciones + topes.
  - `MediaTransport`: proxy local de sólo medios en `127.0.0.1` (puerto efímero, ticket aleatorio) o
    *loader* de hls.js por IPC; se elige con una medición.
  - `FileStore` con `tauri-plugin-fs` (sólo directorios de app).
  - `Player`: `<video>` + hls.js; `playsInline`; Media Session.
- Proveedores incluidos en el build; sin instalación en runtime.
- Biblioteca, búsqueda, ficha, episodios, reproductor, progreso, favoritos, historial, ajustes
  básicos. Descargas, cast, party, Discord, mpv y plugins de usuario: ocultos.
- Migraciones y importación de una base de escritorio (para pruebas y cambio de dispositivo).

**Criterios de aceptación**

- En un Android real o emulador API 34: abrir, buscar, abrir ficha, reproducir un episodio HLS,
  pausar, buscar posición, cambiar calidad/subtítulo y reanudar en el segundo guardado.
- Matar la app y abrirla: la biblioteca, el historial y el progreso siguen ahí.
- 30 min de reproducción sin cortes > 2 s; seek < 1,5 s; primer fotograma < 3 s en LAN/local.
- Sin desbordes a 320/390/430 px; objetivos táctiles ≥ 44 px; safe areas respetadas en vertical y
  horizontal.
- Sin `401/403` inesperados; el ticket se renueva.
- `bun test` de escritorio sigue verde; el APK se genera en CI con `versionCode`.

**Pendiente declarado:** descargas offline, PiP, segundo plano, cast y plugins de usuario.

### Fase 3 — Pulido móvil e iOS (5–7 semanas)

**Entra**

- iOS: Tauri iOS, WKWebView; decidir HLS nativo vs `ManagedMediaSource`; botón de pantalla completa
  con `webkitEnterFullscreen` o modo extendido; PiP con la puerta WebKit correcta.
- Android: `wakeLock`, bloqueo de orientación en reproducción, PiP, audio en segundo plano con
  foreground service, notificaciones.
- Descargas offline: motor móvil (Rust/URLSession/DownloadManager), almacenamiento de app,
  `MediaStore`/SAF, reanudación, cuota y borrado; reproducir sin red; sincronizar progreso al volver.
- Rendimiento: virtualizar búsqueda/biblioteca, cache de imágenes, presupuesto de bundle.
- Accesibilidad móvil: lector de pantalla, tamaños, contraste, reduced motion.

**Criterios de aceptación**

- 30 min en segundo plano sin cortes (Android) y PiP entra/sale (Android; iOS si el WebView lo
  permite).
- Un episodio descargado se reproduce en modo avión; el progreso se sincroniza al reconectar.
- iOS: pantalla completa y reproducción HLS medidas en un iPhone real; si no hay dispositivo, **no
  se declara medido**.
- Presupuestos de la sección 7 cumplidos o desviación declarada con motivo.

### Fase 4 — Android TV (4–6 semanas)

**Entra**

- Manifiesto TV: `LEANBACK_LAUNCHER`, `android.software.leanback` con `required=false`, banner,
  landscape, sin touchscreen requerido. Tauri ya genera parte; se verifica en el APK.
- Capacidad `platform: tv`, `input: dpad`. Navegación espacial propia o `@norbitmedia/…` (evaluar
  dependencia): foco inicial, orden por geometría, sin trampas, `Back` consistente.
- UI de 10 pies: tipografía y controles grandes, overscan, sin hover; acciones visibles sin puntero.
- Reproductor sólo con mando: play/pausa, seek, subtítulos, calidad, siguiente episodio, atrás.
- Medir hls.js vs ExoPlayer en un TV box real; si el WebView no da 1080p estable, adaptador nativo.

**Criterios de aceptación**

- En un Android TV/Google TV real: arranca desde Leanback, se navega toda la app con D-pad, el foco
  siempre se ve, no hay trampas ni saltos, `Back` no cierra la app donde no debe.
- Reproducción 1080p 30 min sin cortes > 2 s; memoria estable; mando remoto controla todo.
- Sin hover ni dependencia de ratón.

### Atajo opcional — Android remoto (3–5 semanas, en paralelo)

Si producto necesita ver Android antes, F1 + transporte remoto entrega biblioteca, búsqueda,
reproductor y progreso contra la instancia de escritorio. No incluye descargas offline ni plugins en
el teléfono. Es también el plan B si F2 local se atasca.

---

## 7. Presupuestos de rendimiento

Son **objetivos a medir**, no medidas. Se calibran con el primer dispositivo de referencia.

| Métrica | Móvil | TV | Cómo se mide |
|---|---|---|---|
| Arranque en frío | ≤ 2,5 s hasta home interactiva | ≤ 4 s | `adb shell am start -W` + `performance.mark` |
| Primer fotograma | ≤ 3 s en LAN/local | ≤ 4 s | `video` `loadeddata`/`playing` |
| Bundle inicial | ≤ 250 KB gzip JS + CSS | ≤ 300 KB | build de Vite + comprobación en CI |
| hls.js | carga diferida; ≤ 250 KB gzip | igual | chunk separado, no en el inicial |
| Memoria | ≤ 250 MB PSS en 1080p | ≤ 400 MB | `dumpsys meminfo` a los 10 min |
| Batería | ≤ 12 %/h en 1080p | — | Battery Historian / medición manual |
| Cortes | 0 cortes > 2 s en 30 min | 0 > 2 s | logs de hls.js + observación |
| Seek | < 1,5 s | < 2 s | medición manual |
| Base de datos | abrir/migrar < 300 ms | < 500 ms | `performance.mark` + log nativo |
| Imágenes | `loading=lazy`, `decoding=async`, caché ≤ 200 MB | igual | DevTools + cuota |
| Listas | virtualizar > 60 elementos | > 40 | prueba con 500 resultados |

**Reglas:**

- hls.js **nunca** en el chunk inicial; `import()` dinámico como hoy.
- Portadas con `loading="lazy"`; el destacado con `eager`/`fetchPriority=high`.
- Listas largas con virtualización o `content-visibility: auto`; no pintar 500 tarjetas.
- Nada de animaciones de layout en TV; sólo transform/opacity.
- Medir en un dispositivo de gama media (p. ej. Snapdragon 6xx/7xx) y en un TV box de 2 GB, no sólo
  en el emulador.

---

## 8. Pruebas y no regresión

**Escritorio (cada cambio):**

- `bun run typecheck`, `bun run lint`, `bun test`.
- `bun run e2e` cuando se toca UI; `bun run desktop:check` cuando se toca Rust.
- CI completo antes de cerrar la fase.

**Móvil/TV:**

- Unitarias del núcleo con dobles de puertos (sin dispositivo).
- e2e de Playwright a 390×844, 844×390 y 1280×720 (TV) con teclado/D-pad simulado.
- Pruebas de foco: recorrer la app con `Tab`/flechas, comprobar que el foco no se pierde ni queda
  atrapado; `dialog` devuelve el foco.
- Pruebas de migración: abrir una base de la versión anterior, migrar y comprobar favoritos,
  historial y progreso.
- Pruebas de mutación en los controles nuevos: romper la implementación y exigir que el test falle.

**CI:**

- Android: job con JDK/SDK/NDK, `tauri android build`, APK de debug y `versionCode`.
- iOS: job macOS con Xcode, sólo cuando haya runner y certificado; si no, se declara.
- No meter `mobile/` en `packages/`: `scripts/workspaces.test.ts` espera nueve paquetes.
- `scripts/version.ts` debe incluir el manifiesto móvil si se le da versión propia.

---

## 9. Riesgos y decisiones abiertas

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| El refactor de puertos rompe escritorio | Media | Alto | F1 por pasos, listón verde, e2e; no mezclar con F2 |
| SQLite síncrono → asíncrono | Alta | Alto | Puerto `SqlDatabase`; adaptador nativo con transacciones; pruebas de migración |
| Puente JS↔Rust por segmento HLS | Media | Alto | Medir pronto; si falla, proxy local de medios |
| hls.js en TV box | Media | Alto | Medir; adaptador ExoPlayer en F4 si no llega |
| iOS MSE/PiP/fullscreen | Alta | Alto | HLS nativo o MSM; dispositivo real; no declarar sin medir |
| Plugins de usuario | **Cierto** | Alto | Incluidos en build o modo remoto; nunca runtime |
| Tienda/legal | Alta | Alto | APK/PWA; revisión legal antes de tienda |
| Dos bases / sincronización | Media | Alto | Fuente única; local es caché en remoto; sin sync bidireccional v1 |
| CI Android/iOS | Media | Medio | Jobs, secretos, keystore, macOS; declarar lo no medido |
| CSP/Tauri (`worker-src`, `ipc:`) | Media | Medio | CSP por plataforma; probar hls.js y SQLite con worker |
| Rendimiento/batería | Desconocida | Medio | Presupuestos y medición en dispositivo real |
| Firewall/TLS en LAN (remoto) | Media | Medio | QR, documentación, `RONA_PUBLIC_ORIGIN`, TLS de confianza |

**Decisiones que no puede tomar el código:**

1. ¿App autocontenida o cliente del PC?
2. ¿Proveedores incluidos o plugins de usuario?
3. ¿Tienda o APK/PWA?
4. ¿Descargas offline en F2 o F3?
5. ¿Segundo plano/PiP son requisito?
6. ¿Android TV es un APK aparte o el mismo con Leanback?
7. ¿Qué Android/iOS mínimos? (Tauri: Android 7/API 24, iOS 15 por defecto.)
8. ¿Quién firma y mantiene los certificados?

---

## 10. Lo que no se hace

- Reescribir el servidor en Rust o Kotlin.
- Duplicar la UI por plataforma o meter `isMobile`/`isTV` en los componentes.
- Copiar `packages/core` a `mobile/`.
- Ejecutar plugins descargados en el móvil con `eval`/`new Function`/`import()` remoto.
- Meter la UI móvil como recursos de Tauri y llamar a un servidor remoto sin resolver cookie,
  `Origin` y CSP (eso es un cambio de modelo de amenaza, no un detalle).
- Prometer tienda, descargas offline o paridad total antes de medirlas.
- Tocar `packages/` para meter el proyecto Android dentro del workspace.

---

## 11. Cierre de cada fase

Cada fase termina con este informe, en `tasks/done/` o en el plan de la fase:

1. **Criterios de aceptación cumplidos**, cada uno con la medición que lo sostiene.
2. **Probado en dispositivo real o emulador**: modelo, versión de Android/iOS, build, red.
3. **Lo que quedó pendiente**, con motivo y fase en la que entra.
4. **Listón de escritorio**: typecheck, lint, test, e2e y CI, con el resultado.
5. **Presupuestos**: medida o desviación declarada.
6. **Commit atómico** con las rutas de la fase.
