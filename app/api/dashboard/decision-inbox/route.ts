import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listAfLeagueTrades } from '@/lib/league-trade-engine/tradeService'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Decision inbox — every AF-native trade awaiting the VIEWER's decision,
 * across every league, with enough detail to act from the dashboard. Actions
 * themselves go through the EXISTING per-trade endpoints
 * (/api/leagues/{leagueId}/trades/{tradeId}/accept|reject) so all engine
 * rules — vetoes, commissioner review, processing — stay in one place.
 *
 * Sleeper leagues also report whether pending offers may exist ON Sleeper
 * itself (invisible to the read-only import) so the inbox can say so honestly
 * and deep-link out instead of pretending the inbox is complete.
 */

function assetLabel(item: { itemReference: string | null; metadata: unknown }): string {
  const meta =
    item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : {}
  const name = typeof meta.playerName === 'string' && meta.playerName.trim() ? meta.playerName : null
  const position = typeof meta.position === 'string' && meta.position.trim() ? ` (${meta.position})` : ''
  return `${name ?? item.itemReference ?? 'Asset'}${name ? position : ''}`
}

export type InboxTrade = {
  tradeId: string
  leagueId: string
  leagueName: string
  partnerName: string
  createdAt: string
  youSend: string[]
  youReceive: string[]
}

export async function GET(_req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  const candidateIds = [userId, profile?.sleeperUserId].filter((v): v is string => Boolean(v))

  const leagues = await prisma.league.findMany({
    where: { OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
    select: { id: true, name: true, platform: true, platformLeagueId: true },
    take: 20,
  })

  const inbox: InboxTrade[] = []
  const sleeperLeagues: { leagueId: string; leagueName: string; sleeperLeagueId: string }[] = []

  for (const league of leagues) {
    if (league.platform === 'sleeper' && league.platformLeagueId) {
      sleeperLeagues.push({
        leagueId: league.id,
        leagueName: league.name ?? 'League',
        sleeperLeagueId: league.platformLeagueId,
      })
    }
    try {
      const myRoster = await prisma.roster.findFirst({
        where: { leagueId: league.id, platformUserId: { in: candidateIds } },
        select: { id: true },
      })
      if (!myRoster) continue
      const trades = await listAfLeagueTrades(league.id, { take: 25 })
      const awaiting = trades.filter(
        (t) => t.status === 'pending' && t.receiverRosterId === myRoster.id,
      )
      if (awaiting.length === 0) continue

      // Partner names via roster → platform user → app user (same as trades-panel).
      const partnerRosterIds = [...new Set(awaiting.map((t) => t.proposerRosterId))]
      const rosters = await prisma.roster.findMany({
        where: { id: { in: partnerRosterIds } },
        select: { id: true, platformUserId: true },
      })
      const users = await prisma.appUser
        .findMany({
          where: { id: { in: rosters.map((r) => r.platformUserId) } },
          select: { id: true, displayName: true, username: true },
        })
        .catch(() => [] as { id: string; displayName: string | null; username: string }[])
      const nameByUserId = new Map(users.map((u) => [u.id, u.displayName?.trim() || u.username]))
      const nameByRosterId = new Map(
        rosters.map((r) => [r.id, nameByUserId.get(r.platformUserId) ?? 'Manager']),
      )

      for (const t of awaiting) {
        inbox.push({
          tradeId: t.id,
          leagueId: league.id,
          leagueName: league.name ?? 'League',
          partnerName: nameByRosterId.get(t.proposerRosterId) ?? 'Manager',
          createdAt: t.createdAt.toISOString(),
          youSend: t.items.filter((i) => i.fromRosterId === myRoster.id).map(assetLabel),
          youReceive: t.items.filter((i) => i.toRosterId === myRoster.id).map(assetLabel),
        })
      }
    } catch {
      // One broken league never empties the inbox.
    }
  }
  inbox.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return NextResponse.json({
    inbox,
    sleeperLeagues,
    note:
      'AF-native offers only. Offers made ON Sleeper itself are not exposed by its read-only API — check them on Sleeper directly.',
  })
}
