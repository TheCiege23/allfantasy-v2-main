import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getPlayerCard } from '@/lib/core-app/playerCard'

/**
 * The player card pop-up's payload — STATE 6 / STATE 7 of the 2026-09-07 design
 * handoff. Opened by clicking a player's name anywhere in `/core`.
 *
 * It is its own route rather than a widening of an existing one because the
 * card is fetched ON DEMAND: every `/core` screen is a server component that
 * has already rendered by the time somebody clicks a name, so there is no
 * server pass left to hang this off. (The repo's old "never add a route" rule
 * was retired 2026-09-05 — it existed only for Vercel's 2,048-route ceiling,
 * and production is on Railway, which has no such ceiling.)
 *
 * ⚠ THE LEAGUE FLAVOUR IS MEMBERSHIP-GATED, THE UNIVERSAL ONE IS NOT. Without
 * `leagueId` the card carries public market facts — price, ranks, schedule,
 * news — and works signed out. WITH one it carries who holds him, your own
 * roster at his position, and that league's trade history, which is league
 * member data and is gated as such.
 */
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  sport: z.string().min(2).max(16),
  externalId: z.string().min(1).max(64).optional(),
  sleeperId: z.string().min(1).max(64).optional(),
  leagueId: z.string().min(1).max(64).optional(),
})

export async function GET(req: Request) {
  const rl = consumeRateLimit({
    scope: 'players',
    action: 'card',
    ip: getClientIp(req),
    includeIpInKey: true,
    // A card is one request per click, but a fast reader opens several in a row.
    maxRequests: 60,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many player cards. Please slow down.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  if (!parsed.data.externalId && !parsed.data.sleeperId) {
    return NextResponse.json({ error: 'externalId or sleeperId is required' }, { status: 400 })
  }

  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
  const userId = typeof session?.user?.id === 'string' && session.user.id.trim() ? session.user.id.trim() : null

  let leagueId: string | null = null
  if (parsed.data.leagueId) {
    const membership = await resolveLeagueMembership(parsed.data.leagueId, userId)
    // A non-member does not get an error — they get the universal card, which
    // is the honest degrade: the league half is what they may not see, not the
    // player. Erroring here would blank a card that has plenty to show.
    if (membership.ok) leagueId = parsed.data.leagueId
  }

  const card = await getPlayerCard({
    sport: parsed.data.sport,
    externalId: parsed.data.externalId ?? null,
    sleeperId: parsed.data.sleeperId ?? null,
    leagueId,
    userId,
  }).catch(() => null)

  if (!card) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

  return NextResponse.json(card, { headers: { 'Cache-Control': 'private, no-store' } })
}
