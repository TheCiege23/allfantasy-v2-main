import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getLeagueActivity, type ActivityPlayer } from '@/lib/core-app/leagueActivity'
import { LEAGUE_MOVES_WINDOW_DAYS, type LeagueMove, type LeagueMovePlayer } from '@/lib/league-chat/leagueMoves'

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

export async function GET(_req: Request, props: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await resolveLeagueAccess(leagueId, userId)) == null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { platform: true, platformLeagueId: true, sport: true } })
    .catch(() => null)
  if (!league) return NextResponse.json({ moves: [] })

  const activity = await getLeagueActivity({
    leagueId,
    platformLeagueId: league.platformLeagueId,
    platform: league.platform,
    sport: league.sport,
    limit: LIMIT,
  })
  const since = Date.now() - LEAGUE_MOVES_WINDOW_DAYS * 86_400_000
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
  return NextResponse.json({ moves })
}
