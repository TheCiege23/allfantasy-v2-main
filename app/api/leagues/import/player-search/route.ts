/**
 * GET /api/leagues/import/player-search?q=&sport=
 *
 * Search box for the "Review your import" screen: lets a commissioner pick the AF player an
 * unmatched imported player really is. Searches `PlayerIdentityMap` (not `SportsPlayer`) because
 * the pick is stored as the identity mapping's `internalId`, which is a `PlayerIdentityMap.id`.
 *
 * Postgres only — no provider call.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { normalizePlayerNameForResolution } from '@/lib/shared-services/player-identity/PlayerIdentityResolver'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().trim().min(2).max(60),
  sport: z.string().trim().max(16).optional(),
})

export async function GET(req: Request) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({
    scope: 'import',
    action: 'player_search',
    ip: getClientIp(req),
    // The limiter's per-user key is named for its first caller; any stable user id works.
    sleeperUsername: auth.userId,
    maxRequests: 40,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Slow down a little and try again.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const { q } = parsed.data
  const sport = parsed.data.sport?.toUpperCase()
  const normalized = normalizePlayerNameForResolution(q)

  const rows = await prisma.playerIdentityMap.findMany({
    where: {
      ...(sport ? { sport } : {}),
      OR: [
        { canonicalName: { contains: q, mode: 'insensitive' } },
        ...(normalized ? [{ normalizedName: { contains: normalized } }] : []),
      ],
    },
    select: { id: true, canonicalName: true, position: true, currentTeam: true, sport: true },
    orderBy: { canonicalName: 'asc' },
    take: 12,
  })

  return NextResponse.json({
    players: rows.map((r) => ({
      afPlayerId: r.id,
      name: r.canonicalName,
      position: r.position,
      team: r.currentTeam,
      sport: r.sport,
    })),
  })
}
