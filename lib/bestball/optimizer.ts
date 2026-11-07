import type { BestBallOptimizedLineup } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { templateSlotsToLineupSlots } from './soccerFormationOptimizer'
import { optimizeLineupForSport } from './optimizerCore'
import { OPTIMAL_LINEUP_ALGORITHM } from '@/lib/lineup-optimizer/optimalLineup'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { resolveBestBallScoringPeriod } from './scoringPeriod'
import type { LineupSlotDef, OptimizerPlayer } from './types'

export type RunBestBallOptimizerArgs = {
  rosterId?: string | null
  leagueId?: string | null
  week: number
  sport: string
  seasonId?: string | null
  entryId?: string | null
  contestId?: string | null
}

async function loadTemplate(sport: string, variant: string) {
  const s = normalizeToSupportedSport(sport)
  return prisma.bestBallSportTemplate.findUnique({
    where: { sport_variant: { sport: s, variant } },
  })
}

export type BestBallDataQuality = {
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'
  excludedPlayerIds: string[]
  warnings: string[]
}

export function buildDataQuality(rosterPlayerIds: string[], availablePlayerIds: Set<string>): BestBallDataQuality {
  const excludedPlayerIds = rosterPlayerIds.filter((id) => !availablePlayerIds.has(id))
  if (excludedPlayerIds.length === 0) {
    return { status: 'AVAILABLE', excludedPlayerIds: [], warnings: [] }
  }
  if (excludedPlayerIds.length === rosterPlayerIds.length) {
    return {
      status: 'UNAVAILABLE',
      excludedPlayerIds,
      warnings: ['No rostered player has a finalized PlayerWeeklyScore row for this week — nothing was optimized.'],
    }
  }
  return {
    status: 'PARTIAL',
    excludedPlayerIds,
    warnings: [
      `${excludedPlayerIds.length} rostered player(s) excluded from optimization — no PlayerWeeklyScore row for this week: ${excludedPlayerIds.join(', ')}`,
    ],
  }
}

/**
 * Runs best-ball optimizer for a redraft roster or contest entry; upserts `BestBallOptimizedLineup`.
 */
export async function runBestBallOptimizer(args: RunBestBallOptimizerArgs): Promise<BestBallOptimizedLineup> {
  const sport = normalizeToSupportedSport(args.sport)
  const week = args.week

  let leagueId = args.leagueId ?? null
  let seasonId = args.seasonId ?? null
  let rosterId = args.rosterId ?? null
  let entryId = args.entryId ?? null
  let contestId = args.contestId ?? null
  let seasonYear = new Date().getFullYear()
  let variant = 'standard'
  let requireFinalized = true

  if (entryId) {
    const entry = await prisma.bestBallEntry.findFirst({
      where: { id: entryId },
      include: { contest: true },
    })
    if (!entry) throw new Error('BestBallEntry not found')
    contestId = entry.contestId
    variant = entry.contest.variant ?? 'tournament'
    seasonYear = entry.contest.contestStartsAt?.getFullYear() ?? seasonYear
    const league = leagueId
      ? await prisma.league.findFirst({ where: { id: leagueId }, select: { bbOptimizerTiming: true } })
      : null
    if (league?.bbOptimizerTiming === 'realtime') requireFinalized = false

    const template = await loadTemplate(sport, variant)
    if (!template) throw new Error(`No BestBallSportTemplate for ${sport}/${variant}`)

    const slots = templateSlotsToLineupSlots(template.lineupSlots)
    const roster = (entry.roster as unknown as { playerId?: string; playerName?: string; position?: string }[]) ?? []
    const rosterPlayerIds = roster.filter((r) => r.playerId && r.position).map((r) => r.playerId!)
    const availablePlayerIds = new Set<string>()
    const players: OptimizerPlayer[] = []
    for (const r of roster) {
      if (!r.playerId || !r.position) continue
      const row = await prisma.playerWeeklyScore.findUnique({
        where: {
          playerId_week_season_sport: {
            playerId: r.playerId,
            week,
            season: seasonYear,
            sport,
          },
        },
      })
      const hasRealData = Boolean(row) && (!requireFinalized || row!.isFinalized)
      if (!hasRealData) continue
      availablePlayerIds.add(r.playerId)
      players.push({
        playerId: r.playerId,
        playerName: String(r.playerName ?? r.playerId),
        position: r.position,
        points: row!.fantasyPts,
      })
    }
    const dataQuality = buildDataQuality(rosterPlayerIds, availablePlayerIds)

    const opt = optimizeLineupForSport(players, slots as LineupSlotDef[], sport)
    const starterIds = opt.assignments.map((a) => a.player.playerId)
    const used = new Set(starterIds)
    const benchIds = players.map((p) => p.playerId).filter((id) => !used.has(id))
    const lineupBreakdown = players.map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      slot: opt.assignments.find((a) => a.player.playerId === p.playerId)?.slot ?? 'bench',
      points: p.points,
      wasUsed: used.has(p.playerId),
    }))

    const existing = await prisma.bestBallOptimizedLineup.findFirst({
      where: { contestId, entryId, week },
    })

    const data = {
      leagueId,
      seasonId,
      rosterId,
      contestId,
      entryId,
      week,
      scoringPeriod: template.scoringPeriod,
      starterIds,
      benchIds,
      totalPoints: opt.totalPoints,
      lineupBreakdown,
      alternateExists: opt.alternateExists,
      alternateLineup: opt.alternateLineup as object | undefined,
      optimizerLog: { ...(opt.optimizerLog as object), dataQuality },
      isFinalized: requireFinalized,
      finalizedAt: requireFinalized ? new Date() : null,
    }

    if (existing) {
      return prisma.bestBallOptimizedLineup.update({
        where: { id: existing.id },
        data,
      })
    }
    return prisma.bestBallOptimizedLineup.create({ data })
  }

  if (!rosterId) throw new Error('rosterId or entryId required')

  /*
   * 🛑 A LEAGUE ROSTER'S CACHED LINEUP IS THE MATCHUP'S LINEUP, COMPUTED BY THE MATCHUP'S CODE.
   *
   * This used to seat the roster over the `BestBallSportTemplate` DB row's slots (not the league's), on
   * the generic `fantasyPts` (not the league's scoring), with the greedy optimizer, over the CURRENT
   * roster (not the roster as of the week, with IR / taxi excluded). Four differences, any of which made
   * this cache — which `/api/bestball/optimize` serves and survivor scores from — disagree with the
   * matchup. It now asks production for the week (`scoreRosterForWeek`, the same call a guillotine week
   * and the stat-correction path use) and only reshapes the answer into this table.
   */
  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId },
    include: { season: true, players: true },
  })
  if (!roster) throw new Error('RedraftRoster not found')

  seasonId = roster.seasonId
  leagueId = roster.leagueId
  seasonYear = roster.season.season
  const league = await prisma.league.findFirst({
    where: { id: roster.leagueId },
    select: { sport: true, settings: true, bbOptimizerTiming: true },
  })
  if (league?.bbOptimizerTiming === 'realtime') requireFinalized = false

  const summary = await scoreRosterForWeek({ leagueId, rosterId, week, seasonYear, collectPlayerPoints: true })
  const scored = summary.playerPoints ?? []
  const rowById = new Map(roster.players.map((p) => [p.playerId, p]))
  const slotById = new Map((summary.bestBall?.assignments ?? []).map((a) => [a.playerId, a.slot]))
  const daily = summary.bestBall?.period === 'daily'
  const starterIds = scored.filter((p) => p.isStarter).map((p) => p.playerId)
  const benchIds = scored.filter((p) => !p.isStarter).map((p) => p.playerId)
  const lineupBreakdown = scored.map((p) => ({
    playerId: p.playerId,
    playerName: rowById.get(p.playerId)?.playerName ?? p.playerId,
    position: rowById.get(p.playerId)?.position ?? null,
    slot: p.isStarter ? (slotById.get(p.playerId) ?? (daily ? 'daily' : 'starter')) : 'bench',
    points: p.points,
    wasUsed: p.isStarter,
  }))
  const dataQuality = buildDataQuality(
    [...scored.map((p) => p.playerId), ...summary.missingPlayerIds],
    new Set(scored.map((p) => p.playerId)),
  )
  // Final only when production says every candidate's week is sealed — never on the caller's say-so.
  const isFinalized = requireFinalized && summary.allFinal && summary.missingPlayerIds.length === 0

  const existing = await prisma.bestBallOptimizedLineup.findFirst({
    where: { seasonId, rosterId, week, entryId: null },
  })

  const data = {
    leagueId,
    seasonId,
    rosterId,
    contestId: null,
    entryId: null,
    week,
    scoringPeriod: resolveBestBallScoringPeriod({ sport: league?.sport ?? sport, settings: league?.settings }),
    starterIds,
    benchIds,
    totalPoints: summary.points,
    lineupBreakdown,
    alternateExists: false,
    alternateLineup: undefined,
    optimizerLog: {
      algorithm: OPTIMAL_LINEUP_ALGORITHM,
      source: 'redraft-scoringEngine.scoreRosterForWeek',
      sport,
      unfilledSlots: (summary.bestBall?.unfilledSlots ?? []).map((u) => `${u.slot} #${u.seat}`),
      dataQuality,
    },
    isFinalized,
    finalizedAt: isFinalized ? new Date() : null,
  }

  if (existing) {
    return prisma.bestBallOptimizedLineup.update({
      where: { id: existing.id },
      data,
    })
  }
  return prisma.bestBallOptimizedLineup.create({ data })
}

/** Batch run for all rosters in a redraft season (best-ball leagues) or all entries in a contest. */
export async function runBestBallOptimizerBatch(params: {
  seasonId?: string
  contestId?: string
  week: number
}): Promise<{ processed: number; kind: 'season' | 'contest' }> {
  const week = params.week
  if (params.contestId) {
    const c = await prisma.bestBallContest.findFirst({ where: { id: params.contestId } })
    if (!c) throw new Error('Contest not found')
    const entries = await prisma.bestBallEntry.findMany({ where: { contestId: params.contestId } })
    for (const e of entries) {
      await runBestBallOptimizer({ entryId: e.id, leagueId: null, week, sport: c.sport })
    }
    return { processed: entries.length, kind: 'contest' }
  }
  if (params.seasonId) {
    const season = await prisma.redraftSeason.findFirst({
      where: { id: params.seasonId },
      include: { rosters: true },
    })
    if (!season) throw new Error('RedraftSeason not found')
    const league = await prisma.league.findFirst({ where: { id: season.leagueId } })
    if (!league?.bestBallMode) {
      return { processed: 0, kind: 'season' }
    }
    let n = 0
    for (const r of season.rosters) {
      await runBestBallOptimizer({
        rosterId: r.id,
        leagueId: season.leagueId,
        week,
        sport: season.sport,
        seasonId: season.id,
      })
      n++
    }
    return { processed: n, kind: 'season' }
  }
  throw new Error('seasonId or contestId required')
}

/** Cron: all best-ball redraft seasons + active contests for a scoring week. */
export async function runBestBallOptimizerCronSweep(week: number): Promise<{ processed: number; week: number }> {
  const seasons = await prisma.redraftSeason.findMany({
    where: { league: { bestBallMode: true } },
    select: { id: true },
  })
  let processed = 0
  for (const s of seasons) {
    const r = await runBestBallOptimizerBatch({ seasonId: s.id, week })
    processed += r.processed
  }
  const contests = await prisma.bestBallContest.findMany({
    where: { status: { in: ['active', 'drafting'] } },
    select: { id: true },
  })
  for (const c of contests) {
    const r = await runBestBallOptimizerBatch({ contestId: c.id, week })
    processed += r.processed
  }
  return { processed, week }
}
