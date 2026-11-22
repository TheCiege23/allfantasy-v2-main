'use client'

import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface LeagueIntroVideoModalProps {
  leagueId: string
  leagueType: string
  leagueName: string
  videoSrc: string
  posterSrc?: string
  onDismiss: () => void
}

const DISMISSED_KEY_PREFIX = 'af_league_intro_seen_'

/**
 * Full-screen intro video modal shown once when entering a league.
 * Uses localStorage to track whether the user has already seen it.
 */
export function LeagueIntroVideoModal({
  leagueId,
  leagueType,
  leagueName,
  videoSrc,
  posterSrc,
  onDismiss,
}: LeagueIntroVideoModalProps) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const key = `${DISMISSED_KEY_PREFIX}${leagueId}`
    if (!localStorage.getItem(key)) {
      setShow(true)
    }
  }, [leagueId])

  const dismiss = useCallback(() => {
    localStorage.setItem(`${DISMISSED_KEY_PREFIX}${leagueId}`, '1')
    setShow(false)
    onDismiss()
  }, [leagueId, onDismiss])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="relative w-full max-w-4xl mx-4">
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute -top-10 right-0 flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white transition z-10"
        >
          <X className="h-3.5 w-3.5" /> Skip Intro
        </button>

        {/* League name overlay */}
        <div className="absolute top-4 left-4 z-10">
          <div className="text-xs uppercase tracking-[0.2em] text-white/40 mb-1">Welcome to</div>
          <div className="text-xl font-bold text-white drop-shadow-lg">{leagueName}</div>
          <div className="text-xs text-white/50 mt-1 capitalize">{leagueType.replace(/_/g, ' ')} League</div>
        </div>

        {/* Video player */}
        <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
          <video
            src={videoSrc}
            poster={posterSrc}
            autoPlay
            playsInline
            onEnded={dismiss}
            className="w-full aspect-video bg-black"
            controls={false}
          />
        </div>

        {/* Tap to dismiss on mobile */}
        <button
          onClick={dismiss}
          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm text-white/60 hover:bg-white/10 transition"
        >
          Enter League
        </button>
      </div>
    </div>
  )
}

