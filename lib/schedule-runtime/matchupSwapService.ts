/**
 * Applying a commissioner's swap of two teams in one week (lib/schedule-runtime/matchupSwap.ts).
 *
 * Only a regular-season week that has not started can change — the same "started" rule schedule regeneration uses
 * (lib/schedule-runtime/scheduleRegeneration.ts) — and the swap is written to the league log with who made it.
 */
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { planTeamSwap } from './matchupSwap'
import { weekHasStarted } from './scheduleRegeneration'

export type SwapResult = { ok: true; week: number } | { ok: false; status: number; code: string; message: string }

export async function swapTeamsInWeek(input: {
  seasonId: string
  week: number
  rosterA: string
  rosterB: string
  actorUserId: string
  now?: Date
}): Promise<SwapResult> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId },
    select: {
      id: true, leagueId: true, sport: true, season: true, currentWeek: true, playoffStartWeek: true,
      schedule: { select: { week: true, status: true, homeScore: true, awayScore: true } },
    },
  })
  if (!season) return { ok: false, status: 404, code: 'SEASON_NOT_FOUND', message: 'Season not found.' }
  const week = Math.floor(input.week)
  if (!Number.isFinite(week) || week < 1 || week >= season.playoffStartWeek) {
    return { ok: false, status: 400, code: 'NOT_REGULAR_SEASON', message: 'Only regular-season weeks can be edited here.' }
  }
  if (weekHasStarted(week, { currentWeek: season.currentWeek, sport: season.sport, seasonYear: season.season, now: input.now ?? new Date(), persisted: season.schedule })) {
    return { ok: false, status: 409, code: 'WEEK_STARTED', message: `Week ${week} has already started, so its matchups can no longer change.` }
  }
  const rows = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week, type: 'regular', isMedianMatchup: false },
    select: { id: true, homeRosterId: true, awayRosterId: true },
  })
  const plan = planTeamSwap(rows, input.rosterA, input.rosterB)
  if (!plan.ok) return { ok: false, status: 400, code: plan.code, message: plan.message }

  await prisma.$transaction(
    plan.updates.map((u) => prisma.redraftMatchup.update({ where: { id: u.id }, data: { homeRosterId: u.homeRosterId, awayRosterId: u.awayRosterId } })),
  )
  await logAction({
    leagueId: season.leagueId,
    userId: input.actorUserId,
    actionType: 'schedule_matchup_swap',
    entityType: 'schedule',
    entityId: season.id,
    beforeState: rows.filter((r) => plan.updates.some((u) => u.id === r.id)),
    afterState: plan.updates,
    metadata: { week, rosterA: input.rosterA, rosterB: input.rosterB },
  }).catch(() => {})
  return { ok: true, week }
}
