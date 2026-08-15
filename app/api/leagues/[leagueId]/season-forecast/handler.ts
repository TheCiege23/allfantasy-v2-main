/**
 * Season + Playoff Probability — GET (fetch) and POST (generate) forecast for a league/season/week.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSeasonForecast, runSeasonForecast } from '@/lib/season-forecast/SeasonForecastEngine'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { TeamSeasonForecast } from '@/lib/season-forecast/types'
import {
  buildTeamForecastTrajectory,
  type TeamForecastTrajectory,
} from '@/lib/trajectory'
import type { SeasonForecastHistoryRow } from '@/lib/trajectory/adapters/seasonForecast'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
  const { searchParams } = new URL(req.url)
  const season = parseInt(searchParams?.get('season') ?? '', 10)
  const week = parseInt(searchParams?.get('week') ?? '', 10)

  if (!leagueId || !Number.isFinite(season) || !Number.isFinite(week)) {
    return NextResponse.json(
      { error: 'Missing or invalid leagueId, season, or week' },
      { status: 400 }
    )
  }

  try {
    const teamForecasts = await getSeasonForecast(leagueId, season, week)
    if (!teamForecasts) {
      return NextResponse.json({ teamForecasts: null, generated: false })
    }
    const snapshot = await prisma.seasonForecastSnapshot.findUnique({
      where: {
        uniq_season_forecast_league_season_week: { leagueId, season, week },
      },
      select: { generatedAt: true },
    })

    // Phase 3.4 — additive: server-computed week-over-week trajectory per team,
    // from the reusable Trajectory Foundation. `getSeasonForecast` returns the
    // snapshot for exactly `week`, so limiting history to `week <= requested`
    // makes the trajectory's "current" point identical to what the card shows.
    // Self-gates by construction: with a single snapshot every summary reports
    // `hasChange: false`. One snapshot read powers every team.
    let trajectories: Record<string, TeamForecastTrajectory> = {}
    try {
      const historyRows = await prisma.seasonForecastSnapshot.findMany({
        where: { leagueId, season, week: { lte: week } },
        orderBy: { week: 'asc' },
        select: { week: true, generatedAt: true, teamForecasts: true },
      })
      const rows: SeasonForecastHistoryRow[] = historyRows.map(
        (r: { week: number; generatedAt: Date; teamForecasts: unknown }) => ({
          week: r.week,
          generatedAt: r.generatedAt.toISOString(),
          teamForecasts: (r.teamForecasts as unknown as TeamSeasonForecast[]) ?? [],
        }),
      )
      const entries = await Promise.all(
        teamForecasts.map(async (tf): Promise<[string, TeamForecastTrajectory]> => [
          tf.teamId,
          await buildTeamForecastTrajectory({ leagueId, season, teamId: tf.teamId }, rows),
        ]),
      )
      trajectories = Object.fromEntries(entries)
    } catch (trajErr) {
      // Trajectory is a progressive enhancement — never fail the forecast for it.
      console.error('[SeasonForecast GET trajectory]', trajErr)
      trajectories = {}
    }

    return NextResponse.json({
      teamForecasts,
      generated: true,
      generatedAt: snapshot?.generatedAt?.toISOString?.() ?? null,
      trajectories,
    })
  } catch (e) {
    console.error('[SeasonForecast GET]', e)
    return NextResponse.json({ error: 'Failed to load forecast' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
  let body: { season?: number; week?: number; totalWeeks?: number; playoffSpots?: number; byeSpots?: number; simulations?: number } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {}

  const season = body.season ?? new Date().getFullYear()
  const week = body.week ?? 1
  if (!leagueId || !Number.isFinite(season) || !Number.isFinite(week)) {
    return NextResponse.json(
      { error: 'Missing or invalid leagueId, season, or week' },
      { status: 400 }
    )
  }

  try {
    const league = await prisma.league.findFirst({
      where: { OR: [{ id: leagueId }, { platformLeagueId: leagueId }] },
      select: { sport: true },
    })
    const sport = normalizeToSupportedSport(league?.sport ?? 'NFL')

    const result = await runSeasonForecast({
      leagueId,
      season,
      week,
      totalWeeks: body.totalWeeks,
      playoffSpots: body.playoffSpots,
      byeSpots: body.byeSpots,
      simulations: body.simulations,
    })
    if (!result) {
      return NextResponse.json(
        { error: 'No rankings/snapshots found for this league and week; run rankings first.' },
        { status: 404 }
      )
    }

    await prisma.seasonSimulationResult.deleteMany({
      where: { leagueId, season, weekOrPeriod: week },
    })
    await prisma.seasonSimulationResult.createMany({
      data: result.teamForecasts.map((t) => ({
        sport,
        leagueId,
        teamId: t.teamId,
        season,
        weekOrPeriod: week,
        playoffProbability: t.playoffProbability,
        championshipProbability: t.championshipProbability,
        expectedWins: t.expectedWins,
        expectedRank: t.expectedFinalSeed,
        simulationsRun: body.simulations ?? 2000,
      })),
    })

    const snapshot = await prisma.seasonForecastSnapshot.findUnique({
      where: { id: result.snapshotId },
      select: { generatedAt: true },
    })
    return NextResponse.json({
      snapshotId: result.snapshotId,
      teamForecasts: result.teamForecasts,
      generatedAt: snapshot?.generatedAt?.toISOString?.() ?? new Date().toISOString(),
    })
  } catch (e) {
    console.error('[SeasonForecast POST]', e)
    return NextResponse.json({ error: 'Failed to generate forecast' }, { status: 500 })
  }
}
