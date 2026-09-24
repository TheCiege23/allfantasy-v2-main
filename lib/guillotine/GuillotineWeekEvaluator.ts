/**
 * Evaluate a scoring period: gather active rosters, period/season scores, and determine if we're past the stat-correction cutoff.
 */

import { prisma } from '@/lib/prisma'
import { getGuillotineConfig } from './GuillotineLeagueConfig'
import type { GuillotineWeekEvalResult, PeriodScoreRow } from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export interface WeekEvaluatorInput {
  leagueId: string
  weekOrPeriod: number
  season?: number | null
  /** If provided, use these as the period scores instead of reading from DB. */
  periodScores?: PeriodScoreRow[]
  /** Period end time (UTC); used for correction-window check. */
  periodEndedAt?: Date
}

/**
 * Check if the league is past the stat-correction cutoff for the given period.
 */
export function isPastCorrectionCutoff(args: {
  correctionWindow: string
  periodEndedAt: Date
  statCorrectionHours: number | null
  customCutoffDayOfWeek: number | null
  customCutoffTimeUtc: string | null
  now?: Date
}): boolean {
  const now = args.now ?? new Date()
  if (args.correctionWindow === 'immediate') return true
  if (args.correctionWindow === 'after_stat_corrections' && args.statCorrectionHours != null) {
    const cutoff = new Date(args.periodEndedAt.getTime() + args.statCorrectionHours * 60 * 60 * 1000)
    return now >= cutoff
  }
  if (args.correctionWindow === 'custom_cutoff') {
    if (args.customCutoffDayOfWeek != null && args.customCutoffTimeUtc) {
      const [h, m] = args.customCutoffTimeUtc.split(':').map(Number)
      const nextCutoff = new Date(now)
      nextCutoff.setUTCDate(nextCutoff.getUTCDate() + 1)
      const dayOffset = (args.customCutoffDayOfWeek - nextCutoff.getUTCDay() + 7) % 7
      nextCutoff.setUTCDate(nextCutoff.getUTCDate() + dayOffset)
      nextCutoff.setUTCHours(h ?? 0, m ?? 0, 0, 0)
      return now >= nextCutoff
    }
    return true
  }
  return true
}

/**
 * Load draft slot order for a league (slot -> rosterId or rosterId -> slot).
 */
export async function getDraftSlotByRoster(leagueId: string): Promise<Map<string, number>> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { slotOrder: true },
  })
  const order = session?.slotOrder as Array<{ slot: number; rosterId: string }> | null
  if (!Array.isArray(order)) return new Map()
  const map = new Map<string, number>()
  for (const o of order) {
    if (o?.rosterId != null && typeof o.slot === 'number') map.set(String(o.rosterId), o.slot)
  }
  return map
}

/**
 * Evaluate the week: active rosters, scores, and who is worst-first (for chop).
 */
export async function evaluateWeek(input: WeekEvaluatorInput): Promise<GuillotineWeekEvalResult | null> {
  const config = await getGuillotineConfig(input.leagueId)
  if (!config) return null

  const { leagueId, weekOrPeriod, season = input.season ?? null } = input
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true },
  })
  const rosterIds = rosters.map((r) => r.id)

  const chopped = await prisma.guillotineRosterState.findMany({
    where: { leagueId, choppedAt: { not: null } },
    select: { rosterId: true },
  })
  const alreadyChoppedRosterIds = chopped.map((c) => c.rosterId)
  const activeRosterIds = rosterIds.filter((id) => !alreadyChoppedRosterIds.includes(id))

  let scores: PeriodScoreRow[]

  if (input.periodScores && input.periodScores.length > 0) {
    scores = input.periodScores.filter((s) => activeRosterIds.includes(s.rosterId))
  } else {
    const rows = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId, weekOrPeriod },
      select: { rosterId: true, periodPoints: true, seasonPointsCumul: true },
    })
    const prevRows = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId, weekOrPeriod: weekOrPeriod - 1 },
      select: { rosterId: true, periodPoints: true },
    })
    const prevByRoster = new Map(prevRows.map((r) => [r.rosterId, r.periodPoints]))
    scores = rows
      .filter((r) => activeRosterIds.includes(r.rosterId))
      .map((r) => ({
        rosterId: r.rosterId,
        periodPoints: r.periodPoints,
        seasonPointsCumul: r.seasonPointsCumul,
        previousPeriodPoints: prevByRoster.get(r.rosterId),
      }))
  }

  const pastCutoff = input.periodEndedAt
    ? isPastCorrectionCutoff({
        correctionWindow: config.correctionWindow,
        periodEndedAt: input.periodEndedAt,
        statCorrectionHours: config.statCorrectionHours,
        customCutoffDayOfWeek: config.customCutoffDayOfWeek,
        customCutoffTimeUtc: config.customCutoffTimeUtc,
      })
    : false

  const orderedWorstFirst = [...scores].sort(
    (a, b) => a.periodPoints - b.periodPoints || a.seasonPointsCumul - b.seasonPointsCumul
  ).map((s) => s.rosterId)

  return {
    leagueId,
    weekOrPeriod,
    season: season ?? null,
    pastCutoff,
    activeRosterIds,
    scores,
    orderedWorstFirst,
    alreadyChoppedRosterIds,
  }
}

/**
 * Persist period scores for a league/period (call from scorer or sync job).
 */
export async function savePeriodScores(args: {
  leagueId: string
  weekOrPeriod: number
  season: number | null
  scores: { rosterId: string; periodPoints: number; seasonPointsCumul: number }[]
}): Promise<void> {
  const { leagueId, weekOrPeriod, season, scores } = args
  await prisma.$transaction(
    scores.map((s) =>
      prisma.guillotinePeriodScore.upsert({
        where: {
          leagueId_rosterId_weekOrPeriod: { leagueId, rosterId: s.rosterId, weekOrPeriod },
        },
        create: {
          leagueId,
          rosterId: s.rosterId,
          weekOrPeriod,
          season,
          periodPoints: s.periodPoints,
          seasonPointsCumul: s.seasonPointsCumul,
        },
        update: {
          periodPoints: s.periodPoints,
          seasonPointsCumul: s.seasonPointsCumul,
        },
      })
    )
  )
}
