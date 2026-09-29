'use client'

import { useEffect, useRef, useState } from 'react'
import { X, SkipForward } from 'lucide-react'

type Props = {
  leagueId: string
  tournamentId: string
  tournamentName: string
  /**
   * Override the default `/videos/tournament-intro.mp4`. Useful when a
   * tournament has its own branded intro stored elsewhere (e.g. a CDN).
   */
  videoSrc?: string
  /** Optional poster shown before the video starts. */
  posterSrc?: string
}

const DEFAULT_VIDEO_SRC = '/videos/tournament-intro.mp4'
const DEFAULT_POSTER_SRC = '/videos/tournament-intro-poster.jpg'

/** Compute the storage key — scoped per (user-context, tournament, league). */
function storageKey(tournamentId: string, leagueId: string): string {
  return `af.tournamentIntroSeen.${tournamentId}.${leagueId}`
}

function hasSeenIntro(tournamentId: string, leagueId: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    // localStorage so the gate survives across tabs and reloads — matches the
    // intent of "loads once when users go into the league but not again after".
    return Boolean(window.localStorage.getItem(storageKey(tournamentId, leagueId)))
  } catch {
    return true
  }
}

function markIntroSeen(tournamentId: string, leagueId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(tournamentId, leagueId), String(Date.now()))
  } catch {
    /* private mode / quota — best-effort */
  }
}

/**
 * Full-viewport intro video that plays exactly once per user per league. Once
 * the user dismisses or the video ends, we mark it seen in localStorage and
 * the overlay never re-mounts for that (tournamentId, leagueId) pair.
 *
 * Designed to be a no-op in two cases:
 *   1. The user has already seen the intro (gate fires on mount).
 *   2. The video asset 404s — we silently dismiss instead of trapping the user
 *      behind a broken player.
 */
export function TournamentIntroVideoOverlay({
  leagueId,
  tournamentId,
  tournamentName,
  videoSrc = DEFAULT_VIDEO_SRC,
  posterSrc = DEFAULT_POSTER_SRC,
}: Props) {
  const [open, setOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (hasSeenIntro(tournamentId, leagueId)) return
    setOpen(true)
  }, [tournamentId, leagueId])

  // ESC closes the overlay (still marks as seen).
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Try to start playback as soon as the overlay mounts. Browsers block
  // unmuted autoplay, so the <video> is muted and we surface a small "tap to
  // unmute" hint after the user interacts.
  useEffect(() => {
    if (!open) return
    const v = videoRef.current
    if (!v) return
    v.muted = true
    v.play().catch(() => {
      // Autoplay was blocked entirely — the controls overlay still lets the
      // user start playback manually, so we don't error out.
    })
  }, [open])

  function dismiss() {
    markIntroSeen(tournamentId, leagueId)
    setOpen(false)
  }

  function handleEnded() {
    dismiss()
  }

  function handleError() {
    // Asset missing or codec unsupported — don't trap the user.
    dismiss()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={`${tournamentName} intro video`}
      data-testid="tournament-intro-overlay"
    >
      <div className="relative w-full max-w-5xl px-4">
        <div className="flex items-center justify-between pb-2 text-white/85">
          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
            Welcome to {tournamentName}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                videoRef.current?.pause()
                dismiss()
              }}
              className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/10"
              data-testid="tournament-intro-skip"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip intro
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close intro"
              className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/65 hover:bg-white/10"
              data-testid="tournament-intro-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <video
          ref={videoRef}
          src={videoSrc}
          poster={posterSrc}
          autoPlay
          muted
          playsInline
          controls
          onEnded={handleEnded}
          onError={handleError}
          className="aspect-video w-full rounded-xl border border-white/15 bg-black shadow-2xl"
          data-testid="tournament-intro-video"
        />
        <p className="pt-2 text-center text-[11px] text-white/45">
          This intro plays once. Skip or wait for it to finish — it won&apos;t show again.
        </p>
      </div>
    </div>
  )
}
