# Sincronización entre dispositivos: análisis y plan por fases

**Estado:** Fase 0 entregada el 2026-11-27 sobre `0.11.4`. Este documento **no cambia código**:
fija el inventario, el modelo, la migración, la investigación de plataforma y las fases. Las
estimaciones son estimaciones; lo que se ha leído del árbol va con su ruta. No hay ninguna medida
en dispositivo real de sincronización todavía.

**Punto de partida.** RoNa ya tiene una base SQLite local, una API Hono y una UI que corre igual en
escritorio y en el WebView de Android (`T412`, en un worktree al escribir esto: no está integrado en
`main`). La app móvil es autocontenida: Hono y SQLite/WASM viven dentro del WebView, y la red nativa
pasa por `tauri-plugin-http`. La sincronización que sigue no puede convertirse en un servidor
central, ni en una cuenta, ni en telemetría.

---

## 1. Resumen ejecutivo

**Recomendación:** sincronización local-first con **LWW por registro y reloj híbrido (HLC)**, una
tabla de registros pequeños (`sync_item`) con tombstones, una proyección de progreso
(`watch_progress`) y un **listener de sincronización separado** del servidor de la app. El
escritorio hace de anfitrión en la v1; móvil y TV son clientes. El emparejamiento se hace con QR o
código corto y claves por dispositivo. La sincronización se dispara al abrir y mientras la app está
en primer plano.

**Lo que ya existe y sirve:**

- `watch_event` guarda posición, duración, `finished` y `started_at` por reproducción.
- `favorite`, `watched_title` y `plan_to_watch` son las tres listas del usuario.
- `setting` guarda el tema, la prioridad de proveedores, el filtro de adultos y Discord.
- El runner de migraciones ya hace copia con `VACUUM INTO`, rota cinco copias y restaura si una
  migración falla (`packages/catalog-store/src/migrations/`).
- Existe una exportación/importación de perfil que ya copia las tres listas
  (`packages/server/src/routes/profile.ts`), pero **no** copia progreso ni ajustes.

**Los tres huecos que hay que cerrar:**

1. **Identidad.** `watch_event`, `favorite`, `watched_title` y `plan_to_watch` apuntan a
   `anime.id`/`episode.id`, que son identificadores **locales**. No hay una clave de contenido
   estable entre instalaciones. La identidad de proveedor (`provider_id`, `provider_ref`) sirve
   mientras los dos dispositivos usen el mismo proveedor y la misma referencia; no sirve si una
   versión del proveedor cambia el slug. `anilist_media` existe, pero está indexada por
   `title_key` y **no está enlazada** con `anime`.
2. **Metadatos de sincronización.** No hay `updated_at`, `device_id`, `deleted` ni un contador
   incremental. `watch_event` guarda una fila por reproducción, no una por episodio.
3. **Transporte.** El servidor escucha en `127.0.0.1` y la autenticación es una cookie de sesión;
   no hay un canal para dispositivos emparejados. La app móvil tiene `targetSdk 37`, así que
   Android 17 le exige `ACCESS_LOCAL_NETWORK` para mDNS y para hablar con la LAN.

**Coste del cambio de datos:** una migración **aditiva** (`0024-sync.sql`) con backfill y sin borrar
nada. No hay que reescribir las tablas del usuario; se añaden `sync_item`, `sync_state`,
`sync_peer` y `watch_progress`, y las lecturas de progreso pasan a la proyección nueva. La copia
previa ya la hace el runner. Es **2–3 semanas** de una persona, con tests de migración desde cada
versión anterior y pruebas del motor de fusión.

**Coste total estimado:** **14–21 semanas-persona** para las cinco fases; **11–16** si el control
remoto de la TV se separa a otra entrega. Es adicional al plan móvil (`docs/plan-movil-tv.md`), no
lo sustituye. La fase 1 debe empezar **después de integrar T412**: ese worktree está tocando
`catalog-store`, `core`, `server` y las migraciones, y empezar antes garantiza conflictos.

---

## 2. Inventario: qué datos existen hoy

### 2.1 Base de datos

| Tabla | Qué guarda | ¿Es del usuario? | ¿Sincronizar? |
|---|---|---|---|
| `watch_event` | Una fila por reproducción: `anime_id`, `episode_id`, `provider_id`, `mode`, `position_s`, `duration_s`, `started_at`, `finished` | Sí, pero **histórico** | **Sí, sólo el último progreso por episodio** (proyección nueva). El histórico completo no. |
| `favorite` | `anime_id` + `created_at` | Sí | **Sí**, con tombstone. |
| `watched_title` | `anime_id` + `created_at` | Sí | **Sí**, con tombstone. |
| `plan_to_watch` | `anime_id` + `created_at` | Sí | **Sí**, con tombstone. |
| `setting` | JSON por clave: `theme`, `providerPriority`, `adultContent`, `discordPresence` | Sí / de instalación | **Sí, sólo una lista blanca.** Ver §3. |
| `taste_profile` | Perfil de la encuesta de gustos (`profile_json`, `updated_at`) | Sí, sensible | **No por defecto.** Opt-in posterior. |
| `search_history` | Consulta, proveedor, aciertos, fecha | Sí, sensible | **No.** Es privacidad y no es necesario para «seguir viendo». |
| `download` | Cola: `path`, `bytes`, `status`, `error`, `provider_ref` | De la instalación | **No.** Rutas y archivos son de cada dispositivo. |
| `download_subtitle` | Pistas de una descarga, con su ruta | De la instalación | **No.** |
| `anime`, `episode`, `genre` | Caché del catálogo y metadatos | No (caché) | **No.** Sólo se crean fichas mínimas para poder pintar lo que llega de otro dispositivo. |
| `stream_cache` | URL de stream, calidad, subtítulos | No (caché, puede tener URLs firmadas) | **No.** |
| `search_cache`, `trending_cache`, `feed_cache`, `episode_page` | Cachés de listados y páginas | No | **No.** |
| `anilist_media`, `anilist_list_cache`, `anilist_image` | Caché de AniList | No | **No.** |
| `aniskip_cache` | Intervalos de intro/ending | No | **No.** |
| `known_cover`, `known_title` | Direcciones y resúmenes de títulos vistos | No (caché) | **No.** |
| `adult_ref` | Marca local de contenido adulto | Derivada | **No.** |
| `revalidate_error` | Errores de revalidación | No | **No.** |
| `schema_version` | Versión del esquema | No | **No.** |

**Lectura del esquema real:** `0001-initial.sql` crea `watch_event`, `favorite` y `setting`;
`0011-visto.sql` y `0012-quiero-ver.sql` crean las otras dos listas; `0013-temporadas.sql` añade
`episode.season`; `0014-descargas.sql` crea `download`; `0023-gustos.sql` crea `taste_profile`.
No hay ninguna columna de sincronización.

### 2.2 Ajustes que no están en SQLite

La UI guarda en `localStorage` del WebView (`packages/web/src/features/player/storage.ts`):

| Clave | Qué es | ¿Sincronizar? |
|---|---|---|
| `rona:autoplay` | Reproducir el siguiente episodio | **Sí**, es una preferencia general. |
| `rona:skipAuto` | Saltar intro/ending automáticamente | **Sí**. |
| `rona:skipMargin` | Margen del salto | **Sí**. |
| `rona:velocidad` | Velocidad de reproducción | **Sí**. |
| `rona:calidad` | Calidad preferida | **Sí**, con matices: una TV y un teléfono pueden querer calidades distintas. |
| `rona:aniskip` | Consultar AniSkip | **Sí**. |
| `rona:avisosQuieroVer` | Avisos de «Quiero ver» | **Sí**. |
| `rona:extendido` | Modo extendido | **No**: es del tamaño de la ventana/dispositivo. |
| `rona:tema` | Tema de arranque | Ya está en `setting`; el `localStorage` es sólo arranque rápido. |
| `rona:progreso:*` | Copia local de la posición | **No**: la fuente de verdad es `watch_progress`; es una caché de comodidad. |
| `rona:cast` | Última sesión de cast | **No**: es de la instalación. |
| `rona:taste:opened` | Si se abrió la encuesta | **No**. |

**Consecuencia:** «ajustes generales» no es sólo `setting`. Para sincronizar de verdad las
preferencias del reproductor hay que moverlas a un registro de ajustes (o escribir un espejo en
`sync_item` y aplicarlas de vuelta a `localStorage`). La recomendación es un **espejo**, no quitar
`localStorage`: la UI las lee de forma síncrona en el render y convertirlas a asíncronas toca el
reproductor entero.

### 2.3 Configuración y secretos

| Dato | Dónde | ¿Sincronizar? |
|---|---|---|
| Cookie de sesión / token de arranque | Memoria del servidor y cookie `HttpOnly` | **No, nunca.** |
| `config.json` (`port`, `open`, `providers`, `lang`, `verbose`) | `configDir` | **No.** Es de la instalación. |
| Plugins de proveedor y su selección | `configDir/providers`, `setting` | **No.** Código y credenciales de terceros. |
| Clave de TMDB u otras claves de proveedor | Configuración/entorno | **No, nunca.** |
| Rutas de datos, caché, descargas, `mpv` | `config.json` y `setting` | **No.** Cambian por dispositivo. |
| Copias de seguridad | `dataDir/backups` | **No.** |
| Perfil del WebView | `dataDir/webview` | **No.** |
| Registro | `dataDir/registro.log` | **No.** |

---

## 3. Qué se sincroniza y qué no

### 3.1 Sí

1. **Progreso por episodio o película.** Un registro por clave de contenido + episodio:
   `position_s`, `duration_s`, `finished`, `mode`, `started_at`, `updated_at`, `device_id`.
   Gana el HLC más reciente. Es lo que alimenta «continuar viendo» y «seguir en otro dispositivo».
2. **Biblioteca.** `favorite`, `watched_title` y `plan_to_watch`, con **tombstone** para que un
   borrado no reaparezca desde un dispositivo que estuvo offline.
3. **Ajustes generales.** `theme`, `providerPriority`, y las preferencias del reproductor
   (`autoplay`, `skipAuto`, `skipMargin`, `velocidad`, `calidad`, `aniskip`, `avisosQuieroVer`).
   La calidad puede ser por dispositivo; se sincroniza como preferencia y cada dispositivo puede
   ignorarla si la fuente no la ofrece.
4. **Metadatos mínimos para pintar.** Título, portada, año y tipo viajan con el registro de
   biblioteca/progreso para poder crear una ficha mínima si el catálogo local no la tiene. No es
   sincronizar el catálogo: es lo justo para que una tarjeta no desaparezca.

### 3.2 No

1. **Credenciales y secretos:** cookie, token, claves de proveedores, `config.json`, archivos de
   plugins.
2. **Rutas de archivos:** `download.path`, carpeta de descargas, `dataDir`, `cacheDir`, rutas de
   `mpv`.
3. **Descargas:** filas, archivos, subtítulos descargados, estados y bytes. Cada dispositivo tiene
   sus archivos; el progreso de reproducción sí viaja.
4. **Configuración de proveedores:** qué plugin está activo, su orden de carga, sus credenciales.
   La `providerPriority` es una preferencia de presentación y se puede sincronizar; el **contenido**
   del plugin no.
5. **`adultContent`:** es una preferencia sensible. Por defecto **no se sincroniza**; si algún día
   se ofrece, será un opt-in explícito y separado. Lo mismo para `taste_profile`.
6. **`discordPresence`:** es de la instalación de escritorio y no tiene sentido en móvil/TV.
7. **Historial de búsquedas y cachés:** privacidad y datos derivados.
8. **Historial completo de reproducciones:** sólo se sincroniza el último progreso por episodio.
   El histórico local se conserva, pero no se replica. Si el usuario quiere el historial completo
   en todos los dispositivos, es una decisión de producto aparte (y más volumen).
9. **Estado de UI y de dispositivos:** pestaña abierta, volumen, sesión de cast, modo extendido,
   posición de la ventana.

---

## 4. Modelo de datos propuesto

### 4.1 Claves estables

La identidad de una obra no puede ser `anime.id`: es un entero local que cambia en cada
instalación. La clave de la v1 es la identidad del proveedor, que ya está en la base:

```
content_key = "p:" + providerId + ":" + providerRef
episode_key = "s" + season + "e" + number        // si season existe
            = "e" + number                        // si no
            = "r:" + providerRef                 // si el número no es fiable
            = "movie"                             // película
progress_key = content_key + "#" + episode_key
```

`providerId` y `providerRef` se codifican con `encodeURIComponent` para que no puedan contener el
separador. La clave es estable entre dispositivos **mientras el proveedor y su referencia sean los
mismos**. Es el caso normal: los dispositivos usan el mismo paquete de proveedores incluido en el
build.

**Límite declarado:** si una versión del proveedor cambia el slug de una obra, la clave deja de
coincidir. La solución posterior es una tabla de alias:

```
content_alias(alias_key TEXT PRIMARY KEY, content_key TEXT NOT NULL)
```

con alias `anilist:<id>`, `mal:<id>` y `title:<clave normalizada>`. Cuando el enriquecimiento de
AniList conozca el id, se escribe el alias. Para la v1 no hace falta: añade complejidad y no es el
caso que se ha pedido. Se deja como F5 opcional, y se documenta que la biblioteca no se fusiona
entre proveedores distintos.

**Episodios:** el número y la temporada son la identidad lógica; `providerRef` es la identidad
física. Al aplicar un progreso remoto se busca primero por `(anime_id, season, number)`; si no
existe, se busca por `provider_ref`; si tampoco, se crea un episodio mínimo con la referencia
remota. Así un cambio de referencia no pierde el progreso si el número coincide.

### 4.2 Registro de sincronización

Una sola tabla, pequeña, por entidad y clave:

```sql
-- Borrador de esquema; la migración real se escribe en F1.
CREATE TABLE sync_item (
  entity        TEXT    NOT NULL,   -- progress | favorite | watched | plan_to_watch | setting
  item_key      TEXT    NOT NULL,
  value_json    TEXT    NOT NULL DEFAULT '{}',
  deleted       INTEGER NOT NULL DEFAULT 0,
  hlc           TEXT    NOT NULL,   -- orden total, ver §4.3
  origin_device TEXT    NOT NULL,
  origin_seq    INTEGER NOT NULL,
  local_seq     INTEGER NOT NULL,   -- cursor incremental de ESTE dispositivo
  updated_at    INTEGER NOT NULL,   -- ms para mostrar y ordenar
  PRIMARY KEY (entity, item_key)
);

CREATE INDEX sync_item_por_local_seq ON sync_item (local_seq);
```

- `entity` + `item_key` es la identidad lógica. Para progreso, `item_key` es `progress_key`; para
  biblioteca, `content_key`; para ajustes, la clave del ajuste.
- `value_json` lleva el payload pequeño: para progreso, posición, duración, modo, título, portada,
  referencias de anime/episodio y número/temporada; para biblioteca, título, portada, año y tipo;
  para ajustes, el JSON del valor.
- `deleted = 1` es el tombstone. No se borra la fila: se marca y se sigue enviando. Un borrado
  posterior con HLC mayor gana; un alta vieja con HLC menor no resucita.
- `origin_device` y `origin_seq` identifican al escritor original. `local_seq` es el cursor de
  este dispositivo y **no** se reutiliza el del origen: es lo que hace que la sincronización
  incremental funcione aunque un registro llegue desordenado o por un tercer dispositivo.
- `updated_at` es el reloj de pared para mostrar («sincronizado hace 2 min»); el orden lo decide
  `hlc`.

### 4.3 Reloj híbrido y desajustes

Cada dispositivo tiene un HLC con tres campos: pared, contador y dispositivo.

```
hlc = hex12(wall) + "-" + hex6(counter) + "-" + deviceId
```

- Al escribir en local: `wall = max(ahora, últimoWall)`. Si `wall` es el mismo que el último,
  `counter++`; si no, `counter = 0`. Se guarda.
- Al recibir: `wall = max(ahora, últimoWall, min(wallRemoto, ahora + MAX_SKEW))`. El `min` acota a
  **5 minutos** el daño de un reloj adelantado. Si el remoto viene del futuro, se acepta su dato
  pero no se permite que su reloj arrastre el de todos para siempre.
- Orden: `wall`, luego `counter`, luego `deviceId`. El `deviceId` desempata de forma determinista:
  dos dispositivos no pueden producir el mismo HLC.
- Si un dispositivo tiene el reloj atrasado, su HLC no gana a uno más nuevo; si lo tiene
  adelantado, se acota y se registra una advertencia (`clock_skew`) para que Ajustes pueda decir
  «el reloj de este dispositivo va adelantado» sin bloquear la sincronización.
- **Empates:** no hay empates reales entre dispositivos porque el `deviceId` forma parte del HLC.
  Dentro del mismo dispositivo, el contador evita el empate en el mismo milisegundo.
- **Progreso:** gana el HLC más reciente para la **posición**. `finished` es pegajoso: una vez que
  un episodio se dio por terminado, un rebobinado posterior no lo vuelve a marcar como pendiente;
  sólo un borrado explícito del historial lo quita. Es la misma regla que ya usa la ficha, que
  ordena por proporción vista y no por la última fila. Si el usuario quiere conservar el progreso de
  este dispositivo, al reproducir se escribe un HLC nuevo y gana; la UI le ofrece elegir cuando los
  dos existen.

### 4.4 Idempotencia y reconexión

- Aplicar un registro es una operación idempotente: si su HLC es menor o igual al guardado, se
  ignora; si es mayor, se reemplaza. No hay `INSERT` ciego.
- Cada dispositivo guarda por peer `last_pull_seq` y `last_push_seq`, que son **sus** contadores
  `local_seq`, no HLC. Un pull pide `local_seq > last_pull_seq`, ordenado y paginado; un push envía
  `local_seq > last_push_seq`. El cursor sólo avanza cuando el lote se ha aplicado/confirmado.
- Si el proceso muere después de aplicar y antes de confirmar, se reenvía el lote: idempotente.
- Si un peer se reinstala, cambia su `epoch` (UUID de la base); el cliente detecta el cambio y
  reinicia los cursores con un pull completo. `device_id` puede sobrevivir a una reinstalación;
  `epoch` no.
- Multihop: A → B → C funciona porque B asigna su propio `local_seq` al aplicar lo de A y se lo
  ofrece a C. El HLC de A se conserva; no se reescribe al reenviar.
- Tombstones: se conservan indefinidamente en la v1 (una fila por elemento borrado). Es barato y
  evita resurrecciones. Se puede podar en el futuro sólo cuando todos los peers hayan pasado el
  cursor; no se hace ahora.

### 4.5 Progreso: proyección y lectura

`watch_event` sigue siendo el registro local de reproducciones (histórico y depuración). La
proyección que leen la home, el historial y la ficha es nueva:

```sql
CREATE TABLE watch_progress (
  episode_id   INTEGER PRIMARY KEY REFERENCES episode (id) ON DELETE CASCADE,
  content_key  TEXT    NOT NULL,
  episode_key  TEXT    NOT NULL,
  mode         TEXT    NOT NULL,
  position_s   REAL    NOT NULL DEFAULT 0,
  duration_s   REAL    NOT NULL DEFAULT 0,
  finished     INTEGER NOT NULL DEFAULT 0,
  started_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  device_id    TEXT    NOT NULL,
  UNIQUE (content_key, episode_key)
);

CREATE INDEX watch_progress_por_fecha ON watch_progress (updated_at DESC);
```

- `recordWatch` y `updateWatchPosition` escriben en `watch_event` y hacen upsert en
  `watch_progress` en la misma transacción.
- `listRecentlyWatched`, `listWatchHistory` y `listWatchedEpisodes` leen de `watch_progress`.
  El historial ya mostraba un episodio por renglón; la consulta se simplifica.
- `deleteEpisodeWatches` borra de las dos tablas y escribe un tombstone de progreso en
  `sync_item`, para que quitar una tarjeta del historial no reaparezca desde otro dispositivo.
- El backfill toma la fila más reciente de `watch_event` por episodio para la posición, y calcula
  `finished` como `OR` de todas las filas del episodio: una marca de terminado no se pierde porque
  la última reproducción empezara por el principio.
- `started_at` conserva la fecha original; `updated_at` ordena «continuar viendo» y permite que
  reanudar un episodio viejo lo suba arriba.

### 4.6 Estado, pares y emparejamiento

```sql
CREATE TABLE sync_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  device_id     TEXT    NOT NULL,
  epoch         TEXT    NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  hlc_wall      INTEGER NOT NULL DEFAULT 0,
  hlc_counter   INTEGER NOT NULL DEFAULT 0,
  local_seq     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sync_peer (
  device_id      TEXT PRIMARY KEY,
  name           TEXT    NOT NULL,
  platform       TEXT    NOT NULL,   -- desktop | mobile | tv
  fingerprint    TEXT    NOT NULL,
  identity_key   TEXT    NOT NULL,   -- clave pública de firma
  dh_key         TEXT    NOT NULL,   -- clave pública de intercambio
  peer_epoch     TEXT    NOT NULL,
  paired_at      INTEGER NOT NULL,
  last_seen_at   INTEGER,
  last_pull_seq  INTEGER NOT NULL DEFAULT 0,
  last_push_seq  INTEGER NOT NULL DEFAULT 0,
  revoked        INTEGER NOT NULL DEFAULT 0
);
```

`sync_state` se crea una vez. `device_id` y `epoch` se generan en la migración con
`randomblob`/el arranque; no se derivan del hardware ni del usuario. `enabled` nace en `0`: la
sincronización está apagada hasta que el usuario la encienda.

### 4.7 Payloads

| Entidad | `item_key` | `value_json` |
|---|---|---|
| `progress` | `content_key#episode_key` | `{ providerId, animeRef, title, coverUrl?, year?, episodeRef, episodeNumber, season?, mode, positionS, durationS, finished, startedAt }` |
| `favorite` / `watched` / `plan_to_watch` | `content_key` | `{ providerId, ref, title, coverUrl?, year?, kind? }` |
| `setting` | `theme`, `providerPriority`, `playerPrefs`, … | El JSON validado del ajuste. |
| Tombstone | cualquiera | `{}` y `deleted = 1`. |

Los schemas viven en `packages/core` y se validan en la frontera del servidor y del cliente. Un
payload que no cumple se rechaza con un error de protocolo; no se escribe a medias.

### 4.8 Ajustes: lista blanca

`SYNCED_SETTINGS` en `core`:

- `theme`
- `providerPriority`
- `playerPrefs` (objeto con `autoplay`, `skipAuto`, `skipMargin`, `velocidad`, `calidad`,
  `aniskip`, `avisosQuieroVer`)

**Fuera:** `adultContent`, `discordPresence`, `taste_profile`, `search_history`, cualquier clave que
empiece por `download.` o `provider.`. Una lista blanca y no una lista negra: una clave nueva no se
sincroniza por accidente.

---

## 5. Migración y coste de convertir los datos

### 5.1 Qué hace la migración

Una sola migración aditiva, `0024-sync.sql`:

1. Crea `watch_progress`, `sync_item`, `sync_state` y `sync_peer`.
2. Crea los índices `sync_item_por_local_seq`, `watch_progress_por_fecha`.
3. Inserta la fila única de `sync_state` con `device_id` y `epoch` aleatorios y `enabled = 0`.
4. Rellena `watch_progress` con la reproducción más reciente de cada episodio.
5. Rellena `sync_item` con:
   - las tres listas (`favorite`, `watched_title`, `plan_to_watch`), con `created_at` como HLC;
   - el progreso de `watch_progress`;
   - los ajustes de la lista blanca (`theme`, `providerPriority`) si existen.
6. Asigna `local_seq = rowid` a las filas del backfill y deja `sync_state.local_seq` en el máximo.
7. No borra ni renombra ninguna tabla, columna ni fila existente.

**No se toca** `download`, `stream_cache`, `anilist_*`, `search_history`, `taste_profile` ni las
tablas de caché. Los datos de usuario que no se sincronizan siguen exactamente donde estaban.

### 5.2 Por qué no se pierde nada

- El runner ya hace `VACUUM INTO` antes de aplicar y restaura si falla
  (`packages/catalog-store/src/migrations/migrate.ts`).
- La migración es aditiva. Las tablas viejas siguen existiendo y las lecturas viejas podrían seguir
  funcionando si se apaga la función.
- El backfill de progreso usa la fila más reciente por episodio, que es la que la UI ya mostraba.
  Las reproducciones antiguas siguen en `watch_event`; no se borran.
- `upgrades.test.ts` migra desde **cada** versión anterior con datos de usuario. Hay que añadir el
  caso nuevo: una base con favoritos, vistos, quiero ver, progreso y ajustes, migrada a 24, con las
  mismas marcas y el mismo último progreso.
- `scripts/migraciones.ts` exige registrar la huella de la migración en
  `packages/catalog-store/migrations.lock.json`.
- La copia se conserva cinco versiones; el usuario puede volver a la versión anterior restaurando
  la copia. **Downgrade sin restaurar no se soporta**: el runner se niega a abrir una base más nueva
  que el binario, que es el comportamiento actual y correcto.

### 5.3 Coste

| Trabajo | Estimación |
|---|---|
| Migración `0024-sync.sql` + backfill + lock | 3–5 días |
| `watch_progress` y cambio de lecturas/escrituras en `catalog-store` | 4–6 días |
| Motor HLC + merge + cursores + schemas en `core` | 4–6 días |
| Tests de migración, fusión, idempotencia, relojes y reconexión | 5–7 días |
| **Total F1** | **2–3 semanas** |

El volumen es pequeño: una biblioteca de 10 000 episodios son 10 000 filas de progreso y unas pocas
miles de marcas. El backfill cabe en una transacción y no necesita un proceso de horas. Se medirá
con una base sintética de 50 000 registros; si tarda más de un segundo en un móvil, se pagina el
backfill o se hace en el primer arranque, no en la migración.

### 5.4 Cambios en el código existente

- `packages/core`: `sync.ts` (HLC, claves, schemas, merge), tests; exportar desde `index.ts`.
- `packages/catalog-store`: migración, `watch_progress`, `sync_item`/`sync_state`/`sync_peer`,
  escritura dual en `watch`, `favorites`, `watched-titles`, `plan-to-watch`, `settings`; `prune.ts`
  protege el progreso reciente y añade `watch_progress` a las tablas contadas.
- `packages/server`: rutas de sincronización, listener separado, estado y control; **no** se tocan
  las rutas existentes ni el servidor de la app.
- `packages/web`: Ajustes → Sincronización, dispositivos vinculados, indicador de estado, banner de
  «continuar en otro dispositivo», textos en `i18n/es.ts`.
- `mobile/`: cliente de sincronización, descubrimiento, permisos, ciclo de vida.
- `AGENTS.md` y `SECURITY.md`: arquitectura y reglas de seguridad (F5).

---

## 6. Plataforma y red local: lo que se puede y lo que no

### 6.1 Android (móvil y TV)

- **Permiso de red local.** La app móvil tiene `targetSdk 37`
  (`mobile/src-tauri/gen/android/app/build.gradle.kts`, worktree T412).
  Desde Android 17 (API 37) la red local está **bloqueada por defecto** para las apps que apuntan a
  37 o más. Hay que declarar `android.permission.ACCESS_LOCAL_NETWORK` en el manifiesto y pedirlo en
  tiempo de ejecución antes de descubrir o conectar. Sin él, mDNS, `NsdManager` y los sockets a la
  LAN fallan (TCP suele dar timeout; UDP, `EPERM`). El permiso está en el grupo `NEARBY_DEVICES`.
- **Alternativa sin permiso amplio:** `NsdManager` con `DiscoveryRequest.FLAG_SHOW_PICKER` deja que
  el sistema muestre un selector y concede acceso sólo al servicio elegido. Es útil para un
  emparejamiento guiado, pero no para descubrimiento continuo; la v1 pide el permiso amplio y
  ofrece el selector como respaldo si el usuario lo deniega.
- **mDNS y multicast.** `NsdManager` es la vía correcta en Android; no hay que abrir sockets
  multicast propios. Antes de T Extensions 7 (Android 12 y parte de 13) hace falta
  `WifiManager.MulticastLock` con `CHANGE_WIFI_MULTICAST_STATE`; desde T Extensions 7 el sistema
  lo gestiona en primer plano. La app tiene que funcionar en API 26, así que el adaptador debe
  adquirir el lock cuando la extensión no llegue. En TV por Ethernet el lock de Wi-Fi no aplica;
  el descubrimiento puede fallar y se usa la IP guardada o la introducción manual.
- **HTTP en claro.** El manifiesto generado pone `usesCleartextTraffic=false` en release y `true`
  en debug. La política de Android se aplica a la pila Java/WebView; el cliente Rust de
  `tauri-plugin-http` no pasa por ella, pero un `fetch` del WebView sí. La sincronización no debe
  depender de HTTP en claro: o TLS, o un sobre cifrado a nivel de mensaje (ver §7.4).
- **TV.** El mismo APK declara `LEANBACK_LAUNCHER` y `android.software.leanback` con
  `required=false`. No hay cámara: el emparejamiento de la TV es por código numérico y D-pad. El
  permiso de red local es el mismo. Algunos TV boxes y redes de hotel bloquean multicast; la IP
  guardada y la introducción manual son obligatorias, no un extra.

### 6.2 iOS

- **Permiso de red local.** iOS 14+ pide permiso para interactuar con la red local. Hay que declarar
  `NSLocalNetworkUsageDescription` y, si se descubre por Bonjour, `NSBonjourServices` con el tipo
  `_rona-sync._tcp` (y `_rona-control._tcp` si se usa). El prompt aparece la primera vez que se
  usa `NWBrowser`/Bonjour o se conecta a una IP local. Si el usuario lo deniega, no hay
  descubrimiento ni conexión; la app debe explicarlo y ofrecer Ajustes del sistema.
- **Bonjour y multicast.** `NWBrowser`/`NWListener` son la vía correcta y no exigen el entitlement
  de multicast. Un socket multicast propio o `mdns-sd` en Rust sí puede exigir
  `com.apple.developer.networking.multicast`, que hay que solicitar a Apple. Por eso el adaptador
  iOS debe usar Network.framework, no el crate de escritorio.
- **ATS.** Si se usa HTTP a una IP local, hace falta `NSAllowsLocalNetworking` en
  `NSAppTransportSecurity`; si se usa TLS, no. Aun con TLS, el permiso de red local sigue siendo
  necesario. `NSAllowsArbitraryLoads` no se pone.
- **Segundo plano.** iOS suspende el WebView al pasar a segundo plano. La sincronización se hace al
  abrir y mientras está en primer plano; no se promete un demonio. El PiP/audio en segundo plano es
  otra función (F3 del plan móvil) y no cambia el modelo de sync.
- **Tauri.** Las claves de `Info.plist` se añaden en `src-tauri/Info.ios.plist`, que Tauri fusiona
  con el generado. El proyecto iOS aún no existe en el árbol; se creará en la fase iOS del plan
  móvil y la sincronización se probará entonces.

### 6.3 Escritorio y Tauri v2

- **Tauri v2 móvil** es estable en Android/iOS; no ejecuta sidecars en móvil; el updater es sólo de
  escritorio. Ya se usa `tauri-plugin-http` para la red nativa; su alcance actual permite
  `http://**` y `https://**`, y la superficie de IPC está cerrada a `core:default` + HTTP.
- **No hay plugin oficial de mDNS.** Hay plugins de la comunidad (`dns-sd-tauri`, `tauri-plugin-dns-sd`)
  que delegan en `NsdManager`/`NWBrowser`, pero añaden dependencia y hay que auditarlos. La
  alternativa es un puente propio: `NsdManager` en Kotlin para Android/TV y `NWBrowser` en Swift
  para iOS, expuesto por comandos Tauri. Es más código (unas 500–800 líneas) pero no mete una
  dependencia nueva en el camino de seguridad.
- **El servidor de la app no cambia.** Sigue escuchando en `127.0.0.1` y sirviendo la UI y la API
  con cookie. La sincronización usa un **listener aparte** en la LAN, con su propio puerto, su
  propio guard y sin estáticos, cookies ni CORS. Así el modo LAN no abre la interfaz ni la API
  normal.
- **mDNS en escritorio.** El sidecar Bun puede anunciar `_rona-sync._tcp.local` con una librería
  DNS-SD (por ejemplo `bonjour-service`) o el anfitrión Tauri puede hacerlo con `mdns-sd`. La
  decisión de F2 es medir cuál encaja mejor; el anuncio debe incluir versión, `device_id`,
  huella de la clave y `pairing=1` sólo mientras la ventana de emparejamiento está abierta.

### 6.4 Resumen de plataforma

| Necesidad | Escritorio | Android | Android TV | iOS |
|---|---|---|---|---|
| Descubrir mDNS | `bonjour-service`/`mdns-sd` | `NsdManager` + `ACCESS_LOCAL_NETWORK` | `NsdManager`; multicast puede fallar | `NWBrowser` + `NSBonjourServices` |
| Permiso de red local | No aplica | Runtime, API 37+ | Runtime, API 37+ | Prompt de iOS 14+ |
| Multicast | Sí | `MulticastLock` antes de T Ext 7 | Igual, y por Ethernet no aplica | `NWBrowser` no necesita entitlement |
| Escuchar en LAN | `Bun.serve` en listener aparte | Posible en primer plano; no en la v1 | Posible en primer plano; necesario para mando | Posible; no en la v1 |
| HTTP en claro | Permitido | Bloqueado en release para la pila Java/WebView | Igual | ATS lo bloquea salvo `NSAllowsLocalNetworking` |
| TLS con pin | Bun + rustls | Rust + rustls (comando propio) | Igual | Rust + rustls o URLSession con delegate |
| Tauri v2 | Host actual | Estable, sin sidecar | Mismo APK Leanback | Estable, requiere Mac/Xcode |

---

## 7. Transporte, emparejamiento y seguridad

### 7.1 Topología de la v1

```
PC (escritorio)                         Teléfono / TV
┌─────────────────────────┐            ┌─────────────────────────┐
│ App Hono en 127.0.0.1   │            │ Hono en proceso          │
│ Cookie, UI, API normal  │            │ SQLite local             │
│                         │            │                          │
│ Sync listener 0.0.0.0   │◀── LAN ───▶│ Cliente de sync          │
│ :PUERTO_SYNC            │  TLS/AEAD  │ Descubrimiento + estado  │
│ Sólo /sync/v1/*         │            │                          │
└─────────────────────────┘            └─────────────────────────┘
```

- **El escritorio es el anfitrión en la v1.** Es el dispositivo que suele estar encendido y el que
  ya tiene el servidor. Móvil y TV son clientes. Esto no impide que en F4 la TV escuche para el
  mando remoto, ni que en una fase posterior cualquier dispositivo pueda hacer de anfitrión.
- El listener de sync **no sirve la UI**, no acepta cookies, no tiene CORS y no comparte el guard
  de `Host`/`Origin` de la app. Sólo acepta peticiones autenticadas por dispositivo. Si la función
  está apagada, el puerto no existe y mDNS no anuncia nada.
- El puerto es configurable y por defecto efímero o fijo alto; se publica por mDNS y QR. No se abre
  en el firewall automáticamente; la UI dice cómo hacerlo y ofrece la IP.

### 7.2 API de sincronización

| Ruta | Qué hace |
|---|---|
| `GET /sync/v1/hello` | Autenticada. Devuelve `protocol`, `deviceId`, `epoch`, `serverHlc`, `features`. |
| `POST /sync/v1/pair/start` | Sólo con una ventana de emparejamiento abierta. Recibe el token/código, la clave pública y el nombre del dispositivo. |
| `POST /sync/v1/pair/confirm` | Confirma el SAS/huella y devuelve el peer creado. |
| `POST /sync/v1/pull` | `{ sinceSeq, limit }` → registros con `local_seq > sinceSeq`, `nextSeq`, `more`. |
| `POST /sync/v1/push` | `{ records }` → `{ applied, rejected, serverHlc }`. |
| `POST /sync/v1/ack` | Opcional: confirma el cursor de push. |
| `GET /sync/v1/status` | Autenticada. Última sync, peers, estado. |
| `POST /sync/v1/revoke` | Autenticada. Revoca un peer. |

Un intercambio completo puede ser **pull + push en una sola petición** para ahorrar idas y vueltas:
`POST /sync/v1/exchange` con `{ sinceSeq, records }`. La v1 puede empezar con las dos rutas
separadas y unirlas después; el contrato de registro es el mismo.

- Límite de cuerpo: 256 KiB por lote (el mismo del servidor actual) o 1 MiB para sync; se pagina.
- Límite de registros por lote: 500.
- Tiempo máximo: 15 s; el cliente reintenta con backoff.
- Nada de `GET` con datos sensibles en la URL; todo lo que lleva datos va en `POST`.
- Errores: `401` sin autenticar, `403` peer revocado, `409` epoch/ventana de emparejamiento,
  `413` lote demasiado grande, `429` rate limit, `400` payload inválido.

### 7.3 Emparejamiento

**Escritorio → móvil (QR):**

1. El usuario pulsa «Emparejar dispositivo» en el PC. Se abre una ventana de 120 s.
2. El PC genera un par de claves efímeras y un secreto de un solo uso; muestra un QR con
   `rona://pair?v=1&host=<ip>&port=<puerto>&code=<6>&fp=<huella>&pk=<clave>` y el código de 6
   dígitos.
3. El móvil escanea el QR (cámara) o escribe el código. Envía su clave pública, su nombre y su
   plataforma, firmado con el secreto.
4. El PC muestra «<nombre> quiere emparejarse» con la huella; el usuario confirma. El móvil muestra
   el mismo SAS; si no coincide, se cancela.
5. Se guardan las claves públicas y el peer en ambos lados. El secreto se borra.

**Escritorio → TV (código corto):**

1. El PC muestra un código de 6 dígitos, grande y agrupado (123 456), y la huella.
2. La TV descubre el PC por mDNS (o usa la IP guardada) y muestra un teclado numérico navegable con
   D-pad. Introduce el código.
3. El PC muestra el nombre y la huella de la TV; el usuario confirma con el ratón/teclado. La TV
   muestra el SAS y el usuario confirma con el mando.
4. El código caduca en 120 s, se limita a 5 intentos/min y sólo hay una sesión de emparejamiento a
   la vez. Un código fallido no revela si el dispositivo existe.

**Por qué el código de 6 dígitos no basta como secreto:** 10^6 es fuerza bruta offline. Por eso el
código es un localizador de sesión de corta vida y la autenticación real es la **confirmación
física en el PC + SAS** derivado del intercambio de claves. Un atacante en la LAN puede intentar
adivinar el código, pero no puede hacer que el SAS coincida en los dos dispositivos sin romper el
intercambio. El QR, además, autentica la clave del PC si el usuario escanea el que muestra el PC.

**Posterior:** no se vuelve a emparejar. Cada peer guarda la clave pública del otro y firma sus
peticiones. El `device_id` no es un secreto; la clave sí.

### 7.4 Cifrado: TLS con pin o sobre a nivel de mensaje

| Criterio | TLS 1.3 con certificado autofirmado y pin | Sobre AEAD a nivel de mensaje |
|---|---|---|
| Criptografía | Estándar, auditada, TLS 1.3 | Composición propia con primitivas auditadas |
| Confidencialidad | Toda la conexión, incluidas cabeceras | Sólo el cuerpo; metadatos visibles |
| Integridad | TLS | AEAD + firma |
| Secreto hacia adelante | Sí, por sesión | Sí, si se hace DH efímero por sesión |
| Plataformas | Bun TLS + rustls en Android/iOS; pin propio en cada cliente | Una implementación TS en `core`, corre en Bun y WebView |
| Certificados | Generar, rotar, SAN de IP/nombre, pin SPKI | No hay certificados |
| Integración Tauri | `tauri-plugin-http` no expone verificador propio; hace falta comando Rust | Reutiliza el HTTP actual; el cuerpo va cifrado |
| Fallos típicos | ATS, trust store, IP cambiada, cert caducado | Nonce repetido, replay, reloj, clave mal guardada |
| Esfuerzo | Medio-alto (dos clientes, generación de cert) | Medio (protocolo + tests) |

**Recomendación:** **sobre AEAD a nivel de mensaje** en `core`, con TLS como endurecimiento
opcional del listener (no como requisito de corrección). Razones:

- La app ya tiene un transporte HTTP nativo que funciona en Android/iOS/TV; cifrar el cuerpo evita
  pelear con ATS, trust stores, certificados autofirmados y pines en dos runtimes.
- Una sola implementación en TypeScript se prueba en `bun test` con vectores y se usa en Bun y en
  el WebView.
- El listener es LAN-only, sólo pares y sin UI; el riesgo de un protocolo propio se acota con
  primitivas estándar, spec formal y revisión.

**Construcción concreta del sobre:**

- Identidad de dispositivo: par **ECDSA P-256** de firma; par **ECDH P-256** de intercambio.
- Emparejamiento: intercambio de claves públicas + confirmación SAS; se guarda la clave pública del
  peer.
- Sesión: el cliente genera un par ECDH efímero por sesión; el servidor responde con otro. La clave
  se deriva con
  `HKDF-SHA256(ECDH(efímera_cliente, estática_servidor) || ECDH(estática_cliente, efímera_servidor))`,
  con `info` que incluye `device_id` y `epoch`. El servidor firma el transcript con su clave
  ECDSA y el cliente firma el suyo; cada lado verifica la clave estática del peer. Así hay secreto
  hacia adelante y autenticación mutua.
- Mensaje: `AES-256-GCM` (WebCrypto) o `XChaCha20-Poly1305` con `@noble/ciphers`; nonce de 96/192
  bits, contador por sesión, `aad` con `v`, `deviceId`, `epoch`, `seq`. Se rechaza un nonce
  repetido y un `seq` fuera de ventana.
- Firma: ECDSA P-256 sobre `header || ciphertext`; el servidor verifica la clave del peer.
- Replay: caché de nonces por sesión + ventana de 5 min; un mensaje viejo se rechaza.
- Claves privadas: Android Keystore / iOS Keychain en móvil; en escritorio, archivo con permisos
  de usuario (0600 / ACL) o DPAPI, declarado como riesgo residual. No se mete en la base ni en un
  log.
- Dependencias: `@noble/curves` y `@noble/ciphers` (auditadas, pure TS) o WebCrypto. Si se usa
  WebCrypto, P-256/ECDH/AES-GCM/HKDF están en todas las plataformas; ECDSA P-256 también. Se evita
  una dependencia nueva, a costa de más código de conversión. La decisión se toma en F2 con una
  prueba de interoperabilidad Bun ↔ WebView.

**Alternativa si el sobre se atasca:** TLS 1.3 con certificado autofirmado y pin SPKI. No se
implementan las dos cosas a la vez: se elige una y se documenta el riesgo residual.

### 7.5 Reglas de seguridad

- La sincronización nace **apagada**. Sin el toggle, no hay listener, ni mDNS, ni puerto.
- El listener sólo acepta peers emparejados y no revocados. La única ruta que no exige una firma de
  peer es `/pair/start`, y sólo existe mientras la ventana de emparejamiento está abierta, con
  código de un solo uso y rate limit. `/hello` y el resto van dentro del sobre autenticado.
- No se sirve la UI, ni la API normal, ni estáticos por el listener de sync.
- No se aceptan cookies, `Origin` de navegador ni CORS. Un navegador de la LAN no puede hablar con
  el listener.
- Rate limit por IP y por peer; límite de cuerpo; tiempo máximo; cierre de conexiones lentas.
- Un peer revocado recibe `403`; se borran sus claves y su cursor. El dispositivo revocado conserva
  sus datos locales (no se puede borrar a distancia), pero no recibe nada nuevo.
- Los logs no escriben títulos, posiciones, claves ni tokens. Como mucho, contadores y `device_id`
  truncado.
- mDNS anuncia sólo `device_id`, versión, puerto y huella; nada de biblioteca ni de usuario. El
  nombre del dispositivo lo elige el usuario y se puede dejar genérico.
- Sin telemetría, sin servicios de terceros, sin NTP propio. El HLC tolera relojes mal puestos.
- El modo VPN (Tailscale) es opcional y documentado: no se implementa servidor propio, no se abre
  un puerto a Internet y no se promete que Android/iOS traten la interfaz VPN como «red local» sin
  probarlo.

### 7.6 Riesgo residual

| Riesgo | Estado |
|---|---|
| Un peer emparejado puede leer todo lo sincronizado | Aceptado: es un dispositivo del usuario. Se revoca y se documenta. |
| La LAN ve `device_id`, tamaños y momentos de sync | Aceptado y declarado. El contenido va cifrado. |
| Un reloj muy adelantado puede ganar un conflicto | Acotado a 5 min; se avisa y se puede reescribir al reproducir. |
| El archivo de clave del escritorio puede ser leído por otro proceso del usuario | Aceptado en v1; 0600/ACL y DPAPI si se puede. Móvil usa Keystore/Keychain. |
| mDNS puede estar bloqueado o ser falsificado | El emparejamiento exige confirmación física/SAS; IP guardada y manual como respaldo. |
| DoS en la LAN contra el listener | Rate limit, cuerpo pequeño, tiempo máximo; no afecta a la app local. |
| Tailscale/VPN no medido | Documentado como «opcional, no soportado» hasta medirlo. |

---

## 8. Experiencia de usuario

### 8.1 Ajustes → Sincronización

- Un solo interruptor: **Sincronizar entre mis dispositivos**. Apagado por defecto.
- Estado: «Sincronizado hace 2 min», «Buscando dispositivos», «Sin conexión», «Sincronización
  apagada». Un icono discreto en la cabecera o en el pie, sin bloquear.
- Botón **Sincronizar ahora**.
- **Dispositivos vinculados:** nombre, plataforma, última vez, huella corta y botón **Desvincular**.
  «Desvincular todos» pide confirmación y explica que el dispositivo conserva sus datos locales.
- **Emparejar dispositivo:** abre el modal con QR y código; en TV, teclado numérico y D-pad.

### 8.2 Continuar en otro dispositivo

Al abrir la app, después de sincronizar:

- Si otro peer tiene un progreso más reciente para algo que esta instalación también conoce, se
  muestra una banda discreta: «En la TV vas por 12:34 de <título>. ¿Seguir desde ahí?» con
  **Seguir** y **Ahora no**.
- **Seguir** abre el reproductor en esa posición sin escribir nada hasta que empiece la
  reproducción; entonces se escribe un HLC nuevo y gana.
- **Ahora no** descarta el aviso para esa sesión; no borra el progreso remoto.
- Si el progreso remoto es de una obra que esta instalación no tiene, se crea la ficha mínima con
  título y portada y se ofrece abrirla; si el proveedor no está, se dice.
- No se muestran avisos de progreso de la misma instalación ni de peers revocados.

### 8.3 Mando remoto del móvil a la TV (F4)

- La TV anuncia `_rona-control._tcp` mientras está en primer plano o reproduciendo.
- El móvil abre **Control remoto**, descubre la TV emparejada y muestra: título, episodio, barra de
  progreso, play/pausa, ±10 s, volumen y mute.
- La TV muestra «Controlado por <dispositivo>» mientras hay una sesión.
- El estado viaja por SSE o por el mismo sobre; los comandos son POST autenticados. Sin peer, no
  hay listener de control.
- En TV, el volumen del sistema se controla con `AudioManager` (Android) o `AVAudioSession` (iOS);
  si no se puede, se controla el volumen del reproductor y se dice.
- El mando se adapta a la entrada: botones grandes en táctil, foco visible y D-pad en TV.

### 8.4 Ciclo de vida

- **Al abrir:** sync inmediata si está encendida y hay peers. En escritorio, el servidor puede
  hacerla al arrancar; en móvil/TV, al evento de reanudar.
- **En primer plano:** cada 5 min, con backoff si falla (5 s, 15 s, 1 min, 5 min). Se para al pasar
  a segundo plano.
- **Al cerrar/pausar:** se intenta un último push si hay cambios pendientes; si no hay tiempo, se
  quedan en `sync_item` para la próxima.
- **Sin red:** la app funciona con la base local; el estado dice «sin conexión» y no bloquea nada.
- **Un solo toggle:** apagarlo para el listener y el anuncio, pero no borra los peers ni los datos.
  Volver a encenderlo reutiliza el emparejamiento.

---

## 9. Plan por fases

Las fases son incrementales y cada una termina con criterios medidos, lo probado en dispositivo o
emulador y lo pendiente. No se declara «hecho» sin `typecheck`, `lint`, `bun test`, `bun run e2e`
si se toca UI y `bun run desktop:check` si se toca Rust.

### Fase 1 — Modelo de datos y motor de fusión (2–3 semanas)

**Entra**

- `packages/core/src/sync.ts`: claves de contenido/episodio, HLC, comparación, merge, cursores,
  schemas Zod de registros y payloads.
- Migración `0024-sync.sql` y backfill; `migrations.lock.json`.
- `watch_progress` y cambio de lecturas/escrituras en `catalog-store`.
- `sync_item`, `sync_state`, `sync_peer`; escritura dual en las tres listas y ajustes.
- `prune.ts`: `watch_progress` protege el anime reciente y se cuenta en el informe.
- Tests: conflictos, tombstones, relojes adelantados/atrasados, empates, idempotencia, lote
  repetido, reconexión, multihop, payload inválido, migración desde cada versión.

**Criterios de aceptación**

- [ ] Una base de cada versión anterior (1–23) migra a 24 sin perder favoritos, vistos, quiero ver,
      último progreso ni ajustes; los conteos coinciden antes y después.
- [ ] El backfill deja un `watch_progress` por episodio con la posición de la fila más reciente y
      la marca `finished` pegajosa de cualquier fila terminada.
- [ ] Un rebobinado posterior no borra la marca de terminado; borrar el historial sí, y el borrado
      se sincroniza como tombstone.
- [ ] El motor converge con dos réplicas que aplican los mismos registros en orden distinto.
- [ ] Aplicar dos veces el mismo lote no cambia filas ni `local_seq`.
- [ ] Un tombstone con HLC mayor gana a un alta vieja; un alta con HLC mayor revive.
- [ ] Un reloj 2 días adelantado no bloquea la convergencia; se acota y se marca.
- [ ] `bun test packages/core packages/catalog-store` verde; mutaciones en rojo.
- [ ] `bun run scripts/migraciones.ts` verde y `bun run typecheck`/`lint` verdes.

**Riesgo:** tocar `catalog-store` y las migraciones mientras T412 está abierto. **Empieza después
de integrar T412**; si no, se rebasa y se resuelven conflictos de esquema.

### Fase 2 — API de sincronización y emparejamiento seguro (4–6 semanas)

**Entra**

- Listener separado `syncServer` con Hono, puerto propio, guard de peer, rate limit y límites.
- `sync/v1` con hello, pair, exchange/pull/push, status y revoke.
- Sobre AEAD (o TLS con pin, según la prueba de F2) y claves por dispositivo.
- Emparejamiento QR + código corto; ventana de 120 s; SAS; confirmación en el PC.
- mDNS en escritorio; estado y toggle en Ajustes; «Dispositivos vinculados».
- Cliente de escritorio que sincroniza con otro escritorio (mismo sobre).
- Tests: 401/403/409/413/429, payload inválido, replay, peer revocado, epoch cambiado, lote
  paginado, corte a mitad de push, reinicio con cursores.

**Criterios de aceptación**

- [ ] Sin el toggle, no hay puerto escuchando ni anuncio mDNS; un escaneo de la LAN no encuentra
      nada.
- [ ] Con el toggle, sólo `/sync/v1/*` está expuesto; la UI y `/api/*` siguen inaccesibles desde
      la LAN.
- [ ] Un dispositivo no emparejado no puede leer ni escribir; uno revocado recibe 403.
- [ ] Un QR empareja un móvil; un código de 6 dígitos empareja una TV; el código caduca y no se
      puede reutilizar.
- [ ] Un mensaje manipulado, repetido o de otra sesión se rechaza.
- [ ] Dos escritorios sincronizan biblioteca y progreso en la LAN; apagar y encender el listener
      conserva los peers.
- [ ] El escritorio no tiene regresiones: servidor local, cookie, UI y e2e verdes.
- [ ] `SECURITY.md` actualizado con la superficie nueva y el riesgo residual.

**Riesgo:** la seguridad es la parte cara. No se acepta «cifrado casero» sin spec, vectores y
revisión; si el sobre no pasa la prueba, se cambia a TLS con pin antes de seguir.

### Fase 3 — Cliente de sincronización en móvil (3–4 semanas)

**Entra**

- Cliente en `core` con adaptador de red (Tauri HTTP en móvil, `fetch` en escritorio).
- Descubrimiento `NsdManager` en Android; permisos `ACCESS_LOCAL_NETWORK` y multicast lock;
  respaldo por IP guardada y manual.
- Ciclo de vida: sync al abrir/reanudar, cada 5 min en primer plano, backoff; sin background.
- Ajustes → Sincronización, dispositivos vinculados, estado, botón de sync.
- «Continuar en otro dispositivo» en la home y al abrir un título.
- Espejo de preferencias del reproductor (`localStorage` ↔ `sync_item`).
- Tests en emulador API 26 y API 37; probar denegar el permiso de red local.

**Criterios de aceptación**

- [ ] Android real o emulador API 37: emparejar con el PC por QR, sincronizar biblioteca y
      progreso, matar la app y verlo todo.
- [ ] El permiso de red local se pide una vez; si se deniega, la app explica y ofrece IP/manual;
      no se queda en negro.
- [ ] Sync al abrir y al volver del background; no hay promesas de sync en segundo plano.
- [ ] «Continuar en otro dispositivo» ofrece la posición remota y no la impone.
- [ ] Un peer revocado deja de sincronizar; el móvil lo dice.
- [ ] `bun test`, `e2e` de UI y el APK de debug siguen verdes.

**Dependencia:** T412 integrado y la app móvil usable; el plan móvil F2 es la base.

### Fase 4 — TV: código corto y mando remoto (3–5 semanas)

**Entra**

- Cliente de sync y descubrimiento en TV; emparejamiento por código numérico con D-pad.
- UI de 10 pies para emparejar y para «dispositivos vinculados»; foco visible, sin hover.
- Listener de control en la TV (sólo primer plano/reproduciendo) y anuncio
  `_rona-control._tcp`.
- Mando remoto en el móvil: estado, play/pausa, ±10 s, volumen/mute; SSE o sobre.
- Volumen del sistema en Android TV (`AudioManager`) con reserva al volumen del reproductor.
- Tests en emulador de TV y en un TV box real si hay.

**Criterios de aceptación**

- [ ] La TV se empareja con un código de 6 dígitos usando sólo el mando; el foco no se pierde.
- [ ] El móvil emparejado controla play/pausa, avance y volumen; la TV muestra quién controla.
- [ ] Sin peer, la TV no escucha ni anuncia control.
- [ ] Al salir de la reproducción, el listener de control se apaga.
- [ ] El mismo APK sigue funcionando en móvil con su UI táctil.
- [ ] Medido en TV real o emulador; si no hay dispositivo, se declara.

**Riesgo:** el control remoto es un producto aparte; si F4 se retrasa, F1–F3 siguen siendo útiles.
No se mezcla con la sync de datos en el mismo commit.

### Fase 5 — Pulido, errores, revocación y documentación (2–3 semanas)

**Entra**

- Estados de error: sin red, mDNS bloqueado, permiso denegado, peer caído, reloj desajustado,
  lote rechazado, versión de protocolo distinta.
- Reintentos y reconexión; no duplicar avisos; no bloquear la reproducción.
- Revocación y «desvincular todos»; limpieza de claves y cursores.
- Documentación: `AGENTS.md` (arquitectura, reglas de seguridad, topología, migración),
  `SECURITY.md` (superficie, límites, riesgo residual), `README.md` si hay comandos nuevos,
  guía de VPN/Tailscale (opcional, sin servidor propio).
- Medición: 30 min de reproducción con sync cada 5 min, batería, tamaño de la base, tiempo de
  migración, tiempo de sync inicial con 10 000 registros.

**Criterios de aceptación**

- [ ] Los estados de error se ven y se explican; ningún fallo de sync rompe la reproducción.
- [ ] Revocar un dispositivo corta su acceso en la siguiente petición; el otro lado lo dice.
- [ ] `AGENTS.md` y `SECURITY.md` describen la función y sus límites.
- [ ] `bun run typecheck`, `bun run lint`, `bun test`, `bun run e2e` y `bun run desktop:check`
      verdes.
- [ ] Informe de cierre con lo medido y lo pendiente.

---

## 10. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Android 17 bloquea la red local sin `ACCESS_LOCAL_NETWORK` | Alta | Alto | Declarar y pedir el permiso; probar API 37; respaldo manual; mensaje claro. |
| iOS deniega el permiso de red local o Bonjour | Alta | Alto | `NSLocalNetworkUsageDescription` + `NSBonjourServices`; `NWBrowser`; guía a Ajustes; IP manual. |
| mDNS bloqueado en la red o en TV por Ethernet | Alta | Medio | IP guardada, introducción manual, QR; no depender sólo de mDNS. |
| Relojes desajustados | Media | Medio | HLC con acotación de 5 min; empate por dispositivo; aviso en Ajustes. |
| Protocolo criptográfico con fallos | Media | Alto | Primitivas auditadas, spec, vectores, revisión; alternativa TLS con pin; no shipping sin prueba. |
| Pérdida de identidad al cambiar un proveedor | Alta | Medio | Clave por proveedor+ref; alias AniList/MAL en F5; no borrar el progreso viejo. |
| Migración con pérdida de datos | Baja | Alto | Aditiva, copia previa, tests desde cada versión, restauración automática. |
| Regresión en escritorio | Media | Alto | Listener separado, sin tocar el servidor local; e2e y desktop:check en cada fase. |
| Dos verdades entre tablas | Media | Alto | `sync_item` manda; `watch_progress` y las listas son proyecciones; escritura dual en una transacción. |
| Control remoto se come la fase | Alta | Medio | F4 separada; F1–F3 entregan valor sin él; no mezclar commits. |
| Clave del escritorio legible por otro proceso | Media | Alto | 0600/ACL, DPAPI si se puede; móvil Keystore/Keychain; riesgo declarado. |
| Sync en segundo plano no funciona | Alta | Medio | No se promete; sólo primer plano; estado honesto. |
| Volumen de datos o batería | Baja | Medio | 500 registros/lote, 5 min, backoff, índices; medir. |
| VPN/Tailscale no medido | Media | Bajo | Documentar como opcional, no soportado; no abrir a Internet. |

---

## 11. Decisiones que necesitan aprobación

1. **Topología.** ¿El escritorio es el único anfitrión en la v1 (recomendado), o cualquier
   dispositivo puede escuchar y sincronizar sin PC?
2. **Cifrado.** ¿Sobre AEAD en `core` (recomendado), o TLS 1.3 con certificado autofirmado y pin?
3. **Ajustes sensibles.** ¿`adultContent` y `taste_profile` quedan fuera de la sync (recomendado),
   o se ofrecen como opt-in separado?
4. **Preferencias del reproductor.** ¿Se sincronizan con el espejo de `localStorage` (recomendado),
   o sólo los ajustes que ya están en SQLite?
5. **Historial.** ¿Sólo el último progreso por episodio (recomendado), o también el historial
   completo de reproducciones?
6. **Mando remoto.** ¿Entra en F4 (recomendado) o se separa a una entrega posterior?
7. **Alcance de la v1.** ¿Se aprueban F1–F5 con el orden propuesto, empezando después de T412?

---

## 12. Fuentes y trazabilidad

**Código leído:**

- Esquema: `packages/catalog-store/src/migrations/0001-initial.sql`, `0011-visto.sql`,
  `0012-quiero-ver.sql`, `0013-temporadas.sql`, `0014-descargas.sql`, `0023-gustos.sql`.
- Migraciones y copia: `packages/catalog-store/src/migrations/{migrate,backup,runner}.ts`,
  `docs/persistencia.md`.
- Progreso: `packages/catalog-store/src/repositories/watch.ts`,
  `packages/core/src/watch-progress.ts`.
- Listas y ajustes: `packages/catalog-store/src/repositories/{favorites,watched-titles,plan-to-watch,settings}.ts`,
  `packages/server/src/routes/settings.ts`.
- Perfil exportable: `packages/server/src/routes/profile.ts`, `packages/core/src/api.ts`.
- Preferencias del reproductor: `packages/web/src/features/player/storage.ts`.
- Servidor y red: `packages/server/src/index.ts`, `packages/cli/src/server-env.ts`,
  `packages/server/src/middleware/{host-guard,origin-guard}.ts`, `packages/server/src/party/lan.ts`.
- Móvil (worktree T412): `mobile/README.md`, `mobile/src-tauri/tauri.conf.json`,
  `mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml`,
  `mobile/src-tauri/gen/android/app/build.gradle.kts`,
  `mobile/src-tauri/capabilities/default.json`, `packages/core/src/capabilities.ts`.
- Plan móvil: `docs/plan-movil-tv.md`.

**Documentación externa consultada (noviembre de 2026):**

- Android: *Local network permission* (Android 17, `ACCESS_LOCAL_NETWORK`, target SDK 37),
  `NsdManager` (multicast lock, `FLAG_SHOW_PICKER`, `FAILURE_PERMISSION_DENIED`), *Network security
  configuration* (cleartext desde API 28).
- Apple: *TN3179 Understanding local network privacy*, `NSLocalNetworkUsageDescription`,
  `NSBonjourServices`, entitlement `com.apple.developer.networking.multicast`,
  `NSAllowsLocalNetworking`.
- Tauri v2: plugins oficiales (`http`, `sql`, `fs`, `store`, `notification`, `deep-link`), móvil
  sin sidecars, updater sólo escritorio, TV Leanback; plugins de comunidad de DNS-SD
  (`dns-sd-tauri`, `tauri-plugin-dns-sd`) y `tauri-plugin-mdns`.
- Bun: `Bun.serve` con TLS; `node:tls`/fetch para pin; SQLite nativo.

**Lo que no está medido:** ninguna sincronización real entre dispositivos; ningún mDNS en Android
TV/iOS; ningún TLS/pin en Tauri; ningún consumo de batería; ninguna migración con una base real de
usuario. Todo eso se mide en las fases, no se declara aquí.

---

## 13. Lo que no se hace

- Servidor central, cuenta, nube, telemetría o servicio de terceros.
- Sincronizar la base entera, los archivos, las descargas o los secretos.
- Abrir la UI o `/api/*` a la LAN para sincronizar.
- Abrir un puerto a Internet; Tailscale es opcional y documentado.
- Implementar dos transportes criptográficos a la vez.
- Meter la lógica de sync en la UI o en `mobile/`: vive en `packages/core`.
- Copiar `packages/core` a la cáscara móvil.
- Prometer sync en segundo plano en iOS o Android.
- Tocar `packages/` para meter el proyecto Android dentro del workspace.
