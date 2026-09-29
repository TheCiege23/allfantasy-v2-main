'use client'

import { useEffect, useState } from 'react'
import { ActionLink } from '@/components/core-app/player-finder/ActionLink'
import { leagueViewActions } from '@/lib/core-app/leagueViewActions'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'

/**
 * The phone's sticky action bar: with a league in view, the next move for this player — set your
 * lineup, trade for him, or claim him — pinned above the tab bar, one thumb away while the card
 * scrolls. The actions are the league card's own (leagueViewActions.ts), never a second opinion.
 *
 * ⚠ NEVER TWO OF THE SAME BUTTON ON SCREEN. While the league card's action row (`#af-pf-lv-actions`)
 * is visible, the bar hides; it appears once that row scrolls away. Where IntersectionObserver is
 * missing the bar simply stays — a duplicate is better than a lost action.
 *
 * Phones only (≤720px, CSS): on a wider screen the card sits beside the content and needs no bar.
 */

export const WATCHED_ACTIONS_ID = 'af-pf-lv-actions'

export function StickyActionBar({ view, playerName }: { view: PlayerLeagueView | null; playerName: string }) {
  const actions = view ? leagueViewActions(view, playerName) : null
  const [cardActionsVisible, setCardActionsVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const el = document.getElementById(WATCHED_ACTIONS_ID)
    if (!el) return
    const io = new IntersectionObserver((entries) => setCardActionsVisible(entries.some((e) => e.isIntersecting)), { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [view?.leagueId])

  if (!view || !actions?.primary) return null
  return (
    <div className="af-pf-stickybar" data-hidden={cardActionsVisible ? 'true' : 'false'} aria-hidden={cardActionsVisible ? true : undefined}>
      <span className="af-pf-stickybar-ctx">
        <span className="af-pf-stickybar-league">{view.leagueName}</span>
        <span className="af-pf-stickybar-status">{actions.status}</span>
      </span>
      <ActionLink action={actions.primary} className="af-btn af-pf-stickybar-btn" />
    </div>
  )
}
