import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildWeekKickoffMap, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import { readSurvivorGovernanceSettings, type SurvivorGovernanceDay } from './survivorGovernanceSettings'
import { WEEK_ONE_WINDOW_SPORTS, weekOneCutoffDay, weekOneExcludedPoints } from './survivorWeekOneWindow'

/**
 * Whether the Survivor week-1 window applies to this week: the commissioner set a start day, the
 * league plays a weekly-kickoff sport, and `week` is the season's first Survivor week.
 */
export function survivorWeekOneStartDay(league: { sport?: string | null; settings: unknown }, week: number): SurvivorGovernanceDay | null {
  const day = readSurvivorGovernanceSettings(league.settings).weekOneScoringStartDay
  if (!day || !WEEK_ONE_WINDOW_SPORTS.includes(String(league.sport ?? '').toUpperCase())) return null
  const firstWeek = readSurvivorFullSeasonPlan(league.settings)?.startWeek ?? 1
  return week === firstWeek ? day : null
}

/**
 * Points to take off a roster's week-1 Survivor total. Reads the league's own schedule rows
 * (SportsGame, via the lineup-lock kickoff map) and the roster's players' teams — no provider call.
 * A player whose team or kickoff is unknown keeps his points: the window removes only what it can
 * prove started early.
 */
export async function survivorWeekOneExclusion(
  args: {
    sport: string
    season: number
    week: number
    startDay: SurvivorGovernanceDay
    redraftRosterId: string
    playerPoints: ReadonlyArray<{ playerId: string; points: number; isStarter: boolean }>
  },
  db: PrismaClient = prisma,
): Promise<number> {
  const starters = args.playerPoints.filter((p) => p.isStarter)
  if (starters.length === 0) return 0
  const [kickoffs, rows] = await Promise.all([
    buildWeekKickoffMap(db, { sport: args.sport, season: args.season, week: args.week }),
    db.redraftRosterPlayer.findMany({ where: { rosterId: args.redraftRosterId, playerId: { in: starters.map((p) => p.playerId) } }, select: { playerId: true, team: true } }),
  ])
  const cutoff = weekOneCutoffDay(kickoffs.firstKickoff, args.startDay)
  const kickoffByPlayer = new Map<string, Date | null>()
  for (const row of rows) {
    const kickoff = lockTeamLookupKeys(args.sport, row.team).map((key) => kickoffs.byTeam.get(key)).find((k): k is Date => k != null) ?? null
    kickoffByPlayer.set(row.playerId, kickoff)
  }
  return weekOneExcludedPoints(args.playerPoints, kickoffByPlayer, cutoff)
}
