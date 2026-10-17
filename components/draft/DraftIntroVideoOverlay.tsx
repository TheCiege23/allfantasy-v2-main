'use client'

import { SkipForward, X } from 'lucide-react'

type DraftIntroVideoOverlayProps = {
  open: boolean
  draftTypeLabel: string
  videoSrc: string
  posterSrc?: string | null
  onDismiss: () => void
}

export function DraftIntroVideoOverlay({
  open,
  draftTypeLabel,
  videoSrc,
  posterSrc = null,
  onDismiss,
}: DraftIntroVideoOverlayProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[85] flex flex-col items-center justify-center bg-black/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={`${draftTypeLabel} draft intro video`}
      data-testid="draft-intro-overlay"
    >
      <div className="relative w-full max-w-5xl px-4">
        <div className="flex items-center justify-between pb-2 text-white/85">
          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">
            Draft Room: {draftTypeLabel}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/10"
              data-testid="draft-intro-skip"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip intro
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close draft intro"
              className="rounded-lg border border-white/20 bg-white/5 p-1.5 text-white/65 hover:bg-white/10"
              data-testid="draft-intro-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <video
          src={videoSrc}
          poster={posterSrc ?? undefined}
          autoPlay
          muted
          playsInline
          controls
          onEnded={onDismiss}
          onError={onDismiss}
          className="aspect-video w-full rounded-xl border border-white/15 bg-black shadow-2xl"
          data-testid="draft-intro-video"
        />
        <p className="pt-2 text-center text-[11px] text-white/45">
          This intro plays once per draft room session.
        </p>
      </div>
    </div>
  )
}
