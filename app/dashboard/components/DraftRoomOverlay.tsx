'use client'

import { useCallback, useEffect } from 'react'
import { Home, X } from 'lucide-react'

export type DraftRoomOverlayProps = {
  leagueId: string
  /** Resolved iframe URL — `/draft/...` or `/league/.../dispersal-draft/...?embed=1` */
  iframeSrc: string | null
  leagueName?: string | null
  /** While parent resolves draft session id */
  loading?: boolean
  errorMessage?: string | null
  onClose: () => void
  onHome: () => void
}

/**
 * Full-screen shell above `/dashboard` when launched from the embedded league iframe.
 * Uses `/draft/[id]` or dispersal route so existing app behavior stays authoritative.
 */
export function DraftRoomOverlay({
  leagueId,
  iframeSrc,
  leagueName,
  loading = false,
  errorMessage = null,
  onClose,
  onHome,
}: DraftRoomOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleHome = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onHome()
    },
    [onHome],
  )

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-[#040915]"
      role="dialog"
      aria-modal="true"
      aria-label="Draft room"
      data-testid="dashboard-draft-room-overlay"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] bg-[#050814] px-3 sm:px-4">
        <button
          type="button"
          onClick={handleHome}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white transition hover:bg-white/[0.07]"
          aria-label="Return to dashboard home"
          data-testid="dashboard-draft-overlay-home"
        >
          <Home className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-semibold text-white/90">Draft Room</p>
          {leagueName ? (
            <p className="truncate text-[11px] text-white/45">{leagueName}</p>
          ) : (
            <p className="truncate font-mono text-[10px] text-white/25">{leagueId}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white transition hover:bg-white/[0.07]"
          aria-label="Close draft room"
          data-testid="dashboard-draft-overlay-close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {errorMessage ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
            data-testid="dashboard-draft-overlay-error"
          >
            <p className="max-w-md text-sm text-white/75">{errorMessage}</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.1]"
            >
              Close
            </button>
          </div>
        ) : loading ? (
          <div
            className="flex h-full items-center justify-center text-sm text-white/45"
            data-testid="dashboard-draft-overlay-loading"
          >
            Opening draft…
          </div>
        ) : iframeSrc ? (
          <iframe title="Draft room" src={iframeSrc} className="h-full w-full border-0 bg-[#040915]" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/45">Nothing to display.</div>
        )}
      </div>
    </div>
  )
}
