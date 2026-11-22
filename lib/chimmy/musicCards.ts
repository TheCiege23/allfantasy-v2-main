import { YOUTUBE_STATIONS, type YouTubeStation } from '@/lib/draft-music/youtube'

/**
 * Chimmy and the music player — 2026-11-16, owner's decision: "play some hype music", "play Drake" or
 * "stop the music" gets a card, and ONE TAP plays or stops it. Nothing plays without the tap (browsers
 * only let audio start from one anyway).
 *
 * The player runs in the browser (components/app-music/AppMusicDock.tsx, through musicBus), so a music
 * card is not a server action: no token, no confirm route. The server only chooses WHAT — a station by
 * id, a search phrase, or stop — and the card calls the player when tapped.
 *
 * Client-safe: no server imports.
 */

export type MusicCard =
  | { kind: 'station'; stationId: string; label: string }
  | { kind: 'search'; term: string }
  | { kind: 'stop' }

export const MUSIC_STATION_IDS = YOUTUBE_STATIONS.map((s) => s.id)

export function findStation(id: unknown): YouTubeStation | null {
  return typeof id === 'string' ? YOUTUBE_STATIONS.find((s) => s.id === id) ?? null : null
}

/** A search phrase as the player takes it: one line, no control characters, capped. */
export function cleanSearchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const term = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return term || null
}

/** The music card on an answer's meta, validated; null when there is none or it is malformed. */
export function readMusicCard(meta: unknown): MusicCard | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).musicCard
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind === 'stop') return { kind: 'stop' }
  if (r.kind === 'station') {
    const station = findStation(r.stationId)
    return station ? { kind: 'station', stationId: station.id, label: station.label } : null
  }
  if (r.kind === 'search') {
    const term = cleanSearchTerm(r.term)
    return term ? { kind: 'search', term } : null
  }
  return null
}

/**
 * Is this a request to play or stop music? Chimmy's off-topic filter looks for sports words, and "play
 * some hype music" has none — so a music request would be turned away before the music tool could run.
 * Deliberately narrow: an imperative at the start, or a music word next to play/stop/put on.
 */
export function isMusicRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/^@chimmy\b[\s,:]*/, '')
  if (/^(?:please\s+)?(?:play|put on|queue up|throw on|turn on)\b/.test(t)) return true
  if (/\b(?:stop|pause|turn off|kill)\b.{0,20}\b(?:music|song|songs|podcast|station|playlist|radio)\b/.test(t)) return true
  return /\b(?:play|put on)\b.{0,40}\b(?:music|song|songs|podcast|station|playlist|radio|beats|hype)\b/.test(t)
}

/** The station list as the tool describes it to the model: "game-day (Game day hype), …". */
export function stationMenu(): string {
  return YOUTUBE_STATIONS.map((s) => `${s.id} (${s.label})`).join(', ')
}
