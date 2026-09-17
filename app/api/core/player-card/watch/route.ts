import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveLeagueMembership } from '@/lib/league-access'
import { addToWatchlist, removeFromWatchlist } from '@/lib/waiver-wire/watchlist-service'
import { prisma } from '@/lib/prisma'
import { followKeyFor, followPlayer, unfollowPlayer } from '@/lib/follows/playerFollows'
import { setTradeBlock } from '@/lib/trade-block/importedTradeBlock'

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
/*
 * ── FOLLOW, ACROSS EVERY LEAGUE (user decisions, 2026-09-14) ─────────────────────────────
 * A body WITHOUT `leagueId` is a cross-league follow, stored in `player_follows` through
 * lib/follows/playerFollows. It needs a session and nothing else: following a player reveals
 * nothing about any league, so there is no membership to check. A body WITH `leagueId` is the
 * league watchlist above, unchanged, so a client built before this still works.
 *
 * ⚠ THE SNAPSHOT COMES FROM OUR PLAYER ROW, NEVER FROM THE REQUEST. The client sends only the
 * ids; name, position and team are read from `SportsPlayer` exactly as the card reads them, so
 * a follow list cannot be written with an invented name.
 *
 * 409 at the follow limit, 503 when follows are unavailable (the migration is not applied).
 */
/*
 * ── TRADE BLOCK (user decision, 2026-09-17) ──────────────────────────────────────────────
 * The card's second write: a league body with `list: 'trade-block'`. Membership is checked
 * here exactly as for the watchlist; that the player is YOURS is proved by
 * lib/trade-block/importedTradeBlock, and its refusals come back with their own status.
 */
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  leagueId: z.string().min(1).max(64),
  sleeperId: z.string().min(1).max(64),
  sport: z.string().min(2).max(16).optional(),
  /*
   * Which of the card's two league lists this writes. Absent means the watchlist, so every client
   * built before the trade block keeps its meaning. `trade-block` puts one of YOUR players on this
   * league's trade block (POST) or takes him off (DELETE) — `lib/trade-block/importedTradeBlock`
   * proves he is yours; membership alone is not enough.
   */
  list: z.enum(['watchlist', 'trade-block']).optional(),
})

const TRADE_BLOCK_STATUS = {
  league_not_found: 404,
  unsupported_platform: 400,
  no_team: 403,
  not_your_player: 403,
  no_roster_id: 409,
} as const

async function handleTradeBlock(leagueId: string, userId: string, sleeperId: string, onBlock: boolean) {
  const out = await setTradeBlock({ leagueId, userId, sleeperId, onBlock })
  if (!out.ok) {
    return NextResponse.json({ error: out.message, code: out.reason }, { status: TRADE_BLOCK_STATUS[out.reason] })
  }
  return NextResponse.json({ ok: true, onTradeBlock: out.onBlock })
}

const followSchema = z
  .object({
    sport: z.string().min(2).max(16),
    sleeperId: z.string().min(1).max(64).optional(),
    externalId: z.string().min(1).max(128).optional(),
  })
  .refine((b) => Boolean(b.sleeperId || b.externalId), { message: 'sleeperId or externalId is required' })

type FollowBody = z.infer<typeof followSchema>

async function authorizeFollow(req: Request, raw: unknown) {
  const parsed = followSchema.safeParse(raw)
  if (!parsed.success) return { error: NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const session = (await getServerSession(authOptions as never).catch(() => null)) as
    | { user?: { id?: string } }
    | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { userId, body: parsed.data }
}

/** Our row for him, by the same lookup the card uses (newest provider row wins). */
async function findPlayer(body: FollowBody) {
  return prisma.sportsPlayer
    .findFirst({
      where: {
        sport: { equals: body.sport, mode: 'insensitive' },
        ...(body.sleeperId
          ? { sleeperId: { equals: body.sleeperId, mode: 'insensitive' } }
          : { externalId: body.externalId! }),
      },
      orderBy: [{ fetchedAt: 'desc' }],
      select: { externalId: true, sleeperId: true, sport: true, name: true, position: true, team: true },
    })
    .catch(() => null)
}

/** One limit for both kinds of star. */
function rateLimited(req: Request) {
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
  if (rl.success) return null
  return NextResponse.json(buildRateLimit429({ message: 'Too many watchlist changes. Please slow down.', rl }), {
    status: 429,
    headers: { 'Retry-After': String(rl.retryAfterSec) },
  })
}

async function handleFollow(req: Request, raw: unknown, method: 'POST' | 'DELETE') {
  const a = await authorizeFollow(req, raw)
  if ('error' in a) return a.error
  const player = await findPlayer(a.body)

  if (method === 'DELETE') {
    const key = followKeyFor(player ?? a.body)
    if (!key) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    const out = await unfollowPlayer(a.userId, player?.sport ?? a.body.sport, key)
    if (out === 'unavailable') return NextResponse.json({ error: 'Follows are unavailable' }, { status: 503 })
    return NextResponse.json({ ok: true, following: false })
  }

  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  const out = await followPlayer(a.userId, {
    sport: player.sport,
    externalId: player.externalId,
    sleeperId: player.sleeperId,
    name: player.name,
    position: player.position,
    team: player.team,
  })
  if (out === 'limit') return NextResponse.json({ error: 'You are following the maximum number of players' }, { status: 409 })
  if (out === 'unavailable') return NextResponse.json({ error: 'Follows are unavailable' }, { status: 503 })
  if (out === 'invalid') return NextResponse.json({ error: 'This player cannot be followed' }, { status: 400 })
  return NextResponse.json({ ok: true, following: true })
}

async function authorize(req: Request) {
  const limited = rateLimited(req)
  if (limited) return { error: limited }

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

/** A body without `leagueId` is a cross-league follow; it is read once and routed here. */
async function followRoute(req: Request, method: 'POST' | 'DELETE') {
  const raw = await req
    .clone()
    .json()
    .catch(() => ({}))
  if (raw && typeof raw === 'object' && 'leagueId' in raw) return null
  return rateLimited(req) ?? handleFollow(req, raw, method)
}

export async function POST(req: Request) {
  const follow = await followRoute(req, 'POST')
  if (follow) return follow
  const a = await authorize(req)
  if ('error' in a) return a.error
  if (a.body.list === 'trade-block') return handleTradeBlock(a.body.leagueId, a.userId, a.body.sleeperId, true)
  await addToWatchlist(a.body.leagueId, a.userId, a.body.sleeperId, a.body.sport ?? null)
  return NextResponse.json({ ok: true, watched: true })
}

export async function DELETE(req: Request) {
  const follow = await followRoute(req, 'DELETE')
  if (follow) return follow
  const a = await authorize(req)
  if ('error' in a) return a.error
  if (a.body.list === 'trade-block') return handleTradeBlock(a.body.leagueId, a.userId, a.body.sleeperId, false)
  await removeFromWatchlist(a.body.leagueId, a.userId, a.body.sleeperId)
  return NextResponse.json({ ok: true, watched: false })
}
