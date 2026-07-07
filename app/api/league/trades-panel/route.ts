import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { LeagueTradeBlockPanelItem, LeagueTradeHistoryItem, LeagueTradeAsset } from '@/components/league/types'
import { listAfLeagueTrades } from '@/lib/league-trade-engine/tradeService'
import { isElevatedCommissioner } from '@/server/services/permissionService'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = new Set(['pending', 'awaiting_votes', 'awaiting_commissioner', 'accepted', 'scheduled'])

function assetLabel(item: { itemReference: string | null; metadata: unknown }): { label: string; sublabel: string | null } {
  const meta = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? (item.metadata as Record<string, unknown>)
    : {}
  const name = typeof meta.playerName === 'string' && meta.playerName.trim() ? meta.playerName : null
  const position = typeof meta.position === 'string' && meta.position.trim() ? meta.position : null
  return { label: name ?? item.itemReference ?? 'Asset', sublabel: position }
}

/**
 * Real native-league trade data for the redraft Trades tab: resolves the viewer's roster, pulls
 * every non-terminal `AfLeagueTrade` for the league, and maps each to the shape the tab already
 * renders. Direction/role flags let the tab show accept/reject/cancel/commissioner controls
 * without a second round-trip.
 */
async function buildNativeActiveTrades(leagueId: string, userId: string): Promise<LeagueTradeHistoryItem[]> {
  const myRoster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
  const myRosterId = myRoster?.id ?? null

  const trades = await listAfLeagueTrades(leagueId, { take: 50 })
  const active = trades.filter((t) => ACTIVE_STATUSES.has(t.status))
  if (active.length === 0) return []

  const rosterIds = [...new Set(active.flatMap((t) => [t.proposerRosterId, t.receiverRosterId]))]
  const rosters = await prisma.roster.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, platformUserId: true },
  })
  const userIds = [...new Set(rosters.map((r) => r.platformUserId))]
  const users = await prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } })
  const nameByUserId = new Map(users.map((u) => [u.id, u.displayName?.trim() || u.username]))
  const userIdByRosterId = new Map(rosters.map((r) => [r.id, r.platformUserId]))
  const nameByRosterId = new Map(rosterIds.map((id) => [id, nameByUserId.get(userIdByRosterId.get(id) ?? '') ?? 'Manager']))

  const isCommissioner = await isElevatedCommissioner(leagueId, userId)

  return active
    .filter((t) => isCommissioner || t.proposerRosterId === myRosterId || t.receiverRosterId === myRosterId)
    .map((t) => {
      const viewerIsProposer = myRosterId != null && t.proposerRosterId === myRosterId
      const viewerIsReceiver = myRosterId != null && t.receiverRosterId === myRosterId
      const direction: LeagueTradeHistoryItem['direction'] = viewerIsProposer
        ? 'outgoing'
        : viewerIsReceiver
          ? 'incoming'
          : 'complete'
      const partnerRosterId = viewerIsProposer ? t.receiverRosterId : t.proposerRosterId
      const sent: LeagueTradeAsset[] = t.items
        .filter((i) => i.fromRosterId === (viewerIsReceiver ? t.receiverRosterId : t.proposerRosterId))
        .map((i) => ({ id: i.id, ...assetLabel(i), headshotUrl: null, accent: 'blue' as const }))
      const received: LeagueTradeAsset[] = t.items
        .filter((i) => i.toRosterId === (viewerIsReceiver ? t.receiverRosterId : t.proposerRosterId))
        .map((i) => ({ id: i.id, ...assetLabel(i), headshotUrl: null, accent: 'teal' as const }))
      return {
        id: t.id,
        direction,
        partnerName: nameByRosterId.get(partnerRosterId) ?? 'Manager',
        timestamp: t.createdAt.toISOString(),
        sent,
        received,
        status: t.status,
        viewerIsCommissioner: isCommissioner,
        viewerIsReceiver,
        viewerIsProposer,
      }
    })
}

/**
 * Trade hub data for the league Trades tab: trade block entries synced to `TradeBlockEntry`, plus active trade count (future).
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: {
      id: true,
      platform: true,
      platformLeagueId: true,
      name: true,
    },
  })

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const sleeperLeagueId =
    league.platform === 'sleeper' && league.platformLeagueId ? league.platformLeagueId : null

  if (!sleeperLeagueId) {
    const activeTrades = await buildNativeActiveTrades(leagueId, userId)
    return NextResponse.json({
      tradeBlock: [] as LeagueTradeBlockPanelItem[],
      activeTrades,
      activeCount: activeTrades.length,
      source: 'native' as const,
    })
  }

  const tradeBlockRows = await prisma.tradeBlockEntry
    .findMany({
      where: {
        sleeperLeagueId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 48,
    })
    .catch(() => [])

  const tradeBlock: LeagueTradeBlockPanelItem[] = tradeBlockRows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    name: row.playerName,
    position: (row.position ?? 'FLEX').trim() || 'FLEX',
    team: row.team?.trim() || null,
    ownerName: row.createdByUsername?.trim() || 'Manager',
  }))

  return NextResponse.json({
    tradeBlock,
    activeTrades: [] as unknown[],
    activeCount: 0,
    source: 'sleeper' as const,
    leagueName: league.name ?? 'League',
  })
}
