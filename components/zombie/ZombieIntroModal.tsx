'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getZombieTheme } from '@/lib/zombie/zombieBackgroundThemes'

const ZOMBIE_INTRO_VIDEO = '/league-type-zombie-intro.mp4'
const STORAGE_PREFIX = 'af_zombie_intro_seen_'

export interface ZombieIntroModalProps {
  leagueId: string
  userId: string
  leagueName: string
  backgroundTheme?: string | null
  enabled: boolean
  onClose: () => void
  forceReplay?: boolean
}

export function ZombieIntroModal({
  leagueId,
  userId,
  leagueName,
  backgroundTheme,
  enabled,
  onClose,
  forceReplay = false,
}: ZombieIntroModalProps) {
  const [visible, setVisible] = useState(false)
  const [videoKey, setVideoKey] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)

  const storageKey = `${STORAGE_PREFIX}${leagueId}_${userId}`
  const theme = getZombieTheme(backgroundTheme)

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

  const handleVideoEnded = useCallback(() => {
    handleDismiss()
  }, [handleDismiss])

  useEffect(() => {
    if (!enabled) {
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

  const backgroundClass = theme?.gradientClass || 'bg-gradient-to-br from-slate-900 via-red-900 to-black'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 backdrop-blur-lg"
      role="dialog"
      aria-modal="true"
      aria-label="Zombie League intro"
    >
      <div className={`relative w-full max-w-3xl overflow-hidden rounded-2xl border border-red-900/50 shadow-2xl`}>
        {/* Background gradient */}
        <div className={`absolute inset-0 ${backgroundClass} opacity-90`} />

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute -top-10 right-0 flex items-center gap-1.5 rounded-full border border-red-900/50 bg-red-950/60 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900 transition z-10"
        >
          <X className="h-3.5 w-3.5" /> Skip Intro
        </button>

        {/* Content */}
        <div className="relative z-10 flex flex-col">
          {/* Header with title and tagline */}
          <div className="border-b border-red-900/30 bg-black/50 backdrop-blur-sm px-6 py-4">
            <div className="text-xs uppercase tracking-[0.2em] text-red-400/80 mb-1">Welcome to</div>
            <h2 className="text-2xl font-black text-red-100">{leagueName}</h2>
            <p className="mt-2 text-sm text-red-100/70">Rise from your grave and dominate the undead arena</p>
          </div>

          {/* Video player */}
          <div className="aspect-video bg-black overflow-hidden">
            {!videoFailed ? (
              <video
                key={videoKey}
                className="w-full h-full object-cover"
                src={ZOMBIE_INTRO_VIDEO}
                autoPlay
                muted
                onEnded={handleVideoEnded}
                onError={() => setVideoFailed(true)}
                controls={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-center px-6">
                <div>
                  <p className="text-red-300 font-semibold mb-2">Welcome to the Zombie League</p>
                  <p className="text-red-100/70 text-sm mb-4">Intro video unavailable. Continue to join the horde.</p>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="px-4 py-2 rounded-lg bg-red-900/40 border border-red-700 text-red-200 hover:bg-red-900/60 transition text-sm font-medium"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          {videoFailed && (
            <div className="border-t border-red-900/30 bg-black/50 backdrop-blur-sm px-6 py-4 flex justify-end">
              <button
                type="button"
                onClick={handleDismiss}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-red-700 to-red-900 text-red-50 hover:from-red-600 hover:to-red-800 transition font-semibold text-sm"
              >
                Enter League
              </button>
            </div>
          )}
        </div>

        {/* Mobile tap hint */}
        <div className="absolute bottom-4 left-4 right-4 z-20 text-center md:hidden">
          <p className="text-[11px] text-red-200/50">Tap anywhere to dismiss</p>
        </div>
      </div>
    </div>
  )
}
