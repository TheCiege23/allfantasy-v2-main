/**
 * GET /api/warehouse/league-history — warehouse-backed league history summary.
 * Used by league page "Previous Leagues" / archived season and analytics dashboards.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getDraftHistoryForLeague,
  getLeagueHistorySummary,
  getLeagueWarehouseSummaryForAI,
  getPlayerGameFactsForPlayer,
  getStandingsHistory,
  getTransactionHistoryForLeague,
  getRosterSnapshotsForTeam,
} from '@/lib/data-warehouse'
import { prisma } from '@/lib/prisma'
import { computeWarehouseDataState } from '@/lib/data-warehouse/warehouseDataState'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

type WarehouseView =
  | 'summary'
  | 'matchups'
  | 'standings'
  | 'rosters'
  | 'draft'
  | 'transactions'
  | 'player'
  | 'team'
  | 'ai'

function parseOptionalInt(value: string | null): number | undefined {
  if (value == null || value.trim() === '') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: NextRequest) {
  try {
    const leagueId = request.nextUrl.searchParams?.get('leagueId')
    if (!leagueId) {
      return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    }

    const view = (request.nextUrl.searchParams?.get('view') ?? 'summary') as WarehouseView
    const sportParam = request.nextUrl.searchParams?.get('sport')
    const season = parseOptionalInt(request.nextUrl.searchParams?.get('season'))
    const fromWeek = parseOptionalInt(request.nextUrl.searchParams?.get('fromWeek'))
    const toWeek = parseOptionalInt(request.nextUrl.searchParams?.get('toWeek'))
    const teamId = request.nextUrl.searchParams?.get('teamId') ?? undefined
    const playerId = request.nextUrl.searchParams?.get('playerId') ?? undefined
    const limit = parseOptionalInt(request.nextUrl.searchParams?.get('limit')) ?? 100

    const summary = await getLeagueHistorySummary(leagueId, {
      season,
      fromWeek,
      toWeek,
    })
    const resolvedSeason = season ?? summary.season
    const resolvedSport = normalizeToSupportedSport(sportParam ?? summary.sport)

    // Truthful availability, attached to every view: distinguishes "no historical events
    // exist" from "player statistics were never imported" (PlayerGameStat sat at 0 rows in
    // prod while this route served empty arrays the UI rendered as real empty history).
    const dataState = await computeWarehouseDataState(resolvedSport, resolvedSeason)

    const matchupWhere = {
      leagueId,
      ...(resolvedSeason != null ? { season: resolvedSeason } : {}),
      ...(
        fromWeek != null || toWeek != null
          ? {
              weekOrPeriod: {
                ...(fromWeek != null ? { gte: fromWeek } : {}),
                ...(toWeek != null ? { lte: toWeek } : {}),
              },
            }
          : {}
      ),
    }

    if (view === 'matchups') {
      const matchups = await prisma.matchupFact.findMany({
        where: matchupWhere,
        orderBy: [{ weekOrPeriod: 'asc' }, { createdAt: 'desc' }],
        take: limit,
      })
      return NextResponse.json(
        { leagueId, view, summary, dataState, data: { matchups } },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (view === 'standings') {
      if (resolvedSeason == null) {
        return NextResponse.json({ error: 'season is required for standings view' }, { status: 400 })
      }
      const standings = await getStandingsHistory(leagueId, resolvedSeason)
      return NextResponse.json(
        { leagueId, view, summary, dataState, data: { standings } },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (view === 'rosters') {
      if (!teamId) {
        return NextResponse.json({ error: 'teamId is required for rosters view' }, { status: 400 })
      }
      const snapshots = await getRosterSnapshotsForTeam(leagueId, teamId, resolvedSeason, fromWeek, toWeek)
      return NextResponse.json(
        { leagueId, view, summary, dataState, data: { snapshots, teamId } },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (view === 'draft') {
      const draft = await getDraftHistoryForLeague(leagueId, resolvedSeason ?? undefined)
      return NextResponse.json(
        { leagueId, view, summary, dataState, data: { draft } },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (view === 'transactions') {
      const transactions = await getTransactionHistoryForLeague(leagueId, undefined, limit)
      return NextResponse.json(
        { leagueId, view, summary, dataState, data: { transactions } },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (view === 'player') {
      if (!playerId) {
        return NextResponse.json({ error: 'playerId is required for player view' }, { status: 400 })
      }
      const playerFacts = await getPlayerGameFactsForPlayer(playerId, resolvedSport, {
        season: resolvedSeason ?? undefined,
        fromWeek,
        toWeek,
        limit,
      })
      return NextResponse.json(
        { leagueId, view, summary, dataState, data: { playerFacts, playerId, sport: resolvedSport } },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (view === 'team') {
      if (!teamId) {
        return NextResponse.json({ error: 'teamId is required for team view' }, { status: 400 })
      }
      const [teamMatchupsRaw, teamStandingsRaw, snapshots] = await Promise.all([
        prisma.matchupFact.findMany({
          where: {
            ...matchupWhere,
            OR: [{ teamA: teamId }, { teamB: teamId }],
          },
          orderBy: [{ weekOrPeriod: 'asc' }, { createdAt: 'desc' }],
          take: limit,
        }),
        resolvedSeason != null
          ? prisma.seasonStandingFact.findMany({
              where: { leagueId, season: resolvedSeason, teamId },
              orderBy: { rank: 'asc' },
            })
          : Promise.resolve([]),
        getRosterSnapshotsForTeam(leagueId, teamId, resolvedSeason ?? undefined, fromWeek, toWeek),
      ])

      const teamMatchups = teamMatchupsRaw.map((m) => {
        const isTeamA = m.teamA === teamId
        const teamScore = isTeamA ? m.scoreA : m.scoreB
        const opponentScore = isTeamA ? m.scoreB : m.scoreA
        const opponentTeamId = isTeamA ? m.teamB : m.teamA
        const result = teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'T'
        return {
          matchupId: m.matchupId,
          weekOrPeriod: m.weekOrPeriod,
          opponentTeamId,
          teamScore,
          opponentScore,
          result,
          winnerTeamId: m.winnerTeamId,
        }
      })

      return NextResponse.json(
        {
          leagueId,
          view,
          summary,
          dataState,
          data: { teamId, teamMatchups, teamStandings: teamStandingsRaw, snapshots },
        },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (view === 'ai') {
      const ai = await getLeagueWarehouseSummaryForAI(leagueId, resolvedSeason ?? undefined)
      return NextResponse.json(
        { leagueId, view, summary, dataState, data: ai },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    return NextResponse.json(
      { leagueId, view: 'summary', summary, dataState, data: { summary } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    console.error('[warehouse/league-history]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load league history' },
      { status: 500 }
    )
  }
}

