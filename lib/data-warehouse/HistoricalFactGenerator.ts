/**
 * HistoricalFactGenerator — generates warehouse facts from existing league/roster/matchup/draft/transaction data.
 * Used by backfill pipelines and league history aggregation.
 */

import { prisma } from '@/lib/prisma'
import { WarehouseIngestionService } from './WarehouseIngestionService'
import { normalizeStatPayload } from './StatNormalizationService'
import { normalizeSportForWarehouse } from './types'

const ingestion = new WarehouseIngestionService()

export type HistoricalFactGenerationStatus = 'COMPLETED' | 'PARTIAL' | 'MISSING_SOURCE_DATA' | 'FAILED'

export interface GameFactGenerationResult {
  status: HistoricalFactGenerationStatus
  playerFacts: number
  teamFacts: number
  sourcePlayerGameStats: number
  sourceTeamGameStats: number
  warnings: string[]
}

/**
 * Generate PlayerGameFact and TeamGameFact from existing PlayerGameStat / TeamGameStat.
 *
 * Zero source rows is a MISSING_SOURCE_DATA condition, not a quiet success — for months this
 * returned {playerFacts: 0} truthfully while every layer above aggregated it into a normal
 * result, so the warehouse UI rendered "no history" as if it were real data.
 *
 * Idempotent by scoped regeneration: the fact tables have NO unique key on
 * (playerId, sport, gameId), so the old per-row `create` silently duplicated facts on every
 * re-run. Facts are pure derivations of the stat rows, so the week's facts are deleted and
 * rebuilt in one transaction (delete + createMany — also removes ~1,500 sequential awaited
 * creates per NFL week).
 */
export async function generateGameFactsFromExistingStats(
  sport: string,
  season: number,
  weekOrRound: number
): Promise<GameFactGenerationResult> {
  const sportNorm = normalizeSportForWarehouse(sport)
  const warnings: string[] = []

  // Explicit selects: a bare findMany requests every schema column, and prod's
  // player_game_stats has drifted behind schema.prisma before — Postgres rejects unknown
  // columns at parse time, so the bare read threw P2022 even against an empty table.
  const [playerStats, teamStats] = await Promise.all([
    prisma.playerGameStat.findMany({
      where: { sportType: sportNorm, season, weekOrRound },
      select: { playerId: true, gameId: true, statPayload: true, normalizedStatMap: true, fantasyPoints: true },
    }),
    prisma.teamGameStat.findMany({
      where: { sportType: sportNorm, season, weekOrRound },
      select: { teamId: true, gameId: true, statPayload: true },
    }),
  ])

  if (playerStats.length === 0 && teamStats.length === 0) {
    return {
      status: 'MISSING_SOURCE_DATA',
      playerFacts: 0,
      teamFacts: 0,
      sourcePlayerGameStats: 0,
      sourceTeamGameStats: 0,
      warnings: [
        `PlayerGameStat/TeamGameStat contain no source rows for ${sportNorm} season ${season} week ${weekOrRound} — nothing to generate facts from.`,
      ],
    }
  }
  if (playerStats.length === 0) {
    warnings.push(`PlayerGameStat has no source rows for ${sportNorm} season ${season} week ${weekOrRound}.`)
  }

  const playerFactRows = playerStats.map((s) => ({
    playerId: s.playerId,
    sport: sportNorm,
    gameId: s.gameId,
    statPayload: (s.statPayload ?? {}) as object,
    normalizedStats: normalizeStatPayload(sport, (s.normalizedStatMap as Record<string, unknown>) ?? {}) as object,
    fantasyPoints: s.fantasyPoints,
    scoringPeriod: weekOrRound,
    season,
    weekOrRound,
  }))

  const teamFactRows = teamStats.map((s) => {
    const payload = (s.statPayload as { points?: number; opponentPoints?: number }) ?? {}
    return {
      teamId: s.teamId,
      sport: sportNorm,
      gameId: s.gameId,
      pointsScored: typeof payload.points === 'number' ? payload.points : 0,
      opponentPoints: typeof payload.opponentPoints === 'number' ? payload.opponentPoints : 0,
      result: payload.points != null && payload.opponentPoints != null
        ? (payload.points > payload.opponentPoints ? 'W' : payload.points < payload.opponentPoints ? 'L' : 'T')
        : null,
      season,
      weekOrRound,
    }
  })

  await prisma.$transaction([
    prisma.playerGameFact.deleteMany({ where: { sport: sportNorm, season, weekOrRound } }),
    ...(playerFactRows.length > 0 ? [prisma.playerGameFact.createMany({ data: playerFactRows })] : []),
    prisma.teamGameFact.deleteMany({ where: { sport: sportNorm, season, weekOrRound } }),
    ...(teamFactRows.length > 0 ? [prisma.teamGameFact.createMany({ data: teamFactRows })] : []),
  ])

  return {
    status: warnings.length > 0 ? 'PARTIAL' : 'COMPLETED',
    playerFacts: playerFactRows.length,
    teamFacts: teamFactRows.length,
    sourcePlayerGameStats: playerStats.length,
    sourceTeamGameStats: teamStats.length,
    warnings,
  }
}

/**
 * Generate MatchupFact from TeamPerformance for a league/week.
 */
export async function generateMatchupFactsFromLeague(
  leagueId: string,
  season: number,
  week: number
): Promise<number> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, include: { teams: true } })
  if (!league) return 0
  const sport = normalizeSportForWarehouse(league.sport)
  const teamIds = league.teams.map((t) => t.id)
  const perfs = await prisma.teamPerformance.findMany({
    where: { teamId: { in: teamIds }, season, week },
  })
  const byTeam = new Map<string, { points: number }>()
  for (const p of perfs) {
    byTeam.set(p.teamId, { points: p.points })
  }
  let count = 0
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const a = teamIds[i]
      const b = teamIds[j]
      const scoreA = byTeam.get(a)?.points ?? 0
      const scoreB = byTeam.get(b)?.points ?? 0
      const winner = scoreA > scoreB ? a : scoreB > scoreA ? b : null
      await ingestion.ingestMatchupFact({
        leagueId,
        sport,
        weekOrPeriod: week,
        teamA: a,
        teamB: b,
        scoreA,
        scoreB,
        winnerTeamId: winner ?? undefined,
        season,
      })
      count++
    }
  }
  return count
}

/**
 * Generate SeasonStandingFact from LeagueTeam for a league/season.
 */
export async function generateStandingFactsFromLeague(
  leagueId: string,
  season: number
): Promise<number> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return 0
  const sport = normalizeSportForWarehouse(league.sport)
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    orderBy: [{ pointsFor: 'desc' }, { currentRank: 'asc' }],
  })
  let rank = 1
  for (const t of teams) {
    await ingestion.ingestSeasonStandingFact({
      leagueId,
      sport,
      season,
      teamId: t.id,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      rank: t.currentRank ?? rank,
    })
    rank++
  }
  return teams.length
}

/**
 * Generate RosterSnapshot from Roster for a league (current state as one period).
 */
export async function generateRosterSnapshotsFromLeague(
  leagueId: string,
  weekOrPeriod: number,
  season?: number
): Promise<number> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return 0
  const sport = normalizeSportForWarehouse(league.sport)
  const rosters = await prisma.roster.findMany({ where: { leagueId } })
  let count = 0
  for (const r of rosters) {
    const playerData = (r.playerData as { roster?: unknown[]; starters?: unknown[] }) ?? {}
    const rosterPlayers = Array.isArray(playerData.roster) ? playerData.roster : []
    const lineupPlayers = Array.isArray(playerData.starters) ? playerData.starters : []
    const benchPlayers = rosterPlayers.filter(
      (p: unknown) => !lineupPlayers.some((s: unknown) => (s as { id?: string })?.id === (p as { id?: string })?.id)
    )
    await ingestion.ingestRosterSnapshot({
      leagueId,
      teamId: r.id,
      sport,
      weekOrPeriod,
      season: season ?? league.season ?? undefined,
      rosterPlayers,
      lineupPlayers,
      benchPlayers,
    })
    count++
  }
  return count
}

/**
 * Generate DraftFact from MockDraft or league draft results for a league.
 */
export async function generateDraftFactsFromMockDraft(
  mockDraftId: string
): Promise<number> {
  const draft = await prisma.mockDraft.findUnique({ where: { id: mockDraftId } })
  if (!draft?.leagueId) return 0
  const league = await prisma.league.findUnique({ where: { id: draft.leagueId } })
  const sport = league ? normalizeSportForWarehouse(league.sport) : 'NFL'
  const results = (draft.results as { picks?: Array<{ round: number; pick: number; playerId?: string; managerId?: string }> })?.picks ?? []
  let count = 0
  for (const p of results) {
    await ingestion.ingestDraftFact({
      leagueId: draft.leagueId!,
      sport,
      round: p.round ?? 1,
      pickNumber: p.pick ?? count + 1,
      playerId: p.playerId ?? '',
      managerId: p.managerId ?? undefined,
      season: league?.season ?? undefined,
    })
    count++
  }
  return count
}

/**
 * Generate DraftFact rows from live draft session picks for a league.
 */
export async function generateDraftFactsFromLeague(
  leagueId: string,
  season?: number
): Promise<number> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return 0

  const sport = normalizeSportForWarehouse(league.sport)
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (!session) return 0

  const picks = await prisma.draftPick.findMany({
    where: { sessionId: session.id },
    orderBy: [{ round: 'asc' }, { overall: 'asc' }],
  })

  let count = 0
  for (const pick of picks) {
    if (!pick.playerId) continue
    await ingestion.ingestDraftFact({
      leagueId,
      sport,
      round: pick.round,
      pickNumber: pick.overall,
      playerId: pick.playerId,
      managerId: pick.rosterId,
      season: season ?? league.season ?? undefined,
    })
    count++
  }
  return count
 }

/**
 * Generate TransactionFact from WaiverTransaction / WaiverClaim for a league.
 */
export async function generateTransactionFactsFromLeague(
  leagueId: string,
  since?: Date
): Promise<number> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return 0
  const sport = normalizeSportForWarehouse(league.sport)
  const txs = await prisma.waiverTransaction.findMany({
    where: { leagueId, ...(since ? { processedAt: { gte: since } } : {}) },
    orderBy: { processedAt: 'asc' },
  })
  let count = 0
  for (const t of txs) {
    await ingestion.ingestTransactionFact({
      leagueId,
      sport,
      type: 'waiver_add',
      playerId: t.addPlayerId,
      managerId: undefined,
      rosterId: t.rosterId,
      payload: { dropPlayerId: t.dropPlayerId, faabSpent: t.faabSpent },
      weekOrPeriod: undefined,
    })
    count++
  }
  return count
}
