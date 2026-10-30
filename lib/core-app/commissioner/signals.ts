/**
 * Review work a commissioner owes: the detectors the old all-leagues hub
 * (11a's `components/commish/MissionControl.tsx`, since deleted) queued, as task cards.
 *
 * Five-doors restyle, 2026-09-17: the hub's two views — every league you run at
 * `/core/commissioner` and one league at `?league=` — draw from ONE queue. That
 * queue is `buildTaskCards`; these cards are the old hub's half of it, so a
 * league reads the same in both views. Merged, not dropped:
 *
 *   old 11a detector          here
 *   inactive teams            the abandoned-teams health flag (moves, not the roster clock)
 *   integrity alerts          `integrityAlerts`
 *   trades awaiting review    `tradesAwaitingReview`
 *   pending waiver claims     `overdueWaiverClaims`
 *   no draft date             `draftDateMissing`
 *   unreadable health         the stale / never-synced card
 *
 * ⚠ TWO OF THE OLD COUNTS DID NOT MEAN WHAT THEIR LABELS SAID.
 *
 *   - "N trades awaiting review" counted every `pending` proposal, and a proposal is
 *     `pending` from the moment it is sent — most of them are waiting on the OTHER
 *     MANAGER. A trade waits on the commissioner only once the receiver has accepted
 *     (`acceptedAt` set, status still `pending` — see /api/redraft/trade-votes) in a
 *     league whose `vetoMode` is `commissioner`. The loader counts exactly that.
 *   - "N waiver claims pending" counted claims queued for the next scheduled run,
 *     which is every league every week. A weekly run is a rhythm, not a task (the
 *     same reason `buildTaskCards` skips the waiver calendar event). The loader
 *     counts claims still pending a week after they were made — a run that did not
 *     happen.
 *
 * Client-safe: no Prisma.
 */

import type { TaskCard } from './tasks'
import { commissionerToolsMessages } from '@/lib/core-app/messages/commissionerTools'
import { messagesFor } from '@/lib/i18n/messages'

export type LeagueReviewSignals = {
  /** Open AI commissioner integrity alerts. */
  integrityAlerts: number
  /** Trades the receiver accepted that now wait on a commissioner approve/veto. */
  tradesAwaitingReview: number
  /** Waiver claims still pending more than `OVERDUE_CLAIM_DAYS` after they were made. */
  overdueWaiverClaims: number
  /** A league AllFantasy runs, still before its draft, with no draft date saved. */
  draftDateMissing: boolean
}

export const OVERDUE_CLAIM_DAYS = 7

export const NO_REVIEW_SIGNALS: LeagueReviewSignals = {
  integrityAlerts: 0,
  tradesAwaitingReview: 0,
  overdueWaiverClaims: 0,
  draftDateMissing: false,
}

function leaguePage(leagueId: string, view: string): string {
  return `/league/${encodeURIComponent(leagueId)}?view=${encodeURIComponent(view)}`
}

/**
 * One card per signal that is on, in the TaskCard shape `buildTaskCards` ranks. Written in the
 * reader's language (default English) — see `health.ts` for why at the source, not at render.
 */
export function reviewSignalCards(leagueId: string, s: LeagueReviewSignals, language = 'en'): TaskCard[] {
  const m = messagesFor(commissionerToolsMessages, language)
  const id = encodeURIComponent(leagueId)
  const cards: TaskCard[] = []

  if (s.integrityAlerts > 0) {
    cards.push({
      id: 'review:integrity',
      severity: 'warn',
      source: 'review',
      title: m.signalsIntegrityTitle(s.integrityAlerts),
      detail: m.signalsIntegrityDetail,
      due: null,
      action: { label: m.signalsIntegrityAction, href: `/league/${id}/commissioner/integrity`, external: false },
    })
  }

  if (s.tradesAwaitingReview > 0) {
    cards.push({
      id: 'review:trades',
      severity: 'warn',
      source: 'review',
      title: m.signalsTradesTitle(s.tradesAwaitingReview),
      detail: m.signalsTradesDetail,
      due: null,
      action: { label: m.signalsTradesAction, href: leaguePage(leagueId, 'trades'), external: false },
    })
  }

  if (s.overdueWaiverClaims > 0) {
    cards.push({
      id: 'review:waivers',
      severity: 'warn',
      source: 'review',
      title: m.signalsWaiversTitle(s.overdueWaiverClaims),
      detail: m.signalsWaiversDetail,
      due: null,
      action: { label: m.signalsWaiversAction, href: `/core/commissioner?league=${id}#ch-waivers`, external: false },
    })
  }

  if (s.draftDateMissing) {
    cards.push({
      id: 'review:draft-date',
      severity: 'info',
      source: 'review',
      title: m.signalsDraftTitle,
      detail: m.signalsDraftDetail,
      due: null,
      action: { label: m.signalsDraftAction, href: `/league/${id}/settings`, external: false },
    })
  }

  return cards
}
