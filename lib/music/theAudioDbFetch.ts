/**
 * The TheAudioDB calls — the vendor boundary, and nothing else (security cleanup, 2026-11-15).
 *
 * Same shape as `lib/weather/openWeatherGeocode.ts` and `lib/fantasycalc-fetch.ts`: the network lives
 * alone in a module whose ONLY importer is the DB-first reader `lib/music/musicCatalog.ts`, so the
 * exemption in scripts/check-db-first-api-boundary.mjs is granted on a caller census, not asserted with
 * a marker. Before this, both /api/music routes built the key-bearing URL and fetched it inline on
 * every widget open.
 *
 * ⚠ TheAudioDB's v1 API takes its key AS A PATH SEGMENT — there is no header form on v1 — so the URL
 * itself is a credential. It is built here, used here, and never returned, thrown or logged: every
 * failure collapses to `null` with no message, because an error string is how a URL usually escapes.
 *
 * Returns `null` for "no answer" (non-ok, network error, timeout, unparseable) and an array — possibly
 * empty — for a real answer. The reader caches only real answers.
 */

import { getTheAudioDbApiKeyOrFallback } from '@/lib/env/sports-media-keys'

export type AudioDbArtist = {
  idArtist?: string
  strArtist?: string
  strArtistThumb?: string
  strGenre?: string
  strStyle?: string
}

export type AudioDbTrack = {
  idTrack?: string
  strTrack?: string
  strArtist?: string
  strTrackThumb?: string
  intDuration?: number
}

const TIMEOUT_MS = 5000

async function getAudioDb(path: 'search.php' | 'track-top10.php', name: string): Promise<Record<string, unknown> | null> {
  const key = getTheAudioDbApiKeyOrFallback('2')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://www.theaudiodb.com/api/v1/json/${encodeURIComponent(key)}/${path}?s=${encodeURIComponent(name)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Artists matching a name. */
export async function fetchAudioDbArtists(name: string): Promise<AudioDbArtist[] | null> {
  const data = await getAudioDb('search.php', name)
  if (!data) return null
  return Array.isArray(data.artists) ? (data.artists as AudioDbArtist[]) : []
}

/** An artist's top ten tracks. */
export async function fetchAudioDbTopTracks(artist: string): Promise<AudioDbTrack[] | null> {
  const data = await getAudioDb('track-top10.php', artist)
  if (!data) return null
  return Array.isArray(data.track) ? (data.track as AudioDbTrack[]) : []
}
