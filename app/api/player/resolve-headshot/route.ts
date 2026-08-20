/**
 * /api/player/resolve-headshot — server-side player-headshot resolver.
 *
 * Wraps `lib/player-assets/resolvePlayerHeadshot.ts` for callers (Roster /
 * Players-Waivers / Trades / Matchups) that want the full provider chain
 * (TheSportsDB → ClearSports → Sleeper for NFL; UI then falls through to ESPN
 * when an `espnId` already exists on the client)
 * resolved on the server, where the provider keys live.
 *
 * Auth: requires a signed-in user (`getServerSession`). Headshots are public
 * data but the resolver hits external APIs and the SportsPlayer DB cache —
 * gating to authenticated sessions prevents anonymous callers from
 * fan-out-walking provider rate limits.
 *
 * NOT non-persistent, despite what this comment used to say. Phase 2 put a write-through
 * cache inside `resolveOnce`, so every call through here can persist a `PlayerImage` row —
 * this route silently became a writer without its callers or this docstring changing.
 *
 * It passes no `playerId` (the UI has a name/team/position and sometimes a Sleeper id, never
 * a canonical `Player.id`), so the resolver DERIVES one. A derived id only equals the stored
 * `Player.id` when the caller's fields reproduce exactly what the canonical backfill used,
 * which is often false — that is how this route wrote 215 orphan image rows in production.
 * `writePrimaryPlayerImage` now refuses ids with no matching `Player`, so the worst case here
 * is a skipped cache write and a re-resolution next time, not a bogus row.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  resolvePlayerHeadshot,
  type ResolveHeadshotResult,
} from '@/lib/player-assets/resolvePlayerHeadshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ResolveHeadshotResponseBody = {
  headshotUrl: string | null
  source: ResolveHeadshotResult['source']
  fallbackUsed: boolean
  confidence: ResolveHeadshotResult['confidence']
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const name = (url.searchParams.get('name') ?? '').trim()
  const sport = (url.searchParams.get('sport') ?? 'NFL').trim().toUpperCase()
  const team = url.searchParams.get('team')?.trim() || null
  const position = url.searchParams.get('position')?.trim() || null
  const sleeperId = url.searchParams.get('sleeperId')?.trim() || null
  const sportsDbId = url.searchParams.get('sportsDbId')?.trim() || null

  if (!name) {
    return NextResponse.json(
      { error: 'name is required' },
      { status: 400 },
    )
  }

  try {
    const result = await resolvePlayerHeadshot({
      name,
      sport,
      team,
      position,
      externalIds: {
        sleeperId,
        sportsDbId,
      },
    })
    const body: ResolveHeadshotResponseBody = {
      headshotUrl: result.imageUrl,
      source: result.source,
      fallbackUsed: result.source !== 'none' && result.confidence !== 'exact',
      confidence: result.confidence,
    }
    return NextResponse.json(body, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { headshotUrl: null, source: 'none', fallbackUsed: false, confidence: 'none', error: message },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
