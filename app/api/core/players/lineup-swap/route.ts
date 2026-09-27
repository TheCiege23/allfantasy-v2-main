/**
 * POST /api/core/players/lineup-swap — the Player Finder's "Swap now" for an AllFantasy league.
 *
 * Body: `{ leagueId, startIds: string[], benchIds: string[] }` (player ids the finder already holds).
 * Returns a CONFIRM CARD, never a change: `{ ok: true, card }` where `card.token` is what the confirm
 * tap sends to POST /api/chimmy/actions/confirm — the one path that writes a native lineup from a
 * suggestion, re-checking everything and claiming the action once (lib/chimmy/actions/lineupAction.ts).
 *
 * Native leagues only (the action scope refuses an imported one: AllFantasy cannot write to Sleeper,
 * ESPN or Yahoo, and the finder sends those to the platform's lineup screen instead).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { proposeLineupSwapByIds } from '@/lib/chimmy/actions/lineupAction'
import { buildRateLimit429, consumeRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({ scope: 'players', action: 'lineup_swap', sleeperUsername: auth.userId, maxRequests: 20, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many lineup requests — try again in a moment.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; startIds?: unknown; benchIds?: unknown } | null
  if (!body || typeof body.leagueId !== 'string' || !body.leagueId.trim()) {
    return NextResponse.json({ ok: false, message: 'Choose a league.' }, { status: 400 })
  }
  const result = await proposeLineupSwapByIds({ leagueId: body.leagueId.trim(), userId: auth.userId, startIds: ids(body.startIds), benchIds: ids(body.benchIds) })
  // A refusal is a normal answer ("his game has started", "not your roster"): 200 with ok:false, shown as-is.
  return NextResponse.json(result, { status: 200 })
}
