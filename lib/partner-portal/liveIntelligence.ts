import type { PrismaClient } from '@prisma/client'

import { FACTOR_SPORTS, FACTOR_TABLE_KEY, type StoredFactorTable } from '@/lib/af-projections/factors/factorLearning'
import { factorReason } from '@/lib/af-projections/factors/factorTables'
import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { ledgerRecordFor } from '@/lib/chimmy-outcomes/ledgerRecord'
import { publicTrackRecord, type PublicRecordLine } from '@/lib/chimmy-outcomes/publicTrackRecord'

/**
 * THE PARTNER PAGES ON LIVE NUMBERS (owner, 2026-11-22: "all of this needs to be built into the B2B pages as well
 * with live data to show"). Three panels, each read from what the scheduled jobs already store — nothing is computed
 * for a partner that a manager does not also get, and nothing here is sample data:
 *
 *   graded record     every recommendation type and trade letter, checked against what happened (the same lines as
 *                     the public /track-record, misses included)
 *   projections       per sport, how far AF's projection landed from what was scored on the held-back later games,
 *                     against the plain trailing average (lib/af-projections/factors)
 *   AF ADP movers     the biggest seven-day moves in AF ADP, measured from real drafts
 *
 * Counts, rates and public player names only: no league, manager or user reaches a partner. Every read is
 * contained — a failed one leaves its panel empty and the page says it is still measuring, never invents a number.
 */

export type ProjectionAccuracyRow = {
  sport: string
  /** Later games the check was run on. */
  games: number
  plainMae: number
  afMae: number
  /** How much closer AF's number was, in percent; negative = further. */
  closerPct: number
  /** The factors that earned their place, said plainly. */
  factors: string[]
  learnedAt: string
}

export type AdpMoverRow = { sport: string; playerName: string; adp: number; movedPicks: number; drafts: number; context: string }

export type LiveIntelligence = {
  record: PublicRecordLine[]
  recordSeason: number | null
  projections: ProjectionAccuracyRow[]
  adpRisers: AdpMoverRow[]
  adpFallers: AdpMoverRow[]
}

type Db = Pick<PrismaClient, 'sportsDataCache' | 'allFantasyAdpSnapshot'>

/** A learned table as a partner row, or null when there is no check to show. PURE. */
export function projectionAccuracyRow(t: StoredFactorTable | null | undefined): ProjectionAccuracyRow | null {
  const o = t?.overall
  if (!t || !o || !(o.games > 0) || o.plainMae == null || o.factorMae == null || o.improvementPct == null) return null
  return {
    sport: t.sport,
    games: o.games,
    plainMae: o.plainMae,
    afMae: o.factorMae,
    closerPct: o.improvementPct,
    factors: t.levels.filter((l) => l.published).map((l) => factorReason(l).replace(/\bhis\b/g, 'the player’s')),
    learnedAt: t.generatedAt,
  }
}

const MIN_ADP_DRAFTS = 5
const MOVERS = 5

function contextLabel(r: { leagueType: string; rosterFormat: string; scoringFormat: string; teamCount: number }): string {
  const fmt = r.rosterFormat && r.rosterFormat !== 'standard' ? ` ${r.rosterFormat}` : ''
  return `${r.leagueType}${fmt}, ${r.scoringFormat}, ${r.teamCount} teams`
}

export async function loadLiveIntelligence(db: Db): Promise<LiveIntelligence> {
  const [snapshot, tables, risers, fallers] = await Promise.all([
    readAdviceLearningSnapshot().catch(() => null),
    db.sportsDataCache
      .findMany({ where: { cacheKey: { in: FACTOR_SPORTS.map(FACTOR_TABLE_KEY) } }, select: { data: true } })
      .catch(() => [] as Array<{ data: unknown }>),
    ...(['desc', 'asc'] as const).map((dir) =>
      db.allFantasyAdpSnapshot
        .findMany({
          where: { draftMode: 'real', sampleSize: { gte: MIN_ADP_DRAFTS }, sevenDayTrend: dir === 'desc' ? { gt: 0 } : { lt: 0 } },
          orderBy: { sevenDayTrend: dir },
          take: MOVERS * 4,
          select: { sport: true, playerName: true, averageOverallPick: true, sevenDayTrend: true, sampleSize: true, leagueType: true, rosterFormat: true, scoringFormat: true, teamCount: true },
        })
        .catch(() => []),
    ),
  ])
  const ledger = snapshot?.ledger
  const record = publicTrackRecord(ledger ? ledgerRecordFor({ ...ledger, users: {} }, null) : null)
  const toMover = (r: (typeof risers)[number]): AdpMoverRow => ({
    sport: r.sport,
    playerName: r.playerName,
    adp: Math.round(r.averageOverallPick * 10) / 10,
    // `sevenDayTrend` = last week's pick minus this week's: positive is going EARLIER.
    movedPicks: Math.round((r.sevenDayTrend ?? 0) * 10) / 10,
    drafts: r.sampleSize,
    context: contextLabel(r),
  })
  /* One row per player — the same player rises in several formats; the biggest move speaks for him. */
  const distinct = (rows: AdpMoverRow[]) => {
    const seen = new Set<string>()
    return rows.filter((r) => (seen.has(`${r.sport}:${r.playerName}`) ? false : (seen.add(`${r.sport}:${r.playerName}`), true))).slice(0, MOVERS)
  }
  return {
    record: record.lines.filter((l) => l.tone !== 'pending'),
    recordSeason: record.season,
    projections: (tables as Array<{ data: unknown }>)
      .map((r) => projectionAccuracyRow(r.data as StoredFactorTable))
      .filter((r): r is ProjectionAccuracyRow => r != null)
      .sort((a, b) => b.games - a.games),
    adpRisers: distinct(risers.map(toMover)),
    adpFallers: distinct(fallers.map(toMover)),
  }
}
