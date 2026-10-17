'use client'

import { useEffect, useRef, useState } from 'react'
import { SkipForward, Volume2, X } from 'lucide-react'

type ConceptIntroVideoOverlayProps = {
  open: boolean
  conceptLabel: string
  videoSrc: string
  posterSrc?: string | null
  onDismiss: () => void
  /** The clip could not load. Defaults to `onDismiss`; the intro gate closes WITHOUT marking seen. */
  onError?: () => void
}

export function ConceptIntroVideoOverlay({
  open,
  conceptLabel,
  videoSrc,
  posterSrc = null,
  onDismiss,
  onError,
}: ConceptIntroVideoOverlayProps) {
  const [reducedMotion, setReducedMotion] = useState(false)
  // Autoplay only works muted, so the clip starts silent; say so and offer sound in one tap.
  const [muted, setMuted] = useState(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const skipRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    setMuted(true)
    skipRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(query.matches)

    const update = () => setReducedMotion(query.matches)
    query.addEventListener?.('change', update)
    return () => {
      query.removeEventListener?.('change', update)
    }
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={`${conceptLabel} intro video`}
      data-testid="concept-intro-overlay"
    >
      <div className="relative w-full max-w-5xl px-4">
        {/* Literal colours: the light-mode readable clamp darkens text-white*, and this sits on black. */}
        <div className="flex items-center justify-between pb-2 text-[rgba(255,255,255,0.85)]">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[rgba(103,232,249,0.8)]">
            Welcome to {conceptLabel}
          </p>
          <div className="flex items-center gap-2">
            <button
              ref={skipRef}
              type="button"
              onClick={onDismiss}
              className="flex min-h-11 items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] px-3 py-1.5 text-[12px] font-semibold text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.1)]"
              data-testid="concept-intro-skip"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip intro
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close intro"
              className="grid h-11 w-11 place-items-center rounded-lg border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.1)]"
              data-testid="concept-intro-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {reducedMotion ? (
          <div
            className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-black shadow-2xl"
            data-testid="concept-intro-reduced-motion"
          >
            {posterSrc ? (
              <img src={posterSrc} alt="" className="h-full w-full object-cover opacity-80" />
            ) : (
              <div className="px-6 text-center text-sm font-semibold text-[rgba(255,255,255,0.7)]">
                Intro preview is paused because reduced motion is enabled.
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            <video
              ref={videoRef}
              src={videoSrc}
              poster={posterSrc ?? undefined}
              autoPlay
              muted={muted}
              playsInline
              controls
              onEnded={onDismiss}
              onError={onError ?? onDismiss}
              onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
              className="aspect-video w-full rounded-xl border border-[rgba(255,255,255,0.15)] bg-black shadow-2xl"
              data-testid="concept-intro-video"
            />
            {muted ? (
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current
                  setMuted(false)
                  if (video) {
                    video.muted = false
                    void video.play?.()?.catch?.(() => undefined)
                  }
                }}
                className="absolute left-3 top-3 flex min-h-11 items-center gap-2 rounded-full bg-[rgba(0,0,0,0.7)] px-4 text-[13px] font-bold text-[#ffffff] ring-1 ring-[rgba(255,255,255,0.3)]"
                data-testid="concept-intro-unmute"
              >
                <Volume2 className="h-4 w-4" aria-hidden />
                Tap for sound
              </button>
            ) : null}
          </div>
        )}
        <p className="pt-2 text-center text-[11px] text-[rgba(255,255,255,0.45)]">
          This intro plays once. Skip or replay it from League Home.
        </p>
      </div>
    </div>
  )
}
