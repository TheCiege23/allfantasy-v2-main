'use client'

import { useState, useEffect, useCallback } from 'react'
import { SURVIVOR_LEAGUE_INTRO_VIDEO } from '@/lib/survivor/constants'
import { SURVIVOR_ISLAND_TAGLINE, SURVIVOR_TIPS, SURVIVOR_WELCOME_BLURB } from '@/lib/survivor/survivorIslandContent'
import { getSurvivorThemeById } from '@/lib/survivor/survivorVisuals'
import { firstEntryIntroStorageKey } from '@/lib/league/post-create-welcome'


export interface SurvivorFirstEntryModalProps {
  leagueId: string
  userId: string
  /** When false, never evaluate visibility. */
  enabled: boolean
  onClose: () => void
  videoSrc?: string
  forceReplay?: boolean
  visualThemeId?: string | null
}

export function SurvivorFirstEntryModal({
  leagueId,
  userId,
  enabled,
  onClose,
  videoSrc = SURVIVOR_LEAGUE_INTRO_VIDEO,
  forceReplay = false,
  visualThemeId,
}: SurvivorFirstEntryModalProps) {
  const [visible, setVisible] = useState(false)
  const [videoKey, setVideoKey] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)

  const storageKey = firstEntryIntroStorageKey('survivor', leagueId, userId)
  const theme = getSurvivorThemeById(visualThemeId, leagueId)

  const markSeen = useCallback(() => {
    if (typeof window !== 'undefined' && leagueId && userId) {
      try {
        window.localStorage.setItem(storageKey, '1')
      } catch {
        /* ignore */
      }
    }
  }, [leagueId, userId, storageKey])

  const handleDismiss = useCallback(() => {
    markSeen()
    setVisible(false)
    onClose()
  }, [markSeen, onClose])

  const handleReplay = useCallback(() => {
    setVideoFailed(false)
    setVideoKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !leagueId || !userId) {
      setVisible(false)
      return
    }
    if (forceReplay) {
      setVisible(true)
      return
    }
    try {
      const seen = typeof window !== 'undefined' && window.localStorage.getItem(storageKey)
      setVisible(!seen)
    } catch {
      setVisible(true)
    }
  }, [enabled, leagueId, userId, storageKey, forceReplay])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Survivor League intro"
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-amber-500/25 bg-[#050a14] shadow-2xl">
        <div className={`absolute inset-0 ${theme.backgroundClass} opacity-95`} />
        <div className="relative border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 to-transparent px-4 py-3">
          <p className="text-[15px] font-bold text-amber-100">Welcome to the island</p>
          <p className="mt-1 text-[12px] leading-snug text-white/60">{SURVIVOR_ISLAND_TAGLINE}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-white/50">{SURVIVOR_WELCOME_BLURB}</p>
        </div>
        {!videoFailed ? (
          <video
            key={videoKey}
            className="aspect-video w-full bg-black"
            src={videoSrc}
            controls
            autoPlay
            muted
            playsInline
            onError={() => setVideoFailed(true)}
            onEnded={handleDismiss}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-[#030816] px-6 text-center text-sm text-white/65">
            Add your league intro video at{' '}
            <span className="mx-1 font-mono text-amber-200/90">public/survivor/Survivor League Intro.mp4</span> or set a
            custom URL in league settings.
          </div>
        )}
        <div className="relative max-h-[28vh] overflow-y-auto border-t border-white/[0.06] bg-[#040914]/90 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Quick tips</p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-white/55">
            {SURVIVOR_TIPS.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-amber-400/90" aria-hidden>
                  •
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-white/[0.04] p-4">
          <button
            type="button"
            onClick={handleReplay}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
          >
            Replay
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg bg-amber-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            data-testid="survivor-intro-continue"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
