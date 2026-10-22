import 'server-only'

import { prisma } from '@/lib/prisma'
import { eliminationsInWeek, weekCouncilState, type CouncilWeekPosition, type WeekCouncilCounts, type WeekCouncilState } from './survivorEliminationSchedule'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'

/** Audit actions that close out a planned elimination: a vote-out, or the final-three skip. */
export const PLANNED_ELIMINATION_ACTIONS = ['player_eliminated', 'planned_elimination_skipped_final_three'] as const

export interface WeekCouncilProgress extends WeekCouncilCounts, WeekCouncilState {
  /** Tribes that already attended a council this week, so a second council can send another. */
  attendedTribeIds: string[]
}

type Db = Pick<typeof prisma, 'survivorAuditEntry' | 'survivorTribalCouncil'>

/** Where `week` of a planned season stands: how many councils it owes and how many have run. */
export async function loadWeekCouncilProgress(
  leagueId: string,
  week: number,
  eliminationWeeks: readonly number[],
  db: Db = prisma,
): Promise<WeekCouncilProgress> {
  const [rows, councils] = await Promise.all([
    db.survivorAuditEntry.findMany({ where: { leagueId, week, action: { in: [...PLANNED_ELIMINATION_ACTIONS] } }, select: { action: true } }),
    db.survivorTribalCouncil.findMany({ where: { leagueId, week, NOT: { phase: 'revote' } }, select: { attendingTribeId: true } }),
  ])
  const counts: WeekCouncilCounts = {
    planned: eliminationsInWeek(eliminationWeeks, week),
    eliminated: rows.filter(row => row.action === 'player_eliminated').length,
    skipped: rows.some(row => row.action === 'planned_elimination_skipped_final_three'),
    opened: councils.length,
  }
  return {
    ...counts,
    ...weekCouncilState(counts),
    attendedTribeIds: [...new Set(councils.map(c => c.attendingTribeId).filter((id): id is string => Boolean(id)))],
  }
}

/**
 * Which of its week's votes `council` is, for the "Vote 2 of 2 this week" label. Revotes are not
 * counted: a revote re-runs the vote before it and shares its number.
 */
export async function loadCouncilWeekPosition(
  leagueId: string,
  council: { week: number; councilNumber: number },
  leagueSettings: unknown,
  db: Pick<typeof prisma, 'survivorTribalCouncil'> = prisma,
): Promise<CouncilWeekPosition> {
  const plan = readSurvivorFullSeasonPlan(leagueSettings)
  const ordinal = await db.survivorTribalCouncil.count({
    where: { leagueId, week: council.week, councilNumber: { lte: council.councilNumber }, NOT: { phase: 'revote' } },
  })
  return { ordinal: Math.max(1, ordinal), planned: plan ? eliminationsInWeek(plan.eliminationWeeks, council.week) : 0 }
}
