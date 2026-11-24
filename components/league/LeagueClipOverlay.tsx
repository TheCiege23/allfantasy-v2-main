'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export type LeagueClipPayload = {
  id: string
  clipUrl: string
  clipType: string
  title?: string
  durationMs?: number
  reducedMotion?: boolean
  displayMode?: 'fullscreen' | 'inline'
  /** Visual accent for concept leagues */
  accent?: 'zombie' | 'survivor'
  /** One line saying what happened, under the title. A card moment's main text. */
  detail?: string
  /** A card moment's big icon (an emoji). */
  icon?: string
  /** A card moment's motion: `mauling` shakes, `bomb` flashes, `weapon` pops (see app/globals.css). */
  anim?: string
}

const CARD_ANIM: Record<string, string> = { mauling: 'mauling-anim', bomb: 'bomb-anim', weapon: 'weapon-pop-anim' }

type Props = {
  open: boolean
  payload: LeagueClipPayload | null
  onClose: () => void
}

export function LeagueClipOverlay({ open, payload, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open || !payload) return
    const ms = Math.min(Math.max(payload.durationMs ?? 12_000, 4000), 120_000)
    if (payload.reducedMotion) {
      closeTimer.current = setTimeout(onClose, Math.min(ms, 8000))
      return () => {
        if (closeTimer.current) clearTimeout(closeTimer.current)
      }
    }
    closeTimer.current = setTimeout(onClose, ms)
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [open, payload, onClose])

  useEffect(() => {
    if (!open || !payload?.reducedMotion) return
    const v = videoRef.current
    if (v) {
      v.pause()
    }
  }, [open, payload])

  if (!open || !payload) return null

  const isVideo = payload.clipType === 'video' && !payload.reducedMotion
  const isImage = payload.clipType === 'image' && !payload.reducedMotion
  // A moment with no video file: drawn here. Reduced motion still shows it — the classes switch their motion off.
  const isCard = payload.clipType === 'card'
  const accent =
    payload.accent === 'survivor'
      ? 'border-amber-500/25 shadow-amber-900/20'
      : payload.accent === 'zombie'
        ? 'border-violet-500/25 shadow-violet-900/25'
        : 'border-white/12 shadow-black/40'

  const shell =
    payload.displayMode === 'inline'
      // Clear of the phone's bottom tab bar (~64px plus the home indicator); the desktop corner as before.
      ? 'fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-[96] w-[min(100vw-1.5rem,420px)] max-h-[min(72vh,520px)] sm:bottom-6 sm:right-6'
      : 'fixed inset-0 z-[96] flex items-center justify-center p-4 sm:p-8'

  return (
    <div className={shell} role="dialog" aria-modal="true" aria-label={payload.title ?? 'League moment'}>
      <button
        type="button"
        className={
          payload.displayMode === 'inline'
            ? 'pointer-events-none absolute inset-0 z-0 bg-transparent'
            : 'absolute inset-0 z-0 bg-black/82 backdrop-blur-[2px]'
        }
        aria-hidden={payload.displayMode === 'inline'}
        tabIndex={payload.displayMode === 'inline' ? -1 : 0}
        onClick={payload.displayMode === 'inline' ? undefined : onClose}
      />

      <div
        className={`relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-2xl border bg-[#070b18] shadow-2xl ${accent} ${
          payload.displayMode === 'inline' ? '' : 'max-w-4xl'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <p className="truncate text-sm font-semibold text-white/90">{payload.title ?? 'League moment'}</p>
          <button
            type="button"
            data-testid="league-clip-overlay-close"
            onClick={onClose}
            className="inline-flex h-10 min-w-[40px] shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] text-white/85 hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40">
          {isCard ? (
            <div
              data-testid="league-clip-card"
              className={`flex w-full flex-col items-center gap-3 px-6 text-center ${payload.displayMode === 'inline' ? 'py-8' : 'py-16'} ${CARD_ANIM[payload.anim ?? ''] ?? ''}`}
            >
              <span aria-hidden className={`leading-none ${payload.displayMode === 'inline' ? 'text-5xl' : 'text-7xl'} ${payload.anim === 'weapon' ? 'weapon-pop-anim' : ''}`}>
                {payload.icon ?? '🧟'}
              </span>
              <p className={`font-extrabold text-white ${payload.displayMode === 'inline' ? 'text-xl' : 'text-3xl'}`}>{payload.title ?? 'League moment'}</p>
              {payload.detail ? <p className="max-w-md text-base text-white/80">{payload.detail}</p> : null}
            </div>
          ) : payload.reducedMotion ? (
            <p className="px-6 py-16 text-center text-sm text-white/70">
              Motion reduced — showing title only. {payload.title ? ` ${payload.title}` : ''}
            </p>
          ) : isVideo ? (
            <video
              ref={videoRef}
              className="max-h-[min(72vh,560px)] w-full object-contain"
              src={payload.clipUrl}
              autoPlay
              muted
              playsInline
              controls={false}
            />
          ) : isImage ? (
            <img
              src={payload.clipUrl}
              alt={payload.title ?? ''}
              className="max-h-[min(72vh,560px)] w-full object-contain"
            />
          ) : (
            <p className="px-6 py-12 text-sm text-white/60">Unsupported clip type.</p>
          )}
        </div>
        {!isCard && payload.detail ? (
          <p data-testid="league-clip-detail" className="border-t border-white/[0.08] px-4 py-3 text-center text-sm text-white/80">{payload.detail}</p>
        ) : null}
      </div>
    </div>
  )
}
