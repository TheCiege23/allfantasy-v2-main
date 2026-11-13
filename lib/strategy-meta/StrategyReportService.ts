/**
 * Generates and persists StrategyMetaReport from league outcomes.
 * Uses SeasonResult + draft/roster data; runs StrategyPatternAnalyzer and MetaSuccessEvaluator.
 */
import { prisma } from '@/lib/prisma'
import { detectStrategies, toLeagueFormat } from './StrategyPatternAnalyzer'
import { computeStrategyMetaReport, type TeamStrategyOutcome } from './MetaSuccessEvaluator'
import type { StrategySport, LeagueFormat } from './types'
import type { DraftPickFact } from './types'
import { getPositionCountsFromRoster } from './RosterCompositionAnalyzer'
import { normalizeToSupportedSport, DEFAULT_SPORT } from '@/lib/sport-scope'
import { resolveSinceFromTimeframe } from '@/lib/global-meta-engine/timeframe'
import { getStrategyLabelForSport } from './SportStrategyResolver'

interface StrategyMetaLeagueDiagnostics {
  leagueId: string
  sport: string
  leagueFormat: string
  season: number
  draftFactCount: number
  rosterSnapshotCount: number
  matchupFactCount: number
  standingFactCount: number
  teamsAnalyzed: number
  teamsWithStrategies: number
  strategyHits: Record<string, number>
  skippedReason?: string
}

interface StrategyMetaDiagnostics {
  totalLeagues: number
  processedLeagues: number
  totalTeamsAnalyzed: number
  totalTeamsWithStrategies: number
  strategyHits: Record<string, number>
  byLeague: StrategyMetaLeagueDiagnostics[]
}

interface StrategyMetaGenerationResult {
  reports: number
  errors: string[]
  diagnostics?: StrategyMetaDiagnostics
}

/** Map League.sport (enum) to string. */
function leagueSportToSport(sport: string): StrategySport {
  return normalizeToSupportedSport(sport) as StrategySport
}

function extractPlayerIdsFromJson(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object' && 'id' in (v as Record<string, unknown>)) {
          const id = (v as Record<string, unknown>).id
          return typeof id === 'string' ? id : null
        }
        return null
      })
      .filter((v): v is string => Boolean(v))
  }
  if (value && typeof value === 'object') {
    const out: string[] = []
    for (const nested of Object.values(value as Record<string, unknown>)) {
      out.push(...extractPlayerIdsFromJson(nested))
    }
    return out
  }
  return []
}

function computeTrendingDirection(
  previous: { usageRate: number; successRate: number } | null,
  current: { usageRate: number; successRate: number }
): 'Rising' | 'Stable' | 'Falling' {
  if (!previous) return 'Stable'
  const usageDelta = current.usageRate - previous.usageRate
  const successDelta = current.successRate - previous.successRate
  const compositeDelta = usageDelta * 0.7 + successDelta * 0.3
  if (compositeDelta >= 0.015) return 'Rising'
  if (compositeDelta <= -0.015) return 'Falling'
  return 'Stable'
}

/**
 * Build draft pick facts for one roster from Sleeper draft picks (need player positions from allPlayers).
 */
function buildDraftPicksForRoster(
  allPicks: Array<{ round: number; pickNumber: number; managerId: string | null; playerId: string; team?: string | null; position?: string | null }>,
  rosterId: string,
  positionByPlayerId: Record<string, string>
): DraftPickFact[] {
  return allPicks
    .filter((p) => p.managerId === rosterId)
    .map((p, i) => ({
      round: p.round ?? Math.floor(i / 12) + 1,
      pickNo: p.pickNumber ?? i + 1,
      rosterId: parseInt(rosterId, 10) || i + 1,
      playerId: p.playerId,
      position: positionByPlayerId[p.playerId] ?? p.position ?? null,
      team: p.team ?? null,
    }))
}

/**
 * Generate strategy meta reports for a sport/format from leagues we have data for.
 * Call from cron or admin; optionally pass leagueIds to limit scope.
 */
export async function generateStrategyMetaReports(opts: {
  sport?: StrategySport
  leagueFormat?: LeagueFormat
  leagueIds?: string[]
  dryRun?: boolean
  includeDiagnostics?: boolean
}): Promise<StrategyMetaGenerationResult> {
  const errors: string[] = []
  const strategyHitsOverall = new Map<string, number>()
  const byLeagueDiagnostics: StrategyMetaLeagueDiagnostics[] = []
  const leagues = await prisma.league.findMany({
    where: {
      ...(opts.leagueIds && opts.leagueIds.length > 0 && { id: { in: opts.leagueIds } }),
      ...(opts.sport && { sport: opts.sport as any }),
    },
    select: {
      id: true,
      platformLeagueId: true,
      sport: true,
      season: true,
      isDynasty: true,
      settings: true,
    },
    take: 200,
  })

  const outcomes: TeamStrategyOutcome[] = []
  let processedLeagues = 0
  let totalTeamsAnalyzed = 0
  let totalTeamsWithStrategies = 0

  for (const league of leagues) {
    const season = league.season ?? new Date().getFullYear()
    const diag: StrategyMetaLeagueDiagnostics = {
      leagueId: league.id,
      sport: league.sport,
      leagueFormat: 'unknown',
      season,
      draftFactCount: 0,
      rosterSnapshotCount: 0,
      matchupFactCount: 0,
      standingFactCount: 0,
      teamsAnalyzed: 0,
      teamsWithStrategies: 0,
      strategyHits: {},
    }

    try {
      const isSF = (league.settings as Record<string, unknown>)?.is_superflex ?? false
      const format = toLeagueFormat({ isDynasty: league.isDynasty ?? false, isSuperFlex: !!isSF })
      diag.leagueFormat = format
      if (opts.leagueFormat && format !== opts.leagueFormat) {
        diag.skippedReason = `Filtered out by leagueFormat (${opts.leagueFormat})`
        byLeagueDiagnostics.push(diag)
        continue
      }
      processedLeagues++

      const sport = leagueSportToSport(league.sport)
      const [draftFacts, rosterSnapshots, matchupFacts, standings] = await Promise.all([
        prisma.draftFact.findMany({
          where: { leagueId: league.id, season, sport },
          select: {
            round: true,
            pickNumber: true,
            managerId: true,
            playerId: true,
          },
          orderBy: [{ round: 'asc' }, { pickNumber: 'asc' }],
        }),
        prisma.rosterSnapshot.findMany({
          where: { leagueId: league.id, season, sport },
          select: {
            teamId: true,
            weekOrPeriod: true,
            rosterPlayers: true,
            lineupPlayers: true,
            benchPlayers: true,
          },
          orderBy: [{ weekOrPeriod: 'desc' }],
        }),
        prisma.matchupFact.findMany({
          where: { leagueId: league.id, season, sport },
          select: {
            teamA: true,
            teamB: true,
            scoreA: true,
            scoreB: true,
            winnerTeamId: true,
          },
        }),
        prisma.seasonStandingFact.findMany({
          where: { leagueId: league.id, season, sport },
          select: {
            teamId: true,
            wins: true,
            losses: true,
            pointsFor: true,
            rank: true,
          },
        }),
      ])

      diag.draftFactCount = draftFacts.length
      diag.rosterSnapshotCount = rosterSnapshots.length
      diag.matchupFactCount = matchupFacts.length
      diag.standingFactCount = standings.length

      if (draftFacts.length === 0) {
        diag.skippedReason = 'No DraftFact rows found for league/sport/season'
        byLeagueDiagnostics.push(diag)
        continue
      }

      const latestSnapshotByTeam = new Map<string, (typeof rosterSnapshots)[number]>()
      for (const snap of rosterSnapshots) {
        if (!latestSnapshotByTeam.has(snap.teamId)) {
          latestSnapshotByTeam.set(snap.teamId, snap)
        }
      }

      const rosterIdsFromDraft = new Set<string>()
      for (const d of draftFacts) {
        if (d.managerId) rosterIdsFromDraft.add(d.managerId)
      }

      const allPlayerIds = new Set<string>()
      for (const d of draftFacts) allPlayerIds.add(d.playerId)
      for (const snap of latestSnapshotByTeam.values()) {
        for (const id of extractPlayerIdsFromJson(snap.rosterPlayers)) allPlayerIds.add(id)
        for (const id of extractPlayerIdsFromJson(snap.lineupPlayers)) allPlayerIds.add(id)
        for (const id of extractPlayerIdsFromJson(snap.benchPlayers)) allPlayerIds.add(id)
      }

      const players = await prisma.player.findMany({
        where: { id: { in: [...allPlayerIds] }, sport },
        select: { id: true, position: true, team: true, birthYear: true },
      })
      const playerMap = new Map(players.map((p) => [p.id, p]))
      const positionByPlayerId: Record<string, string> = {}
      for (const p of players) {
        if (p.position) positionByPlayerId[p.id] = p.position
      }

      for (const rosterId of rosterIdsFromDraft) {
        diag.teamsAnalyzed += 1
        totalTeamsAnalyzed += 1

        const picksForRoster = buildDraftPicksForRoster(
          draftFacts.map((d) => ({
            round: d.round,
            pickNumber: d.pickNumber,
            managerId: d.managerId,
            playerId: d.playerId,
            team: playerMap.get(d.playerId)?.team ?? null,
            position: playerMap.get(d.playerId)?.position ?? null,
          })),
          rosterId,
          positionByPlayerId
        )
        if (picksForRoster.length === 0) continue

        const latestSnapshot = latestSnapshotByTeam.get(rosterId)
        const rosterPlayerIds = latestSnapshot
          ? [...new Set([
              ...extractPlayerIdsFromJson(latestSnapshot.rosterPlayers),
              ...extractPlayerIdsFromJson(latestSnapshot.lineupPlayers),
              ...extractPlayerIdsFromJson(latestSnapshot.benchPlayers),
            ])]
          : picksForRoster.map((p) => p.playerId).filter((id): id is string => Boolean(id))

        const rosterPlayers = rosterPlayerIds
          .map((id) => playerMap.get(id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))

        const rosterPositions = getPositionCountsFromRoster(
          rosterPlayers.map((p) => ({ position: p.position ?? undefined }))
        )

        const currentYear = new Date().getUTCFullYear()
        const rookieCount = rosterPlayers.filter((p) => p.birthYear != null && currentYear - p.birthYear <= 24).length
        const veteranCount = rosterPlayers.filter((p) => p.birthYear != null && currentYear - p.birthYear >= 28).length

        const teamCounts = new Map<string, { qb: number; wrte: number; total: number; players: string[] }>()
        for (const p of picksForRoster) {
          if (!p.team || !p.position || !p.playerId) continue
          const key = p.team
          const cur = teamCounts.get(key) ?? { qb: 0, wrte: 0, total: 0, players: [] }
          const pos = p.position.toUpperCase()
          if (pos === 'QB') cur.qb += 1
          if (pos === 'WR' || pos === 'TE') cur.wrte += 1
          cur.total += 1
          cur.players.push(p.playerId)
          teamCounts.set(key, cur)
        }
        const stacks = [...teamCounts.entries()]
          .filter(([, c]) => c.total >= 2 && (sport === 'NFL' || sport === 'NCAAF' ? c.qb >= 1 && c.wrte >= 1 : true))
          .map(([team, c]) => ({ type: `${team} stack`, players: c.players.slice(0, 4) }))

        let wins = 0
        let losses = 0
        let pointsFor = 0
        for (const m of matchupFacts) {
          if (m.teamA === rosterId) {
            pointsFor += m.scoreA
            if (m.scoreA > m.scoreB || m.winnerTeamId === rosterId) wins += 1
            else if (m.scoreA < m.scoreB) losses += 1
          } else if (m.teamB === rosterId) {
            pointsFor += m.scoreB
            if (m.scoreB > m.scoreA || m.winnerTeamId === rosterId) wins += 1
            else if (m.scoreB < m.scoreA) losses += 1
          }
        }

        const standing = standings.find((s) => s.teamId === rosterId)
        if (wins + losses === 0 && standing) {
          wins = standing.wins
          losses = standing.losses
          pointsFor = standing.pointsFor
        }
        const champion = standing?.rank === 1

        const detected = detectStrategies({
          sport,
          leagueFormat: format,
          draftPicks: picksForRoster,
          rosterPositions,
          stacks,
          rookieCount,
          veteranCount,
        })
        if (detected.length === 0) continue

        diag.teamsWithStrategies += 1
        totalTeamsWithStrategies += 1
        for (const d of detected) {
          diag.strategyHits[d.strategyType] = (diag.strategyHits[d.strategyType] ?? 0) + 1
          strategyHitsOverall.set(d.strategyType, (strategyHitsOverall.get(d.strategyType) ?? 0) + 1)
        }

        outcomes.push({
          leagueId: league.id,
          rosterId,
          season,
          sport,
          strategyTypes: detected.map((d) => d.strategyType),
          leagueFormat: format,
          wins,
          losses,
          pointsFor,
          champion,
          playoffTeam: standing?.rank != null ? standing.rank <= 6 : undefined,
        })
      }
    } catch (e) {
      errors.push(`League ${league.id}: ${(e as Error).message}`)
      diag.skippedReason = (e as Error).message
    }

    byLeagueDiagnostics.push(diag)
  }

  if (outcomes.length === 0) {
    return {
      reports: 0,
      errors,
      diagnostics: opts.includeDiagnostics
        ? {
            totalLeagues: leagues.length,
            processedLeagues,
            totalTeamsAnalyzed,
            totalTeamsWithStrategies,
            strategyHits: Object.fromEntries(strategyHitsOverall.entries()),
            byLeague: byLeagueDiagnostics,
          }
        : undefined,
    }
  }

  const bySegment = new Map<string, { sport: StrategySport; leagueFormat: string; outcomes: TeamStrategyOutcome[] }>()
  for (const o of outcomes) {
    const sport = normalizeToSupportedSport(o.sport ?? opts.sport ?? DEFAULT_SPORT) as StrategySport
    const key = `${sport}::${o.leagueFormat}`
    const segment = bySegment.get(key) ?? { sport, leagueFormat: o.leagueFormat, outcomes: [] }
    segment.outcomes.push(o)
    bySegment.set(key, segment)
  }

  let reportCount = 0
  for (const segment of bySegment.values()) {
    const reports = computeStrategyMetaReport(segment.outcomes, {
      sport: segment.sport,
      leagueFormat: segment.leagueFormat,
    })
    for (const r of reports) {
      const previous = await prisma.strategyMetaReport.findUnique({
        where: {
          uniq_strategy_meta_report_type_sport_format: {
            strategyType: r.strategyType,
            sport: r.sport,
            leagueFormat: r.leagueFormat,
          },
        },
        select: {
          usageRate: true,
          successRate: true,
        },
      })
      const trendingDirection = computeTrendingDirection(previous, {
        usageRate: r.usageRate,
        successRate: r.successRate,
      })

      if (!opts.dryRun) {
        await prisma.strategyMetaReport.upsert({
          where: {
            uniq_strategy_meta_report_type_sport_format: {
              strategyType: r.strategyType,
              sport: r.sport,
              leagueFormat: r.leagueFormat,
            },
          },
          create: {
            strategyType: r.strategyType,
            sport: r.sport,
            usageRate: r.usageRate,
            successRate: r.successRate,
            trendingDirection,
            leagueFormat: segment.leagueFormat,
            sampleSize: r.sampleSize,
          },
          update: {
            usageRate: r.usageRate,
            successRate: r.successRate,
            trendingDirection,
            sampleSize: r.sampleSize,
          },
        })
      }
      reportCount++
    }
  }

  return {
    reports: reportCount,
    errors,
    diagnostics: opts.includeDiagnostics
      ? {
          totalLeagues: leagues.length,
          processedLeagues,
          totalTeamsAnalyzed,
          totalTeamsWithStrategies,
          strategyHits: Object.fromEntries(strategyHitsOverall.entries()),
          byLeague: byLeagueDiagnostics,
        }
      : undefined,
  }
}

/**
 * Fetch current strategy meta reports for API/dashboard.
 */
export async function getStrategyMetaReports(opts: {
  sport?: string
  leagueFormat?: string
  timeframe?: '24h' | '7d' | '30d'
}): Promise<Array<{ strategyType: string; strategyLabel: string; sport: string; usageRate: number; successRate: number; trendingDirection: string; leagueFormat: string; sampleSize: number }>> {
  const since = resolveSinceFromTimeframe(opts.timeframe)
  const sportFilter = opts.sport ? normalizeToSupportedSport(opts.sport) : undefined
  const rows = await prisma.strategyMetaReport.findMany({
    where: {
      ...(sportFilter && { sport: sportFilter }),
      ...(opts.leagueFormat && { leagueFormat: opts.leagueFormat }),
      ...(since ? { updatedAt: { gte: since } } : {}),
    },
    orderBy: [{ usageRate: 'desc' }, { successRate: 'desc' }],
  })
  return rows.map((r) => ({
    strategyType: r.strategyType,
    strategyLabel:
      getStrategyLabelForSport(
        r.strategyType as Parameters<typeof getStrategyLabelForSport>[0],
        normalizeToSupportedSport(r.sport)
      ) || r.strategyType,
    sport: r.sport,
    usageRate: r.usageRate,
    successRate: r.successRate,
    trendingDirection: r.trendingDirection,
    leagueFormat: r.leagueFormat,
    sampleSize: r.sampleSize,
  }))
}
