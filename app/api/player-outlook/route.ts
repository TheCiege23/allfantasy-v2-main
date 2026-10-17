import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getPlayerOutlook,
  getPlayerOutlookBatch,
  PlayerOutlookRequestSchema,
  PlayerOutlookBatchRequestSchema,
} from '@/lib/player-outlook'

/**
 * GET /api/player-outlook?playerName=X&sport=NFL&narrative=true
 *
 * Returns a single player outlook. No auth required (public player data).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('playerName') ?? undefined
    const playerId = searchParams.get('playerId') ?? undefined
    const sport = searchParams.get('sport') ?? 'NFL'
    // Optional: the player page passes the identity's own position/team so a namesake is not valued.
    const position = searchParams.get('position')
    const team = searchParams.get('team')
    const narrative = searchParams.get('narrative') === 'true'

    if (!playerName && !playerId) {
      return NextResponse.json(
        { error: 'Either playerName or playerId query parameter is required' },
        { status: 400 },
      )
    }

    const outlook = await getPlayerOutlook({
      playerName,
      playerId,
      sport,
      position,
      team,
      includeNarrative: narrative,
    })

    return NextResponse.json({
      data: outlook,
      fromCache: outlook.fromCache,
      cacheAge: outlook.cacheAge,
    })
  } catch (err: any) {
    console.error('[player-outlook] GET error:', err?.message || err)
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/player-outlook
 * Body: { players: [{ playerName, sport }], narrative: boolean }
 *
 * Returns batch player outlooks. Auth required (prevents abuse).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = PlayerOutlookBatchRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues },
        { status: 400 },
      )
    }

    const outlooks = await getPlayerOutlookBatch(
      parsed.data.players,
      parsed.data.narrative,
    )

    return NextResponse.json({
      data: outlooks,
      count: outlooks.filter(Boolean).length,
      total: parsed.data.players.length,
    })
  } catch (err: any) {
    console.error('[player-outlook] POST error:', err?.message || err)
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 },
    )
  }
}
