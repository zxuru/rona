-- Sincronizacion entre dispositivos (F1): esquema aditivo.
--
-- Tablas nuevas para el motor de fusion LWW por registro con HLC:
--   sync_item: registros sincronizables genericos (favoritos, listas, ajustes)
--   watch_progress: proyeccion del ultimo progreso por episodio
--   sync_state: cursor y estado local del motor
--   sync_peer: dispositivos emparejados
--
-- No se borra ni reescribe nada: las tablas de usuario quedan igual y las
-- lecturas de progreso pasan a la nueva proyeccion de forma gradual.

CREATE TABLE sync_item (
  id         TEXT    PRIMARY KEY NOT NULL,
  kind       TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  hlc        INTEGER NOT NULL,
  device_id  TEXT    NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_sync_item_kind ON sync_item (kind);
CREATE INDEX idx_sync_item_hlc ON sync_item (hlc);

CREATE TABLE watch_progress (
  episode_key TEXT    PRIMARY KEY NOT NULL,
  anime_key   TEXT    NOT NULL,
  position_s  INTEGER NOT NULL,
  duration_s  INTEGER NOT NULL,
  finished    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT    NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_watch_progress_anime ON watch_progress (anime_key);

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE sync_peer (
  device_id   TEXT    PRIMARY KEY NOT NULL,
  name        TEXT    NOT NULL,
  public_key  TEXT    NOT NULL,
  paired_at   INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER
);

-- Backfill: un registro por episodio con el ultimo progreso conocido.
INSERT INTO watch_progress (episode_key, anime_key, position_s, duration_s, finished, updated_at, device_id, deleted)
SELECT
  CAST(episode_id AS TEXT) AS episode_key,
  CAST(anime_id AS TEXT)   AS anime_key,
  COALESCE(position_s, 0)  AS position_s,
  COALESCE(duration_s, 0)  AS duration_s,
  COALESCE(finished, 0)    AS finished,
  COALESCE(started_at, 0)  AS updated_at,
  'local'                  AS device_id,
  0                        AS deleted
FROM watch_event
WHERE id IN (
  SELECT MAX(id) FROM watch_event GROUP BY episode_id
);
