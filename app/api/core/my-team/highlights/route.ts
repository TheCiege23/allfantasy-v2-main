import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { getPlayerHighlights } from '@/lib/highlights/youtube'
import { mergeRosterHighlights } from '@/lib/highlights/roster'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const body = z.object({ playerIds: z.array(z.string().trim().min(1).max(64)).min(1).max(60) }).strict()

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  const rl = consumeRateLimit({ scope: 'players', action: 'team-highlights', sleeperUsername: session.user.id, ip: getClientIp(req), includeIpInKey: true, maxRequests: 10, windowMs: 60_000 })
  if (!rl.success) return NextResponse.json(buildRateLimit429({ message: 'Please slow down and try again.', rl }), { status: 429, headers: { ...headers, 'Retry-After': String(rl.retryAfterSec) } })
  const raw = await req.text()
  if (raw.length > 6000) return NextResponse.json({ error: 'Roster request is too large.' }, { status: 413, headers })
  let parsed
  try { parsed = body.safeParse(JSON.parse(raw)) } catch { return NextResponse.json({ error: 'Invalid roster request.' }, { status: 400, headers }) }
  if (!parsed.success) return NextResponse.json({ error: 'Provide up to 60 player IDs.' }, { status: 400, headers })
  try {
    // Only public player identities are resolved. No league or another user's roster is read.
    // The UI sends the IDs from its already-authorized My Team roster snapshot; nothing is stored.
    const rows = await prisma.sportsPlayer.findMany({
      where: { sport: { equals: 'NFL', mode: 'insensitive' }, sleeperId: { in: [...new Set(parsed.data.playerIds)], mode: 'insensitive' } },
      orderBy: { fetchedAt: 'desc' }, select: { sleeperId: true, name: true, sport: true, team: true },
    })
    const players = rows.filter((p, index) => p.sleeperId && rows.findIndex(row => row.sleeperId === p.sleeperId) === index)
    if (!players.length) return NextResponse.json({ status: 'ready', videos: [], checkedAt: null, message: 'No recognized NFL players in this roster.' }, { headers })
    // Concurrent lookups share one cached catalog and one in-flight provider request.
    const results = await Promise.all(players.map(async player => ({ sleeperId: player.sleeperId!, name: player.name, result: await getPlayerHighlights(player) })))
    return NextResponse.json(mergeRosterHighlights(results), { headers })
  } catch { return NextResponse.json({ error: 'Highlights are temporarily unavailable.' }, { status: 503, headers }) }
}
