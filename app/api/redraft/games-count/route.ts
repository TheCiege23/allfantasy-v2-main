import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applyGamesCountAction, getGamesCountState, type GamesCountAction } from '@/lib/redraft/gamesCountService'

export const dynamic = 'force-dynamic'

/**
 * "Which games count" — the manager's side (lib/redraft/gamesCount.ts, lib/redraft/gamesCountService.ts).
 *
 *   GET  ?leagueId=…&playerId=…[&playerId=…][&week=…]
 *        → the player's games this week, which count, and the stored choice. Several `playerId`s are
 *          candidates for ONE player (the player card knows a Rolling Insights id and a Sleeper id);
 *          the first one on the viewer's roster is used.
 *   POST { leagueId, playerId, week?, action: 'pick', gameIds }   best-N: choose which games count
 *        { leagueId, playerId, week?, action: 'clear_picks' }     best-N: back to his best N
 *        { leagueId, playerId, week?, action: 'lock', gameId }    lock-in: lock a finished game in
 *
 * Every refusal (membership, roster ownership, the setting being off, a final week, a player not
 * started, an unfinished game, his next game having started) is decided in the service.
 */

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const result = await getGamesCountState({
    leagueId: params.get('leagueId') ?? '',
    userId,
    playerIds: params.getAll('playerId'),
    week: params.get('week') ?? undefined,
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leagueId?: unknown; playerId?: unknown; week?: unknown; action?: unknown; gameIds?: unknown; gameId?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = String(body.action ?? '')
  let input: GamesCountAction
  if (action === 'pick') input = { action, gameIds: body.gameIds }
  else if (action === 'clear_picks') input = { action }
  else if (action === 'lock') input = { action, gameId: body.gameId }
  else return NextResponse.json({ error: 'action must be pick, clear_picks or lock', code: 'bad_action' }, { status: 400 })

  const result = await applyGamesCountAction({
    leagueId: String(body.leagueId ?? ''),
    userId,
    playerId: String(body.playerId ?? ''),
    week: body.week ?? undefined,
    input,
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json(result)
}
