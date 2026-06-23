/**
 * T10 — deterministic Chimmy trade tools. Each tool REUSES the existing T2–T9
 * services / persisted data and returns structured JSON + short safe text. No tool
 * fabricates numbers; missing data is reported as a limitation, never guessed.
 *
 * Read-only. No tool sends/accepts/vetoes a trade or mutates provider/official values.
 */
import { prisma } from '@/lib/prisma'
import type { TeamProfile } from '@/lib/trade-value/types'
import { buildTeamProfile } from '@/lib/trade-value/teamProfile'
import { summarizeMarketContext, type MarketEventLite } from '@/lib/trade-review/marketContext'
import { buildCommissionerTradeReview, type ReviewAsset } from '@/lib/trade-review/redraftCommissionerTradeReview'
import { resolveAllFantasyMarketValue } from '@/lib/trade-market/allFantasyMarketValues'
import { assembleDiscoveryLeague } from '@/lib/trade-discovery/assembleRosters'
import { findPartners, findPackages } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { discoverySignals } from '@/lib/trade-block/redraftTradeBlockService'
import type {
  ExplainTradeData,
  PlayerMarketValueData,
  TradeBlockSummaryData,
  TradeRole,
  TradeToolResult,
} from './types'

const PLAYER_VALUE_SOURCES = {
  allFantasyMarket: 'official AllFantasy market value (internal trade signals)',
  provider: 'provider/ADP/projection values are a SEPARATE source and are not shown here',
  snapshot: 'historical trade snapshot values are immutable and may differ from current',
} as const

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Resolve the caller's role + their roster in this league (commissioner/manager/non-member). */
export async function resolveTradeRole(
  leagueId: string,
  userId: string,
): Promise<{ role: TradeRole; rosterId: string | null; seasonId: string | null; sport: string | null }> {
  const league = await prisma.league
    .findFirst({
      where: { id: leagueId },
      select: {
        userId: true,
        teams: { where: { claimedByUserId: userId }, select: { isCommissioner: true, isCoCommissioner: true } },
      },
    })
    .catch(() => null)
  const season = await prisma.redraftSeason
    .findFirst({ where: { leagueId }, select: { id: true, sport: true }, orderBy: { season: 'desc' } })
    .catch(() => null)
  let rosterId: string | null = null
  if (season?.id) {
    const roster = await prisma.redraftRoster
      .findFirst({ where: { seasonId: season.id, claimedByUserId: userId }, select: { id: true } })
      .catch(() => null)
    rosterId = roster?.id ?? null
  }
  if (!league) return { role: 'non_member', rosterId, seasonId: season?.id ?? null, sport: season?.sport ?? null }
  const isCommish =
    league.userId === userId ||
    league.teams.some((t: { isCommissioner: boolean | null; isCoCommissioner: boolean | null }) => t.isCommissioner || t.isCoCommissioner)
  const role: TradeRole = isCommish ? 'commissioner' : rosterId ? 'manager' : 'non_member'
  return { role, rosterId, seasonId: season?.id ?? null, sport: season?.sport ?? null }
}

// ── explainTrade (T2 immutable snapshot) ────────────────────────────────────────
export async function explainTrade(proposalId: string): Promise<TradeToolResult<ExplainTradeData>> {
  const proposal = await prisma.redraftTradeProposal
    .findUnique({ where: { id: proposalId }, include: { valueSnapshot: true } })
    .catch(() => null)
  if (!proposal) {
    return { ok: false, data: null, text: [], limitations: [{ code: 'NOT_FOUND', detail: `No proposal ${proposalId}.` }] }
  }
  const snap = proposal.valueSnapshot
  if (!snap) {
    return {
      ok: true,
      data: { proposalId, status: proposal.status, snapshotGrade: null, fairnessScore: null, confidenceScore: null, valueDifference: null, sideTotals: [], reasons: [], warnings: [], snapshotIsHistorical: true },
      text: ['No value snapshot was captured for this proposal, so there is no grade to explain.'],
      limitations: [{ code: 'NO_SNAPSHOT', detail: 'Proposal has no captured value snapshot.' }],
    }
  }
  const payload = (snap.payload ?? {}) as { sides?: Array<{ rosterId: string; total: number }>; reasons?: string[]; warnings?: string[] }
  const data: ExplainTradeData = {
    proposalId,
    status: proposal.status,
    snapshotGrade: snap.grade ?? null,
    fairnessScore: num(snap.fairnessScore),
    confidenceScore: num(snap.confidenceScore),
    valueDifference: num(snap.valueDifference),
    sideTotals: Array.isArray(payload.sides) ? payload.sides.map((s) => ({ rosterId: s.rosterId, total: s.total })) : [],
    reasons: Array.isArray(payload.reasons) ? payload.reasons.slice(0, 6) : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 6) : [],
    snapshotIsHistorical: true,
  }
  const text = [
    `At proposal time this trade graded ${data.snapshotGrade ?? 'n/a'} (fairness ${data.fairnessScore ?? 'n/a'}/100, confidence ${data.confidenceScore ?? 'n/a'}/100). This grade is a historical snapshot and may differ from current market value.`,
  ]
  if (data.reasons.length) text.push(`Why: ${data.reasons.join('; ')}.`)
  if (data.warnings.length) text.push(`Watch-outs: ${data.warnings.join('; ')}.`)
  text.push('A lopsided grade can still make sense if it fills a roster need or matches your strategy — the grade is one input, not a verdict.')
  return { ok: true, data, text, limitations: [] }
}

// ── commissionerTradeReview (T4 — commissioner-gated) ───────────────────────────
export async function commissionerTradeReview(
  proposalId: string,
  role: TradeRole,
): Promise<TradeToolResult<unknown>> {
  if (role !== 'commissioner') {
    return { ok: false, data: null, text: ['Commissioner review details are only available to the league commissioner or co-commissioner.'], limitations: [{ code: 'PERMISSION_REQUIRED', detail: 'Commissioner-only context.' }] }
  }
  const proposal = await prisma.redraftTradeProposal
    .findUnique({ where: { id: proposalId }, include: { assets: true, valueSnapshot: true } })
    .catch(() => null)
  if (!proposal) return { ok: false, data: null, text: [], limitations: [{ code: 'NOT_FOUND', detail: `No proposal ${proposalId}.` }] }

  const [season, league, teamCount] = await Promise.all([
    prisma.redraftSeason.findUnique({ where: { id: proposal.seasonId }, select: { sport: true, currentWeek: true } }).catch(() => null),
    prisma.league.findUnique({ where: { id: proposal.leagueId }, select: { tradeReviewHours: true, tradeDeadlineWeek: true, draftPickTrading: true } }).catch(() => null),
    prisma.redraftRoster.count({ where: { seasonId: proposal.seasonId } }).catch(() => 0),
  ])
  const leagueSize = teamCount || 12
  async function profileFor(rosterId: string): Promise<TeamProfile | undefined> {
    const r = await prisma.redraftRoster
      .findUnique({ where: { id: rosterId }, select: { id: true, wins: true, losses: true, ties: true, pointsFor: true, playoffSeed: true, players: { where: { droppedAt: null }, select: { position: true } } } })
      .catch(() => null)
    if (!r) return undefined
    return buildTeamProfile({ rosterId: r.id, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor, playoffSeed: r.playoffSeed, leagueSize, positions: r.players.map((p: { position: string }) => p.position) })
  }
  const [proposerProfile, receiverProfile] = await Promise.all([profileFor(proposal.proposerRosterId), profileFor(proposal.receiverRosterId)])
  const [leagueEvents, proposalEvents] = await Promise.all([
    prisma.redraftTradeMarketEvent.findMany({ where: { leagueId: proposal.leagueId, ...(season?.sport ? { sport: season.sport } : {}) }, select: { eventType: true, fairnessScore: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 500 }).catch(() => []),
    prisma.redraftTradeMarketEvent.findMany({ where: { tradeProposalId: proposalId }, select: { eventType: true, createdAt: true }, orderBy: { createdAt: 'asc' } }).catch(() => []),
  ])
  const assets: ReviewAsset[] = proposal.assets.map(
    (a: { assetType: string; fromRosterId: string; toRosterId: string; metadata: unknown }) => {
      const md = (a.metadata ?? {}) as Record<string, unknown>
      return { kind: a.assetType, fromRosterId: a.fromRosterId, toRosterId: a.toRosterId, position: typeof md.position === 'string' ? md.position : null, faabAmount: a.assetType === 'faab' ? num(md.amount) : null }
    },
  )
  const snapPayload = (proposal.valueSnapshot?.payload ?? null) as { sides?: Array<{ rosterId: string; total: number }> } | null
  const snapshot = proposal.valueSnapshot
    ? { grade: proposal.valueSnapshot.grade, fairnessScore: proposal.valueSnapshot.fairnessScore, confidenceScore: proposal.valueSnapshot.confidenceScore, valueDifference: proposal.valueSnapshot.valueDifference, sideTotals: snapPayload?.sides?.map((s) => ({ rosterId: s.rosterId, total: s.total })) ?? [] }
    : null
  const review = buildCommissionerTradeReview({
    proposerRosterId: proposal.proposerRosterId,
    receiverRosterId: proposal.receiverRosterId,
    status: proposal.status,
    vetoMode: proposal.vetoMode,
    vetoThreshold: proposal.vetoThreshold,
    sport: season?.sport ?? 'NFL',
    currentWeek: season?.currentWeek ?? null,
    settings: { tradeReviewHours: league?.tradeReviewHours ?? null, tradeDeadlineWeek: league?.tradeDeadlineWeek ?? null, draftPickTrading: league?.draftPickTrading ?? false },
    snapshot,
    assets,
    proposerProfile,
    receiverProfile,
    hasMarketEvents: proposalEvents.length > 0,
    marketContext: summarizeMarketContext(leagueEvents as MarketEventLite[]),
  })
  return {
    ok: true,
    data: { review, snapshotSummary: snapshot },
    text: ['Manual commissioner review suggested — the flags below are neutral risk/context signals, not an instruction to veto. They never imply collusion or bad faith.'],
    limitations: [],
  }
}

// ── explainPlayerMarketValue (T9 official value, source-separated) ───────────────
export async function explainPlayerMarketValue(
  playerId: string,
  sport: string | null,
): Promise<TradeToolResult<PlayerMarketValueData>> {
  if (!sport) {
    return { ok: false, data: null, text: ['No redraft season/sport is set for this league, so an AllFantasy market value cannot be resolved.'], limitations: [{ code: 'LIMITED_DATA', detail: 'No sport scope.' }] }
  }
  const v = await resolveAllFantasyMarketValue(playerId, { sport, leagueConcept: 'redraft' }).catch(() => null)
  const pub = v && v.published ? v : null // narrows to the published shape (has base/adj/confidence/etc.)
  const data: PlayerMarketValueData = {
    playerId,
    // Resolver does not return name/position; the player row is keyed by id. Keep null and let text fall back to id.
    playerName: null,
    position: null,
    allFantasyMarketValue: pub ? num(pub.allFantasyMarketValue) : null,
    baseValue: pub ? num(pub.baseValue) : null,
    adjustmentPercent: pub ? num(pub.adjustmentPercent) : null,
    confidence: pub ? num(pub.confidence) : null,
    sampleSize: pub ? num(pub.sampleSize) : null,
    published: Boolean(pub),
    direction: pub ? (pub.direction ?? null) : null,
    sources: PLAYER_VALUE_SOURCES,
  }
  const published = data.published
  if (!published) {
    return {
      ok: true,
      data,
      text: ['There is not yet enough verified AllFantasy trade history to publish an official market value for this player. Provider/ADP/projection values are a separate source and are not shown here.'],
      limitations: [{ code: 'NO_PUBLISHED_VALUE', detail: 'Sample/confidence below publish gate.' }],
    }
  }
  const text = [
    `AllFantasy official market value: ${data.allFantasyMarketValue} (base ${data.baseValue}, ${data.adjustmentPercent && data.adjustmentPercent > 0 ? '+' : ''}${data.adjustmentPercent}%, ${data.direction ?? 'steady'}; confidence ${data.confidence}/100, sample ${data.sampleSize}).`,
    'This is the official AllFantasy market value derived from internal trade signals — it is separate from provider/ADP/projection values and from immutable historical trade snapshots, and it does not overwrite them.',
  ]
  if ((data.sampleSize ?? 0) < 10) text.push('Sample size is still small, so treat this value as low-confidence.')
  return { ok: true, data, text, limitations: [] }
}

// ── summarizeTradeBlock (T8 — league-visible + own private interests only) ───────
export async function summarizeTradeBlock(
  leagueId: string,
  myRosterId: string | null,
): Promise<TradeToolResult<TradeBlockSummaryData>> {
  const items = await prisma.redraftTradeBlockItem
    .findMany({ where: { leagueId, status: 'active', visibility: 'league' }, select: { rosterId: true, playerId: true, playerName: true, note: true }, orderBy: { updatedAt: 'desc' }, take: 100 })
    .catch(() => [])
  let myInterests: TradeBlockSummaryData['myInterests'] = []
  let myInterestPositions: string[] = []
  let hasNativeBlock = items.length > 0
  if (myRosterId) {
    const signals = await discoverySignals(leagueId, myRosterId).catch(() => null)
    if (signals) {
      myInterestPositions = signals.myInterestPositions ?? []
      hasNativeBlock = signals.hasNativeBlock || hasNativeBlock
      const mine = await prisma.redraftTradeInterest
        .findMany({ where: { leagueId, fromRosterId: myRosterId, status: 'active' }, select: { playerId: true, playerName: true }, take: 50 })
        .catch(() => [] as Array<{ playerId: string | null; playerName: string | null }>)
      myInterests = mine
        .filter((m: { playerId: string | null }) => m.playerId)
        .map((m: { playerId: string | null; playerName: string | null }) => ({ playerId: m.playerId as string, playerName: m.playerName ?? null }))
    }
  }
  const data: TradeBlockSummaryData = {
    leagueVisibleItems: items.map((i: { rosterId: string; playerId: string; playerName: string | null; note: string | null }) => ({ rosterId: i.rosterId, playerId: i.playerId, playerName: i.playerName ?? null, note: i.note ?? null })),
    myInterests,
    myInterestPositions,
    hasNativeBlock,
  }
  const text = [
    `${data.leagueVisibleItems.length} player(s) are on the league-visible trade block.`,
    myRosterId ? `You have ${data.myInterests.length} private trade interest(s) saved (only visible to you).` : 'Sign in as a league manager to see your own private trade interests.',
  ]
  return { ok: true, data, text, limitations: data.leagueVisibleItems.length ? [] : [{ code: 'LIMITED_DATA', detail: 'No active league-visible block items.' }] }
}

// ── findTradePartners / suggestTradePackages (T7 — deterministic, no auto-submit) ─
async function loadDiscovery(leagueId: string, myRosterId: string) {
  const league = await assembleDiscoveryLeague(leagueId).catch(() => null)
  if (!league) return null
  const myRoster = league.rosters.find((r) => r.rosterId === myRosterId)
  if (!myRoster) return null
  const signals = await discoverySignals(leagueId, myRosterId).catch(() => null)
  if (signals) for (const r of league.rosters) r.blockPlayerIds = signals.blockPlayerIdsByRoster[r.rosterId] ?? []
  return { league, myRoster, signals }
}

export async function findTradePartners(leagueId: string, myRosterId: string | null): Promise<TradeToolResult<unknown>> {
  if (!myRosterId) return { ok: false, data: null, text: ['You need a claimed roster in this league to find trade partners.'], limitations: [{ code: 'NO_ROSTER', detail: 'No roster for user.' }] }
  const ctx = await loadDiscovery(leagueId, myRosterId)
  if (!ctx) return { ok: false, data: null, text: ['This league has no native redraft trade data to match partners.'], limitations: [{ code: 'NOT_REDRAFT_LEAGUE', detail: 'No discovery league.' }] }
  const partners = findPartners({
    myRoster: ctx.myRoster,
    otherRosters: ctx.league.rosters,
    sport: ctx.league.sport,
    myInterest: { playerIds: ctx.signals?.myInterestPlayerIds ?? [], positions: ctx.signals?.myInterestPositions ?? [], hasPrivate: true },
    hasNativeBlock: ctx.signals?.hasNativeBlock ?? false,
  })
  return {
    ok: true,
    data: { partnerCount: partners.length, partners, sport: ctx.league.sport },
    text: [
      partners.length ? `Found ${partners.length} deterministic partner match(es) based on roster needs/surpluses and trade-block signals. Chimmy can help you build an offer, but will not auto-submit it.` : 'No strong partner matches right now based on current needs and block signals.',
      ...(ctx.league.sport === 'NCAAF' ? ['NCAAF has limited valuation data — treat matches as lower confidence.'] : []),
    ],
    limitations: ctx.league.sport === 'NCAAF' ? [{ code: 'LIMITED_DATA', detail: 'NCAAF limited data.' }] : [],
  }
}

export async function suggestTradePackages(
  leagueId: string,
  myRosterId: string | null,
  partnerRosterId: string | null,
): Promise<TradeToolResult<unknown>> {
  if (!myRosterId) return { ok: false, data: null, text: ['You need a claimed roster in this league to build trade packages.'], limitations: [{ code: 'NO_ROSTER', detail: 'No roster for user.' }] }
  if (!partnerRosterId) return { ok: false, data: null, text: ['Tell me which team you want to trade with and I can suggest deterministic packages.'], limitations: [{ code: 'LIMITED_DATA', detail: 'No partner roster specified.' }] }
  const ctx = await loadDiscovery(leagueId, myRosterId)
  if (!ctx) return { ok: false, data: null, text: ['This league has no native redraft trade data to build packages.'], limitations: [{ code: 'NOT_REDRAFT_LEAGUE', detail: 'No discovery league.' }] }
  const partner = ctx.league.rosters.find((r) => r.rosterId === partnerRosterId)
  if (!partner) return { ok: false, data: null, text: ['That partner team is not in this league.'], limitations: [{ code: 'NOT_FOUND', detail: 'Partner roster not found.' }] }
  const faabSupported = (ctx.myRoster.faabBalance ?? 0) > 0 || (partner.faabBalance ?? 0) > 0
  const packages = findPackages({
    myRoster: ctx.myRoster,
    partnerRoster: partner,
    sport: ctx.league.sport,
    faabSupported,
    draftPickTrading: ctx.league.draftPickTrading,
  })
  return {
    ok: true,
    data: { packageCount: packages.length, packages, canStartProposal: packages.length > 0 },
    text: [
      packages.length ? `Built ${packages.length} deterministic package option(s) with fairness bands. You can open the Trade Center to start any of them — Chimmy will not auto-submit.` : 'No balanced packages found between these two rosters right now.',
    ],
    limitations: [],
  }
}
