'use client'

/**
 * D.6 — War Room as a Sleeper-style floating popup (bottom-right) instead of
 * a fixed left column. Replaces the legacy `teamPanel` aside placement.
 *
 * Behavior:
 *   - Closed: renders a small circular button bottom-right with the AF crest +
 *     optional notification badge dot when AI/War Room has fresh recommendations.
 *   - Open (desktop): renders a docked panel anchored to the bottom-right corner,
 *     ~360px wide × ~520px tall, with the existing DraftTeamPanel content inside.
 *   - Open (mobile): renders as a bottom sheet covering the lower 80% of the
 *     viewport so the player table stays visible above.
 *   - Click outside closes; ESC closes; click again on the trigger toggles.
 *
 * Notification badge logic is a pure prop (`hasNewIntel`). The parent decides
 * when to set it (e.g. when an AI recommendation arrives) and clears it on open.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export interface WarRoomPopupProps {
  /** Content to render inside the popup body — typically <DraftTeamPanel /> + recommendations. */
  children: ReactNode
  /** When true, the trigger button shows a pulsing amber dot (Sleeper-style notification). */
  hasNewIntel?: boolean
  /** Optional label used by screen readers + tooltip. */
  triggerLabel?: string
  /** When true, the popup mounts open at first paint (used for smoke / e2e). */
  defaultOpen?: boolean
  /** Test id base — defaults to 'war-room-popup'. */
  testIdBase?: string
  /**
   * Anchor for the floating trigger + desktop panel so we do not stack on the queue rail (right).
   * Defaults to bottom-right (legacy Sleeper-style).
   */
  triggerPosition?: 'bottom-right' | 'bottom-left'
}

const POPUP_OPEN_PREF_KEY = 'af:draft-warroom-popup-open'

export function WarRoomPopup({
  children,
  hasNewIntel = false,
  triggerLabel = 'War Room',
  defaultOpen = false,
  testIdBase = 'war-room-popup',
  triggerPosition = 'bottom-right',
}: WarRoomPopupProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [acknowledgedIntel, setAcknowledgedIntel] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Persist open state across reloads.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(POPUP_OPEN_PREF_KEY)
      if (v === '1') setOpen(true)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(POPUP_OPEN_PREF_KEY, open ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (open) setAcknowledgedIntel(true)
  }, [open])

  // Click-outside closes.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const showBadge = hasNewIntel && !acknowledgedIntel && !open

  const triggerCorner =
    triggerPosition === 'bottom-left'
      ? 'bottom-4 left-4'
      : 'bottom-4 right-4'
  const panelCorner =
    triggerPosition === 'bottom-left'
      ? 'sm:bottom-20 sm:left-4 sm:right-auto'
      : 'sm:bottom-20 sm:right-4 sm:left-auto'

  return (
    <>
      {/* Trigger button — fixed corner. Sized at 56px (touch-friendly). */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? `Close ${triggerLabel}` : `Open ${triggerLabel}`}
        title={triggerLabel}
        data-testid={`${testIdBase}-trigger`}
        data-trigger-position={triggerPosition}
        data-open={open ? 'true' : 'false'}
        data-has-new-intel={showBadge ? 'true' : 'false'}
        className={`fixed ${triggerCorner} z-[60] inline-flex h-11 w-11 sm:h-14 sm:w-14 items-center justify-center rounded-full border-2 shadow-2xl shadow-black/50 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
          open
            ? 'border-cyan-400/55 bg-gradient-to-br from-cyan-500/30 to-violet-600/25 text-cyan-50'
            : 'border-white/20 bg-[linear-gradient(150deg,#0a1228_0%,#101a34_100%)] text-white/85 hover:border-cyan-400/35 hover:text-cyan-100'
        }`}
      >
        {/* AF crest — simple wordmark; replace with logo image when assets land. */}
        <span className="text-[11px] font-extrabold tracking-tighter">AF</span>
        {/* Notification badge — pulsing amber dot when fresh intel is waiting. */}
        {showBadge ? (
          <span
            aria-hidden
            data-testid={`${testIdBase}-badge`}
            className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300/70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-300 ring-2 ring-[#040915]" />
          </span>
        ) : null}
      </button>

      {/* Popup panel — fixed, anchored bottom-right on desktop; bottom sheet on mobile. */}
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={triggerLabel}
          data-testid={testIdBase}
          className={`fixed inset-x-0 bottom-0 z-[55] flex h-[80vh] flex-col overflow-hidden border-t border-cyan-400/20 bg-[linear-gradient(180deg,#0a1228_0%,#060f20_100%)] shadow-2xl shadow-black/60 sm:inset-x-auto sm:h-[min(560px,80vh)] sm:w-[min(380px,calc(100vw-2rem))] sm:rounded-xl sm:border ${panelCorner}`}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-cyan-400/15 bg-[linear-gradient(90deg,rgba(8,18,40,0.95),rgba(6,14,30,0.92))] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-cyan-400/35 bg-gradient-to-br from-cyan-500/25 to-violet-600/20 text-[10px] font-extrabold text-cyan-50">
                AF
              </span>
              <div className="flex flex-col leading-tight">
                <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/90">
                  {triggerLabel}
                </span>
                <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-cyan-200/70">Command Center</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={`Close ${triggerLabel}`}
              data-testid={`${testIdBase}-close`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/30 text-white/70 hover:border-white/25 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div
            data-testid={`${testIdBase}-body`}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {children}
          </div>
        </div>
      ) : null}
    </>
  )
}
