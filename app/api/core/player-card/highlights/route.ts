import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { getPlayerHighlights } from '@/lib/highlights/youtube'

export const dynamic = 'force-dynamic'

const query = z.object({
  sport: z.string().min(2).max(16).transform((sport) => sport.toUpperCase()),
  externalId: z.string().trim().min(1).max(64).optional(),
  sleeperId: z.string().trim().min(1).max(64).optional(),
}).refine((value) => value.externalId || value.sleeperId)

export async function GET(req: Request) {
  const rl = consumeRateLimit({
    scope: 'players', action: 'highlights', ip: getClientIp(req), includeIpInKey: true,
    maxRequests: 30, windowMs: 60_000,
  })
  if (!rl.success) return NextResponse.json(buildRateLimit429({ message: 'Please slow down and try again.', rl }), {
    status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) },
  })
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'A sport and player ID are required.' }, { status: 400 })
  const { sport, externalId, sleeperId } = parsed.data
  if (sport !== 'NFL') return NextResponse.json(await getPlayerHighlights({ sport, name: '', team: null }))
  try {
    // Public catalog only. Names come from canonical player identity, never a caller's search string.
    const player = await prisma.sportsPlayer.findFirst({
      where: { sport: { equals: sport, mode: 'insensitive' }, ...(externalId ? { externalId } : { sleeperId: { equals: sleeperId!, mode: 'insensitive' } }) },
      orderBy: [{ fetchedAt: 'desc' }],
      select: { name: true, sport: true, team: true },
    })
    if (!player) return NextResponse.json({ error: 'Player not found.' }, { status: 404 })
    return NextResponse.json(await getPlayerHighlights(player), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Highlights are temporarily unavailable.' }, { status: 503 })
  }
}
