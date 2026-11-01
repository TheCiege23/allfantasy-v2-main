'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { firstEntryIntroStorageKey } from '@/lib/league/post-create-welcome'

const VIDEO_SRC = '/media/create-league/concept/videos/Guillotine.mp4'

/**
 * This modal covers the whole league page, and it used to close itself ONLY on the video's `ended`
 * event. Android in-app browsers (an invite opened from Messages, Discord, Gmail…) and Chrome with
 * data/battery saver block muted autoplay, so `ended` never fired and invitees were left under a
 * full-screen layer — "frozen, can't even enter the draft". So: if playback has not started soon
 * after opening, get out of the way; and never stay up longer than the clip (~6s) plus slack.
 */
const PLAYBACK_START_GRACE_MS = 4000
const MAX_VISIBLE_MS = 20000

/** Seen-state for browsers where localStorage throws (WebViews with DOM storage off). */
const seenThisPageLoad = new Set<string>()

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
  const [failed, setFailed] = useState(false)
  const [muted, setMuted] = useState(true)
  const [started, setStarted] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const markSeen = useCallback(() => {
    if (!leagueId) return
    seenThisPageLoad.add(leagueId)
    try {
      window.localStorage.setItem(firstEntryIntroStorageKey('guillotine', leagueId, ''), '1')
    } catch {}
  }, [leagueId])

  const dismiss = useCallback(() => {
    markSeen()
    setVisible(false)
    onClose()
  }, [markSeen, onClose])

  const handleReplay = useCallback(() => {
    setFailed(false)
    setStarted(false)
    setVideoKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!show || !leagueId) {
      setVisible(false)
      return
    }
    if (forceReplay) {
      setVisible(true)
      return
    }
    if (seenThisPageLoad.has(leagueId)) {
      setVisible(false)
      return
    }
    try {
      setVisible(!window.localStorage.getItem(firstEntryIntroStorageKey('guillotine', leagueId, '')))
    } catch {
      setVisible(true)
    }
  }, [show, leagueId, forceReplay])

  // Autoplay blocked → nothing will ever end the video. Leave rather than trap the page.
  useEffect(() => {
    if (!visible || started || failed) return
    const timer = setTimeout(dismiss, PLAYBACK_START_GRACE_MS)
    return () => clearTimeout(timer)
  }, [visible, started, failed, videoKey, dismiss])

  // Hard ceiling, whatever the video does (stalls, buffering forever on a weak connection).
  useEffect(() => {
    if (!visible || forceReplay) return
    const timer = setTimeout(dismiss, MAX_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [visible, forceReplay, videoKey, dismiss])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, dismiss])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Guilly League intro"
      onClick={(e) => {
        // A tap on the dark backdrop (not the card) is a way out too.
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Close intro and enter league"
        className="fixed right-3 top-3 z-[101] flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        data-testid="guillotine-intro-close"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
      <div className="flex min-h-full items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) dismiss() }}>
        <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-black shadow-2xl">
          {failed ? (
            <p role="status" className="p-6 text-center text-sm text-white">The intro could not load. Retry or enter your league below.</p>
          ) : (
            <video
              ref={videoRef}
              key={videoKey}
              className="mx-auto block max-h-[60vh] w-full object-contain"
              src={VIDEO_SRC}
              controls
              autoPlay
              muted={muted}
              onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
              preload="metadata"
              playsInline
              onPlaying={() => setStarted(true)}
              onEnded={dismiss}
              onError={() => setFailed(true)}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.06] p-4">
            {!failed && muted ? (
              <button
                type="button"
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white"
                onClick={() => {
                  setMuted(false)
                  if (videoRef.current) {
                    videoRef.current.muted = false
                    void videoRef.current.play()?.catch(() => undefined)
                  }
                }}
              >
                Tap for sound
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleReplay}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
            >
              Replay
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg bg-cyan-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
              data-testid="guillotine-intro-enter"
            >
              Enter league
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
