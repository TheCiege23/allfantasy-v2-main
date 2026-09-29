/**
 * POST /api/core/players/refresh-lineups — one batch of the game-day list's "Refresh my lineups".
 *
 * Brings the caller's own connected leagues' rosters current through the durable collector
 * (lib/import-os/collector/lineupRefresh.ts), so a lineup fixed on Sleeper a minute ago stops being
 * flagged here. The candidate set is recomputed server-side from the caller's claimed teams.
 *
 * An optional JSON body `{ "leagueId": "<AllFantasy league id>" }` narrows it to that one league —
 * Chimmy's "Refresh" under a stale answer. It can only NARROW: the filter runs inside the query over
 * the caller's own claimed teams, so naming a league they hold no team in refreshes nothing.
 *
 * The client loops while `remaining > 0` (a league takes ~2s; sixty-five do not fit one request),
 * then reloads the page. Rate limited per user: a loop is a handful of posts, a stuck button is not.
 */
import { NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { buildRateLimit429, consumeRateLimit } from '@/lib/rate-limit'
import { refreshLineupsNow } from '@/lib/import-os/collector/lineupRefresh'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The optional single-league filter. Anything but a short plain id string is ignored, not an error. */
async function readLeagueId(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { leagueId?: unknown } | null
  const id = body?.leagueId
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

export async function POST(request: Request) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({ scope: 'players', action: 'refresh_lineups', sleeperUsername: auth.userId, maxRequests: 8, windowMs: 60_000 })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Your lineups were just refreshed. Try again in a moment.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const result = await refreshLineupsNow({ userId: auth.userId, leagueId: await readLeagueId(request) })
  const count = (s: string) => result.attempted.filter((a) => a.status === s).length
  return NextResponse.json({
    total: result.total,
    remaining: result.remaining,
    refreshed: count('refreshed'),
    busy: count('busy'),
    skipped: count('skipped'),
    failed: count('failed'),
  })
}
