import { NextResponse } from 'next/server'
import { z } from 'zod'

import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { loadPlayerCardMore } from '@/lib/core-app/playerCardMore'

/**
 * GET /api/core/player-card/more?sport=&name=[&position=&team=&sleeperId=&externalId=]
 *
 * The player card's Game log, Career and Depth chart tabs (lib/core-app/playerCardMore.ts). Postgres
 * only — every table here is written by an ingestion job, never by this request.
 */
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  sport: z.string().trim().min(2).max(12),
  name: z.string().trim().min(1).max(120),
  position: z.string().trim().max(12).optional(),
  team: z.string().trim().max(64).optional(),
  sleeperId: z.string().trim().max(64).optional(),
  externalId: z.string().trim().max(64).optional(),
})

export async function GET(req: Request) {
  const rl = consumeRateLimit({
    scope: 'players',
    action: 'card-more',
    ip: getClientIp(req),
    includeIpInKey: true,
    maxRequests: 60,
    windowMs: 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: 'Too many player cards. Please slow down.', rl }), {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const q = parsed.data

  try {
    const more = await loadPlayerCardMore({
      sport: q.sport,
      name: q.name,
      position: q.position ?? null,
      team: q.team ?? null,
      ids: [q.sleeperId, q.externalId].filter((x): x is string => Boolean(x)),
    })
    return NextResponse.json(more, { headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch (error) {
    console.error('[core/player-card/more]', error instanceof Error ? error.message : 'failed')
    return NextResponse.json({ error: 'Could not load this player' }, { status: 500 })
  }
}
