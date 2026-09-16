'use client'

import { useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useOverlayContainment } from '@/components/core-app/useOverlayContainment'

/**
 * The phone breakpoint every /core stylesheet uses. One constant, so the sheet opens at exactly the
 * width the CSS stacks the builder at — a sheet at 721px beside a two-column builder would be a
 * modal nobody needed.
 */
export const PHONE_QUERY = '(max-width: 720px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener?.('change', onChange)
  return () => mq.removeEventListener?.('change', onChange)
}

/**
 * True at phone width.
 *
 * ⚠ FALSE ON THE SERVER AND ON THE FIRST CLIENT RENDER, deliberately. Everything that renders on
 * load is laid out by CSS alone; this only decides how the asset picker OPENS, which cannot happen
 * before hydration. So there is no markup whose shape depends on it at first paint, and no
 * hydration mismatch to cause.
 */
export function usePhoneViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}

/**
 * The asset picker as a bottom sheet, for phones.
 *
 * ── WHY A SHEET ──────────────────────────────────────────────────────────────────────────────────
 *
 * Inline, the picker opens INSIDE the team card: on a 390px screen its search box, three tabs and a
 * sixteen-man roster push the card's own total and everything after it several screens down, and
 * the manager loses the deal they were building. A sheet keeps the deal where it was and gives the
 * search the whole height.
 *
 * ⚠ THE SHARED CONTAINMENT HOOK, NOT A FIFTH HAND-ROLLED MODAL. `useOverlayContainment` owns Escape,
 * the reference-counted scroll lock, background inertness and focus restore for every /core overlay
 * precisely because four separate copies broke each other when two were open at once — and a
 * player card can open from a roster row inside this sheet.
 *
 * ⚠ z-index 1100 SITS BELOW THE PLAYER CARD (1200) AND ABOVE THE SHELL'S FLOATING CHROME (tab bar
 * 40, league pill 60, Comms launcher 59), so a card opened from here stacks on top of it and nothing
 * in the shell paints over the search box.
 */
export function TradeAssetSheet(props: {
  label: string
  onClose: () => void
  /**
   * The control that opened the sheet, for focus to return to.
   *
   * 🛑 REQUIRED, BECAUSE THE HOOK'S OWN CAPTURE SEES THE WRONG ELEMENT HERE. The picker's search box
   * has `autoFocus`, which React applies during COMMIT — before the containment hook's effect runs
   * and records "where focus sat when this overlay activated". So the hook records the search box,
   * the search box unmounts with the sheet, and focus fell to <body> on close. Measured at 390px:
   * Escape closed the sheet and `document.activeElement` was BODY. The hook already takes a
   * fallback for exactly this "the recorded element is gone" case.
   */
  openerRef: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  useOverlayContainment({
    active: true,
    containerRef: panelRef,
    onClose: props.onClose,
    restoreFallbackRef: props.openerRef,
  })

  return (
    <div
      className="af-tc-sheet-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        ref={panelRef}
        className="af-tc-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        /*
          ⚠ NO tabIndex. The hook focuses the container on open when it can; a focusable container
          would take focus FROM the search box the picker autofocuses, and on a phone that is the
          difference between the keyboard opening and not. Caught by the sheet's focus test.
        */
      >
        <span className="af-tc-sheet-grip" aria-hidden />
        {props.children}
      </div>
    </div>
  )
}
