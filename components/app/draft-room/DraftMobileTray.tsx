'use client'

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'
import {
  cycleTraySnap,
  resolveTraySnap,
  stepTraySnap,
  trayHeightFor,
  type TraySnap,
} from '@/lib/draft-room/mobileTraySnap'

/**
 * The Sleeper-style draggable bottom tray for phone draft rooms — shared by the live room
 * (`DraftRoomShell`) and the mock room (`MockDraftSleeperRoomClient`).
 *
 * It owns ONLY the sheet mechanics: the handle, the snap height (peek / half / full), drag and
 * flick, keyboard control, and the measurement that bounds it. Each room keeps its own tab bar
 * (`chrome`) and its own panel content (`children`), because the two rooms name, order and label
 * their tabs differently — and the live room's structure tests pin that markup in its own file.
 *
 * ⚠ OPEN/CLOSED STAYS WITH THE ROOM. A room says whether a panel is selected (`open`); the tray
 * maps that onto a snap height and asks the room to change it (`onRequestExpand` /
 * `onRequestCollapse`) when the user drags across the peek line. The room's own tab state remains
 * the source of truth, so a tab tap and a drag can never disagree about what is showing.
 */
export type DraftMobileTrayProps = {
  /** True when the room has a panel selected; false collapses to peek (whole board visible). */
  open: boolean
  onRequestCollapse: () => void
  onRequestExpand: () => void
  /** The element whose height bounds the tray — normally the room's mobile layout column. */
  layoutRef: RefObject<HTMLElement | null>
  /** Panel content for the selected tab. Sized and clipped by the tray. */
  children: ReactNode
  /** Rendered below the content: the room's tab bar and any tools dock. */
  chrome: ReactNode
  /** Floats above the tray's top-right edge (e.g. a quick-action button). */
  accessory?: ReactNode
  /** Expand to full when a text field inside the content gains focus (chat composer). */
  fullOnInputFocus?: boolean
  /** Prefix for test ids: `${prefix}-tray`, `${prefix}-tray-handle`, `${prefix}-tray-content`. */
  testIdPrefix: string
  ariaLabel: string
  /** Fires with the snap the tray settled on, for rooms that mirror it (data attributes, analytics). */
  onSnapChange?: (snap: TraySnap) => void
}

export function DraftMobileTray({
  open,
  onRequestCollapse,
  onRequestExpand,
  layoutRef,
  children,
  chrome,
  accessory,
  fullOnInputFocus = false,
  testIdPrefix,
  ariaLabel,
  onSnapChange,
}: DraftMobileTrayProps) {
  const chromeRef = useRef<HTMLDivElement | null>(null)
  const [snap, setSnap] = useState<TraySnap>(open ? 'half' : 'peek')
  const [fullHeight, setFullHeight] = useState<number | null>(null)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragRef = useRef<{ startY: number; startHeight: number; lastY: number; lastT: number; velocity: number } | null>(
    null,
  )

  useEffect(() => {
    setSnap((current) => (!open ? 'peek' : current === 'peek' ? 'half' : current))
  }, [open])

  useEffect(() => {
    onSnapChange?.(snap)
  }, [snap, onSnapChange])

  useEffect(() => {
    const layout = layoutRef.current
    if (!layout) return
    const measure = () => {
      const chrome = chromeRef.current?.offsetHeight ?? 0
      // Leave a sliver of board above a full tray so the sheet still reads as a sheet.
      const full = layout.clientHeight - chrome - 8
      /*
       * ⚠ ZERO MEANS "NOT LAID OUT", NOT "NO ROOM". Mobile layouts are hidden at desktop widths, so
       * on a wide window — or a phone rotating through a breakpoint — this measures 0. Storing that
       * would pin an OPEN tray at 0px; null falls back to the dvh heights until a real size lands.
       */
      setFullHeight(full > 0 ? full : null)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(layout)
    return () => observer.disconnect()
  }, [layoutRef])

  const settle = useCallback(
    (next: TraySnap) => {
      setSnap((prev) => {
        if (prev !== next && typeof navigator !== 'undefined') navigator.vibrate?.(8)
        return next
      })
      if (next === 'peek' && open) onRequestCollapse()
      if (next !== 'peek' && !open) onRequestExpand()
    },
    [open, onRequestCollapse, onRequestExpand],
  )

  const contentHeight = dragHeight ?? (fullHeight == null ? null : trayHeightFor(snap, fullHeight))

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fullHeight == null) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const startHeight = trayHeightFor(snap, fullHeight)
    dragRef.current = { startY: event.clientY, startHeight, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 }
    setDragHeight(startHeight)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || fullHeight == null) return
    const dt = Math.max(1, event.timeStamp - drag.lastT)
    drag.velocity = (event.clientY - drag.lastY) / dt
    drag.lastY = event.clientY
    drag.lastT = event.timeStamp
    const next = drag.startHeight + (drag.startY - event.clientY)
    setDragHeight(Math.min(fullHeight, Math.max(0, next)))
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    setDragHeight(null)
    if (!drag || fullHeight == null) return
    // A tap on the handle (no real movement) cycles, like the keyboard does.
    if (Math.abs(event.clientY - drag.startY) < 6) {
      settle(cycleTraySnap(snap))
      return
    }
    settle(
      resolveTraySnap({
        heightPx: drag.startHeight + (drag.startY - event.clientY),
        velocity: drag.velocity,
        fullHeight,
      }),
    )
  }

  return (
    <section
      className="relative z-10 flex shrink-0 flex-col rounded-t-2xl border-t border-cyan-400/20 bg-[linear-gradient(180deg,rgba(9,17,34,0.98),rgba(7,12,24,0.99))] shadow-[0_-12px_32px_rgba(0,0,0,0.45)]"
      data-testid={`${testIdPrefix}-tray`}
      data-snap={snap}
      aria-label={ariaLabel}
    >
      {accessory ? (
        <div className="absolute bottom-full right-4 z-20 mb-3" data-testid={`${testIdPrefix}-dock-accessory`}>
          {accessory}
        </div>
      ) : null}
      <div
        role="button"
        tabIndex={0}
        aria-label={snap === 'full' ? 'Collapse draft tray' : 'Expand draft tray'}
        aria-expanded={snap !== 'peek'}
        aria-controls={`${testIdPrefix}-tray-content`}
        data-testid={`${testIdPrefix}-tray-handle`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            settle(cycleTraySnap(snap))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            settle(stepTraySnap(snap, 'up'))
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            settle(stepTraySnap(snap, 'down'))
          }
        }}
        className="flex min-h-[28px] cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1 w-10 rounded-full bg-white/30" aria-hidden />
      </div>
      <div
        id={`${testIdPrefix}-tray-content`}
        className={cn(
          'min-h-0 overflow-hidden',
          dragHeight == null && 'transition-[height] duration-200 ease-out motion-reduce:transition-none',
        )}
        style={{ height: contentHeight ?? (snap === 'peek' ? 0 : snap === 'half' ? '45dvh' : '78dvh') }}
        aria-hidden={snap === 'peek' && dragHeight == null}
        onFocusCapture={(event) => {
          // Typing in chat: give the conversation the whole screen so the keyboard does not leave a
          // two-line sliver.
          if (!fullOnInputFocus) return
          const tag = (event.target as HTMLElement).tagName
          if (tag === 'TEXTAREA' || tag === 'INPUT') settle('full')
        }}
      >
        {children}
      </div>
      <div ref={chromeRef} className="shrink-0">
        {chrome}
      </div>
    </section>
  )
}
