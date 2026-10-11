import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { findMyRoster, rosterPlayerIds } from '@/lib/core-app/myRoster'
import { crosswalkToSleeperIds, sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'
import { readXCatalog } from '@/lib/highlights/x-catalog'
import { xHighlightsEnabled } from '@/lib/highlights/x-provider'
import { matchXClips } from '@/lib/highlights/x-match'
import type { ClipPlayer } from '@/lib/highlights/x-types'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const id = z.string().trim().min(1).max(64)
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player'), sport: z.literal('NFL'), externalId: id.optional(), sleeperId: id.optional() }).strict(),
  z.object({ kind: z.literal('roster'), playerIds: z.array(id).min(1).max(60) }).strict(),
  z.object({ kind: z.literal('leagues'), leagueIds: z.array(id).min(1).max(5) }).strict(),
])
async function playersFor(ids: string[]): Promise<ClipPlayer[]> {
  if (!ids.length) return []
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport: { equals: 'NFL', mode: 'insensitive' }, sleeperId: { in: [...new Set(ids)] } },
    orderBy: { fetchedAt: 'desc' }, select: { sleeperId: true, name: true },
  })
  const players = new Map<string, ClipPlayer>()
  for (const row of rows) if (row.sleeperId && !players.has(row.sleeperId)) players.set(row.sleeperId, { id: row.sleeperId, name: row.name })
  return [...players.values()]
}
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  const limit = consumeRateLimit({ scope: 'players', action: 'x-clips', sleeperUsername: session.user.id, ip: getClientIp(req), includeIpInKey: true, maxRequests: 30, windowMs: 60_000 })
  if (!limit.success) return NextResponse.json({ error: 'Please try again shortly.' }, { status: 429, headers: { ...headers, 'Retry-After': String(limit.retryAfterSec) } })
  const raw = await req.text()
  if (raw.length > 6000) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers })
  let parsed
  try { parsed = schema.safeParse(JSON.parse(raw)) } catch { return NextResponse.json({ error: 'Invalid clip request.' }, { status: 400, headers }) }
  if (!parsed.success || (parsed.data.kind === 'player' && !parsed.data.externalId && !parsed.data.sleeperId)) return NextResponse.json({ error: 'Invalid clip request.' }, { status: 400, headers })
  if (!xHighlightsEnabled()) return NextResponse.json({ status: 'disabled', clips: [], checkedAt: null }, { headers })
  try {
    const catalog = await readXCatalog()
    if (!catalog) return NextResponse.json({ status: 'unavailable', clips: [], checkedAt: null }, { headers })
    const request = parsed.data
    const groups: Array<{ players: ClipPlayer[]; league?: { id: string; name: string } }> = []
    if (request.kind === 'player') {
      const row = await prisma.sportsPlayer.findFirst({
        where: { sport: { equals: 'NFL', mode: 'insensitive' }, ...(request.externalId ? { externalId: request.externalId } : { sleeperId: request.sleeperId }) },
        orderBy: { fetchedAt: 'desc' }, select: { sleeperId: true, externalId: true, name: true },
      })
      if (!row) return NextResponse.json({ error: 'Player not found.' }, { status: 404, headers })
      groups.push({ players: [{ id: row.sleeperId ?? row.externalId, name: row.name }] })
    } else if (request.kind === 'roster') {
      // Public identities from the already-authorized My Team snapshot, never stored.
      groups.push({ players: await playersFor(request.playerIds) })
    } else {
      // Authorization is applied before any roster read, including shared/imported leagues.
      const teams = await prisma.leagueTeam.findMany({
        where: { leagueId: { in: [...new Set(request.leagueIds)] }, claimedByUserId: session.user.id },
        select: { league: { select: { id: true, name: true, sport: true, platform: true } } },
      })
      const leagues = [...new Map(teams.filter(t => t.league.sport === 'NFL').map(t => [t.league.id, t.league])).values()]
      await Promise.all(leagues.map(async league => {
        const roster = await findMyRoster(prisma, league.id, session.user.id)
        if (!roster.found) return
        const ids = rosterPlayerIds(roster.playerData).slice(0, 60)
        const crosswalk = await crosswalkToSleeperIds(league.platform, 'NFL', ids)
        const sleeperIds = ids.map(id => sleeperLookupId(league.platform, id, crosswalk)).filter((id): id is string => Boolean(id))
        groups.push({ league: { id: league.id, name: league.name ?? 'My league' }, players: await playersFor(sleeperIds) })
      }))
      groups.sort((a, b) => request.leagueIds.indexOf(a.league!.id) - request.leagueIds.indexOf(b.league!.id))
    }
    return NextResponse.json({ status: 'ready', clips: matchXClips(catalog.posts, groups, Date.now(), request.kind === 'leagues'), checkedAt: catalog.checkedAt }, { headers })
  } catch {
    return NextResponse.json({ error: 'Recent clips are temporarily unavailable.' }, { status: 503, headers })
  }
}

