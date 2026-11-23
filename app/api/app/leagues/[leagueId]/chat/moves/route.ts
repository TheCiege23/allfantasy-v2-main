import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getLeagueActivity, type ActivityPlayer } from '@/lib/core-app/leagueActivity'
import { LEAGUE_MOVES_WINDOW_DAYS, type LeagueMove, type LeagueMovePlayer } from '@/lib/league-chat/leagueMoves'
import { fantraxLeagueMoves } from '@/lib/league/collegePro/fantraxActivity'
import { halfLabel, pairedLeagueFor } from '@/lib/league/collegePro/pairLink'

/**
 * GET /api/app/leagues/[leagueId]/chat/moves — the league's recent transactions, for the cards league
 * chat draws between messages (`lib/league-chat/leagueMoves.ts` says why they are read, not stored).
 *
 * Postgres only: `getLeagueActivity` reads `DecisionOsImportedActivity`, which the ingest cron
 * writes. No provider is called from here. Readable by exactly who can read the league's chat — the
 * same `resolveLeagueAccess` gate as `/api/league/chat`.
 */
const LIMIT = 40

const player = (p: ActivityPlayer): LeagueMovePlayer => ({
  id: p.id,
  name: p.name ?? p.label,
  position: p.position,
  team: p.team,
  imageUrl: p.imageUrl,
  to: p.to ?? null,
})

/** One league's moves in the window, newest first: the activity table, plus a Fantrax league's stored roster diffs. */
async function movesForLeague(leagueId: string, since: number): Promise<LeagueMove[]> {
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { platform: true, platformLeagueId: true, sport: true } })
    .catch(() => null)
  if (!league) return []

  const activity = await getLeagueActivity({
    leagueId,
    platformLeagueId: league.platformLeagueId,
    platform: league.platform,
    sport: league.sport,
    limit: LIMIT,
  })
  const moves: LeagueMove[] = (activity?.items ?? [])
    .filter((i) => i.occurredAt.getTime() >= since)
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      occurredAt: i.occurredAt.toISOString(),
      teamName: i.teamName,
      managerName: i.managerName,
      avatarUrl: i.avatarUrl,
      involvedTeams: i.involvedTeams,
      adds: i.adds.map(player),
      drops: i.drops.map(player),
      bid: i.bid,
      picks: i.picks,
    }))
  // Fantrax publishes no transactions, so the activity table has none for it (fantraxActivity.ts).
  if (String(league.platform ?? '').toLowerCase() === 'fantrax' && league.platformLeagueId) {
    moves.push(...(await fantraxLeagueMoves(league.platformLeagueId, { since }).catch(() => [])))
  }
  return moves
}

const newestFirst = (a: LeagueMove, b: LeagueMove) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)

/**
 * `?scope=franchise` (the Activity tab): for half of a paired college + pro league, BOTH halves' moves
 * in one feed, each tagged with the league it happened in, so the two leagues read as one. League chat
 * omits it and keeps its own league's moves only.
 */
export async function GET(req: Request, props: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await resolveLeagueAccess(leagueId, userId)) == null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const since = Date.now() - LEAGUE_MOVES_WINDOW_DAYS * 86_400_000
  const franchise = new URL(req.url).searchParams.get('scope') === 'franchise'
  const pair = franchise ? await pairedLeagueFor(leagueId, userId).catch(() => null) : null
  if (!pair) return NextResponse.json({ moves: (await movesForLeague(leagueId, since)).sort(newestFirst).slice(0, LIMIT) })

  const [own, other, rows] = await Promise.all([
    movesForLeague(leagueId, since),
    movesForLeague(pair.otherLeagueId, since),
    prisma.league.findMany({ where: { id: { in: [leagueId, pair.otherLeagueId] } }, select: { id: true, name: true, sport: true } }),
  ])
  const tag = (id: string) => {
    const r = rows.find((x) => x.id === id)
    return { leagueId: id, name: (r?.name ?? '').trim() || 'League', label: halfLabel(r?.sport) }
  }
  const moves = [
    ...own.map((m) => ({ ...m, league: tag(leagueId) })),
    ...other.map((m) => ({ ...m, league: tag(pair.otherLeagueId) })),
  ]
    .sort(newestFirst)
    .slice(0, LIMIT * 2)
  return NextResponse.json({ moves, leagues: [tag(leagueId), tag(pair.otherLeagueId)] })
}
