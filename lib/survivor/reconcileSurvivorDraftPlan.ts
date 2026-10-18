import 'server-only'

import type { Prisma } from '@prisma/client'
import { buildSurvivorFullSeasonPlan, readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'

/** Rebase a creation preview to the completed draft, once, before Survivor play starts. */
export async function reconcileSurvivorDraftPlan(db: Prisma.TransactionClient, leagueId: string, sessionId: string): Promise<void> {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorMode: true } })
  const saved = readSurvivorFullSeasonPlan(league?.settings)
  if (!league?.survivorMode || !saved) return
  const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, phase: true } })
  if (game && (game.currentWeek > 0 || !['pre_draft', 'draft', 'pre_merge'].includes(game.phase))) return
  const settings = league.settings as Record<string, Prisma.JsonValue>
  if (settings.survivor_calendar_draft_id === sessionId) return
  const draft = await db.draftSession.findFirst({ where: { id: sessionId, leagueId, status: 'completed', sessionKind: { not: 'mock' }, sleeperDraftId: null }, select: { completedAt: true } })
  if (!draft?.completedAt) throw new Error('Record the native draft completion time before starting this Survivor season.')
  const plan = buildSurvivorFullSeasonPlan({ sport: saved.sport, season: saved.season, castSize: saved.castSize, endWeek: saved.endWeek, now: draft.completedAt, exileEnabled: saved.exileReturnSlots === 1, exileReturnWeek: saved.exileReturnWeek, finalistCount: saved.finalistCount })
  await db.league.update({ where: { id: leagueId }, data: { settings: { ...settings, survivor_full_season_plan: plan, survivor_calendar_draft_id: sessionId } as unknown as Prisma.InputJsonValue } })
  await db.survivorLeagueConfig.updateMany({ where: { leagueId }, data: { regularSeasonEndWeek: plan.endWeek } })
  // A season may have been created by a pre-draft read. Never shift a played week.
  await db.redraftSeason.updateMany({ where: { leagueId, currentWeek: { lte: saved.startWeek }, status: { in: ['setup', 'active'] }, rosters: { none: { OR: [{ pointsFor: { gt: 0 } }, { wins: { gt: 0 } }, { losses: { gt: 0 } }, { ties: { gt: 0 } }] } } }, data: { currentWeek: plan.startWeek, totalWeeks: plan.endWeek, playoffStartWeek: plan.endWeek + 1 } })
}
