/**
 * POST /api/core/players/leagues — save the Player Finder's "pick leagues" choice to the account.
 *
 * Body: `{ leagueIds: string[] | null }` — null (or an empty list) clears the pick, which means
 * "every league". The list is shape-checked here and INTERSECTED with the leagues the account plays
 * every time it is read (finderLeaguePicks.ts), so a foreign id stored here can never widen what
 * anyone sees — it has nowhere to be read.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { normalizePicks } from '@/lib/core-app/finderLeaguePicks'
import { setFinderLeaguePicks } from '@/lib/core-app/finderLeaguePicksStore'
import { buildRateLimit429, consumeRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({ scope: 'players', action: 'league_picks', sleeperUsername: auth.userId, maxRequests: 20, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many changes — try again in a moment.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('leagueIds' in body)) {
    return NextResponse.json({ error: 'Send leagueIds: a list of league ids, or null for every league.' }, { status: 400 })
  }
  const picks = normalizePicks(body.leagueIds)
  try {
    await setFinderLeaguePicks(auth.userId, picks && picks.length > 0 ? picks : null)
    return NextResponse.json({ ok: true, count: picks?.length ?? 0 })
  } catch {
    return NextResponse.json({ error: 'Your league choice could not be saved. Please try again.' }, { status: 503 })
  }
}
