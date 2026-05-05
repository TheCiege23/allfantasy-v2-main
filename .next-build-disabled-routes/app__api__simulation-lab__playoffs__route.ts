/**
 * Simulation Lab — POST run sandbox playoff simulation (no league required).
 */

import { NextRequest, NextResponse } from 'next/server'
import { runPlayoffSimulation } from '@/lib/simulation-lab'
import type { PlayoffSimLabInput } from '@/lib/simulation-lab'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as PlayoffSimLabInput
    if (!Array.isArray(body.teams) || body.teams.length < 2) {
      return NextResponse.json(
        { error: 'teams (array of at least 2) required' },
        { status: 400 }
      )
    }
    const target =
      typeof body.targetTeamIndex === 'number'
        ? body.targetTeamIndex
        : 0
    if (target < 0 || target >= body.teams.length) {
      return NextResponse.json(
        { error: 'targetTeamIndex must be valid index into teams' },
        { status: 400 }
      )
    }
    const result = runPlayoffSimulation({
      sport: body.sport,
      teams: body.teams,
      targetTeamIndex: target,
      iterations: body.iterations,
    })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[simulation-lab/playoffs]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Playoff simulation failed' },
      { status: 500 }
    )
  }
}
