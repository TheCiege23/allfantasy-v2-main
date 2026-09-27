import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createHash } from 'node:crypto'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
/** Cross-process trade invalidation: never relies on an in-memory publisher. */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const [claimed, owned] = await Promise.all([
      prisma.leagueTeam.findMany({ where: { claimedByUserId: session.user.id }, select: { league: { select: { id: true, platformLeagueId: true, platform: true } } } }),
      prisma.league.findMany({ where: { userId: session.user.id }, select: { id: true, platformLeagueId: true, platform: true } }),
    ])
    const sources = [...new Map([...owned, ...claimed.map(t => t.league)].flatMap(l => l?.platformLeagueId ? [[`${l.platform}:${l.platformLeagueId}`, { platform: String(l.platform ?? 'sleeper').toLowerCase(), history: { sleeperLeagueId: l.platformLeagueId } }] as const] : [])).values()]
    const rows = sources.length ? await prisma.leagueTrade.findMany({
      where: { OR: sources, tradeDate: { gte: new Date(Date.now() - 14 * 86400000) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 40,
      select: { id: true, tradeDate: true },
    }) : []
    const leagueIds = [...new Set([...owned, ...claimed.map(t => t.league)].flatMap(l => l?.id ? [l.id] : []))]
    // Only processed native trades are league-public; private proposals never affect this hint.
    const native = leagueIds.length ? await prisma.afLeagueTrade.findMany({
      where: { leagueId: { in: leagueIds }, status: 'processed', updatedAt: { gte: new Date(Date.now() - 14 * 86400000) } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, updatedAt: true },
    }) : []
    const version = createHash('sha256').update(JSON.stringify({ rows, native })).digest('hex')
    return NextResponse.json({ version }, { headers })
  } catch { return NextResponse.json({ error: 'Trade updates unavailable' }, { status: 503, headers }) }
}
