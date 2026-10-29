import 'server-only'

/**
 * Server half of ./chopPreview.ts: gathers this week's inputs the way the native week runner does
 * (./nativeGuillotineWeek.ts) — the same next-chop week, every surviving team scored with the same
 * scorer, mapped into the engine's roster id space — and writes nothing.
 *
 * A team that cannot be mapped is not dropped: the real chop REFUSES to run in that case, so the
 * preview says so as a blocker, which is the point of looking ahead.
 */
import { prisma } from '@/lib/prisma'
import { getGuillotineConfig } from './GuillotineLeagueConfig'
import { getDraftSlotByRoster } from './GuillotineWeekEvaluator'
import { resolveGuillotineEndgame } from './endgameRules'
import { readAdvanced } from './chopSchedule'
import { readFaabOnChop } from './faabOnChop'
import { rosterIdForOwner } from './finishGuillotineSeason'
import { resolveRosterDisplayNames } from './rosterDisplayNames'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { buildChopPreview, type ChopPreview, type ChopPreviewTeam } from './chopPreview'

export async function loadChopPreview(leagueId: string): Promise<ChopPreview | { error: string }> {
  const [config, league, season] = await Promise.all([
    getGuillotineConfig(leagueId),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineEndgame: true } }),
    prisma.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, season: true, currentWeek: true },
    }),
  ])
  if (!config || !league) return { error: 'Not a Guilly league.' }
  if (!season) return { error: 'The preview starts once the draft is done and the season is set up.' }

  // The next week to chop, by the native runner's rule: one past the last chop or scored week.
  const [gSeason, lastChop] = await Promise.all([
    prisma.guillotineSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { currentScoringPeriod: true } }),
    prisma.guillotineRosterState.findFirst({
      where: { leagueId, choppedInPeriod: { not: null } },
      orderBy: { choppedInPeriod: 'desc' },
      select: { choppedInPeriod: true },
    }),
  ])
  const week = Math.max(Math.max(lastChop?.choppedInPeriod ?? 0, gSeason?.currentScoringPeriod ?? 0) + 1, config.eliminationStartWeek)

  const [active, rosters, choppedStates] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { seasonId: season.id, isEliminated: false }, select: { id: true, ownerId: true, teamName: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true, faabRemaining: true } }),
    prisma.guillotineRosterState.findMany({ where: { leagueId, choppedAt: { not: null } }, select: { rosterId: true } }),
  ])
  const chopped = new Set(choppedStates.map((c) => c.rosterId))

  const blockers: string[] = []
  const placed: Array<{ redraftId: string; rosterId: string; teamName: string | null }> = []
  for (const r of active) {
    const rosterId = rosters.find((x) => x.redraftRosterId === r.id)?.id ?? rosterIdForOwner(r.ownerId, rosters)
    if (rosterId) placed.push({ redraftId: r.id, rosterId, teamName: r.teamName })
    else blockers.push(`${r.teamName ?? 'A team'} can't be matched to its league roster, so the chop will refuse to run until it is fixed.`)
  }
  const covered = new Set(placed.map((p) => p.rosterId))
  const orphaned = rosters.filter((r) => !chopped.has(r.id) && !covered.has(r.id)).length
  if (orphaned > 0) blockers.push(`${orphaned === 1 ? 'One roster has' : `${orphaned} rosters have`} no team in this season, so the chop will refuse to run until it is fixed.`)

  const [previous, names, draftSlotByRoster, playerCounts] = await Promise.all([
    prisma.guillotinePeriodScore.findMany({
      where: { leagueId, season: season.season, weekOrPeriod: { lt: week } },
      select: { rosterId: true, periodPoints: true, weekOrPeriod: true },
    }),
    resolveRosterDisplayNames(leagueId, placed.map((p) => p.rosterId)),
    getDraftSlotByRoster(leagueId),
    prisma.redraftRosterPlayer.groupBy({ by: ['rosterId'], where: { rosterId: { in: placed.map((p) => p.redraftId) }, droppedAt: null }, _count: { _all: true } }),
  ])
  const cumulBefore = new Map<string, number>()
  const lastWeek = new Map<string, number>()
  for (const p of previous) {
    cumulBefore.set(p.rosterId, (cumulBefore.get(p.rosterId) ?? 0) + p.periodPoints)
    if (p.weekOrPeriod === week - 1) lastWeek.set(p.rosterId, p.periodPoints)
  }
  const countByRedraft = new Map(playerCounts.map((c) => [c.rosterId, c._count._all]))
  const faabByRoster = new Map(rosters.map((r) => [r.id, r.faabRemaining]))

  // Scored the same way the chop scores them. A week not started yet reads as 0 for everyone.
  const teams: ChopPreviewTeam[] = []
  for (const p of placed) {
    const s = await scoreRosterForWeek({ leagueId, rosterId: p.redraftId, week, seasonYear: season.season, includeBench: true }).catch(() => null)
    const periodPoints = s?.points ?? 0
    teams.push({
      rosterId: p.rosterId,
      name: p.teamName?.trim() || names.get(p.rosterId) || 'Unnamed team',
      periodPoints,
      seasonPointsCumul: Math.round(((cumulBefore.get(p.rosterId) ?? 0) + periodPoints) * 100) / 100,
      ...(typeof s?.benchPoints === 'number' ? { benchPoints: s.benchPoints } : {}),
      ...(lastWeek.has(p.rosterId) ? { previousPeriodPoints: lastWeek.get(p.rosterId) } : {}),
      faab: faabByRoster.get(p.rosterId) ?? null,
      playerCount: countByRedraft.get(p.redraftId) ?? 0,
    })
  }

  const endgame = resolveGuillotineEndgame(league)
  return buildChopPreview({
    week,
    weekState: week < season.currentWeek ? 'final' : 'live',
    eliminationStartWeek: config.eliminationStartWeek,
    eliminationEndWeek: config.eliminationEndWeek ?? null,
    teamsPerChop: config.teamsPerChop,
    advanced: readAdvanced(league.settings),
    endgame: { format: endgame.format, threshold: endgame.threshold },
    tiebreakerOrder: config.tiebreakerOrder,
    dangerMarginPoints: config.dangerMarginPoints ?? 10,
    faabOnChop: readFaabOnChop(league.settings),
    rosterReleaseTiming: config.rosterReleaseTiming,
    teams,
    previousWeek: [...lastWeek].map(([rosterId, periodPoints]) => ({ rosterId, periodPoints })),
    draftSlotByRoster,
    blockers,
  })
}
