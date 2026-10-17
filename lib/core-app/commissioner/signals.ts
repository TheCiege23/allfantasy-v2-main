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

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function leaguePage(leagueId: string, view: string): string {
  return `/league/${encodeURIComponent(leagueId)}?view=${encodeURIComponent(view)}`
}

/**
 * One card per signal that is on, in the TaskCard shape `buildTaskCards` ranks. Written in the
 * reader's language (default English) — see `health.ts` for why at the source, not at render.
 */
export function reviewSignalCards(leagueId: string, s: LeagueReviewSignals, language = 'en'): TaskCard[] {
  const es = language === 'es'
  const id = encodeURIComponent(leagueId)
  const cards: TaskCard[] = []

  if (s.integrityAlerts > 0) {
    cards.push({
      id: 'review:integrity',
      severity: 'warn',
      source: 'review',
      title: es
        ? plural(s.integrityAlerts, 'alerta de integridad abierta', 'alertas de integridad abiertas')
        : `${plural(s.integrityAlerts, 'open integrity alert')}`,
      detail: es
        ? 'Detectadas a partir de los valores de los intercambios y las alineaciones. Necesitan que una persona las revise antes de decidir nada.'
        : 'Flagged from trade values and lineup cards. They need a person to look before anything is decided.',
      due: null,
      action: { label: es ? 'Revisar alertas' : 'Review alerts', href: `/league/${id}/commissioner/integrity`, external: false },
    })
  }

  if (s.tradesAwaitingReview > 0) {
    cards.push({
      id: 'review:trades',
      severity: 'warn',
      source: 'review',
      title: es
        ? `${plural(s.tradesAwaitingReview, 'intercambio espera', 'intercambios esperan')} tu revisión`
        : `${plural(s.tradesAwaitingReview, 'trade')} awaiting your review`,
      detail: es
        ? 'Ambos mánagers aceptaron. El intercambio no se hace efectivo hasta que un comisionado lo apruebe o lo vete.'
        : 'Both managers agreed. The trade does not go through until a commissioner approves or vetoes it.',
      due: null,
      action: { label: es ? 'Revisar intercambios' : 'Review trades', href: leaguePage(leagueId, 'trades'), external: false },
    })
  }

  if (s.overdueWaiverClaims > 0) {
    cards.push({
      id: 'review:waivers',
      severity: 'warn',
      source: 'review',
      title: es
        ? `${plural(s.overdueWaiverClaims, 'reclamo lleva', 'reclamos llevan')} más de una semana esperando`
        : `${plural(s.overdueWaiverClaims, 'waiver claim')} waiting over a week`,
      detail: es
        ? 'Estos reclamos ya deberían haberse resuelto en un procesamiento de reclamos. Procésalos para resolverlos.'
        : 'These claims should have been decided by a waiver run by now. Run waivers to process them.',
      due: null,
      action: { label: es ? 'Abrir agentes libres' : 'Open waivers', href: `/core/commissioner?league=${id}#ch-waivers`, external: false },
    })
  }

  if (s.draftDateMissing) {
    cards.push({
      id: 'review:draft-date',
      severity: 'info',
      source: 'review',
      title: es ? 'No hay fecha de draft' : 'No draft date set',
      detail: es
        ? 'Los mánagers no pueden organizarse para un draft sin fecha. Añádela en la configuración del draft.'
        : 'Managers can’t plan around a draft that isn’t scheduled. Add the date in draft settings.',
      due: null,
      action: { label: es ? 'Poner la fecha' : 'Set the date', href: `/league/${id}/settings`, external: false },
    })
  }

  return cards
}
