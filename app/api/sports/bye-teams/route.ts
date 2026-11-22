import { withApiUsage } from '@/lib/telemetry/usage'
import { NextRequest, NextResponse } from 'next/server'
import { resolveByeWeekMap } from '@/lib/core-app/byeWeekMap'

export const dynamic = 'force-dynamic'

/**
 * The clubs on bye in one week, read from the schedule AF holds (`resolveByeWeekMap` — Postgres only,
 * no provider call). Drives BYE on the league page's roster rows.
 *
 * A club absent from the answer means "not known to be on bye", never "plays": the map omits any
 * week it cannot judge, so an empty list costs a BYE label rather than inventing one.
 */
export const GET = withApiUsage({ endpoint: '/api/sports/bye-teams', tool: 'SportsByeTeams' })(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams
  const season = Number(params.get('season'))
  const week = Number(params.get('week'))
  const sport = (params.get('sport') || 'NFL').toUpperCase()
  if (!Number.isInteger(season) || season < 2000 || !Number.isInteger(week) || week < 1) {
    return NextResponse.json({ error: 'season and week are required' }, { status: 400 })
  }
  // Only NFL has bye weeks; other sports get an empty answer rather than a guess.
  if (sport !== 'NFL') return NextResponse.json({ teams: [] })
  const map = await resolveByeWeekMap(season, 'NFL').catch(() => ({}) as Record<string, number>)
  const teams = Object.entries(map)
    .filter(([, bye]) => bye === week)
    .map(([team]) => team.toUpperCase())
    .sort()
  return NextResponse.json({ teams }, { headers: { 'Cache-Control': 'private, max-age=600' } })
})
