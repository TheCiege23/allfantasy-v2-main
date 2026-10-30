'use client'

import { useRef, type MouseEvent, type TouchEvent } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { useOverlayContainment } from '@/components/core-app/useOverlayContainment'
import { railRowMessages } from '@/lib/core-app/messages/railRow'

/**
 * Pin, Move and Hide for one league in a league list — the sheet, and the press-and-hold that opens it.
 *
 * ⚠ ONE IMPLEMENTATION, TWO LISTS: /core's rail and the /league workspace rail both draw this, so a
 * change to how a hold is read or what the sheet offers lands in both (the same rule RailRowBody
 * follows). The row itself stays ONE link; the actions live here, beside it, never as buttons inside it.
 */

/**
 * Press-and-hold (touch) and right-click / the context-menu key (desktop) on a league row. A hold
 * that fired swallows the click that follows it, so lifting the finger does not also open the
 * league; a touch that moves (a scroll) never opens anything.
 */
export function useRailHold(open: (id: string) => void) {
  const hold = useRef<{ timer: number | null; fired: boolean; x: number; y: number }>({ timer: null, fired: false, x: 0, y: 0 })
  const clear = () => {
    if (hold.current.timer) window.clearTimeout(hold.current.timer)
    hold.current.timer = null
  }
  return {
    /** Spread onto the row's link. */
    handlers: (id: string) => ({
      onContextMenu: (event: MouseEvent) => {
        event.preventDefault()
        open(id)
      },
      onTouchStart: (event: TouchEvent) => {
        const t = event.touches[0]
        clear()
        hold.current.fired = false
        hold.current.x = t?.clientX ?? 0
        hold.current.y = t?.clientY ?? 0
        hold.current.timer = window.setTimeout(() => {
          hold.current.timer = null
          hold.current.fired = true
          open(id)
        }, 550)
      },
      onTouchMove: (event: TouchEvent) => {
        const t = event.touches[0]
        if (hold.current.timer && t && Math.hypot(t.clientX - hold.current.x, t.clientY - hold.current.y) > 10) clear()
      },
      onTouchEnd: clear,
      onTouchCancel: clear,
    }),
    /** Call first in the row's onClick: true when this click is the lift after a hold, already swallowed. */
    swallowClick: (event: MouseEvent): boolean => {
      if (!hold.current.fired) return false
      hold.current.fired = false
      event.preventDefault()
      event.stopPropagation()
      return true
    },
  }
}

/** Save one of the account's league lists (favorites, order or hidden) through the existing preferences route. */
export function saveLeaguePreference(field: 'favorites' | 'order' | 'hidden', leagueIds: string[], onSaved?: () => void): void {
  void fetch('/api/core/league-preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ field, leagueIds }),
  })
    .then((res) => {
      if (res.ok) onSaved?.()
    })
    .catch(() => {
      /* the on-screen change stays until the next render shows what was saved */
    })
}

/**
 * Hide one league from the account's lists. The hidden list is read back first and the league added
 * to it, so a list changed in Settings (or by another tab) since this page rendered is extended rather
 * than overwritten — the pages carry archived leagues in their hidden set too, which must not be saved.
 */
export function hideLeagueForAccount(leagueId: string, onSaved?: () => void): void {
  void fetch('/api/core/league-preferences', { credentials: 'same-origin', cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((prefs: { hidden?: unknown }) => {
      const hidden = Array.isArray(prefs?.hidden) ? prefs.hidden.filter((x): x is string => typeof x === 'string') : []
      if (hidden.includes(leagueId)) return onSaved?.()
      saveLeaguePreference('hidden', [...hidden, leagueId], onSaved)
    })
    .catch(() => {
      /* the row comes back on the next render, which is the truthful state */
    })
}

export function RailLeagueMenu({
  name,
  pinned,
  canMoveUp,
  canMoveDown,
  onPin,
  onMove,
  onHide,
  onClose,
}: {
  name: string
  pinned: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onPin: () => void
  onMove: (direction: -1 | 1) => void
  onHide: () => void
  onClose: () => void
}) {
  const msg = useMessages(railRowMessages)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLButtonElement>(null)
  useOverlayContainment({ active: true, containerRef, onClose, keepClickableRefs: [scrimRef] })
  return (
    <>
      <button
        ref={scrimRef}
        type="button"
        className="af-rail-menu-scrim"
        aria-label={msg.menuClose}
        tabIndex={-1}
        onClick={onClose}
      />
      <div ref={containerRef} className="af-rail-menu" role="dialog" aria-modal="true" aria-label={msg.menuTitle(name)}>
        <p className="af-rail-menu-title">{name}</p>
        <button
          type="button"
          className="af-rail-menu-item"
          onClick={() => {
            onPin()
            onClose()
          }}
        >
          <span aria-hidden>{pinned ? '☆' : '★'}</span>
          {pinned ? msg.unpin : msg.pin}
        </button>
        <button type="button" className="af-rail-menu-item" disabled={!canMoveUp} onClick={() => onMove(-1)}>
          <span aria-hidden>↑</span>
          {msg.moveUp}
        </button>
        <button type="button" className="af-rail-menu-item" disabled={!canMoveDown} onClick={() => onMove(1)}>
          <span aria-hidden>↓</span>
          {msg.moveDown}
        </button>
        <button
          type="button"
          className="af-rail-menu-item"
          data-kind="hide"
          onClick={() => {
            onHide()
            onClose()
          }}
        >
          <span aria-hidden>⊘</span>
          <span className="af-rail-menu-label">
            {msg.hide}
            <small>{msg.hideNote}</small>
          </span>
        </button>
        <button type="button" className="af-rail-menu-item" data-kind="done" onClick={onClose}>
          {msg.menuDone}
        </button>
      </div>
    </>
  )
}
