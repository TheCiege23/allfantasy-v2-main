import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import type { LeagueTradeBlockPanelItem, LeagueTradeHistoryItem, LeagueTradeAsset } from '@/components/league/types'
import { rosterIdMapKeys } from '@/lib/core-app/rosterIdMatch'
import { getLeagueTradeLedgerForRoster } from '@/lib/provider-trades/providerTradeOfferReads'
import { buildProviderOfferHistoryRows } from '@/lib/provider-trades/providerOfferHistoryRows'
import { listAfLeagueTrades } from '@/lib/league-trade-engine/tradeService'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { readTradeBlock, tradeBlockSupport } from '@/lib/trade-block/importedTradeBlock'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
import {
  scanPendingSleeperTrades,
  type PendingProviderTrade,
  type PendingTradeAsset,
  type PendingTradeScan,
} from '@/lib/provider-trades/scanPendingSleeperTrades'
import { scanPendingYahooTrades } from '@/lib/provider-trades/scanPendingYahooTrades'
import {
  evaluatePendingProviderTrades,
  type ProviderPendingEvaluation,
} from '@/lib/provider-trades/evaluatePendingProviderTrades'
import { priceTradesAtCurrentMarket } from '@/lib/league-trade-engine/tradeLearningCapture'
import { evaluateCanonicalTrade } from '@/lib/decision-os/trade/canonicalEvaluator'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import { summarizeRosterImpact } from '@/lib/decision-os/trade/rosterImpactSummary'
import type { League } from '@prisma/client'
import { publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from '@/lib/trade-value/leagueTradeGrader'
import { gradeInputsFromNativeItems, gradeInputsFromPending } from '@/lib/trade-value/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/trade-value/tradeGrade'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = new Set(['pending', 'awaiting_votes', 'awaiting_commissioner', 'accepted', 'scheduled'])
const TERMINAL_STATUSES = new Set(['processed', 'rejected', 'cancelled', 'countered', 'expired', 'vetoed', 'reversed'])

async function loadDecisionReceipts(tradeIds: string[]): Promise<Map<string, NonNullable<LeagueTradeHistoryItem['decisionReceipt']>>> {
  if (!tradeIds.length) return new Map()
  const store = (prisma as typeof prisma & { tradeDecisionSnapshot?: typeof prisma.tradeDecisionSnapshot }).tradeDecisionSnapshot
  if (!store) return new Map()
  const rows = await store.findMany({ where: { tradeId: { in: tradeIds } } }).catch(() => [])
  return new Map(rows.map((row) => [row.tradeId, publicTradeDecisionReceipt(row)]))
}

/**
 * ONE grader per request, loaded only if something open needs grading. It reads the league's chart
 * once and grades every open offer on it — see `lib/trade-value/leagueTradeGrader.ts`.
 */
type GraderSource = () => Promise<LeagueTradeGrader | null>
function lazyGrader(leagueId: string, userId: string): GraderSource {
  let pending: Promise<LeagueTradeGrader | null> | null = null
  return () => (pending ??= createLeagueTradeGrader({ leagueId, userId }).catch(() => null))
}

/**
 * The grade fields an OPEN row carries. The letter, the values under it and the recommendation all
 * come from the one grade, so the "Then → Now" tiles, the advice line and the card letters cannot
 * disagree about the same offer. `decisionCoveragePct` and `rosterImpact` stay with the canonical
 * evaluation, which still runs for the lineup effect and the Decision OS record.
 */
function openGradeFields(grade: TradeGradeView, side: 'viewer' | 'proposer') {
  return {
    leagueGrade: grade,
    leagueGradeSide: side,
    decisionAction: grade.graded ? grade.action : undefined,
    decisionRecommendation: grade.graded ? grade.recommendation : `Not graded: ${grade.reason}`,
    currentGrade: grade.graded ? grade.letter : null,
    currentValueGiven: grade.graded ? grade.giveValue : null,
    currentValueReceived: grade.graded ? grade.getValue : null,
  } satisfies Partial<LeagueTradeHistoryItem>
}

/** Grade each pending provider offer from the viewer's side (their `assetsGiven` is what they send). */
async function gradeProviderOffers(trades: PendingProviderTrade[], grader: GraderSource): Promise<Map<string, TradeGradeView>> {
  const out = new Map<string, TradeGradeView>()
  if (trades.length === 0) return out
  const g = await grader()
  await Promise.all(trades.map(async (t) => {
    out.set(t.transactionId, await gradeDeal(g, {
      give: gradeInputsFromPending(t.assetsGiven),
      get: gradeInputsFromPending(t.assetsReceived),
      viewerSide: true,
    }))
  }))
  return out
}

function assetLabel(item: { itemType: string; itemReference: string | null; metadata: unknown }, sport = 'NFL'): {
  label: string; sublabel: string | null; playerId: string | null; team: string | null; headshotUrl: string | null; teamLogoUrl: string | null
} {
  const meta = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? (item.metadata as Record<string, unknown>)
    : {}
  const name = typeof meta.playerName === 'string' && meta.playerName.trim() ? meta.playerName : null
  const position = typeof meta.position === 'string' && meta.position.trim() ? meta.position : null
  const team = typeof meta.team === 'string' && meta.team.trim() ? meta.team.trim().toUpperCase() : null
  const itemType = String(item.itemType ?? 'player').toLowerCase()
  const playerId = itemType.includes('player') ? item.itemReference : null
  const explicitHeadshot = typeof meta.headshotUrl === 'string' && meta.headshotUrl.trim() ? meta.headshotUrl.trim() : null
  return {
    label: name ?? item.itemReference ?? 'Asset',
    sublabel: [position, team].filter(Boolean).join(' · ') || null,
    playerId,
    team,
    headshotUrl: explicitHeadshot ?? sleeperPlayerHeadshot(playerId),
    teamLogoUrl: teamLogoUrl(sport, team),
  }
}

/**
 * Real native-league trade data for the redraft Trades tab: resolves the viewer's roster, pulls
 * every non-terminal `AfLeagueTrade` for the league, and maps each to the shape the tab already
 * renders. Direction/role flags let the tab show accept/reject/cancel/commissioner controls
 * without a second round-trip.
 */
async function buildNativeActiveTrades(
  leagueId: string,
  userId: string,
  sport = 'NFL',
  grader: GraderSource = lazyGrader(leagueId, userId),
): Promise<LeagueTradeHistoryItem[]> {
  // Resolve the viewer's roster. Native AF leagues store the AF user id in
  // `platformUserId`; imported Sleeper leagues store the SLEEPER user id there,
  // so also try the viewer's linked sleeperUserId — otherwise the viewer-role
  // flags (accept/reject controls) never light up on imported leagues.
  const [profile, claimedTeam] = await Promise.all([
    prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null),
    prisma.leagueTeam
      .findFirst({ where: { leagueId, claimedByUserId: userId }, select: { platformUserId: true } })
      .catch(() => null),
  ])
  const candidateIds = [userId, profile?.sleeperUserId, claimedTeam?.platformUserId].filter(
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
  const decisionReceipts = await loadDecisionReceipts(active.map((trade) => trade.id))

  const rosterIds = [...new Set(active.flatMap((t) => [
    t.proposerRosterId,
    t.receiverRosterId,
    ...t.items.flatMap((i) => [i.fromRosterId, i.toRosterId]),
  ]))]
  const rosters = await prisma.roster.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, platformUserId: true },
  })
  const userIds = [...new Set(rosters.map((r) => r.platformUserId))]
  const users = await prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true, avatarUrl: true } })
  const leagueTeamStore = (prisma as typeof prisma & { leagueTeam?: typeof prisma.leagueTeam }).leagueTeam
  const leagueTeams = leagueTeamStore && typeof leagueTeamStore.findMany === 'function'
    ? await leagueTeamStore.findMany({
        where: {
          leagueId,
          OR: [
            { externalId: { in: [...rosterIds, ...userIds] } },
            { platformUserId: { in: userIds } },
            { claimedByUserId: { in: userIds } },
          ],
        },
        select: { externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true, teamName: true, avatarUrl: true },
      }).catch(() => [])
    : []
  const nameByUserId = new Map(users.map((u) => [u.id, u.displayName?.trim() || u.username]))
  const avatarByUserId = new Map(users.map((u) => [u.id, u.avatarUrl]))
  const teamByRosterIdentity = new Map(leagueTeams.flatMap((team) => [
    [team.externalId, team] as const,
    ...(team.platformUserId ? [[team.platformUserId, team] as const] : []),
    ...(team.claimedByUserId ? [[team.claimedByUserId, team] as const] : []),
  ]))
  const userIdByRosterId = new Map(rosters.map((r) => [r.id, r.platformUserId]))
  const nameByRosterId = new Map(rosterIds.map((id) => {
    const externalId = userIdByRosterId.get(id) ?? ''
    const team = teamByRosterIdentity.get(id) ?? teamByRosterIdentity.get(externalId)
    return [id, nameByUserId.get(externalId) ?? team?.ownerName ?? team?.teamName ?? 'Manager']
  }))
  const avatarByRosterId = new Map(rosterIds.map((id) => {
    const externalId = userIdByRosterId.get(id) ?? ''
    return [id, teamByRosterIdentity.get(id)?.avatarUrl ?? teamByRosterIdentity.get(externalId)?.avatarUrl ?? avatarByUserId.get(externalId) ?? null]
  }))

  const isCommissioner = await isElevatedCommissioner(leagueId, userId)
  const world = await resolveCanonicalWorld(leagueId).catch(() => null)

  /*
   * Names for the grade. A Trade Center proposal carries a Sleeper id and no metadata per player, and
   * the one grader prices players by name — so the ids are resolved here, once for the whole panel.
   * One row per id: `SportsPlayer` holds several for many players (see viewerNeedFactors).
   */
  const unnamedIds = [...new Set(active.flatMap((t) => t.items)
    .filter((i) => !String(i.itemType ?? 'player').toLowerCase().includes('pick') && !String(i.itemType ?? '').toLowerCase().includes('faab'))
    .filter((i) => {
      const m = i.metadata && typeof i.metadata === 'object' && !Array.isArray(i.metadata) ? i.metadata as Record<string, unknown> : {}
      return !(typeof m.playerName === 'string' && m.playerName.trim()) && !(typeof m.name === 'string' && m.name.trim())
    })
    .map((i) => i.itemReference)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const sportsPlayerStore = (prisma as typeof prisma & { sportsPlayer?: typeof prisma.sportsPlayer }).sportsPlayer
  const nameRows = unnamedIds.length > 0 && sportsPlayerStore && typeof sportsPlayerStore.findMany === 'function'
    ? await sportsPlayerStore.findMany({ where: { sleeperId: { in: unnamedIds } }, select: { sleeperId: true, name: true } }).catch(() => [])
    : []
  const nameBySleeperId = new Map<string, string>()
  for (const r of nameRows) if (r.sleeperId && r.name && !nameBySleeperId.has(r.sleeperId)) nameBySleeperId.set(r.sleeperId, r.name)
  const nameForId = (id: string) => nameBySleeperId.get(id) ?? null

  return Promise.all(active
    .filter((t) => {
      const participants = new Set([
        t.proposerRosterId,
        t.receiverRosterId,
        ...t.items.flatMap((i) => [i.fromRosterId, i.toRosterId]),
      ])
      return isCommissioner || (myRosterId != null && participants.has(myRosterId))
    })
    .map(async (t) => {
      const participantIds = [...new Set([
        t.proposerRosterId,
        t.receiverRosterId,
        ...t.items.flatMap((i) => [i.fromRosterId, i.toRosterId]),
      ])]
      const meta = t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata)
        ? t.metadata as Record<string, unknown>
        : {}
      const accepted = new Set(Array.isArray(meta.acceptedRosterIds) ? meta.acceptedRosterIds.map(String) : [])
      const viewerIsProposer = myRosterId != null && t.proposerRosterId === myRosterId
      const viewerIsReceiver = myRosterId != null && participantIds.includes(myRosterId) && !viewerIsProposer && !accepted.has(myRosterId)
      const direction: LeagueTradeHistoryItem['direction'] = viewerIsProposer
        ? 'outgoing'
        : viewerIsReceiver
          ? 'incoming'
          : 'complete'
      const viewRosterId = myRosterId && participantIds.includes(myRosterId) ? myRosterId : t.proposerRosterId
      const partnerName = participantIds.filter((id) => id !== viewRosterId).map((id) => nameByRosterId.get(id) ?? 'Manager').join(' + ')
      const sent: LeagueTradeAsset[] = t.items
        .filter((i) => i.fromRosterId === viewRosterId)
        .map((i) => ({ id: i.id, ...assetLabel(i, sport), accent: 'blue' as const }))
      const received: LeagueTradeAsset[] = t.items
        .filter((i) => i.toRosterId === viewRosterId)
        .map((i) => ({ id: i.id, ...assetLabel(i, sport), accent: 'teal' as const }))
      /*
       * ⚠ ONLY WHEN THE VIEWER IS A PARTY. A commissioner looking at someone else's offer falls back
       * to `viewerRosterId: t.proposerRosterId` below, and a lineup effect computed there would be
       * the PROPOSER's lineup rendered under "your projected starting lineup".
       */
      const wantImpact = viewerIsProposer || viewerIsReceiver
      const receipt = decisionReceipts.get(t.id) ?? null
      const frozenDecision = receipt?.participantDecisions.find((row) => row.rosterId === viewRosterId) ?? null
      const participantSides: NonNullable<LeagueTradeHistoryItem['participantSides']> = participantIds.map((rosterId) => {
        const frozen = receipt?.participantDecisions.find((row) => row.rosterId === rosterId) ?? null
        return {
          rosterId,
          name: nameByRosterId.get(rosterId) ?? 'Manager',
          avatarUrl: avatarByRosterId.get(rosterId) ?? null,
          isViewer: rosterId === myRosterId,
          assets: t.items
            .filter((item) => item.fromRosterId === rosterId)
            .map((item) => ({ id: item.id, ...assetLabel(item, sport), accent: rosterId === viewRosterId ? 'blue' as const : 'teal' as const })),
          grade: frozen?.grade ?? null,
          reason: frozen?.reason ?? null,
        }
      })
      const decision = world ? await evaluateCanonicalTrade({
        leagueId,
        proposalId: t.id,
        proposerRosterId: t.proposerRosterId,
        receiverRosterId: t.receiverRosterId,
        viewerRosterId: myRosterId ?? t.proposerRosterId,
        assets: t.items.map((item): TradeAssetSummary => {
          const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
            ? item.metadata as Record<string, unknown>
            : {}
          const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
          const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
          return {
            assetType: item.itemType,
            itemReference: item.itemReference,
            fromRosterId: item.fromRosterId,
            toRosterId: item.toRosterId,
            playerId: item.itemType.toLowerCase().includes('player') ? item.itemReference : stringValue(metadata.playerId),
            playerName: stringValue(metadata.playerName ?? metadata.name),
            position: stringValue(metadata.position),
            team: stringValue(metadata.team),
            pickSeason: numberValue(metadata.pickSeason ?? metadata.season),
            pickRound: numberValue(metadata.pickRound ?? metadata.round),
            pickNumber: numberValue(metadata.pickNumber),
            pickOriginalRosterId: stringValue(metadata.originalRosterId),
            pickLabel: stringValue(metadata.pickLabel),
            faabAmount: item.faabAmount ?? numberValue(metadata.faabAmount),
          }
        }),
        currentSeason: world.league.season ?? undefined,
        includeRosterImpact: wantImpact,
      }, { resolveWorld: async () => world }).catch(() => null) : null
      /*
       * THE grade, from the viewer's side when they are in the deal, otherwise from the proposer's —
       * the same side `sent`/`received` are rendered from. Two-team deals only: one gap cannot give
       * three teams a letter each, and the receipt path already withholds for the same reason.
       */
      const partyView = myRosterId != null && participantIds.includes(myRosterId)
      const openGrade: TradeGradeView = participantIds.length === 2
        ? await gradeDeal(await grader(), {
            give: gradeInputsFromNativeItems(t.items.filter((i) => i.fromRosterId === viewRosterId), nameForId),
            get: gradeInputsFromNativeItems(t.items.filter((i) => i.toRosterId === viewRosterId), nameForId),
            viewerSide: partyView,
          })
        : { graded: false, reason: 'Only two-team trades are graded — one value gap cannot give three teams a letter each.', basis: null }
      const graded = openGradeFields(openGrade, partyView ? 'viewer' : 'proposer')
      return {
        id: t.id,
        direction,
        partnerName,
        proposerName: nameByRosterId.get(t.proposerRosterId) ?? 'Manager',
        receiverName: nameByRosterId.get(t.receiverRosterId) ?? 'Manager',
        partnerAvatarUrl: avatarByRosterId.get(participantIds.find((id) => id !== viewRosterId) ?? '') ?? null,
        viewerAvatarUrl: avatarByRosterId.get(viewRosterId) ?? null,
        proposerAvatarUrl: avatarByRosterId.get(t.proposerRosterId) ?? null,
        receiverAvatarUrl: avatarByRosterId.get(t.receiverRosterId) ?? null,
        timestamp: t.createdAt.toISOString(),
        sent,
        received,
        participantSides,
        status: t.status,
        viewerIsCommissioner: isCommissioner,
        viewerIsReceiver,
        viewerIsProposer,
        viewerIsParticipant: myRosterId != null && participantIds.includes(myRosterId),
        decisionAction: graded.decisionAction,
        decisionRecommendation: graded.decisionRecommendation,
        decisionCoveragePct: frozenDecision?.coveragePct ?? decision?.coveragePct ?? null,
        /*
         * "Then" is the proposal-time RECEIPT when one was written — frozen evidence, left as it was
         * recorded. Without one there is no proposal-time grade, and "Then" is the grade now.
         */
        proposalGrade: frozenDecision?.grade ?? graded.currentGrade,
        proposalValueGiven: frozenDecision?.valueGiven ?? graded.currentValueGiven,
        proposalValueReceived: frozenDecision?.valueReceived ?? graded.currentValueReceived,
        currentGrade: graded.currentGrade,
        currentValueGiven: graded.currentValueGiven,
        currentValueReceived: graded.currentValueReceived,
        leagueGrade: graded.leagueGrade,
        leagueGradeSide: graded.leagueGradeSide,
        proposalCapturedAt: receipt?.capturedAt ?? decision?.evaluatedAt ?? null,
        decisionReceipt: receipt,
        // Asked for and the evaluation itself failed is still "asked for, not produced" — `null`.
        rosterImpact: wantImpact ? (decision ? summarizeRosterImpact(decision.rosterImpact) ?? null : null) : undefined,
      }
    }))
}

/**
 * Native trade history for the league timeline.
 *
 * Processed/reversed transactions are league facts and may be shown to every
 * member. An offer that was rejected, cancelled, countered, vetoed or expired
 * is visible only to either participant or a commissioner; this preserves the
 * private negotiation while still giving each manager their own complete log.
 */
type NativeHistoryLeague = Pick<
  League,
  'id' | 'sport' | 'leagueType' | 'leagueVariant' | 'isDynasty' | 'scoring' | 'settings'
>

async function buildNativeTradeHistory(league: NativeHistoryLeague, userId: string): Promise<LeagueTradeHistoryItem[]> {
  const leagueId = league.id
  const [profile, isCommissioner, trades] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUserId: true } }).catch(() => null),
    isElevatedCommissioner(leagueId, userId),
    listAfLeagueTrades(leagueId, { take: 200 }),
  ])
  const terminal = trades.filter((trade) => TERMINAL_STATUSES.has(trade.status))
  if (terminal.length === 0) return []
  const decisionReceipts = await loadDecisionReceipts(terminal.map((trade) => trade.id))

  const rosterIds = [...new Set(terminal.flatMap((trade) => [
    trade.proposerRosterId,
    trade.receiverRosterId,
    ...trade.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
  ]))]
  const rosters = await prisma.roster.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, platformUserId: true },
  })
  const candidateIds = new Set(
    [userId, profile?.sleeperUserId].filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
  const myRosterIds = new Set(rosters.filter((roster) => candidateIds.has(roster.platformUserId)).map((roster) => roster.id))
  const userIds = [...new Set(rosters.map((roster) => roster.platformUserId))]
  const users = await prisma.appUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true },
  })
  const historyLeagueTeamStore = (prisma as typeof prisma & { leagueTeam?: typeof prisma.leagueTeam }).leagueTeam
  const historyLeagueTeams = historyLeagueTeamStore && typeof historyLeagueTeamStore.findMany === 'function'
    ? await historyLeagueTeamStore.findMany({
        where: {
          leagueId,
          OR: [
            { externalId: { in: [...rosterIds, ...userIds] } },
            { platformUserId: { in: userIds } },
            { claimedByUserId: { in: userIds } },
          ],
        },
        select: { externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true, teamName: true, avatarUrl: true },
      }).catch(() => [])
    : []
  const nameByUserId = new Map(users.map((user) => [user.id, user.displayName?.trim() || user.username]))
  const avatarByUserId = new Map(users.map((user) => [user.id, user.avatarUrl]))
  const historyTeamByIdentity = new Map(historyLeagueTeams.flatMap((team) => [
    [team.externalId, team] as const,
    ...(team.platformUserId ? [[team.platformUserId, team] as const] : []),
    ...(team.claimedByUserId ? [[team.claimedByUserId, team] as const] : []),
  ]))
  const userIdByRosterId = new Map(rosters.map((roster) => [roster.id, roster.platformUserId]))
  const nameOf = (rosterId: string) => {
    const externalId = userIdByRosterId.get(rosterId) ?? ''
    const team = historyTeamByIdentity.get(rosterId) ?? historyTeamByIdentity.get(externalId)
    return nameByUserId.get(externalId) ?? team?.ownerName ?? team?.teamName ?? 'Manager'
  }
  const avatarOf = (rosterId: string) => {
    const externalId = userIdByRosterId.get(rosterId) ?? ''
    return historyTeamByIdentity.get(rosterId)?.avatarUrl ?? historyTeamByIdentity.get(externalId)?.avatarUrl ?? avatarByUserId.get(externalId) ?? null
  }
  const offerEvents = await prisma.tradeOfferEvent.findMany({
    where: { afLeagueTradeId: { in: terminal.map((trade) => trade.id) } },
    select: {
      afLeagueTradeId: true,
      grade: true,
      assetsGiven: true,
      assetsReceived: true,
      createdAt: true,
      modelVersion: true,
    },
  })
  const offerByTradeId = new Map(offerEvents.map((event) => [event.afLeagueTradeId, event]))
  const currentMarket = await priceTradesAtCurrentMarket({
    leagueId,
    league,
    trades: terminal.map((trade) => ({
      id: trade.id,
      proposerRosterId: trade.proposerRosterId,
      items: trade.items,
    })),
  })
  const valueTotal = (assets: unknown): number | null => {
    if (!Array.isArray(assets)) return null
    const values = assets.map((asset) =>
      asset && typeof asset === 'object' && typeof (asset as { value?: unknown }).value === 'number'
        ? (asset as { value: number }).value
        : null,
    )
    return values.every((value): value is number => value != null)
      ? values.reduce((sum, value) => sum + value, 0)
      : null
  }

  return terminal
    .filter((trade) => {
      if (trade.status === 'processed' || trade.status === 'reversed') return true
      const participants = new Set([
        trade.proposerRosterId,
        trade.receiverRosterId,
        ...trade.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
      ])
      return isCommissioner || [...myRosterIds].some((rosterId) => participants.has(rosterId))
    })
    .map((trade) => {
      const offer = offerByTradeId.get(trade.id)
      const now = currentMarket.get(trade.id)
      const receipt = decisionReceipts.get(trade.id) ?? null
      const frozenProposer = receipt?.participantDecisions.find((row) => row.rosterId === trade.proposerRosterId) ?? null
      const viewerIsProposer = myRosterIds.has(trade.proposerRosterId)
      const viewerIsReceiver = myRosterIds.has(trade.receiverRosterId)
      const participantIds = [...new Set([
        trade.proposerRosterId,
        trade.receiverRosterId,
        ...trade.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
      ])]
      const participantSides: NonNullable<LeagueTradeHistoryItem['participantSides']> = participantIds.map((rosterId) => {
        const frozen = receipt?.participantDecisions.find((row) => row.rosterId === rosterId) ?? null
        return {
          rosterId,
          name: nameOf(rosterId),
          avatarUrl: avatarOf(rosterId),
          isViewer: myRosterIds.has(rosterId),
          assets: trade.items
            .filter((item) => item.fromRosterId === rosterId)
            .map((item) => ({ id: item.id, ...assetLabel(item, String(league.sport)), accent: rosterId === trade.proposerRosterId ? 'blue' as const : 'teal' as const })),
          grade: frozen?.grade ?? null,
          reason: frozen?.reason ?? null,
        }
      })
      return {
        id: trade.id,
        direction: viewerIsProposer ? 'outgoing' as const : viewerIsReceiver ? 'incoming' as const : 'complete' as const,
        partnerName: nameOf(viewerIsProposer ? trade.receiverRosterId : trade.proposerRosterId),
        proposerName: nameOf(trade.proposerRosterId),
        receiverName: nameOf(trade.receiverRosterId),
        partnerAvatarUrl: avatarOf(viewerIsProposer ? trade.receiverRosterId : trade.proposerRosterId),
        viewerAvatarUrl: viewerIsProposer ? avatarOf(trade.proposerRosterId) : viewerIsReceiver ? avatarOf(trade.receiverRosterId) : null,
        proposerAvatarUrl: avatarOf(trade.proposerRosterId),
        receiverAvatarUrl: avatarOf(trade.receiverRosterId),
        timestamp: trade.createdAt.toISOString(),
        executedAt: (trade.processedAt ?? trade.rejectedAt ?? trade.cancelledAt ?? trade.updatedAt ?? trade.createdAt).toISOString(),
        sent: trade.items
          .filter((item) => item.fromRosterId === trade.proposerRosterId)
          .map((item) => ({ id: item.id, ...assetLabel(item, String(league.sport)), accent: 'blue' as const })),
        received: trade.items
          .filter((item) => item.fromRosterId === trade.receiverRosterId)
          .map((item) => ({ id: item.id, ...assetLabel(item, String(league.sport)), accent: 'teal' as const })),
        participantSides,
        status: trade.status,
        proposalGrade: frozenProposer?.grade ?? offer?.grade ?? null,
        proposalGradeReason: frozenProposer?.reason ?? (offer?.grade
          ? 'Recovered from the proposal-time market values stored with this trade. Complete league-context evidence was not archived.'
          : 'Original grade unavailable — this trade predates immutable decision receipts.'),
        proposalValueGiven: frozenProposer?.valueGiven ?? valueTotal(offer?.assetsGiven),
        proposalValueReceived: frozenProposer?.valueReceived ?? valueTotal(offer?.assetsReceived),
        proposalCapturedAt: receipt?.capturedAt ?? offer?.createdAt.toISOString() ?? null,
        proposalModelVersion: receipt?.policyVersion ?? offer?.modelVersion ?? null,
        decisionReceipt: receipt,
        currentGrade: now?.grade ?? null,
        currentValueGiven: now?.valueGiven ?? null,
        currentValueReceived: now?.valueReceived ?? null,
        currentPricedAt: now?.pricedAt ?? null,
        currentPricingComplete: now?.fullyPriced ?? false,
        currentUnresolvedAssets: now?.unresolvedAssets ?? [],
        viewerIsCommissioner: isCommissioner,
        viewerIsReceiver,
        viewerIsProposer,
        viewerIsParticipant: participantIds.some((rosterId) => myRosterIds.has(rosterId)),
      }
    })
}

/**
 * Trades that have already EXECUTED, for a commissioner who may need to reverse one.
 *
 * ⚠ SEPARATE FROM `buildNativeActiveTrades`, AND `activeTrades` IS UNTOUCHED. That list feeds the tab's
 * "Needs your action" section and is filtered to non-terminal statuses; a `processed` trade in it would
 * render as something waiting on someone. Executed trades are a different list with a different
 * audience.
 *
 * ⚠ COMMISSIONER-ONLY ON THE SERVER, not merely hidden by the UI. Reversal is a commissioner action, and
 * a manager has no use for a list of other people's settled trades with a reverse control beside them.
 *
 * The caller gates this to NATIVE write authority as well: on an imported (shadow) league the trade
 * happened on the provider, AllFantasy holds no execution record, and there is nothing it may undo.
 */
async function buildNativeExecutedTrades(leagueId: string, userId: string): Promise<LeagueTradeHistoryItem[]> {
  const isCommissioner = await isElevatedCommissioner(leagueId, userId)
  if (!isCommissioner) return []

  const trades = await listAfLeagueTrades(leagueId, { status: 'processed', take: 20 })
  if (trades.length === 0) return []

  const rosterIds = [...new Set(trades.flatMap((t) => [
    t.proposerRosterId,
    t.receiverRosterId,
    ...t.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
  ]))]
  const rosters = await prisma.roster.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, platformUserId: true },
  })
  const userIds = [...new Set(rosters.map((r) => r.platformUserId))]
  const users = await prisma.appUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, username: true, avatarUrl: true },
  })
  const nameByUserId = new Map(users.map((u) => [u.id, u.displayName?.trim() || u.username]))
  const avatarByUserId = new Map(users.map((u) => [u.id, u.avatarUrl]))
  const userIdByRosterId = new Map(rosters.map((r) => [r.id, r.platformUserId]))
  const nameOf = (rosterId: string) => nameByUserId.get(userIdByRosterId.get(rosterId) ?? '') ?? 'Manager'
  const avatarOf = (rosterId: string) => avatarByUserId.get(userIdByRosterId.get(rosterId) ?? '') ?? null

  return trades.map((t) => {
    const participantIds = [...new Set([
      t.proposerRosterId,
      t.receiverRosterId,
      ...t.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
    ])]
    return {
      id: t.id,
      direction: 'complete' as const,
      partnerName: nameOf(t.receiverRosterId),
      proposerName: nameOf(t.proposerRosterId),
      receiverName: nameOf(t.receiverRosterId),
      timestamp: t.createdAt.toISOString(),
      executedAt: (t.processedAt ?? t.createdAt).toISOString(),
      // What each side SENT: `sent` is the proposer's outgoing assets, `received` the receiver's.
      sent: t.items
        .filter((i) => i.fromRosterId === t.proposerRosterId)
        .map((i) => ({ id: i.id, ...assetLabel(i), accent: 'blue' as const })),
      received: t.items
        .filter((i) => i.fromRosterId === t.receiverRosterId)
        .map((i) => ({ id: i.id, ...assetLabel(i), accent: 'teal' as const })),
      participantSides: participantIds.map((rosterId) => ({
        rosterId,
        name: nameOf(rosterId),
        avatarUrl: avatarOf(rosterId),
        isViewer: false,
        assets: t.items
          .filter((item) => item.fromRosterId === rosterId)
          .map((item) => ({ id: item.id, ...assetLabel(item), accent: rosterId === t.proposerRosterId ? 'blue' as const : 'teal' as const })),
        grade: null,
        reason: null,
      })),
      status: t.status,
      viewerIsCommissioner: true,
      viewerIsReceiver: false,
      viewerIsProposer: false,
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
function mapProviderTrades(
  pending: PendingProviderTrade[],
  evaluations: Map<string, ProviderPendingEvaluation> = new Map(),
  /** THE grade per open offer. Absent for completed trades, which keep their own letters for now. */
  grades: Map<string, TradeGradeView> = new Map(),
): LeagueTradeHistoryItem[] {
  return pending.map((trade) => ({
    id: `${trade.provider}:${trade.transactionId}`,
    // Facing matters: a trade the viewer SENT is outgoing. Hardcoding
    // 'incoming' would render their own offer backwards, with given/received
    // reversed relative to how they built it.
    direction: (trade.proposedByViewer ? 'outgoing' : 'incoming') as LeagueTradeHistoryItem['direction'],
    partnerName: trade.lifecycleStatus === 'complete'
      ? trade.proposedBy
      : trade.proposedByViewer ? 'Awaiting response' : trade.proposedBy,
    timestamp: trade.proposedAt ?? new Date().toISOString(),
    sent: trade.assetsGiven.map((a, i) => providerAsset(a, i, 'blue')),
    received: trade.assetsReceived.map((a, i) => providerAsset(a, i, 'teal')),
    status: trade.lifecycleStatus === 'complete'
      ? `completed_on_${trade.provider}`
      : `pending_on_${trade.provider}`,
    executedAt: trade.lifecycleStatus === 'complete' ? (trade.proposedAt ?? undefined) : undefined,
    decisionAction: evaluations.get(trade.transactionId)?.action,
    decisionRecommendation: evaluations.get(trade.transactionId)?.recommendation ?? null,
    decisionCoveragePct: evaluations.get(trade.transactionId)?.coveragePct ?? null,
    proposalGrade: evaluations.get(trade.transactionId)?.grade ?? null,
    proposalValueGiven: evaluations.get(trade.transactionId)?.valueGiven ?? null,
    proposalValueReceived: evaluations.get(trade.transactionId)?.valueReceived ?? null,
    proposalCapturedAt: evaluations.get(trade.transactionId)?.evaluatedAt ?? null,
    rosterImpact: evaluations.get(trade.transactionId)?.rosterImpact,
    /*
     * An open offer has no proposal-time record, so "Then" and "Now" are both the grade now — and
     * both are THE grade, replacing the canonical fairness letter, which was one letter for both
     * teams (the partner of a lopsided deal saw the same C as the winner).
     */
    ...(() => {
      const g = grades.get(trade.transactionId)
      if (!g) return {}
      const f = openGradeFields(g, 'viewer')
      return {
        ...f,
        proposalGrade: f.currentGrade,
        proposalValueGiven: f.currentValueGiven,
        proposalValueReceived: f.currentValueReceived,
      }
    })(),
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
function builderOffers(
  pending: PendingProviderTrade[],
  evaluations: Map<string, ProviderPendingEvaluation> = new Map(),
  grades: Map<string, TradeGradeView> = new Map(),
) {
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
    provider: t.provider,
    transactionId: t.transactionId,
    direction: t.proposedByViewer ? ('outgoing' as const) : ('incoming' as const),
    partnerName: t.proposedByViewer ? 'Awaiting response' : t.proposedBy,
    proposedAt: t.proposedAt,
    give: t.assetsGiven.map(asset),
    get: t.assetsReceived.map(asset),
    evaluation: evaluations.get(t.transactionId) ?? null,
    /** THE grade for this offer, from the viewer's side — what the inbox shows beside it. */
    leagueGrade: grades.get(t.transactionId) ?? null,
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
      scoring: true,
      isDynasty: true,
      leagueType: true,
      leagueVariant: true,
      settings: true,
    },
  })

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  /*
   * The manager's saved draft for this league, if the table is there.
   *
   * ⚠ A MISSING TABLE IS A NULL, NOT A 500. The migration is applied by hand on
   * this project, so this code can land before the column does — and the Trade
   * Center falls back to the browser when it gets null. Letting the read throw
   * would take the whole panel down over a scratchpad.
   */
  const draft = await prisma.tradeDraft
    .findUnique({
      where: { userId_leagueId: { userId, leagueId } },
      select: { payload: true, updatedAt: true },
    })
    .catch(() => null)

  const sleeperLeagueId =
    league.platform === 'sleeper' && league.platformLeagueId ? league.platformLeagueId : null

  if (!sleeperLeagueId) {
    const grader = lazyGrader(leagueId, userId)
    const [activeTrades, historyTrades] = await Promise.all([
      buildNativeActiveTrades(leagueId, userId, league.sport, grader),
      buildNativeTradeHistory(league, userId),
    ])
    const platform = String(league.platform ?? 'manual').toLowerCase()

    /*
     * ── Yahoo ────────────────────────────────────────────────────────────
     *
     * The second platform whose open offers we can read. It goes through the
     * league-import module's own auth and parser rather than a second Yahoo
     * client, so the 401-refresh path is the one already in production.
     *
     * ⚠ NO DIRECTION IS CLAIMED. Yahoo's transactions payload does not name a
     * proposer, so every offer is shown as incoming. Guessing would render a
     * manager's own outgoing offer backwards, which reads as a plausible trade
     * rather than as a bug.
     */
    if (platform === 'yahoo' && league.platformLeagueId) {
      const scan = await scanPendingYahooTrades({
        leagueId,
        platformLeagueId: league.platformLeagueId,
        userId,
      }).catch(() => ({ trades: [], scanned: false, reason: 'Yahoo could not be reached' as string | null }))
      const [evaluations, grades] = await Promise.all([
        evaluatePendingProviderTrades({
          leagueId,
          trades: scan.trades,
          includeRosterImpact: true,
        }).catch(() => new Map()),
        gradeProviderOffers(scan.trades, grader).catch(() => new Map<string, TradeGradeView>()),
      ])

      return NextResponse.json({
        draft,
        tradeBlock: [] as LeagueTradeBlockPanelItem[],
        tradeBlockNote: tradeBlockSupport('yahoo').note,
        activeTrades: [...activeTrades, ...mapProviderTrades(scan.trades, evaluations, grades)],
        historyTrades,
        activeCount: activeTrades.length + scan.trades.length,
        source: 'yahoo' as const,
        leagueName: league.name ?? 'League',
        providerPendingCount: scan.trades.length,
        providerLeagueUrl: `https://football.fantasysports.yahoo.com/f1/${encodeURIComponent(
          league.platformLeagueId.split('.l.')[1] ?? league.platformLeagueId,
        )}`,
        pending: {
          scanned: scan.scanned,
          reason: scan.reason,
          platform: 'yahoo' as const,
          leagueUrl: `https://football.fantasysports.yahoo.com/f1/${encodeURIComponent(
            league.platformLeagueId.split('.l.')[1] ?? league.platformLeagueId,
          )}`,
          weeksUnanswered: 0,
        },
        pendingOffers: builderOffers(scan.trades, evaluations, grades),
      })
    }

    const executedTrades =
      resolveWriteAuthority(league.platform) === 'NATIVE' ? await buildNativeExecutedTrades(leagueId, userId) : []

    return NextResponse.json({
      draft,
      tradeBlock: [] as LeagueTradeBlockPanelItem[],
      /*
       * An imported league's empty block is a platform we cannot read, not a league with nothing on
       * it, so the tab says which. A native league keeps its plain empty state.
       */
      tradeBlockNote: resolveWriteAuthority(league.platform) === 'NATIVE' ? null : tradeBlockSupport(platform).note,
      activeTrades,
      historyTrades,
      executedTrades,
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
        reason: `we do not read pending offers on ${platform} yet — Sleeper and Yahoo are the two we can`,
        platform,
        leagueUrl: null as string | null,
        weeksUnanswered: 0,
      },
      pendingOffers: [] as ReturnType<typeof builderOffers>,
    })
  }

  /*
   * The block through the one reader the player card and Chimmy use (2026-09-17). A listing counts only
   * while the roster that listed the player still holds him, and is named by that team. The direct read
   * of the active rows this replaced kept a traded player "on the block" for a team that no longer had
   * him — harmless while the table was empty, which it was until managers could list players.
   */
  const blockRead = await readTradeBlock(league.id)
  const tradeBlock: LeagueTradeBlockPanelItem[] = (blockRead?.listings ?? []).slice(0, 48).map((l) => ({
    id: `${l.rosterId}:${l.sleeperId}`,
    playerId: l.sleeperId,
    name: l.playerName,
    position: (l.position ?? 'FLEX').trim() || 'FLEX',
    team: l.nflTeam?.trim() || null,
    ownerName: l.teamName?.trim() || l.ownerName?.trim() || 'Manager',
  }))
  /*
   * ⚠ "COULD NOT READ" IS NOT "NOBODY LISTED ANYONE", and the tab can only tell them apart if the
   * envelope does. With the note alone the empty state read "No players marked on the trade block in
   * AllFantasy" above "The trade block could not be read right now" — the headline claiming knowledge
   * the sentence under it withdrew.
   */
  const tradeBlockReadable = blockRead != null
  const tradeBlockNote = blockRead ? blockRead.support.note : 'The trade block could not be read right now.'

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

  const grader = lazyGrader(leagueId, userId)
  const [nativeTrades, nativeHistory, pendingScan] = await Promise.all([
    buildNativeActiveTrades(leagueId, userId, league.sport, grader).catch((err) => {
      console.error('[trades-panel] native trades for imported league failed', { leagueId, err })
      return [] as LeagueTradeHistoryItem[]
    }),
    buildNativeTradeHistory(league, userId).catch((err) => {
      console.error('[trades-panel] native trade history failed', { leagueId, err })
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
          // Permanent until the manager links an account — the same class as the scan module's own
          // identity returns, and never a reason to treat a trade read as transiently incomplete.
          unscannedKind: 'identity',
          weeksUnanswered: 0,
        }),
  ])

  const providerPending: PendingProviderTrade[] = pendingScan.trades
  const providerCompleted: PendingProviderTrade[] = pendingScan.completedTrades ?? []
  /*
   * ⚠ LINEUP EFFECT ON THE PENDING CALL ONLY. A completed trade's roster already holds the result,
   * so there is no honest "before" to compute — see `includeRosterImpact` on the evaluator wrapper.
   */
  const [providerEvaluations, providerGrades] = await Promise.all([
    evaluatePendingProviderTrades({
      leagueId,
      trades: providerPending,
      includeRosterImpact: true,
    }).catch(() => new Map()),
    gradeProviderOffers(providerPending, grader).catch(() => new Map<string, TradeGradeView>()),
  ])
  const completedEvaluations = await evaluatePendingProviderTrades({ leagueId, trades: providerCompleted }).catch(() => new Map())

  // Native first (the viewer can act on those); provider proposals follow.
  const activeTrades = [...nativeTrades, ...mapProviderTrades(providerPending, providerEvaluations, providerGrades)]

  /*
   * SETTLED PROVIDER OFFERS — the feed the "Declined & expired" filter never had.
   *
   * `TradeInbox` has had five timeline buckets for a while, and on an imported league the last one
   * was permanently empty: `historyTrades` below is native + provider-COMPLETED, an imported league
   * has no native trades, and `scanPendingSleeperTrades` keeps only `pending` and `complete` while
   * dropping `failed` entirely. So a declined Sleeper offer was invisible everywhere in the
   * product, and an expired one was not knowable at all. The UI was starved, not missing.
   *
   * ⚠ SETTLED ONLY — PENDING STAYS LIVE, one line above. `lib/core-app/trades.ts` records why: a
   * cached pending offer goes stale the moment it is accepted, so an offer answered on Sleeper
   * thirty seconds ago must not still sit in an inbox here. The ledger supplies what the live read
   * cannot (what BECAME of an offer); the live read keeps what the ledger cannot (what is true
   * now). Each owns a different question, so the two cannot disagree about one.
   *
   * ⚠ FAILURE-CONTAINED. The ledger is a young table fed by a rotating sweep, so a league it has
   * not reached yet contributes nothing and the panel behaves exactly as it does today. It must
   * never cost the panel its live offers.
   */
  const settledProviderOffers = await (async () => {
    try {
      const viewerTeam = await prisma.leagueTeam.findFirst({
        where: { leagueId, claimedByUserId: userId },
        select: { externalId: true },
      })
      if (!viewerTeam?.externalId) return []
      /*
       * ⚠ NORMALISED, BECAUSE A RAW COMPARISON IS DOCUMENTED AS WRONG HERE. `rosterIdMapKeys`
       * exists because an MFL `externalId` is zero-padded ("0001") while the id written elsewhere
       * is "1". The ledger stores the plain provider form, so the normalised key is the one that
       * matches — see lib/core-app/rosterIdMatch.ts.
       */
      const viewerRosterId = rosterIdMapKeys(viewerTeam.externalId).slice(-1)[0]
      const ledger = await getLeagueTradeLedgerForRoster({ leagueId, rosterId: viewerRosterId })
      const teamRows = await prisma.leagueTeam.findMany({
        where: { leagueId },
        select: { externalId: true, teamName: true, ownerName: true },
      })
      const teamNames = new Map<string, string>()
      for (const t of teamRows) {
        /*
         * ⚠ `teamName` THEN `ownerName` — AND THERE IS NO `name` COLUMN, which is what I first
         * wrote. Both are non-null strings that can still be EMPTY, so the check is truthiness
         * rather than null: an empty label would render the partner as a blank space, which reads
         * as a rendering bug rather than as a team nobody named.
         */
        const label = t.teamName?.trim() || t.ownerName?.trim()
        if (!label) continue
        for (const key of rosterIdMapKeys(t.externalId)) teamNames.set(key, label)
      }
      return buildProviderOfferHistoryRows({
        offers: [...ledger.declined, ...ledger.gone],
        viewerRosterId,
        teamNames,
      })
    } catch {
      return []
    }
  })()

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
    draft,
    tradeBlock,
    tradeBlockNote,
    tradeBlockReadable,
    activeTrades,
    historyTrades: [
      ...mapProviderTrades(providerCompleted, completedEvaluations),
      ...settledProviderOffers,
      ...nativeHistory,
    ],
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
      weeksRequested: pendingScan.weeksRequested,
      weeksAnswered: pendingScan.weeksAnswered,
    },
    pendingOffers: builderOffers(providerPending, providerEvaluations, providerGrades),
  })
}

/**
 * Save or clear the manager's trade draft for this league.
 *
 * ⚠ NO NEW API ROUTE. This is a second method on the endpoint the Trade Center
 * already calls, not a new path — the repo sits at the platform's route ceiling
 * and a scratchpad is not worth one. It is league-scoped and reuses the same
 * membership gate as the GET above, because a draft belongs to a league the
 * manager is actually in.
 *
 * ⚠ AN EMPTY DEAL DELETES RATHER THAN STORING NOTHING. "Save" on an empty board
 * is how a manager clears a draft, and a row holding two empty arrays would
 * restore as a deal with nothing in it — which reads as "your draft was lost"
 * rather than "there is no draft".
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const member = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true },
  })
  if (!member) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    give?: unknown[]
    get?: unknown[]
  }
  const give = Array.isArray(body.give) ? body.give : []
  const get = Array.isArray(body.get) ? body.get : []

  try {
    if (give.length === 0 && get.length === 0) {
      await prisma.tradeDraft
        .delete({ where: { userId_leagueId: { userId, leagueId } } })
        .catch(() => null)
      return NextResponse.json({ ok: true, cleared: true })
    }

    /* A cap, so a scratchpad cannot become a payload. */
    const payload = toPrismaJsonInput({ give: give.slice(0, 24), get: get.slice(0, 24) })
    const saved = await prisma.tradeDraft.upsert({
      where: { userId_leagueId: { userId, leagueId } },
      create: { userId, leagueId, payload },
      update: { payload },
      select: { updatedAt: true },
    })
    return NextResponse.json({ ok: true, updatedAt: saved.updatedAt })
  } catch (err) {
    /*
     * The table may not exist yet — the migration is applied by hand here. Say
     * that plainly so the client falls back to the browser and TELLS the
     * manager, rather than reporting a save that did not happen.
     */
    console.error('[trades-panel] draft save failed', { leagueId, err })
    return NextResponse.json({ error: 'Draft could not be saved to your account.' }, { status: 503 })
  }
}
