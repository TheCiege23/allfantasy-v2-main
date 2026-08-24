'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@/components/core-app/af-draft-music.css'

/**
 * 31a — Spotify in the draft room ("War Room").
 *
 * ⚠ THE QUEUE IS SHARED. THE AUDIO IS NOT. There is no way to broadcast audio to
 * a room with Spotify's public API, and this widget must never imply otherwise.
 * Everyone sees the same queue; everyone hears it on their own authenticated
 * device, starting whenever they press play. That sentence is printed in the UI,
 * not just written here — a user who believes the room is listening together and
 * then finds out otherwise has been misled by us, not by Spotify.
 *
 * ⚠ FULL TRACKS NEED PREMIUM, AND THAT IS SPOTIFY'S RULE. A free account
 * authorises perfectly happily and simply cannot stream in-browser. The copy
 * attributes the limit to Spotify explicitly, because a user reading "upgrade to
 * play music" on our surface reasonably concludes we are the ones charging.
 *
 * ⚠ PLAYBACK RUNS ON THE LISTENER'S DEVICE. AllFantasy never streams audio.
 *
 * ⚠ NEVER AUTOPLAY ON ROOM OPEN, AND NEVER COVER THE BOARD. The collapsed
 * variant is the default in the draft header. It is a fixed-height strip, it
 * does not overlay the board, and nothing starts until someone presses play —
 * a draft room that starts making noise by itself during a pick is a bug.
 *
 * ⚠ THE COLLABORATIVE QUEUE NEEDS A TABLE THAT IS NOT APPLIED YET. Migration
 * 20260823130000_draft_room_music_queue is authored but not run (the only
 * database .env.local points at is production), so the queue reports itself as
 * pending rather than silently dropping what someone adds.
 */

export type DraftMusicState =
  | { kind: 'loading' }
  /** No Spotify authorization at all. */
  | { kind: 'disconnected' }
  /** Authorized, but the grant predates playback scopes. */
  | { kind: 'needs-reauth'; message: string }
  /** Authorized and scoped, but a free account — previews only. */
  | { kind: 'free'; message: string; displayName: string | null }
  /** Authorized, scoped, Premium. */
  | { kind: 'ready'; displayName: string | null }

export type QueueTrack = {
  id: string
  trackName: string
  artistName: string
  albumArt: string | null
  durationMs: number
  previewUrl: string | null
  addedByName: string
}

export type DraftMusicWidgetProps = {
  /** Collapsed is the draft-room default: it must not cover the board. */
  variant?: 'collapsed' | 'full'
  /** Queue rows, once the queue table exists. Empty while pending. */
  queue?: QueueTrack[]
  /** True while the queue migration is unapplied. */
  queuePending?: boolean
  playlistName?: string | null
}

type TokenResponse = {
  connected?: boolean
  accessToken?: string
  isPremium?: boolean
  canPlay?: boolean
  needsReauthorization?: boolean
  playbackMessage?: string | null
  displayName?: string | null
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function DraftMusicWidget({
  variant = 'collapsed',
  queue = [],
  queuePending = true,
  playlistName = null,
}: DraftMusicWidgetProps) {
  const [state, setState] = useState<DraftMusicState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(variant === 'full')
  const [volume, setVolume] = useState(60)
  /*
   * ⚠ NEVER TRUE ON MOUNT. The draft room opening must not start audio. This
   * only becomes true when a person presses play.
   */
  const [playing, setPlaying] = useState(false)
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/spotify/token')
        if (cancelled) return
        if (res.status === 404 || res.status === 401) {
          setState({ kind: 'disconnected' })
          return
        }
        if (!res.ok) {
          // 503 = the integration is not configured on this server at all.
          setState({ kind: 'disconnected' })
          return
        }
        const data = (await res.json()) as TokenResponse
        if (cancelled) return
        if (data.needsReauthorization) {
          setState({
            kind: 'needs-reauth',
            message:
              data.playbackMessage ??
              'Reconnect Spotify to enable playback — your connection was made before playback permissions were added.',
          })
          return
        }
        if (!data.isPremium) {
          setState({
            kind: 'free',
            message:
              data.playbackMessage ??
              'In-browser playback needs Spotify Premium. That is Spotify’s rule, not ours.',
            displayName: data.displayName ?? null,
          })
          return
        }
        setState({ kind: 'ready', displayName: data.displayName ?? null })
      } catch {
        if (!cancelled) setState({ kind: 'disconnected' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Per-user volume. Local to this listener — there is no room volume.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100
  }, [volume])

  const nowPlaying = useMemo(() => queue[0] ?? null, [queue])

  const playPreview = useCallback((track: QueueTrack) => {
    if (!track.previewUrl) return
    if (audioRef.current) {
      audioRef.current.pause()
    }
    const audio = new Audio(track.previewUrl)
    audio.volume = 0.6
    audioRef.current = audio
    void audio.play().catch(() => undefined)
    setPreviewTrackId(track.id)
    audio.addEventListener('ended', () => setPreviewTrackId(null))
  }, [])

  useEffect(
    () => () => {
      audioRef.current?.pause()
    },
    [],
  )

  /* ── Collapsed strip ─────────────────────────────────────────────────── */

  if (!expanded) {
    return (
      <div className="af-dm af-dm--collapsed" data-state={state.kind}>
        <span className="af-dm-mark" aria-hidden="true">
          ♫
        </span>
        <span className="af-dm-collapsed-text">
          {state.kind === 'loading'
            ? 'Checking Spotify…'
            : state.kind === 'disconnected'
              ? 'Music — not connected'
              : state.kind === 'needs-reauth'
                ? 'Music — reconnect needed'
                : nowPlaying
                  ? `${nowPlaying.trackName} · ${nowPlaying.artistName}`
                  : 'Music — queue is empty'}
        </span>
        {state.kind === 'free' ? <span className="af-dm-badge">Previews only</span> : null}
        <button type="button" className="af-dm-expand" onClick={() => setExpanded(true)}>
          Open
        </button>
      </div>
    )
  }

  /* ── Full widget ─────────────────────────────────────────────────────── */

  return (
    <section className="af-dm" data-state={state.kind} aria-label="Draft room music">
      <header className="af-dm-head">
        <span className="af-dm-mark" aria-hidden="true">
          ♫
        </span>
        <div className="af-dm-head-text">
          <h3 className="af-dm-title">Draft room music</h3>
          <p className="af-dm-playlist">{playlistName ?? 'Shared queue'}</p>
        </div>
        {variant === 'collapsed' ? (
          <button type="button" className="af-dm-expand" onClick={() => setExpanded(false)}>
            Close
          </button>
        ) : null}
      </header>

      {/*
        ⚠ THE SHARED-QUEUE / SEPARATE-AUDIO SENTENCE IS PERMANENT UI, NOT A
        TOOLTIP. It is the single most misunderstood thing about this widget.
      */}
      <p className="af-dm-truth">
        Everyone in the room shares the queue. Everyone plays it on their own Spotify — the audio
        is not synchronised, and nothing here streams from AllFantasy.
      </p>

      {state.kind === 'loading' ? <p className="af-dm-msg">Checking your Spotify connection…</p> : null}

      {state.kind === 'disconnected' ? (
        <div className="af-dm-connect">
          <p className="af-dm-msg">
            Connect Spotify to play the room&apos;s queue on your own account.
          </p>
          <ul className="af-dm-scopes">
            <li className="af-dm-scope af-dm-scope--yes">Playback control on your devices</li>
            <li className="af-dm-scope af-dm-scope--yes">The playlist this room uses</li>
            <li className="af-dm-scope af-dm-scope--no">Never your library or listening history</li>
          </ul>
          <a className="af-dm-btn" href="/api/auth/spotify">
            Connect Spotify
          </a>
        </div>
      ) : null}

      {state.kind === 'needs-reauth' ? (
        <div className="af-dm-connect">
          <p className="af-dm-msg">{state.message}</p>
          <a className="af-dm-btn" href="/api/auth/spotify">
            Reconnect Spotify
          </a>
        </div>
      ) : null}

      {state.kind === 'free' ? (
        <div className="af-dm-free">
          <p className="af-dm-msg">
            {state.message} You can still play <strong>30-second previews</strong> of anything in
            the queue, and open any track in Spotify to hear it in full.
          </p>
          <div className="af-dm-free-actions">
            <button
              type="button"
              className="af-dm-btn af-dm-btn--ghost"
              disabled={!nowPlaying?.previewUrl}
              onClick={() => nowPlaying && playPreview(nowPlaying)}
            >
              {nowPlaying?.previewUrl
                ? previewTrackId === nowPlaying.id
                  ? 'Playing preview…'
                  : 'Play preview'
                : 'No preview for this track'}
            </button>
            {nowPlaying ? (
              <a
                className="af-dm-btn af-dm-btn--ghost"
                href={`https://open.spotify.com/track/${nowPlaying.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Spotify ↗
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.kind === 'ready' && nowPlaying ? (
        <div className="af-dm-now">
          <div className="af-dm-art" aria-hidden="true">
            {nowPlaying.albumArt ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={nowPlaying.albumArt} alt="" width={56} height={56} />
            ) : (
              <span>♫</span>
            )}
          </div>
          <div className="af-dm-now-text">
            <span className="af-dm-track">{nowPlaying.trackName}</span>
            <span className="af-dm-artist">{nowPlaying.artistName}</span>
          </div>
          <div className="af-dm-transport">
            <button type="button" className="af-dm-tbtn" aria-label="Previous track">
              ⏮
            </button>
            <button
              type="button"
              className="af-dm-tbtn af-dm-tbtn--main"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <button type="button" className="af-dm-tbtn" aria-label="Next track">
              ⏭
            </button>
          </div>
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <div className="af-dm-scrub">
            <span className="af-dm-time">0:00</span>
            <div className="af-dm-scrub-track" role="presentation">
              <div className="af-dm-scrub-fill" style={{ width: playing ? '32%' : '0%' }} />
            </div>
            <span className="af-dm-time">{fmt(nowPlaying?.durationMs ?? 0)}</span>
          </div>

          <label className="af-dm-vol">
            {/* Per-user, always. There is no room volume to set. */}
            <span className="af-dm-vol-label">Your volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Your volume"
            />
            <span className="af-dm-vol-val">{volume}</span>
          </label>
        </>
      ) : null}

      {/* ── The shared queue ─────────────────────────────────────────── */}
      <div className="af-dm-queue">
        <div className="af-dm-queue-head">
          <span className="af-dm-queue-title">Up next</span>
          <span className="af-dm-queue-count">{queue.length}</span>
        </div>
        {queuePending ? (
          <p className="af-dm-pending">
            The shared queue needs a table that is written but not yet applied — see{' '}
            <code>prisma/migrations/20260823130000_draft_room_music_queue</code>. Adding a track is
            disabled rather than accepting something that would be dropped.
          </p>
        ) : queue.length > 1 ? (
          <ul className="af-dm-queue-list">
            {queue.slice(1).map((t) => (
              <li key={t.id} className="af-dm-queue-row">
                <span className="af-dm-queue-track">{t.trackName}</span>
                <span className="af-dm-queue-artist">{t.artistName}</span>
                <span className="af-dm-queue-by">added by {t.addedByName}</span>
                <span className="af-dm-queue-dur">{fmt(t.durationMs)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="af-dm-msg">Nothing queued yet. Anyone in the room can add a track.</p>
        )}
        <button type="button" className="af-dm-btn af-dm-btn--ghost" disabled={queuePending}>
          Add a track
        </button>
      </div>
    </section>
  )
}

export default DraftMusicWidget
