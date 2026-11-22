/**
 * The two Spotify Web API calls the music widget makes on the listener's behalf:
 * list their playlists, and start one on the in-browser player.
 *
 * Called server-side only, from /api/spotify/playlists and /api/spotify/play, with the
 * listener's own token from lib/spotify/userAccess. This is per-user account access,
 * not a data feed — there is nothing to cache in Postgres, which is why
 * api.spotify.com is classified `platform-infra` in the DB-first host census.
 *
 * ⚠ NEVER LOG A TOKEN, AN AUTHORIZATION HEADER OR A FULL REQUEST. Status codes only.
 */

const API = 'https://api.spotify.com/v1'

/** Spotify ids are 22 base-62 characters. Anything else is not ours to forward. */
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/
const CONTEXT_URI = /^spotify:(playlist|album|artist):[0-9A-Za-z]{22}$/
/** Web Playback SDK device ids are hex; allow a generous alnum range, nothing else. */
const DEVICE_ID = /^[0-9A-Za-z]{8,128}$/

type SpotifyPlaylistSummary = {
  id: string
  name: string
  uri: string
  imageUrl: string | null
  /** null when Spotify did not report one (playlists the user only follows). */
  trackCount: number | null
  ownerName: string | null
}

export function isValidContextUri(value: unknown): value is string {
  return typeof value === 'string' && CONTEXT_URI.test(value)
}

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID.test(value)
}

/**
 * Normalize one playlist from GET /v1/me/playlists.
 *
 * ⚠ THE COUNT MOVED. The February 2026 Web API changes renamed the playlist's `tracks`
 * field to `items` for Development Mode apps, so `tracks.total` is absent there and
 * `items.total` carries it. Apps on extended quota still get `tracks`. Read both rather
 * than guessing which mode this app is in, and report null — never 0 — when neither is
 * present: for playlists the user only follows, Spotify now omits the contents entirely,
 * and "0 tracks" would be a false statement about a full playlist.
 */
export function normalizePlaylist(raw: unknown): SpotifyPlaylistSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const id = typeof p.id === 'string' ? p.id : null
  if (!id || !SPOTIFY_ID.test(id)) return null

  const uri = typeof p.uri === 'string' && CONTEXT_URI.test(p.uri) ? p.uri : `spotify:playlist:${id}`
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Untitled playlist'

  const images = Array.isArray(p.images) ? (p.images as Array<Record<string, unknown>>) : []
  // Spotify lists images widest first; the smallest is plenty for a 40px thumbnail.
  const image = images.length ? images[images.length - 1] : null
  const imageUrl = image && typeof image.url === 'string' ? image.url : null

  const countOf = (field: unknown): number | null => {
    if (!field || typeof field !== 'object') return null
    const total = (field as Record<string, unknown>).total
    return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : null
  }
  const trackCount = countOf(p.items) ?? countOf(p.tracks)

  const owner = p.owner && typeof p.owner === 'object' ? (p.owner as Record<string, unknown>) : null
  const ownerName = owner && typeof owner.display_name === 'string' ? owner.display_name : null

  return { id, name, uri, imageUrl, trackCount, ownerName }
}

type ListPlaylistsResult =
  | { ok: true; playlists: SpotifyPlaylistSummary[]; truncated: boolean }
  | { ok: false; status: number }

/** 50 is the endpoint's page maximum; 4 pages covers all but the largest libraries. */
const PAGE_SIZE = 50
const MAX_PAGES = 4

export async function listMyPlaylists(accessToken: string): Promise<ListPlaylistsResult> {
  const playlists: SpotifyPlaylistSummary[] = []
  let offset = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await fetch(`${API}/me/playlists?limit=${PAGE_SIZE}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      // A failure on a LATER page still leaves real playlists to show.
      if (playlists.length > 0) return { ok: true, playlists, truncated: true }
      return { ok: false, status: res.status }
    }
    const body = (await res.json()) as { items?: unknown[]; next?: unknown; total?: unknown }
    const items = Array.isArray(body.items) ? body.items : []
    for (const item of items) {
      const normalized = normalizePlaylist(item)
      if (normalized) playlists.push(normalized)
    }
    if (!body.next || items.length === 0) return { ok: true, playlists, truncated: false }
    offset += PAGE_SIZE
  }
  return { ok: true, playlists, truncated: true }
}

type StartPlaybackResult =
  | { ok: true }
  | { ok: false; status: number; reason: 'premium_required' | 'forbidden' | 'device_not_found' | 'unauthorized' | 'rate_limited' | 'failed' }

async function readReason(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { reason?: unknown } }
    return typeof body?.error?.reason === 'string' ? body.error.reason : null
  } catch {
    return null
  }
}

function classify(status: number, reason: string | null): StartPlaybackResult {
  if (status === 401) return { ok: false, status, reason: 'unauthorized' }
  if (status === 429) return { ok: false, status, reason: 'rate_limited' }
  // A 403 is NOT always Premium: a grant missing `user-modify-playback-state` is also 403,
  // and telling that listener to buy Premium sends them to fix the wrong thing.
  if (reason === 'PREMIUM_REQUIRED') return { ok: false, status, reason: 'premium_required' }
  if (status === 403) return { ok: false, status, reason: 'forbidden' }
  if (status === 404 || reason === 'NO_ACTIVE_DEVICE') return { ok: false, status, reason: 'device_not_found' }
  return { ok: false, status, reason: 'failed' }
}

/**
 * Start `contextUri` (a playlist) on the listener's in-browser player.
 *
 * ⚠ A JUST-REGISTERED SDK DEVICE IS OFTEN NOT YET PLAYABLE BY ID. Spotify answers a
 * play request aimed at a device that connected moments ago with 404 until playback
 * has been transferred to it. So: try once; on 404, transfer playback to the device
 * (without starting audio) and try exactly once more. Never loop.
 */
export async function startPlaylistPlayback(
  accessToken: string,
  deviceId: string,
  contextUri: string
): Promise<StartPlaybackResult> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const play = () =>
    fetch(`${API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ context_uri: contextUri }),
      cache: 'no-store',
    })

  let res = await play()
  if (res.ok) return { ok: true }

  if (res.status === 404) {
    const transfer = await fetch(`${API}/me/player`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
      cache: 'no-store',
    })
    if (transfer.ok) {
      res = await play()
      if (res.ok) return { ok: true }
    } else {
      res = transfer
    }
  }

  return classify(res.status, await readReason(res))
}
