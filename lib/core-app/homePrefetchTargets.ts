import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

/**
 * Where the reader is most likely to go next from the /core home — the pages worth warming.
 *
 * ⚠ EVERY TARGET IS A FULL SERVER RENDER. `router.prefetch` on /core runs the shell reads plus a
 * screen loader, so this list is short on purpose and every entry is conditional on something the
 * home already knows. In order:
 *   1. the screen the top decision's action opens (e.g. that league's My team) — the likeliest tap;
 *   2. the home of the most urgent decision that NAMES a league — the likeliest league switch.
 *      Not necessarily the first decision's: an account-wide row (the collapsed "N leagues have
 *      never been read") belongs to no league, so the next one that does is used;
 *   3. Notifications, only when something is unread;
 *   4. Your week, only while a slate is live;
 *   5. Trades, only when the trade band has something to show.
 * External actions (the provider's own site) are never warmed: they are not ours to prefetch.
 */
export const HOME_PREFETCH_LIMIT = 3

export function homePrefetchTargets(input: {
  /** The queue in ranked order — `rankDecisions` output. */
  decisions: readonly CoreIssue[]
  unreadNotifications: number
  gameDayActive: boolean
  hasRecentTrades: boolean
  limit?: number
}): string[] {
  const out: string[] = []
  const add = (href: string | null | undefined) => {
    if (!href || !href.startsWith('/core') || href.startsWith('//') || out.includes(href)) return
    out.push(href)
  }

  const top = input.decisions[0]
  if (top?.action && !top.action.external) add(top.action.href)
  // The first decision, in ranked order, that belongs to a league — point 2 above.
  const leagueId = input.decisions.find((d) => d.leagueId)?.leagueId
  if (leagueId) add(`/core?league=${encodeURIComponent(leagueId)}`)
  if (input.unreadNotifications > 0) add('/core/notifications')
  if (input.gameDayActive) add('/core/week')
  if (input.hasRecentTrades) add('/core/trades')

  return out.slice(0, input.limit ?? HOME_PREFETCH_LIMIT)
}
