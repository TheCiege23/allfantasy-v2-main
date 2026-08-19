'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'

type PlaybackState = {
  trackName: string
  artistName: string
  albumArt: string
  paused: boolean
  durationMs: number
  positionMs: number
}

export function SpotifyMiniPlayer() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
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
  const playerRef = useRef<Spotify.Player | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshToken = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/spotify/refresh', { method: 'POST' })
      if (!res.ok) return null
      const data = await res.json()
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
          if (token) {
            cb(token)
          } else {
            void refreshToken().then((t) => { if (t) cb(t) })
          }
        },
        volume: 0.5,
      })

      player.addListener('ready', () => setReady(true))
      player.addListener('not_ready', () => setReady(false))
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

  /*
   * ⚠ SHOWN BEFORE THE READY GUARD, ON PURPOSE. When the grant lacks playback
   * scopes the Web Playback SDK never reaches `ready`, so the old guard returned
   * null and the user got NOTHING — no player, no error, no explanation. Silence
   * is the worst of the three: it reads as "the feature is broken" rather than
   * "one click fixes this".
   */
  if (playbackBlock && !dismissed) {
    return (
      <div className="fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-[#0a1220]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-4 py-2">
          <span className="text-xs text-white/70">{playbackBlock}</span>
          {needsReauth && (
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
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-[#0a1220]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-4 py-2">
        {playback?.albumArt && (
          <Image
            src={playback.albumArt}
            alt="Album art"
            width={40}
            height={40}
            unoptimized
            className="h-10 w-10 shrink-0 rounded"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {playback?.trackName ?? 'No track playing'}
          </p>
          <p className="truncate text-xs text-white/50">
            {playback?.artistName ?? 'Open Spotify and start playing'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={prevTrack} className="p-1.5 text-white/60 hover:text-white">
            <SkipBack className="h-4 w-4" />
          </button>
          <button type="button" onClick={togglePlay} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            {playback?.paused !== false ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" onClick={nextTrack} className="p-1.5 text-white/60 hover:text-white">
            <SkipForward className="h-4 w-4" />
          </button>
          <button type="button" onClick={toggleMute} className="p-1.5 text-white/60 hover:text-white">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => setDismissed(true)} className="p-1.5 text-white/40 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
