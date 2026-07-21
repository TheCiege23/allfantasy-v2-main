import type { BestBallOptimizedLineup } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { templateSlotsToLineupSlots } from './soccerFormationOptimizer'
import { optimizeLineupForSport } from './optimizerCore'
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

/**
 * Only players with a real (finalized-if-required) `PlayerWeeklyScore` row end up in the
 * returned map. A missing row is absent from the map — never coerced to a fabricated 0 — so
 * callers can tell "no data" apart from a real zero-point week.
 */
async function loadWeeklyPoints(
  players: { playerId: string; sport: string }[],
  week: number,
  seasonYear: number,
  requireFinalized: boolean,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const p of players) {
    const row = await prisma.playerWeeklyScore.findUnique({
      where: {
        playerId_week_season_sport: {
          playerId: p.playerId,
          week,
          season: seasonYear,
          sport: p.sport,
        },
      },
    })
    if (!row) continue
    if (requireFinalized && !row.isFinalized) continue
    map.set(p.playerId, row.fantasyPts)
  }
  return map
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

  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId },
    include: {
      season: true,
      players: { where: { droppedAt: null } },
    },
  })
  if (!roster) throw new Error('RedraftRoster not found')

  seasonId = roster.seasonId
  leagueId = roster.leagueId
  seasonYear = roster.season.season
  const league = await prisma.league.findFirst({
    where: { id: roster.leagueId },
    select: {
      bestBallVariant: true,
      bbOptimizerTiming: true,
    },
  })
  variant = league?.bestBallVariant ?? 'standard'
  if (league?.bbOptimizerTiming === 'realtime') requireFinalized = false

  const template = await loadTemplate(sport, variant)
  if (!template) throw new Error(`No BestBallSportTemplate for ${sport}/${variant}`)

  const slots = templateSlotsToLineupSlots(template.lineupSlots)
  const ptsMap = await loadWeeklyPoints(
    roster.players.map((p) => ({ playerId: p.playerId, sport: p.sport })),
    week,
    seasonYear,
    requireFinalized,
  )

  const players: OptimizerPlayer[] = roster.players
    .filter((p) => ptsMap.has(p.playerId))
    .map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      points: ptsMap.get(p.playerId)!,
    }))
  const dataQuality = buildDataQuality(
    roster.players.map((p) => p.playerId),
    new Set(ptsMap.keys()),
  )

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
    where: { seasonId, rosterId, week, entryId: null },
  })

  const data = {
    leagueId,
    seasonId,
    rosterId,
    contestId: null,
    entryId: null,
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
