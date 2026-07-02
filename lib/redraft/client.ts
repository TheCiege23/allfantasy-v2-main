import type { CanonicalScheduleRuntimeState } from '@/lib/schedule-runtime/canonicalScheduleRuntime'
import type { NflRedraftLiveScoringRuntimeState } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import type { NflRedraftTradeRuntimeState } from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'
import type { NflRedraftWaiverRuntimeState } from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'

export type RedraftRosterRow = {
  id: string
  teamName: string | null
  ownerName?: string | null
  wins: number
  losses: number
  ties?: number
  pointsFor: number
  pointsAgainst?: number
  playoffSeed?: number | null
  streak?: string | null
}

export type RedraftSeasonClient = {
  id: string
  leagueId: string
  sport: string
  season: number
  currentWeek: number
  status: string
  rosters: RedraftRosterRow[]
}

export type RedraftWeeklyScore = {
  fantasyPts: number
  isFinalized: boolean
  stats: Record<string, number>
}

export type RedraftRosterPlayerClient = {
  id: string
  playerId: string
  playerName: string
  position: string
  team: string | null
  sport: string
  slotType: string
  isLocked?: boolean | null
  injuryStatus: string | null
  byeWeek?: number | null
  weeklyProjection?: number | null
  restOfSeasonProjection?: number | null
  floorProjection?: number | null
  ceilingProjection?: number | null
  projectionConfidenceScore?: number | null
  projectionConfidenceLevel?: 'high' | 'medium' | 'low' | 'none' | null
  projectionSource?: string | null
  weeklyScore: RedraftWeeklyScore | null
}

export type RedraftLineupValidationIssueClient = {
  code: string
  severity: 'error' | 'warning'
  message: string
  playerId?: string
  playerName?: string
  slotType?: string
}

export type RedraftLineupValidationClient = {
  ok: boolean
  issues: RedraftLineupValidationIssueClient[]
  errorCount: number
  warningCount: number
}

export type RedraftRosterClient = RedraftRosterRow & {
  players: RedraftRosterPlayerClient[]
  lineupValidation?: RedraftLineupValidationClient
}

export type RedraftMatchupClient = {
  id: string
  week: number
  status: string
  homeScore: number
  awayScore: number
  homeRosterId: string
  awayRosterId: string | null
  homeRoster: RedraftRosterRow
  awayRoster: RedraftRosterRow | null
  lineupSnapshots?: unknown
}

export type RedraftScheduleClient = CanonicalScheduleRuntimeState
export type RedraftLiveScoringClient = NflRedraftLiveScoringRuntimeState
export type RedraftTradeRuntimeClient = NflRedraftTradeRuntimeState
export type RedraftWaiverRuntimeClient = NflRedraftWaiverRuntimeState

export type RedraftWaiverClaimClient = {
  id: string
  addPlayerId: string
  addPlayerName: string
  dropPlayerName: string | null
  bidAmount: number | null
  priority: number | null
  status: string
  submittedAt: string
  processedAt: string | null
  denialReason: string | null
}

export type RedraftTradeProposal = {
  id: string
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  status: string
  vetoMode: string
  vetoThreshold: number | null
  reason: string | null
  expiresAt: string | null
  createdAt: string
  assets: Array<{
    id: string
    fromRosterId: string
    toRosterId: string
    assetType: string
    playerName: string | null
    pickSeason: number | null
    pickRound: number | null
    pickNumber: number | null
  }>
  votes: Array<{ id: string; rosterId: string; vote: string; reason: string | null }>
  decision?: { id: string; decision: string; decisionReason: string | null } | null
  /** T2 immutable value snapshot captured at proposal time (original grade/values for history). */
  valueSnapshot?: {
    grade: string
    fairnessScore: number
    confidenceScore: number
    valueDifference: number
    createdAt: string
  } | null
}

export type RedraftTradeAssetInput = {
  fromRosterId: string
  toRosterId: string
  assetType: 'player' | 'draft_pick' | 'faab' | 'future_consideration'
  playerId?: string
  playerName?: string
  pickSeason?: number
  pickRound?: number
  pickNumber?: number
  metadata?: Record<string, unknown>
}

export type RedraftTradeSettings = {
  tradeReviewHours: number
  tradeDeadlineWeek: number | null
  draftPickTrading: boolean
  commissionerTradeReviewType: string
}

export async function fetchRedraftTradeSettings(params: {
  leagueId: string
  seasonId?: string | null
}): Promise<{ settings: RedraftTradeSettings; faabByRosterId: Record<string, number>; isCommissioner: boolean }> {
  const qs = new URLSearchParams({ leagueId: params.leagueId })
  if (params.seasonId) qs.set('seasonId', params.seasonId)
  const res = await fetch(`/api/redraft/trade-settings?${qs.toString()}`, { credentials: 'include' })
  return parseJson<{ settings: RedraftTradeSettings; faabByRosterId: Record<string, number>; isCommissioner: boolean }>(res)
}

export type CommissionerTradeReview = {
  review: {
    summary: {
      reviewScore: number
      fairnessScore: number
      confidenceScore: number
      valueDelta: number
      grade: string | null
      status: string
      reviewRecommended: boolean
      lopsided: boolean
      deadlineFlag: boolean
      expired: boolean
      vetoMode: string
      reviewHours: number | null
    }
    riskFlags: string[]
    contextFlags: string[]
    notes: string[]
    marketContext: { sampleSize: number; averageFairness?: number; medianFairness?: number; acceptedCount?: number; vetoedCount?: number; recentCount?: number; message?: string }
  }
  eventTrail: Array<{ eventType: string; createdAt: string }>
  settings: { vetoMode: string; vetoThreshold: number | null; reviewHours: number | null; tradeDeadlineWeek: number | null; draftPickTrading: boolean }
}

export async function fetchCommissionerTradeReview(proposalId: string): Promise<CommissionerTradeReview> {
  const res = await fetch(`/api/redraft/trades/${encodeURIComponent(proposalId)}/commissioner-review`, { credentials: 'include' })
  return parseJson<CommissionerTradeReview>(res)
}

export type TradeMarketAggregates = {
  scope: string
  requestedScope: string
  sampleStatus: 'ok' | 'insufficient' | 'empty'
  summary: {
    sampleSize: number
    acceptedCount: number
    rejectedCount: number
    canceledCount: number
    vetoedCount: number
    expiredCount: number
    processedCount: number
    averageFairness: number | null
    medianFairness: number | null
    averageConfidence: number | null
    averageValueDelta: number | null
    lastEventAt: string | null
  }
  gradeDistribution: { aRange: number; bRange: number; cRange: number; dfRange: number; unknown: number }
  reviewDistribution: { lopsidedCount: number; lowConfidenceCount: number; highValueDeltaCount: number; reviewRecommendedCount: number | null }
  generatedAt: string
}

export async function fetchTradeMarketAggregates(params: { leagueId: string; scope?: 'league' | 'sport' | 'sport_concept' }): Promise<TradeMarketAggregates> {
  const qs = new URLSearchParams({ leagueId: params.leagueId, scope: params.scope ?? 'league' })
  const res = await fetch(`/api/redraft/trades/market-aggregates?${qs.toString()}`, { credentials: 'include' })
  return parseJson<TradeMarketAggregates>(res)
}

export type AdaptiveValuePreview = {
  playerId: string
  playerName: string | null
  position: string | null
  baseValue: number | null
  marketPreviewValue: number | null
  adjustmentPercent: number
  adjustmentPoints: number
  confidence: number
  sampleSize: number
  direction: 'rising' | 'falling' | 'stable' | 'insufficient'
  reasons: string[]
}

export async function fetchAdaptiveValueTopMovers(leagueId: string): Promise<{ topMovers: AdaptiveValuePreview[] }> {
  const res = await fetch(`/api/redraft/trades/adaptive-value-preview?leagueId=${encodeURIComponent(leagueId)}&topMovers=1`, { credentials: 'include' })
  return parseJson<{ topMovers: AdaptiveValuePreview[] }>(res)
}

export type TradePartnerMatch = {
  rosterId: string
  teamName: string
  managerDisplayName: string | null
  partnerNeeds: string[]
  partnerSurpluses: string[]
  myNeeds: string[]
  mySurpluses: string[]
  matchScore: number
  matchReasons: string[]
  warningFlags: string[]
}
export type TradePackageAsset = { kind: 'player' | 'faab'; playerId?: string; playerName?: string; position?: string; faabAmount?: number; value: number | null }
export type TradePackageSuggestion = {
  packageId: string
  giveAssets: TradePackageAsset[]
  receiveAssets: TradePackageAsset[]
  myTotalValue: number
  partnerTotalValue: number
  valueDelta: number
  fairnessBand: string
  confidence: number
  reasons: string[]
  warningFlags: string[]
  canStartProposal: boolean
}

export async function fetchTradeDiscovery(params: { leagueId: string; rosterId: string }): Promise<{ partners: TradePartnerMatch[]; summary: { myNeeds: string[]; mySurpluses: string[]; partnerCount: number; sport: string }; warnings: string[] }> {
  const qs = new URLSearchParams({ leagueId: params.leagueId, rosterId: params.rosterId })
  const res = await fetch(`/api/redraft/trades/discovery?${qs.toString()}`, { credentials: 'include' })
  return parseJson(res)
}

export async function fetchTradePackages(payload: { leagueId: string; myRosterId: string; partnerRosterId: string; targetPlayerId?: string | null; outgoingPlayerId?: string | null }): Promise<{ suggestedPackages: TradePackageSuggestion[]; warnings: string[]; canStartProposal: boolean }> {
  const res = await fetch('/api/redraft/trades/package-finder', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  return parseJson(res)
}

export type TradeBlockItem = {
  id: string
  rosterId: string
  playerId: string
  playerName: string
  position: string | null
  team: string | null
  askingForPositions: string[]
  wantsFaab: boolean
  wantsDraftPicks: boolean
  note: string | null
  expiresAt: string | null
}
export type TradeInterestItem = {
  id: string
  playerId: string | null
  playerName: string | null
  position: string | null
  interestType: string
  visibility: string
  note: string | null
}

export async function fetchLeagueTradeBlock(leagueId: string): Promise<{ items: TradeBlockItem[] }> {
  const res = await fetch(`/api/redraft/trades/trade-block?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
  return parseJson(res)
}
export async function addTradeBlockItem(payload: { leagueId: string; playerId: string; playerName: string; position?: string | null; team?: string | null; askingForPositions?: string[]; wantsFaab?: boolean; wantsDraftPicks?: boolean; note?: string | null }) {
  const res = await fetch('/api/redraft/trades/trade-block', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  return parseJson<{ item: TradeBlockItem }>(res)
}
export async function removeTradeBlockItem(itemId: string) {
  const res = await fetch(`/api/redraft/trades/trade-block/${encodeURIComponent(itemId)}`, { method: 'DELETE', credentials: 'include' })
  return parseJson<{ ok: boolean }>(res)
}
export async function fetchMyInterests(leagueId: string): Promise<{ interests: TradeInterestItem[] }> {
  const res = await fetch(`/api/redraft/trades/interests?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
  return parseJson(res)
}
export async function addTradeInterest(payload: { leagueId: string; interestType: string; targetRosterId?: string | null; playerId?: string | null; playerName?: string | null; position?: string | null; note?: string | null; visibility?: 'private' | 'public' }) {
  const res = await fetch('/api/redraft/trades/interests', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  return parseJson<{ interest: TradeInterestItem }>(res)
}
export async function removeTradeInterest(interestId: string) {
  const res = await fetch(`/api/redraft/trades/interests/${encodeURIComponent(interestId)}`, { method: 'DELETE', credentials: 'include' })
  return parseJson<{ ok: boolean }>(res)
}

export type AllFantasyMarketValueRow = {
  playerId: string
  playerName: string | null
  position: string | null
  baseValue: number
  marketValue: number
  adjustmentPercent: number
  confidence: number
  sampleSize: number
  direction: string
  generatedAt: string
}
export async function fetchAllFantasyMarketValues(leagueId: string): Promise<{ sport: string | null; values: AllFantasyMarketValueRow[] }> {
  const res = await fetch(`/api/redraft/trades/market-values?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
  return parseJson(res)
}

type JsonHeaders = Record<string, string>

const jsonHeaders: JsonHeaders = {
  'Content-Type': 'application/json',
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as T | null
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: unknown }).error ?? `Request failed (${res.status})`)
        : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return (body ?? {}) as T
}

export async function fetchRedraftSeason(leagueId: string): Promise<RedraftSeasonClient | null> {
  const res = await fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ season?: RedraftSeasonClient }>(res)
  return body.season ?? null
}

export async function fetchRedraftStandings(seasonId: string): Promise<RedraftRosterRow[]> {
  const res = await fetch(`/api/redraft/standings?seasonId=${encodeURIComponent(seasonId)}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ rosters?: RedraftRosterRow[] }>(res)
  return body.rosters ?? []
}

export async function fetchRedraftMatchups(seasonId: string, week: number): Promise<RedraftMatchupClient[]> {
  const qs = new URLSearchParams({ seasonId, week: String(week) })
  const res = await fetch(`/api/redraft/matchup?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ matchups?: RedraftMatchupClient[] }>(res)
  return body.matchups ?? []
}

export async function fetchRedraftSchedule(leagueId: string, seasonId?: string | null): Promise<RedraftScheduleClient | null> {
  const qs = new URLSearchParams(seasonId ? { seasonId } : { leagueId })
  const res = await fetch(`/api/redraft/schedule?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ schedule?: RedraftScheduleClient }>(res)
  return body.schedule ?? null
}

export async function fetchRedraftLiveScoring(params: {
  leagueId: string
  seasonId?: string | null
  week?: number | null
}): Promise<RedraftLiveScoringClient | null> {
  const qs = new URLSearchParams(params.seasonId ? { seasonId: params.seasonId } : { leagueId: params.leagueId })
  if (params.week != null) qs.set('week', String(params.week))
  const res = await fetch(`/api/redraft/live-scoring?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ scoring?: RedraftLiveScoringClient }>(res)
  return body.scoring ?? null
}

export async function fetchRedraftRoster(rosterId: string, week: number): Promise<RedraftRosterClient | null> {
  const qs = new URLSearchParams({ rosterId, week: String(week) })
  const res = await fetch(`/api/redraft/roster?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ roster?: RedraftRosterClient }>(res)
  return body.roster ?? null
}

export async function fetchRedraftWaiverClaims(
  seasonId: string,
  rosterId: string,
): Promise<RedraftWaiverClaimClient[]> {
  const qs = new URLSearchParams({ seasonId, rosterId })
  const res = await fetch(`/api/redraft/waivers?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ claims?: RedraftWaiverClaimClient[] }>(res)
  return body.claims ?? []
}

export async function fetchRedraftWaiverRuntime(params: {
  leagueId: string
  seasonId?: string | null
  rosterId?: string | null
  week?: number | null
  scope?: 'mine' | 'league'
  includeFreeAgents?: boolean
}): Promise<RedraftWaiverRuntimeClient | null> {
  const qs = new URLSearchParams(params.seasonId ? { seasonId: params.seasonId } : { leagueId: params.leagueId })
  if (params.rosterId) qs.set('rosterId', params.rosterId)
  if (params.week != null) qs.set('week', String(params.week))
  if (params.scope) qs.set('scope', params.scope)
  if (params.includeFreeAgents) qs.set('includeFreeAgents', '1')
  const res = await fetch(`/api/redraft/waiver-runtime?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ waivers?: RedraftWaiverRuntimeClient }>(res)
  return body.waivers ?? null
}

export async function fetchRedraftTradeRuntime(params: {
  leagueId: string
  seasonId?: string | null
  week?: number | null
}): Promise<RedraftTradeRuntimeClient | null> {
  const qs = new URLSearchParams(params.seasonId ? { seasonId: params.seasonId } : { leagueId: params.leagueId })
  if (params.week != null) qs.set('week', String(params.week))
  const res = await fetch(`/api/redraft/trade-runtime?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ trades?: RedraftTradeRuntimeClient }>(res)
  return body.trades ?? null
}

export async function listTradeProposals(params: {
  leagueId: string
  seasonId: string
  status?: string
}): Promise<RedraftTradeProposal[]> {
  const qs = new URLSearchParams({
    leagueId: params.leagueId,
    seasonId: params.seasonId,
    ...(params.status ? { status: params.status } : {}),
  })
  const res = await fetch(`/api/redraft/trade-proposals?${qs.toString()}`, {
    credentials: 'include',
  })
  const body = await parseJson<{ proposals?: RedraftTradeProposal[] }>(res)
  return body.proposals ?? []
}

export async function createTradeProposal(payload: {
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  reason?: string
  assets?: RedraftTradeAssetInput[]
}) {
  const assets =
    payload.assets && payload.assets.length > 0
      ? payload.assets
      : [
          {
            fromRosterId: payload.proposerRosterId,
            toRosterId: payload.receiverRosterId,
            assetType: 'future_consideration' as const,
            metadata: {},
          },
        ]
  const proposalPayload = {
    leagueId: payload.leagueId,
    seasonId: payload.seasonId,
    proposerRosterId: payload.proposerRosterId,
    receiverRosterId: payload.receiverRosterId,
    reason: payload.reason,
  }
  const res = await fetch('/api/redraft/trade-proposals', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({
      ...proposalPayload,
      assets,
    }),
  })
  return parseJson<{ proposal: RedraftTradeProposal }>(res)
}

export async function submitTradeVote(payload: {
  proposalId: string
  action:
    | 'accept'
    | 'reject'
    | 'cancel'
    | 'commissioner_approve'
    | 'commissioner_veto'
    | 'vote_approve'
    | 'vote_veto'
  reason?: string
}) {
  const res = await fetch('/api/redraft/trade-votes', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  return parseJson<{ proposal: RedraftTradeProposal; resolved: boolean }>(res)
}

export async function vetoRedraftTradeProposal(payload: { proposalId: string; reason?: string }) {
  const res = await fetch('/api/redraft/trades/veto', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  return parseJson<{
    proposalId: string
    leagueId: string
    status: string
    vetoedBy: string
    reason: string | null
  }>(res)
}

export async function finalizeRedraftSeason(payload: { seasonId: string }) {
  const res = await fetch('/api/redraft/seasons/finalize', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  return parseJson<{
    status: string
    alreadyFinalized: boolean
    championTeamName: string | null
    championUserId: string | null
  }>(res)
}

export async function generatePlayoffs(payload: {
  seasonId: string
  playoffTeams?: number
  regenerate?: boolean
}) {
  const res = await fetch('/api/redraft/playoffs/generate', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  return parseJson<{
    summary?: { playoffTeams: number; bracketSize: number; byes: number; rounds: number }
  }>(res)
}
