/**
 * Simulation Lab — POST run sandbox season simulation (no league required).
 */

import { NextRequest, NextResponse } from 'next/server'
import { runSeasonSimulation } from '@/lib/simulation-lab'
import type { SeasonSimLabInput } from '@/lib/simulation-lab'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as SeasonSimLabInput
    if (!body.team || !Array.isArray(body.opponents)) {
      return NextResponse.json(
        { error: 'team and opponents (array) required' },
        { status: 400 }
      )
    }
    if (
      typeof body.playoffSpots !== 'number' ||
      body.playoffSpots < 1 ||
      body.playoffSpots > body.opponents.length + 1
    ) {
      return NextResponse.json(
        { error: 'playoffSpots must be a number between 1 and number of teams' },
        { status: 400 }
      )
    }
    const result = runSeasonSimulation({
      sport: body.sport,
      team: body.team,
      opponents: body.opponents,
      playoffSpots: body.playoffSpots,
      byeSpots: body.byeSpots ?? 0,
      iterations: body.iterations,
    })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[simulation-lab/season]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Season simulation failed' },
      { status: 500 }
    )
  }
}
