'use client'

import { useState, useEffect, useCallback } from 'react'
import { firstEntryIntroStorageKey } from '@/lib/league/post-create-welcome'

const VIDEO_SRC = '/guillotine/Guillotine.mp4'

export interface GuillotineFirstEntryModalProps {
  leagueId: string
  /** When true, show modal (e.g. first entry). When false, never show. */
  show: boolean
  onClose: () => void
  /** Allow replay even after seen (e.g. from a "Watch again" link). */
  forceReplay?: boolean
}

export function GuillotineFirstEntryModal({
  leagueId,
  show,
  onClose,
  forceReplay = false,
}: GuillotineFirstEntryModalProps) {
  const [visible, setVisible] = useState(false)
  const [videoKey, setVideoKey] = useState(0)

  const markSeen = useCallback(() => {
    if (typeof window !== 'undefined' && leagueId) {
      try {
        window.localStorage.setItem(firstEntryIntroStorageKey('guillotine', leagueId, ''), '1')
      } catch {}
    }
  }, [leagueId])

  const handleSkip = useCallback(() => {
    markSeen()
    setVisible(false)
    onClose()
  }, [markSeen, onClose])

  const handleReplay = useCallback(() => {
    setVideoKey((k) => k + 1)
  }, [])

  const handleVideoEnded = useCallback(() => {
    markSeen()
    setVisible(false)
    onClose()
  }, [markSeen, onClose])

  useEffect(() => {
    if (!show || !leagueId) {
      setVisible(false)
      return
    }
    if (forceReplay) {
      setVisible(true)
      return
    }
    try {
      const seen = typeof window !== 'undefined' && window.localStorage.getItem(firstEntryIntroStorageKey('guillotine', leagueId, ''))
      setVisible(!seen)
    } catch {
      setVisible(true)
    }
  }, [show, leagueId, forceReplay])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Guillotine League intro"
    >
      <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden bg-black shadow-2xl">
        <video
          key={videoKey}
          className="w-full aspect-video"
          src={VIDEO_SRC}
          controls
          autoPlay
          playsInline
          onEnded={handleVideoEnded}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white/[0.06]">
          <button
            type="button"
            onClick={handleReplay}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
          >
            Replay
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-lg bg-cyan-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
