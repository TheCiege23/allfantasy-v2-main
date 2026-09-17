import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueStage } from '@/lib/league-stage/leagueStage'
import { NO_REVIEW_SIGNALS, OVERDUE_CLAIM_DAYS, type LeagueReviewSignals } from './signals'

const BEFORE_DRAFT = new Set(['setup', 'pre_draft', 'predraft'])

/**
 * The reads behind `LeagueReviewSignals`, batched across leagues — one grouped
 * count per signal whether the caller asks about one league or sixty.
 *
 * Trades, waivers and draft dates live in tables only leagues AllFantasy runs
 * write, so those three are read for native leagues only; an imported league's
 * zero there is "not ours to count", not "none". Every read settles on its own and
 * reports `partial` rather than throwing.
 */

export type SignalLeague = {
  id: string
  native: boolean
  status: string | null
  lifecycleState?: string | null
}

type CountRow = { leagueId: string; _count: { _all: number } }

function toMap(rows: CountRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.leagueId, r._count._all]))
}

export async function readReviewSignals(
  leagues: SignalLeague[],
  now: Date,
): Promise<{ byLeague: Map<string, LeagueReviewSignals>; partial: boolean }> {
  const byLeague = new Map<string, LeagueReviewSignals>()
  if (leagues.length === 0) return { byLeague, partial: false }

  let partial = false
  const settle = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    p.catch((err: unknown) => {
      partial = true
      console.warn('[commissioner/signals] read failed', err instanceof Error ? err.message : err)
      return fallback
    })

  const ids = leagues.map((l) => l.id)
  const nativeIds = leagues.filter((l) => l.native).map((l) => l.id)
  // Before the draft only: a league already drafting has a date whether or not one was saved.
  const preDraftIds = leagues
    .filter((l) => l.native && BEFORE_DRAFT.has(resolveLeagueStage(l) ?? ''))
    .map((l) => l.id)
  const overdueBefore = new Date(now.getTime() - OVERDUE_CLAIM_DAYS * 24 * 60 * 60 * 1000)

  /*
   * Each query is built inside its own arrow, never as an argument to a typed helper: a
   * contextual return type there is fed into `groupBy`'s generic inference and breaks it.
   */
  const readAlerts = () =>
    prisma.aiCommissionerAlert
      .groupBy({ by: ['leagueId'], where: { leagueId: { in: ids }, status: 'open' }, _count: { _all: true } })
      .then(toMap)
  // Accepted by the receiver, not yet settled, and waiting on a commissioner — see signals.ts.
  const readTrades = () =>
    prisma.redraftTradeProposal
      .groupBy({
        by: ['leagueId'],
        where: { leagueId: { in: nativeIds }, status: 'pending', acceptedAt: { not: null }, vetoMode: 'commissioner' },
        _count: { _all: true },
      })
      .then(toMap)
  const readClaims = () =>
    prisma.redraftWaiverClaim
      .groupBy({
        by: ['leagueId'],
        where: { leagueId: { in: nativeIds }, status: 'pending', submittedAt: { lt: overdueBefore } },
        _count: { _all: true },
      })
      .then(toMap)
  const readDrafts = () =>
    prisma.leagueSettings.findMany({
      where: { leagueId: { in: preDraftIds } },
      select: { leagueId: true, draftDateUtc: true },
    })

  const none = new Map<string, number>()
  const [alertMap, tradeMap, claimMap, drafts] = await Promise.all([
    settle(readAlerts(), none),
    nativeIds.length === 0 ? none : settle(readTrades(), none),
    nativeIds.length === 0 ? none : settle(readClaims(), none),
    preDraftIds.length === 0 ? null : settle<Awaited<ReturnType<typeof readDrafts>> | null>(readDrafts(), null),
  ])

  // A failed settings read says nothing about draft dates, so no league is flagged from it.
  const dated = drafts ? new Set(drafts.filter((d) => d.draftDateUtc).map((d) => d.leagueId)) : null
  const preDraft = new Set(preDraftIds)

  for (const l of leagues) {
    byLeague.set(l.id, {
      ...NO_REVIEW_SIGNALS,
      integrityAlerts: alertMap.get(l.id) ?? 0,
      tradesAwaitingReview: tradeMap.get(l.id) ?? 0,
      overdueWaiverClaims: claimMap.get(l.id) ?? 0,
      draftDateMissing: dated != null && preDraft.has(l.id) && !dated.has(l.id),
    })
  }
  return { byLeague, partial }
}
