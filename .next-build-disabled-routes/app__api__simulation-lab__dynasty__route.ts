/**
 * Simulation Lab — POST run sandbox dynasty (multi-season) simulation (no league required).
 */

import { NextRequest, NextResponse } from 'next/server'
import { runDynastySimulation } from '@/lib/simulation-lab'
import type { DynastySimLabInput } from '@/lib/simulation-lab'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as DynastySimLabInput
    if (!Array.isArray(body.teams) || body.teams.length < 2) {
      return NextResponse.json(
        { error: 'teams (array of at least 2) required' },
        { status: 400 }
      )
    }
    const playoffSpots =
      typeof body.playoffSpots === 'number'
        ? Math.min(Math.max(1, body.playoffSpots), body.teams.length)
        : Math.max(1, Math.floor(body.teams.length / 2))
    const result = runDynastySimulation({
      sport: body.sport,
      teams: body.teams,
      seasons: body.seasons ?? 50,
      playoffSpots,
      iterationsPerSeason: body.iterationsPerSeason,
    })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[simulation-lab/dynasty]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Dynasty simulation failed' },
      { status: 500 }
    )
  }
}
