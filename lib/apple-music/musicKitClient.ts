'use client'

/**
 * Browser-side MusicKit JS v3 loader and the small slice of its API we use.
 *
 * ⚠ LOADED ON DEMAND, NEVER ON PAGE LOAD. Apple's script is only fetched when
 * someone opens the Apple Music tab, so a draft room that never uses it pays
 * nothing for it.
 */

export type MusicKitItem = {
  id: string
  type: string
  attributes?: {
    name?: string
    artistName?: string
    curatorName?: string
    artwork?: { url?: string }
  }
}

export type MusicKitNowPlaying = {
  id?: string
  title?: string
  artistName?: string
  artwork?: { url?: string }
  attributes?: MusicKitItem['attributes']
}

export type MusicKitInstance = {
  isAuthorized: boolean
  isPlaying: boolean
  nowPlayingItem?: MusicKitNowPlaying | null
  authorize(): Promise<string>
  unauthorize(): Promise<void>
  setQueue(options: { song?: string; playlist?: string; startPlaying?: boolean }): Promise<unknown>
  play(): Promise<void>
  pause(): void
  stop(): void
  skipToNextItem(): Promise<void>
  skipToPreviousItem(): Promise<void>
  addEventListener(name: string, cb: () => void): void
  removeEventListener(name: string, cb: () => void): void
  api: {
    music(path: string, params?: Record<string, unknown>): Promise<{ data: unknown }>
  }
}

type MusicKitGlobal = {
  configure(options: {
    developerToken: string
    app: { name: string; build: string }
  }): Promise<MusicKitInstance>
  getInstance(): MusicKitInstance
}

const SCRIPT_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
const LOAD_TIMEOUT_MS = 15_000

function globalMusicKit(): MusicKitGlobal | undefined {
  return (window as unknown as { MusicKit?: MusicKitGlobal }).MusicKit
}

let loading: Promise<MusicKitGlobal> | null = null

function loadScript(): Promise<MusicKitGlobal> {
  const existing = globalMusicKit()
  if (existing) return Promise.resolve(existing)
  if (loading) return loading

  /*
   * ⚠ DO NOT WAIT ON `musickitloaded` ALONE, AND NEVER WAIT FOREVER. Observed
   * 2026-11-15 on MusicKit 3.2526: the panel sat on "Checking Apple Music…"
   * while window.MusicKit already existed and configure() answered in 11 ms.
   * The cause was NOT pinned down — a missed event and a slow dev-server compile
   * (the token route took 10–14 s on first hit) both fit. So resolve on
   * whichever comes first — the event, the script's own load, or
   * window.MusicKit appearing — and give up after LOAD_TIMEOUT_MS so the panel
   * can offer "Try again" rather than spin.
   */
  loading = new Promise<MusicKitGlobal>((resolve, reject) => {
    let settled = false
    const finish = (mk: MusicKitGlobal | undefined, err?: Error) => {
      if (settled) return
      settled = true
      window.clearInterval(poll)
      window.clearTimeout(timeout)
      document.removeEventListener('musickitloaded', check)
      if (mk) resolve(mk)
      else reject(err ?? new Error('MusicKit did not initialise'))
    }
    const check = () => {
      const mk = globalMusicKit()
      if (mk) finish(mk)
    }
    const poll = window.setInterval(check, 100)
    const timeout = window.setTimeout(
      () => finish(globalMusicKit(), new Error('MusicKit timed out')),
      LOAD_TIMEOUT_MS,
    )
    document.addEventListener('musickitloaded', check)

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = check
    script.onerror = () => finish(undefined, new Error('MusicKit script failed to load'))
    document.head.appendChild(script)
  }).catch((err) => {
    loading = null
    throw err
  })
  return loading
}

export type MusicKitSetup =
  | { kind: 'unavailable' }
  | { kind: 'error' }
  | { kind: 'ready'; music: MusicKitInstance }

let configured: MusicKitInstance | null = null

/** Gets a configured MusicKit instance, or says why there is not one. */
export async function setUpMusicKit(): Promise<MusicKitSetup> {
  if (configured) return { kind: 'ready', music: configured }

  let token: string
  try {
    const res = await fetch('/api/apple-music/developer-token', { cache: 'no-store' })
    if (res.status === 503) return { kind: 'unavailable' }
    if (!res.ok) return { kind: 'error' }
    const body = (await res.json()) as { token?: string }
    if (!body.token) return { kind: 'error' }
    token = body.token
  } catch {
    return { kind: 'error' }
  }

  try {
    const MusicKit = await loadScript()
    configured = await Promise.race([
      MusicKit.configure({
        developerToken: token,
        app: { name: 'AllFantasy', build: '2026.11' },
      }),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('MusicKit configure timed out')), LOAD_TIMEOUT_MS),
      ),
    ])
    return { kind: 'ready', music: configured }
  } catch {
    return { kind: 'error' }
  }
}

/** Apple artwork URLs are templates: `{w}x{h}` is filled in by the caller. */
export function artworkUrl(template: string | undefined, size: number): string | null {
  if (!template) return null
  return template.replace('{w}', String(size)).replace('{h}', String(size))
}

export type AppleSearchResult = {
  id: string
  kind: 'song' | 'playlist'
  title: string
  subtitle: string
  art: string | null
}

/** Catalog search in the listener's own storefront (country). */
export async function searchCatalog(
  music: MusicKitInstance,
  term: string,
): Promise<AppleSearchResult[]> {
  const res = await music.api.music('/v1/catalog/{{storefrontId}}/search', {
    term,
    types: ['playlists', 'songs'],
    limit: 6,
  })
  const results =
    (res.data as {
      results?: { songs?: { data?: MusicKitItem[] }; playlists?: { data?: MusicKitItem[] } }
    })?.results ?? {}

  const playlists = (results.playlists?.data ?? []).map<AppleSearchResult>((item) => ({
    id: item.id,
    kind: 'playlist',
    title: item.attributes?.name ?? 'Playlist',
    subtitle: item.attributes?.curatorName ?? 'Playlist',
    art: artworkUrl(item.attributes?.artwork?.url, 96),
  }))
  const songs = (results.songs?.data ?? []).map<AppleSearchResult>((item) => ({
    id: item.id,
    kind: 'song',
    title: item.attributes?.name ?? 'Song',
    subtitle: item.attributes?.artistName ?? '',
    art: artworkUrl(item.attributes?.artwork?.url, 96),
  }))
  return [...playlists, ...songs]
}
