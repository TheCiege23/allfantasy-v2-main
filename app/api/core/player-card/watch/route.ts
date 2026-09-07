import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveLeagueMembership } from '@/lib/league-access'
import { addToWatchlist, removeFromWatchlist } from '@/lib/waiver-wire/watchlist-service'

/**
 * The player card's ☆ — the one WRITE the card makes.
 *
 * ⚠ IT IS MEMBERSHIP-GATED ON THE SAME HELPER THE CARD ITSELF USES.
 * `resolveLeagueMembership` is the canonical predicate; the older
 * `/api/waiver-wire/leagues/[leagueId]/watchlist` route hand-rolls its own
 * (`League.userId` OR `Roster.platformUserId`), and this repo has already
 * measured that rosters for CLAIMED teams key on `claimedByUserId` — 332 of 332
 * — so a hand-rolled pair like that can refuse a legitimate member. Reusing the
 * canonical helper means the star is visible on exactly the leagues whose card
 * the reader is allowed to open, with no second opinion about who belongs.
 *
 * ⚠ IT WRITES THROUGH `lib/waiver-wire/watchlist-service`, NOT ITS OWN QUERIES.
 * One implementation of the rule, so the card and the waiver page cannot drift
 * on what "watched" means at the persistence layer.
 *
 * 🛑 THE ID STORED IS THE SLEEPER ID, AND THAT DOES **NOT** MATCH THE WAIVER
 * PAGE'S KEY. Measured 2026-09-07 on production: `SportsPlayer.sleeperId`
 * ("5129"), `SportsPlayer.id` (a uuid) and `SportsPlayerRecord.id` ("NFL:1000",
 * which the waiver pool joins through) share nothing — 0 of 200 sampled ids
 * matched in either direction. So a player starred here will not light up on
 * the waiver wire, and vice versa. Reconciling the two needs a name-based join
 * across the 178 NFL duplicate groups the repo explicitly forbids merging;
 * until somebody does that deliberately, these are two lists in one table,
 * distinguishable by the shape of the id. `waiver_watchlists` was EMPTY in
 * production when this shipped, so nothing was reinterpreted.
 */
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  leagueId: z.string().min(1).max(64),
  sleeperId: z.string().min(1).max(64),
  sport: z.string().min(2).max(16).optional(),
})

async function authorize(req: Request) {
  const rl = consumeRateLimit({
    scope: 'players',
    action: 'card-watch',
    ip: getClientIp(req),
    includeIpInKey: true,
    // A star is one deliberate click; this is generous enough for a fast reader
    // working down a list and tight enough that it cannot be used to enumerate.
    maxRequests: 60,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return {
      error: NextResponse.json(buildRateLimit429({ message: 'Too many watchlist changes. Please slow down.', rl }), {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      }),
    }
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return { error: NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const session = (await getServerSession(authOptions as never).catch(() => null)) as
    | { user?: { id?: string } }
    | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const membership = await resolveLeagueMembership(parsed.data.leagueId, userId)
  if (!membership.ok) {
    /* The league's own status — 404 for one you cannot see, so this never
       confirms the existence of a league you are not in. */
    return { error: NextResponse.json({ error: 'League not found' }, { status: membership.status }) }
  }

  return { userId, body: parsed.data }
}

export async function POST(req: Request) {
  const a = await authorize(req)
  if ('error' in a) return a.error
  await addToWatchlist(a.body.leagueId, a.userId, a.body.sleeperId, a.body.sport ?? null)
  return NextResponse.json({ ok: true, watched: true })
}

export async function DELETE(req: Request) {
  const a = await authorize(req)
  if ('error' in a) return a.error
  await removeFromWatchlist(a.body.leagueId, a.userId, a.body.sleeperId)
  return NextResponse.json({ ok: true, watched: false })
}
