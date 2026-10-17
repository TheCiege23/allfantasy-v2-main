import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseFormerSleeperKey } from '@/lib/league-import/sleeper/historicalTeamIdentity'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** A stored team id: Sleeper writes bracket ids and playoff participants as NUMBERS, which `asString` drops. */
function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return asString(value)
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function buildStandingNameMap(standings: unknown): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of asArray<JsonRecord>(standings)) {
    const managerName = asString(row.managerName) ?? asString(row.teamName)
    if (!managerName) continue
    const keys = [row.rosterId, row.teamId, row.source_team_id].map(asString).filter(Boolean) as string[]
    for (const key of keys) {
      map.set(key, managerName)
    }
  }
  return map
}

function summarizeWeeklyMatchups(
  weeklyMatchups: Array<{
    weekOrPeriod: number
    scoreA: number
    scoreB: number
    teamA: string
    teamB: string
  }>
) {
  const byWeek = new Map<number, { matchups: number; highestCombinedScore: number; highestCombinedLabel: string | null }>()
  let highestScoringWeek: { week: number; combined: number; label: string } | null = null

  for (const matchup of weeklyMatchups) {
    const combined = matchup.scoreA + matchup.scoreB
    const label = `${matchup.teamA} vs ${matchup.teamB}`
    const existing = byWeek.get(matchup.weekOrPeriod) ?? {
      matchups: 0,
      highestCombinedScore: 0,
      highestCombinedLabel: null,
    }
    existing.matchups += 1
    if (combined > existing.highestCombinedScore) {
      existing.highestCombinedScore = combined
      existing.highestCombinedLabel = label
    }
    byWeek.set(matchup.weekOrPeriod, existing)

    if (!highestScoringWeek || combined > highestScoringWeek.combined) {
      highestScoringWeek = { week: matchup.weekOrPeriod, combined, label }
    }
  }

  return {
    weeks: Array.from(byWeek.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([week, value]) => ({
        week,
        matchupCount: value.matchups,
        highestCombinedScore: value.highestCombinedScore,
        highestCombinedLabel: value.highestCombinedLabel,
      })),
    highestScoringWeek,
  }
}

function summarizeTransactions(
  transactions: Array<{ type: string; payload: unknown }>
) {
  const counts = new Map<string, number>()
  for (const transaction of transactions) {
    const key = transaction.type?.trim() || 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }))
}

function summarizeDraft(
  draft: Array<{ round: number; pickNumber: number; managerId: string | null; playerId: string }>
) {
  const rounds = new Set<number>()
  const managers = new Set<string>()
  for (const pick of draft) {
    if (Number.isFinite(pick.round)) rounds.add(pick.round)
    if (pick.managerId) managers.add(pick.managerId)
  }
  return {
    totalPicks: draft.length,
    roundCount: rounds.size,
    managerCount: managers.size,
    firstOverall: draft[0]
      ? {
          round: draft[0].round,
          pickNumber: draft[0].pickNumber,
          playerId: draft[0].playerId,
          managerId: draft[0].managerId,
        }
      : null,
  }
}

function buildRosterSnapshots(
  rawSnapshots: Array<{
    teamId: string
    rosterPlayers: unknown
    lineupPlayers: unknown
    benchPlayers: unknown
    weekOrPeriod: number
  }>,
  standingNameMap: Map<string, string>
) {
  return rawSnapshots.map((snapshot) => {
    const lineupPlayers = asArray<JsonRecord>(snapshot.lineupPlayers)
    const benchPlayers = asArray<JsonRecord>(snapshot.benchPlayers)
    const rosterPlayers = asArray<JsonRecord>(snapshot.rosterPlayers)
    const toPlayerSummary = (player: JsonRecord) => ({
      id: asString(player.id),
      name: asString(player.name),
      position: asString(player.position),
      team: asString(player.team),
      bucket: asString(player.bucket),
    })

    return {
      teamId: snapshot.teamId,
      managerName: standingNameMap.get(snapshot.teamId) ?? null,
      weekOrPeriod: snapshot.weekOrPeriod,
      rosterCount: rosterPlayers.length,
      lineupCount: lineupPlayers.length,
      benchCount: benchPlayers.length,
      lineupPlayers: lineupPlayers.slice(0, 12).map(toPlayerSummary),
      benchPlayers: benchPlayers.slice(0, 10).map(toPlayerSummary),
    }
  })
}

function buildPlayoffBracket(metadata: unknown, standingNameMap: Map<string, string>) {
  const root = asRecord(metadata)
  const playoffStructure = asRecord(root?.playoffStructure)
  if (!playoffStructure) return null

  const idMap = asRecord(playoffStructure.canonicalRosterIdByHistoricalRosterId) ?? {}
  const finishByRosterId = asRecord(playoffStructure.playoffFinishByRosterId) ?? {}
  const mapRosterId = (value: unknown) => {
    const rawId = asId(value)
    if (!rawId) return null
    const canonical = asId(idMap[rawId])
    return canonical ?? rawId
  }
  /*
   * ⚠ NAME BY THE SEASON'S OWN ROSTER ID. `teamRecords` is written per season, keyed by that season's
   * `roster_id`; the canonical id is TODAY's slot, which in a past season may have been someone else's.
   */
  const resolveLabel = (value: unknown) => {
    const rawId = asId(value)
    const canonical = mapRosterId(value)
    if (!rawId || !canonical) return null
    return (
      standingNameMap.get(rawId) ??
      standingNameMap.get(canonical) ??
      (parseFormerSleeperKey(canonical) ? 'Former manager' : canonical)
    )
  }

  const decorateBracket = (value: unknown) =>
    asArray<JsonRecord>(value).map((matchup, index) => {
      const teamOneId = mapRosterId(matchup.team1)
      const teamTwoId = mapRosterId(matchup.team2)
      const winnerId = mapRosterId(matchup.winner)
      const loserId = mapRosterId(matchup.loser)
      return {
        id: `${asNumber(matchup.round) ?? 0}-${asNumber(matchup.matchup) ?? index}`,
        round: asNumber(matchup.round),
        matchup: asNumber(matchup.matchup),
        teamOneId,
        teamTwoId,
        winnerId,
        loserId,
        teamOneLabel: resolveLabel(matchup.team1),
        teamTwoLabel: resolveLabel(matchup.team2),
        winnerLabel: resolveLabel(matchup.winner),
        loserLabel: resolveLabel(matchup.loser),
      }
    })

  const participantRawIds = asArray(playoffStructure.playoffParticipants)
    .map(asId)
    .filter(Boolean) as string[]

  // `playoffFinishByRosterId` is keyed by the season's own roster id, like `teamRecords`.
  const participants = participantRawIds.map((rawId) => {
    const participantId = mapRosterId(rawId) ?? rawId
    const finishEntry = asRecord(finishByRosterId[rawId])
    return {
      rosterId: participantId,
      managerName: resolveLabel(rawId) ?? participantId,
      seed: asNumber(finishEntry?.playoffSeed),
      label: asString(finishEntry?.label),
      isChampion: finishEntry?.isChampion === true,
      isRunnerUp: finishEntry?.isRunnerUp === true,
      playoffWins: asNumber(finishEntry?.playoffWins) ?? 0,
      playoffLosses: asNumber(finishEntry?.playoffLosses) ?? 0,
    }
  })

  return {
    playoffWeekStart: asNumber(playoffStructure.playoffWeekStart),
    regularSeasonLength: asNumber(playoffStructure.regularSeasonLength),
    playoffTeams: asNumber(playoffStructure.playoffTeams),
    participants,
    winnersBracket: decorateBracket(playoffStructure.winnersBracket),
    losersBracket: decorateBracket(playoffStructure.losersBracket),
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string }
    } | null
    const userId = session?.user?.id?.trim()
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { leagueId } = await params
    const id = leagueId?.trim()
    if (!id) {
      return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    }

    const url = new URL(req.url)
    const seasonParam = url.searchParams.get('season')
    const season = seasonParam ? Number.parseInt(seasonParam, 10) : NaN
    if (!Number.isFinite(season)) {
      return NextResponse.json({ error: 'season (YYYY) required' }, { status: 400 })
    }

    const [leagueSeason, weeklyMatchups, draft, transactions, rosterSnapshots, dynastySeason] = await Promise.all([
      prisma.leagueSeason.findFirst({
        where: { leagueId: id, season },
        select: {
          season: true,
          platformLeagueId: true,
          championName: true,
          championAvatar: true,
          runnerUpName: true,
          regularSeasonWinnerName: true,
          teamRecords: true,
          teamCount: true,
          scoringFormat: true,
          isDynasty: true,
          status: true,
        },
      }),
      prisma.matchupFact.findMany({
        where: { leagueId: id, season },
        orderBy: [{ weekOrPeriod: 'asc' }],
        select: {
          matchupId: true,
          weekOrPeriod: true,
          teamA: true,
          teamB: true,
          scoreA: true,
          scoreB: true,
          winnerTeamId: true,
        },
      }),
      prisma.draftFact.findMany({
        where: { leagueId: id, season },
        orderBy: [{ round: 'asc' }, { pickNumber: 'asc' }],
        select: {
          draftId: true,
          round: true,
          pickNumber: true,
          playerId: true,
          managerId: true,
        },
      }),
      prisma.transactionFact.findMany({
        where: { leagueId: id, season },
        orderBy: [{ createdAt: 'desc' }],
        take: 500,
        select: {
          transactionId: true,
          type: true,
          playerId: true,
          managerId: true,
          rosterId: true,
          payload: true,
          weekOrPeriod: true,
          createdAt: true,
        },
      }),
      prisma.rosterSnapshot.findMany({
        where: { leagueId: id, season, weekOrPeriod: 0 },
        orderBy: [{ teamId: 'asc' }],
        select: {
          teamId: true,
          rosterPlayers: true,
          lineupPlayers: true,
          benchPlayers: true,
          weekOrPeriod: true,
        },
      }),
      prisma.leagueDynastySeason.findUnique({
        where: {
          uniq_league_dynasty_season_league_season: {
            leagueId: id,
            season,
          },
        },
        select: {
          provider: true,
          platformLeagueId: true,
          metadata: true,
        },
      }),
    ])

    const standings = (leagueSeason?.teamRecords as unknown) ?? []
    const standingNameMap = buildStandingNameMap(standings)
    const scoringSettings = {
      scoringFormat: leagueSeason?.scoringFormat ?? null,
      isDynasty: leagueSeason?.isDynasty ?? false,
      teamCount: leagueSeason?.teamCount ?? null,
    }
    const weeklySummary = summarizeWeeklyMatchups(weeklyMatchups)
    const draftSummary = summarizeDraft(draft)
    const transactionSummary = summarizeTransactions(transactions)
    const lineupSnapshots = buildRosterSnapshots(rosterSnapshots, standingNameMap)
    const playoffBracket = buildPlayoffBracket(dynastySeason?.metadata, standingNameMap)
    const importedHistory = asRecord(dynastySeason?.metadata)

    return NextResponse.json({
      season,
      standings,
      weeklyMatchups,
      weeklySummary,
      draft,
      draftSummary,
      transactions,
      transactionSummary,
      lineupSnapshots,
      playoffBracket,
      importedHistory: {
        provider: asString(dynastySeason?.provider),
        platformLeagueId: asString(dynastySeason?.platformLeagueId),
        matchupHistory: asRecord(importedHistory?.matchupHistory),
      },
      scoringSettings,
      summary: {
        matchupCount: weeklyMatchups.length,
        weekCount: weeklySummary.weeks.length,
        draftPickCount: draft.length,
        transactionCount: transactions.length,
        rosterSnapshotCount: lineupSnapshots.length,
        playoffMatchupCount:
          (playoffBracket?.winnersBracket.length ?? 0) + (playoffBracket?.losersBracket.length ?? 0),
      },
      meta: leagueSeason
        ? {
            championName: leagueSeason.championName,
            championAvatar: leagueSeason.championAvatar,
            runnerUpName: leagueSeason.runnerUpName,
            regularSeasonWinnerName: leagueSeason.regularSeasonWinnerName,
            status: leagueSeason.status,
          }
        : null,
    })
  } catch (e) {
    console.error('[api/league/[leagueId]/season-history GET]', e)
    return NextResponse.json({ error: 'Failed to load season history' }, { status: 500 })
  }
}
