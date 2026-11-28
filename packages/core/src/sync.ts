import { z } from 'zod'

export const SYNC_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

export type Hlc = {
  wall: number
  counter: number
  device: string
}

export function hlcCompare(a: Hlc, b: Hlc): number {
  if (a.wall !== b.wall) return a.wall - b.wall
  if (a.counter !== b.counter) return a.counter - b.counter
  return a.device < b.device ? -1 : a.device > b.device ? 1 : 0
}

export function hlcToString(h: Hlc): string {
  const wall = h.wall.toString(16).padStart(12, '0')
  const counter = h.counter.toString(16).padStart(6, '0')
  return `${wall}-${counter}-${h.device}`
}

export function hlcFromString(s: string): Hlc {
  const parts = s.split('-')
  const wall = parseInt(parts[0] ?? '0', 16)
  const counter = parseInt(parts[1] ?? '0', 16)
  const device = parts.slice(2).join('-')
  return { wall, counter, device }
}

export function contentKey(providerId: string, providerRef: string): string {
  return `p:${encodeURIComponent(providerId)}:${encodeURIComponent(providerRef)}`
}

export function episodeKey(season: number | null | undefined, number: number | null | undefined, providerRef: string | null | undefined): string {
  if (season != null && number != null) return `s${season}e${number}`
  if (number != null) return `e${number}`
  if (providerRef) return `r:${encodeURIComponent(providerRef)}`
  return 'movie'
}

export function progressKey(ck: string, ek: string): string {
  return `${ck}#${ek}`
}

export const SYNC_ENTITIES = ['progress', 'favorite', 'watched', 'plan_to_watch', 'setting'] as const
export type SyncEntity = (typeof SYNC_ENTITIES)[number]

export const SYNCED_SETTINGS = ['theme', 'providerPriority', 'playerPrefs'] as const
export type SyncedSetting = (typeof SYNCED_SETTINGS)[number]

export const syncItemSchema = z.object({
  entity: z.enum(SYNC_ENTITIES),
  itemKey: z.string().min(1),
  valueJson: z.string().default('{}'),
  deleted: z.boolean().default(false),
  hlc: z.string().min(1),
  originDevice: z.string().min(1),
  originSeq: z.number().int().nonnegative(),
  localSeq: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type SyncItem = z.infer<typeof syncItemSchema>

export const progressPayloadSchema = z.object({
  providerId: z.string(),
  animeRef: z.string(),
  title: z.string(),
  coverUrl: z.string().optional(),
  year: z.number().optional(),
  episodeRef: z.string(),
  episodeNumber: z.number().optional(),
  season: z.number().optional(),
  mode: z.string(),
  positionS: z.number(),
  durationS: z.number(),
  finished: z.boolean(),
  startedAt: z.number(),
})

export const libraryPayloadSchema = z.object({
  providerId: z.string(),
  ref: z.string(),
  title: z.string(),
  coverUrl: z.string().optional(),
  year: z.number().optional(),
  kind: z.string().optional(),
})

export const settingPayloadSchema = z.unknown()

export type ProgressPayload = z.infer<typeof progressPayloadSchema>
export type LibraryPayload = z.infer<typeof libraryPayloadSchema>

export type HlcState = { wall: number; counter: number }

export function nextHlc(state: HlcState, now: number, device: string): { hlc: Hlc; state: HlcState } {
  let wall = Math.max(now, state.wall)
  let counter = 0
  if (wall === state.wall) counter = state.counter + 1
  const hlc: Hlc = { wall, counter, device }
  return { hlc, state: { wall, counter } }
}

export function receiveHlc(state: HlcState, remote: Hlc, now: number, device: string): { hlc: Hlc; state: HlcState; skew: boolean } {
  const cappedRemoteWall = Math.min(remote.wall, now + SYNC_MAX_CLOCK_SKEW_MS)
  const wall = Math.max(now, state.wall, cappedRemoteWall)
  let counter = 0
  if (wall === state.wall && wall === cappedRemoteWall && wall === remote.wall) {
    counter = Math.max(state.counter, remote.counter) + 1
  } else if (wall === state.wall) {
    counter = state.counter + 1
  } else if (wall === cappedRemoteWall && wall === remote.wall) {
    counter = remote.counter + 1
  }
  const skew = remote.wall > now + SYNC_MAX_CLOCK_SKEW_MS
  const hlc: Hlc = { wall, counter, device }
  return { hlc, state: { wall, counter }, skew }
}

export function shouldApply(existing: SyncItem | null, incoming: SyncItem): boolean {
  if (!existing) return true
  const cmp = hlcCompare(hlcFromString(incoming.hlc), hlcFromString(existing.hlc))
  return cmp > 0
}

export function mergeProgress(existingFinished: boolean, incomingFinished: boolean, incomingHlcWins: boolean): boolean {
  // finished is sticky: once true, a rewind does not un-finish; only explicit delete.
  return existingFinished || (incomingHlcWins ? incomingFinished : false)
}