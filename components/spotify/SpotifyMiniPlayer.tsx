'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PREMIUM_REQUIRED_MESSAGE } from '@/lib/spotify/playbackCapability'
import {
  SpotifyPlaylistPicker,
  type PickerPlaylist,
  type PickerState,
} from '@/components/spotify/SpotifyPlaylistPicker'
import { SpotifyPlayerBar } from '@/components/spotify/SpotifyPlayerBar'

type PlaybackState = {
  trackName: string
  artistName: string
  albumArt: string
  paused: boolean
  durationMs: number
  positionMs: number
}

const RECONNECT_MESSAGE =
  'Reconnect Spotify to enable playback — your existing connection was made before playback permissions were added.'

export function SpotifyMiniPlayer() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  /** The Web Playback SDK device id — what /api/spotify/play aims a playlist at. */
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [playback, setPlayback] = useState<PlaybackState | null>(null)
  const [muted, setMuted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  /*
   * ⚠ A CONNECTED SPOTIFY ACCOUNT IS NOT NECESSARILY A PLAYABLE ONE, AND THE
   * WIDGET USED TO ASSUME IT WAS. Measured in production: all 8 connected
   * accounts hold `scope: user-read-email` and nothing else, because they
   * authorized before the playback scopes were added. Spotify grants scopes at
   * authorization time, so the widened list fixed NEW connections and left every
   * existing one silently unable to start audio — the player rendered, looked
   * connected, and produced nothing.
   *
   * /api/spotify/token now reports the gap. Showing it beats a dead player.
   */
  const [playbackBlock, setPlaybackBlock] = useState<string | null>(null)
  const [needsReauth, setNeedsReauth] = useState(false)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [picker, setPicker] = useState<PickerState>({ status: 'loading' })
  const [pendingUri, setPendingUri] = useState<string | null>(null)
  const [playError, setPlayError] = useState<{ message: string; reconnect?: boolean } | null>(null)
  const playlistsLoadedRef = useRef(false)

  const playerRef = useRef<Spotify.Player | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /*
   * The SDK calls getOAuthToken whenever it needs one, long after mount. Reading a
   * ref there returns the CURRENT token; closing over `token` returned the one from
   * the first render forever, so every refresh was invisible to the player.
   */
  const tokenRef = useRef<string | null>(null)

  const refreshToken = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/spotify/refresh', { method: 'POST' })
      if (!res.ok) return null
      const data = await res.json()
      tokenRef.current = data.accessToken as string
      setToken(data.accessToken)
      return data.accessToken as string
    } catch {
      return null
    }
  }, [])

  // Can this connection actually play? Scope gap vs Premium are different
  // problems with different remedies, so the server distinguishes them.
  useEffect(() => {
    let active = true
    fetch('/api/spotify/token', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return
        if (d.playbackMessage) setPlaybackBlock(d.playbackMessage as string)
        if (d.needsReauthorization) setNeedsReauth(true)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // Check if user has Spotify connected
  useEffect(() => {
    let active = true
    fetch('/api/user/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return
        if (data?.spotifyConnectedAt) {
          void refreshToken()
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [refreshToken])

  // Load Spotify Web Playback SDK
  useEffect(() => {
    if (!token) return

    if (document.getElementById('spotify-sdk-script')) return

    ;(window as any).onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'AllFantasy',
        getOAuthToken: (cb: (t: string) => void) => {
          if (tokenRef.current) {
            cb(tokenRef.current)
          } else {
            void refreshToken().then((t) => { if (t) cb(t) })
          }
        },
        volume: 0.5,
      })

      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        setDeviceId(device_id)
        setReady(true)
      })
      player.addListener('not_ready', () => {
        setDeviceId(null)
        setReady(false)
      })
      /*
       * ⚠ THE SDK IS THE ONLY RELIABLE PREMIUM CHECK LEFT. Spotify removed `product`
       * from GET /v1/me for Development Mode apps in February 2026, so the server can
       * no longer tell free from Premium. The SDK still can: a free account fails
       * with `account_error`. Without this listener a free listener got a player that
       * never became ready and no explanation.
       */
      player.addListener('account_error', () => {
        setNeedsReauth(false)
        setPlaybackBlock(PREMIUM_REQUIRED_MESSAGE)
      })
      player.addListener('authentication_error', () => {
        setNeedsReauth(true)
        setPlaybackBlock(RECONNECT_MESSAGE)
      })
      player.addListener('player_state_changed', (state: Spotify.PlaybackState | null) => {
        if (!state) { setPlayback(null); return }
        const track = state.track_window.current_track
        setPlayback({
          trackName: track.name,
          artistName: track.artists.map((a) => a.name).join(', '),
          albumArt: track.album.images[0]?.url ?? '',
          paused: state.paused,
          durationMs: state.duration,
          positionMs: state.position,
        })
      })

      player.connect()
      playerRef.current = player
    }

    const script = document.createElement('script')
    script.id = 'spotify-sdk-script'
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    document.body.appendChild(script)

    return () => {
      playerRef.current?.disconnect()
    }
  }, [token, refreshToken])

  // Token refresh interval (every 50 min)
  useEffect(() => {
    if (!token) return
    intervalRef.current = setInterval(() => void refreshToken(), 50 * 60 * 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [token, refreshToken])

  const loadPlaylists = useCallback(async () => {
    setPicker({ status: 'loading' })
    try {
      const res = await fetch('/api/spotify/playlists', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setPicker({
          status: 'error',
          message: (data?.error as string) ?? 'Could not load your Spotify playlists.',
          reconnect: res.status === 401 || res.status === 404,
        })
        return
      }
      playlistsLoadedRef.current = true
      setPicker({
        status: 'ready',
        playlists: Array.isArray(data?.playlists) ? (data.playlists as PickerPlaylist[]) : [],
        notice: typeof data?.notice === 'string' ? data.notice : null,
        truncated: data?.truncated === true,
      })
    } catch {
      setPicker({ status: 'error', message: 'Could not reach AllFantasy. Check your connection.' })
    }
  }, [])

  const openPicker = useCallback(() => {
    setPickerOpen(true)
    setPlayError(null)
    // Load once per page view; "Try again" reloads on demand.
    if (!playlistsLoadedRef.current) void loadPlaylists()
  }, [loadPlaylists])

  const playPlaylist = useCallback(
    async (playlist: PickerPlaylist) => {
      if (!deviceId) {
        setPlayError({ message: 'The player is still starting. Try again in a moment.' })
        return
      }
      setPendingUri(playlist.uri)
      setPlayError(null)
      try {
        const res = await fetch('/api/spotify/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, contextUri: playlist.uri }),
        })
        if (res.ok) {
          setPickerOpen(false)
          return
        }
        const data = await res.json().catch(() => null)
        setPlayError({
          message: (data?.error as string) ?? 'Spotify would not start that playlist. Try again.',
          reconnect: data?.reconnect === true,
        })
      } catch {
        setPlayError({ message: 'Could not reach AllFantasy. Check your connection.' })
      } finally {
        setPendingUri(null)
      }
    },
    [deviceId]
  )

  /*
   * ⚠ SHOWN BEFORE THE READY GUARD, ON PURPOSE. When the grant lacks playback
   * scopes the Web Playback SDK never reaches `ready`, so the old guard returned
   * null and the user got NOTHING — no player, no error, no explanation. Silence
   * is the worst of the three: it reads as "the feature is broken" rather than
   * "one click fixes this".
   */
  if (playbackBlock && !dismissed) {
    return (
      <div className="fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-[#0a1220]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-4 py-2">
          <span className="text-xs text-white/70">{playbackBlock}</span>
          {needsReauth && (
            // An OAuth redirect route needs a full navigation; <Link> would client-route to it.
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- see the line above
            <a
              href="/api/auth/spotify"
              className="rounded-full bg-[#1DB954] px-3 py-1 text-xs font-semibold text-black"
            >
              Reconnect Spotify
            </a>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="ml-auto text-white/50 hover:text-white/80"
          >
            ×
          </button>
        </div>
      </div>
    )
  }

  if (!token || !ready || dismissed) return null

  const togglePlay = () => playerRef.current?.togglePlay()
  const prevTrack = () => playerRef.current?.previousTrack()
  const nextTrack = () => playerRef.current?.nextTrack()
  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    playerRef.current?.setVolume(next ? 0 : 0.5)
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 pb-[env(safe-area-inset-bottom)]">
      {pickerOpen && (
        <SpotifyPlaylistPicker
          state={picker}
          pendingUri={pendingUri}
          playError={playError}
          onPick={(p) => void playPlaylist(p)}
          onClose={() => setPickerOpen(false)}
          onRetry={() => void loadPlaylists()}
        />
      )}
      <SpotifyPlayerBar
        playback={playback}
        muted={muted}
        pickerOpen={pickerOpen}
        onTogglePicker={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
        onOpenPicker={openPicker}
        onPrev={prevTrack}
        onTogglePlay={togglePlay}
        onNext={nextTrack}
        onToggleMute={toggleMute}
        onClose={() => setDismissed(true)}
      />
    </div>
  )
}
