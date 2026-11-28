'use client'

import { useEffect, useRef, useState } from 'react'
import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'

/**
 * "Who just went where", for EVERY pick — a small notice that fades on its own.
 *
 * The round-1 card (DraftRoundOneAnnouncementOverlay) is the only pick announcement outside chat,
 * so from round 2 on a manager who glanced away saw nothing: the top-bar counter moved and the
 * pick was buried in chat. That is the Yahoo 2026 complaint ("the top icon showed '7 picks until
 * your turn' but didn't show who was just picked"). This shows the newest pick for a few seconds
 * and is read by screen readers.
 *
 * ⚠ NOT A STRIP. The strips above the board were removed at the user's request on 2026-10-29 to
 * match Sleeper — nothing persistent sits between the top bar and the board. This is transient,
 * floats, never takes layout space, and taps through to nothing.
 *
 * Picks already on the board when the room opens are not announced (a reload is not news), and a
 * burst (autopicks after a pause) shows only the newest.
 */
export const LAST_PICK_TOAST_MS = 5200

export function DraftLastPickToast({
  picks,
  slotOrder,
  active,
  skipRoundOne,
}: {
  picks: DraftPickSnapshot[]
  slotOrder: Array<{ rosterId: string; displayName: string }>
  /** The draft is running (not paused before it starts, not complete). */
  active: boolean
  /** The round-1 card already announces those picks. */
  skipRoundOne: boolean
}) {
  const seen = useRef<Set<string> | null>(null)
  const [shown, setShown] = useState<DraftPickSnapshot | null>(null)

  useEffect(() => {
    const filled = picks.filter((p) => p.playerName && !p.pickEditorEmpty)
    if (seen.current == null) {
      seen.current = new Set(filled.map((p) => p.id))
      return
    }
    const fresh = filled.filter((p) => !seen.current!.has(p.id))
    for (const p of fresh) seen.current.add(p.id)
    if (!active || fresh.length === 0) return
    const newest = fresh.reduce((a, b) => (b.overall > a.overall ? b : a))
    if (skipRoundOne && newest.round === 1) return
    setShown(newest)
  }, [picks, active, skipRoundOne])

  useEffect(() => {
    if (!shown) return
    const t = window.setTimeout(() => setShown(null), LAST_PICK_TOAST_MS)
    return () => window.clearTimeout(t)
  }, [shown])

  const team = shown ? (slotOrder.find((s) => s.rosterId === shown.rosterId)?.displayName ?? shown.displayName ?? 'A team') : null

  /*
   * Never on top of the "You're up" alert. Where that alert sits differs by layout (top-centre on
   * desktop, bottom on phones) and its height by its contents, and guessed offsets were wrong twice
   * when measured. So measure it: if it is showing in the top half of the screen, drop below it.
   */
  const [below, setBelow] = useState<number | null>(null)
  useEffect(() => {
    if (!shown) return
    const alert = document.querySelector('[data-testid="draft-youre-up-alert"]')
    const r = alert?.getBoundingClientRect()
    setBelow(r && r.height > 0 && r.top < window.innerHeight / 2 ? Math.round(r.bottom + 8) : null)
  }, [shown])

  return (
    <div
      aria-live="polite"
      // Below the top bar: never over the clock or the on-the-clock pill (and below the "You're up"
      // alert when it is up there — see `below`).
      className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+150px)] z-[70] w-[min(92vw,420px)] -translate-x-1/2 md:top-[calc(env(safe-area-inset-top)+108px)]"
      style={below != null ? { top: below } : undefined}
    >
      {shown ? (
        <div
          key={shown.id}
          data-testid="draft-last-pick-toast"
          className="animate-[slide-in-pick_180ms_ease-out] rounded-xl border border-emerald-400/40 bg-[#062a22] px-3 py-2 text-[13px] text-emerald-50 shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
        >
          <span className="mr-2 rounded border border-emerald-300/40 px-1 text-[11px] font-bold tabular-nums text-emerald-200">
            {shown.pickLabel || `#${shown.overall}`}
          </span>
          <b className="font-semibold">{team}</b> took <b className="font-semibold">{shown.playerName}</b>
          <span className="text-emerald-100/70">
            {' '}
            · {shown.position}
            {shown.team ? `, ${shown.team}` : ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}
