import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { LeagueTradeBlockPanelItem, LeagueTradeHistoryItem, LeagueTradeAsset } from '@/components/league/types'
import { listAfLeagueTrades } from '@/lib/league-trade-engine/tradeService'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
import {
  scanPendingSleeperTrades,
  type PendingProviderTrade,
  type PendingTradeAsset,
  type PendingTradeScan,
} from '@/lib/provider-trades/scanPendingSleeperTrades'

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
  // Resolve the viewer's roster. Native AF leagues store the AF user id in
  // `platformUserId`; imported Sleeper leagues store the SLEEPER user id there,
  // so also try the viewer's linked sleeperUserId — otherwise the viewer-role
  // flags (accept/reject controls) never light up on imported leagues.
  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  const candidateIds = [userId, profile?.sleeperUserId].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
  const myRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: { in: candidateIds } },
    select: { id: true },
  })
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

/** Map a provider asset onto the panel's asset shape. */
function providerAsset(asset: PendingTradeAsset, idx: number, accent: 'blue' | 'teal'): LeagueTradeAsset {
  return {
    id: `${asset.playerId ?? 'pick'}:${idx}`,
    label: asset.playerName,
    sublabel: asset.isPick ? 'Draft pick' : [asset.position, asset.team].filter((v) => v && v !== '—').join(' · ') || null,
    headshotUrl: null,
    accent,
  }
}

/**
 * Pending trades proposed ON Sleeper. These were previously invisible: the
 * importer never calls `/transactions/`, and this panel read only
 * `AfLeagueTrade`, so a real proposal sitting in a user's Sleeper league showed
 * as "Active Trades 0" — and nothing could analyze it because nothing knew it
 * existed.
 *
 * They are surfaced READ-ONLY. Sleeper's public API has no write endpoint, so
 * the viewer-role flags that drive accept/reject/cancel are deliberately left
 * unset: AllFantasy advises on these, it cannot execute them. `direction` is
 * still resolved so the tab renders the trade the right way round.
 */
function mapProviderTrades(pending: PendingProviderTrade[]): LeagueTradeHistoryItem[] {
  return pending.map((trade) => ({
    id: `sleeper:${trade.transactionId}`,
    // Facing matters: a trade the viewer SENT is outgoing. Hardcoding
    // 'incoming' would render their own offer backwards, with given/received
    // reversed relative to how they built it.
    direction: (trade.proposedByViewer ? 'outgoing' : 'incoming') as LeagueTradeHistoryItem['direction'],
    partnerName: trade.proposedByViewer ? 'Awaiting response' : trade.proposedBy,
    timestamp: trade.proposedAt ?? new Date().toISOString(),
    sent: trade.assetsGiven.map((a, i) => providerAsset(a, i, 'blue')),
    received: trade.assetsReceived.map((a, i) => providerAsset(a, i, 'teal')),
    status: 'pending_on_sleeper',
    // Intentionally omitted: viewerIsReceiver / viewerIsProposer /
    // viewerIsCommissioner. Leaving them unset suppresses action controls the
    // provider API cannot honor.
  }))
}

/**
 * The same pending offers, in the shape a trade BUILDER can reload.
 *
 * ⚠ WHY NOT REUSE `activeTrades`. That array is `LeagueTradeHistoryItem`, whose
 * assets are `{ label, sublabel }` — display strings. Turning "2027 1st round
 * pick" back into `{ year: 2027, round: 1 }` means parsing prose, and the first
 * reword of that label silently breaks the reload. This carries the fields the
 * builder needs and leaves the panel's shape alone.
 *
 * `give` and `get` are from the VIEWER's side in both directions: an offer they
 * sent and an offer they received both list what leaves their roster under
 * `give`. Flipping on direction would show their own outgoing offer backwards.
 */
function builderOffers(pending: PendingProviderTrade[]) {
  const asset = (a: PendingTradeAsset) => ({
    playerId: a.playerId,
    name: a.playerName,
    position: a.position === '—' ? null : a.position,
    team: a.team === '—' ? null : a.team,
    isPick: Boolean(a.isPick),
    pickYear: a.pickYear ?? null,
    pickRound: a.pickRoundNumber ?? null,
    faabAmount: a.faabAmount ?? null,
  })

  return pending.map((t) => ({
    transactionId: t.transactionId,
    direction: t.proposedByViewer ? ('outgoing' as const) : ('incoming' as const),
    partnerName: t.proposedByViewer ? 'Awaiting response' : t.proposedBy,
    proposedAt: t.proposedAt,
    give: t.assetsGiven.map(asset),
    get: t.assetsReceived.map(asset),
  }))
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
      sport: true,
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
      /*
       * ⚠ NOT SCANNED, AND THE ENVELOPE SAYS SO. Only Sleeper exposes pending
       * offers to a read-only client. On every other platform we have not
       * looked, and an inbox that renders empty here would be claiming a fact
       * about the manager's league that we never checked.
       */
      pending: {
        scanned: false,
        reason: `pending offers are only readable on Sleeper today — this league is on ${String(league.platform ?? 'another platform')}`,
        platform: String(league.platform ?? 'manual').toLowerCase(),
        leagueUrl: null as string | null,
        weeksUnanswered: 0,
      },
      pendingOffers: [] as ReturnType<typeof builderOffers>,
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

  // Two independent sources on an imported league:
  //   1. AF-native trades proposed via the AF Trade Center on imported rosters.
  //   2. Pending trades proposed ON Sleeper.
  //
  // (2) used to be missing entirely — the comment here previously claimed
  // pending offers were "not exposed by the read-only public API", which is
  // wrong: `/league/<id>/transactions/<week>` returns them with
  // `status: "pending"`, and AF already reads exactly that on the dashboard.
  // The result was that a real proposal sitting in the user's Sleeper league
  // rendered as "Active Trades 0", so no analysis could run on a trade the app
  // had never heard of.
  // Resolve the viewer's SLEEPER id two ways, because a claimed team is not
  // guaranteed: prefer the claimed LeagueTeam row, then fall back to the id on
  // their profile (the same dual lookup buildNativeActiveTrades does). Without
  // the fallback, an unclaimed-but-owned league silently scans nothing.
  const viewerSleeperId = await (async () => {
    const claimed = await prisma.leagueTeam
      .findFirst({ where: { leagueId, claimedByUserId: userId }, select: { platformUserId: true } })
      .catch(() => null)
    const fromClaim = claimed?.platformUserId?.trim()
    if (fromClaim) return fromClaim
    const profile = await prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null)
    return profile?.sleeperUserId?.trim() || null
  })()

  const [nativeTrades, pendingScan] = await Promise.all([
    buildNativeActiveTrades(leagueId, userId).catch((err) => {
      console.error('[trades-panel] native trades for imported league failed', { leagueId, err })
      return [] as LeagueTradeHistoryItem[]
    }),
    viewerSleeperId
      ? scanPendingSleeperTrades({
          platformLeagueId: sleeperLeagueId,
          ownerSleeperId: viewerSleeperId,
          sport: league.sport,
        })
      : Promise.resolve<PendingTradeScan>({
          trades: [],
          scanned: false,
          /*
           * The viewer is in the league but nothing links them to a Sleeper
           * account, so there is no roster to scan FOR. Distinct from "Sleeper
           * refused" and from "nothing pending", and the copy has to keep them
           * apart — this one the manager can fix themselves.
           */
          reason: 'link your Sleeper account, or claim your team, so we know whose offers to read',
          weeksUnanswered: 0,
        }),
  ])

  const providerPending: PendingProviderTrade[] = pendingScan.trades

  // Native first (the viewer can act on those); provider proposals follow.
  const activeTrades = [...nativeTrades, ...mapProviderTrades(providerPending)]

  // Slice 5 wiring: the LeagueContext envelope rides along so every trade
  // surface can label HOW its verdicts are framed (IDP scoring, pirate house
  // rules) — flags are facts from settings/declarations, never inferred.
  const context = await getLeagueContext(sleeperLeagueId).catch(() => null)
  const values = context ? await getMarketValues(context).catch(() => null) : null
  const verdictContext = context
    ? {
        valuation: values
          ? { source: values.source, mode: values.mode, faabFormula: values.faab.formula }
          : null,
        idp: context.variant.idp,
        idpEmphasis: context.scoring.idp.emphasis,
        scoringFormat: context.scoring.format,
        superflex: context.variant.superflex,
        dynasty: context.variant.dynasty,
        adpKeyLabel: context.adpKeyLabel,
        pirate: context.houseRules.pirate
          ? {
              active: context.houseRules.pirate.active,
              source: context.houseRules.pirate.source,
              lines: context.houseRules.pirate.lines,
            }
          : null,
      }
    : null

  return NextResponse.json({
    tradeBlock,
    activeTrades,
    activeCount: activeTrades.length,
    source: 'sleeper' as const,
    leagueName: league.name ?? 'League',
    verdictContext,
    // Provenance so the tab can label provider rows and link out to Sleeper
    // rather than offering actions AF cannot perform.
    providerPendingCount: providerPending.length,
    providerLeagueUrl: `https://sleeper.com/leagues/${encodeURIComponent(sleeperLeagueId)}`,
    /*
     * ⚠ THE SCAN'S OUTCOME, NOT JUST ITS RESULT. `providerPendingCount: 0` is
     * true whether nothing is pending or nothing was read, and a consumer that
     * only sees the count cannot tell those apart. Everything needed to say
     * which one it was rides here.
     */
    pending: {
      scanned: pendingScan.scanned,
      reason: pendingScan.reason,
      platform: 'sleeper' as const,
      leagueUrl: `https://sleeper.com/leagues/${encodeURIComponent(sleeperLeagueId)}`,
      weeksUnanswered: pendingScan.weeksUnanswered,
    },
    pendingOffers: builderOffers(providerPending),
  })
}
