import type {
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime/leagueRuntimeEvents'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'

export type NflRedraftTradeRulesInput = {
  draft: {
    pickTradingEnabled?: boolean | null
  }
  permissions: {
    memberMovesLocked?: boolean | null
  }
  roster: {
    lockAllMoves?: boolean | null
    size?: number | null
  }
  trades: {
    deadlineWeek?: number | null
    draftPickTrading?: boolean | null
    reviewHours?: number | null
  }
}

export type NflRedraftTradeAssetType = 'player' | 'faab' | 'draft_pick' | 'future_consideration'
export type NflRedraftTradeStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'vetoed' | 'expired' | 'processed'
export type NflRedraftTradeVetoMode = 'commissioner' | 'league_vote' | 'no_veto'
export type NflRedraftTradeVoteValue = 'approve' | 'veto'

export type NflRedraftTradeSettings = {
  reviewHours: number
  deadlineWeek: number | null
  draftPickTrading: boolean
  activeRosterLimit: number
  lockAllMoves: boolean
  deadlinePassed: boolean
  pickExecutionStatus: 'supported' | 'reference_only' | 'disabled'
}

export type NflRedraftTradePlayerInput = {
  playerId: string
  playerName: string
  position: string
  team?: string | null
  sport?: string | null
  slotType?: string | null
  isLocked?: boolean | null
  injuryStatus?: string | null
  byeWeek?: number | null
  acquisitionType?: string | null
  droppedAt?: Date | string | null
}

export type NflRedraftTradeRosterInput = {
  rosterId: string
  displayName?: string | null
  ownerId?: string | null
  ownerName?: string | null
  faabBalance?: number | null
  waiverPriority?: number | null
  players: NflRedraftTradePlayerInput[]
  validationIssues?: Array<{ code: string; severity: string; message: string; playerId?: string | null }>
}

export type NflRedraftTradeAssetInput = {
  assetId?: string | null
  fromRosterId: string
  toRosterId: string
  assetType: NflRedraftTradeAssetType | string
  playerId?: string | null
  playerName?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  pickNumber?: number | null
  faabAmount?: number | null
  metadata?: Record<string, unknown> | null
}

export type NflRedraftTradeVoteInput = {
  voteId?: string | null
  rosterId: string
  vote: NflRedraftTradeVoteValue | string
  reason?: string | null
  createdAtIso?: string | null
}

export type NflRedraftTradeProposalInput = {
  proposalId: string
  proposerRosterId: string
  receiverRosterId: string
  status?: NflRedraftTradeStatus | string | null
  vetoMode?: NflRedraftTradeVetoMode | string | null
  vetoThreshold?: number | null
  reason?: string | null
  expiresAtIso?: string | null
  createdAtIso?: string | null
  acceptedAtIso?: string | null
  rejectedAtIso?: string | null
  cancelledAtIso?: string | null
  processedAtIso?: string | null
  assets: NflRedraftTradeAssetInput[]
  votes?: NflRedraftTradeVoteInput[]
}

export type NflRedraftTradeTransactionInput = {
  transactionId: string
  rosterId: string
  type: string
  createdAtIso: string
  proposalId?: string | null
  metadata?: Record<string, unknown> | null
}

export type NflRedraftTradeTeamState = {
  rosterId: string
  displayName: string | null
  ownerId: string | null
  ownerName: string | null
  faabBalance: number
  waiverPriority: number
  activeRosterCount: number
  activeRosterLimit: number
  rosterFull: boolean
  players: NflRedraftTradePlayerInput[]
  lockedPlayerIds: string[]
  validationIssues: Array<{ code: string; severity: string; message: string; playerId?: string | null }>
}

export type NflRedraftTradeAssetState = {
  assetId: string
  fromRosterId: string
  toRosterId: string
  assetType: NflRedraftTradeAssetType
  playerId: string | null
  playerName: string | null
  pickSeason: number | null
  pickRound: number | null
  pickNumber: number | null
  faabAmount: number | null
  metadata: Record<string, unknown>
}

export type NflRedraftTradeVoteState = {
  voteId: string
  rosterId: string
  vote: NflRedraftTradeVoteValue
  reason: string | null
  createdAtIso: string
}

export type NflRedraftTradeProposalState = {
  proposalId: string
  proposerRosterId: string
  receiverRosterId: string
  status: NflRedraftTradeStatus
  vetoMode: NflRedraftTradeVetoMode
  vetoThreshold: number
  reason: string | null
  expiresAtIso: string | null
  createdAtIso: string
  acceptedAtIso: string | null
  rejectedAtIso: string | null
  cancelledAtIso: string | null
  processedAtIso: string | null
  assets: NflRedraftTradeAssetState[]
  votes: NflRedraftTradeVoteState[]
  voteCounts: { approve: number; veto: number; threshold: number }
}

export type NflRedraftTradeTransactionState = {
  transactionId: string
  rosterId: string
  type: string
  createdAtIso: string
  proposalId: string | null
  metadata: Record<string, unknown>
}

export type NflRedraftTradeRosterImpact = {
  rosterId: string
  beforeCount: number
  afterCount: number
  outgoingPlayers: string[]
  incomingPlayers: string[]
  faabBefore: number
  faabAfter: number
  warnings: string[]
}

export type NflRedraftTradeValidationResult =
  | { ok: true; warnings: string[]; rosterImpact: NflRedraftTradeRosterImpact[] }
  | {
      ok: false
      code:
        | 'ASSET_DIRECTION_INVALID'
        | 'DRAFT_PICK_TRADING_DISABLED'
        | 'DUPLICATE_ASSET'
        | 'EXPIRED'
        | 'INSUFFICIENT_FAAB'
        | 'INVALID_ASSET'
        | 'LOCKED_PLAYER'
        | 'MOVE_LOCKED'
        | 'NO_ASSETS'
        | 'PLAYER_NOT_OWNED'
        | 'ROSTER_LIMIT'
        | 'ROSTER_NOT_FOUND'
        | 'SAME_ROSTER'
        | 'TRADE_DEADLINE_PASSED'
      message: string
    }

export type NflRedraftTradeRuntimeState = {
  leagueId: string
  seasonId: string
  season: number
  week: number
  sport: 'NFL'
  generatedAtIso: string
  settings: NflRedraftTradeSettings
  teams: NflRedraftTradeTeamState[]
  proposals: NflRedraftTradeProposalState[]
  transactions: NflRedraftTradeTransactionState[]
  coverage: {
    rosterCount: number
    pendingTrades: number
    processedTrades: number
    transactionCount: number
    voteCount: number
    lockedPlayers: number
  }
}

export type NflRedraftTradeExecutionResult =
  | {
      ok: true
      proposal: NflRedraftTradeProposalState
      teams: NflRedraftTradeTeamState[]
      transaction: NflRedraftTradeTransactionState
      rosterImpact: NflRedraftTradeRosterImpact[]
      events: CanonicalLeagueRuntimeEvent[]
    }
  | { ok: false; validation: NflRedraftTradeValidationResult; events: CanonicalLeagueRuntimeEvent[] }

type NflRedraftTradeLifecycleEvent =
  | 'proposed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'vetoed'
  | 'league_vote_opened'
  | 'league_vote_cast'
  | 'league_vote_passed'
  | 'league_vote_failed'

function finiteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function positiveInt(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)))
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function iso(value: unknown, fallback: Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback.toISOString()
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return null
}

function normalizeStatus(value: unknown): NflRedraftTradeStatus {
  const raw = String(value ?? 'pending').trim().toLowerCase()
  if (raw === 'accepted' || raw === 'approved') return 'accepted'
  if (raw === 'rejected' || raw === 'declined') return 'rejected'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  if (raw === 'vetoed') return 'vetoed'
  if (raw === 'expired') return 'expired'
  if (raw === 'processed' || raw === 'complete' || raw === 'completed') return 'processed'
  return 'pending'
}

function normalizeVetoMode(value: unknown): NflRedraftTradeVetoMode {
  const raw = String(value ?? 'commissioner').trim().toLowerCase()
  if (raw === 'league_vote') return 'league_vote'
  if (raw === 'no_veto' || raw === 'none' || raw === 'instant') return 'no_veto'
  return 'commissioner'
}

function normalizeAssetType(value: unknown): NflRedraftTradeAssetType | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'player' || raw === 'faab' || raw === 'draft_pick' || raw === 'future_consideration') return raw
  return null
}

function normalizeVote(value: unknown): NflRedraftTradeVoteValue {
  return String(value ?? '').trim().toLowerCase() === 'veto' ? 'veto' : 'approve'
}

function activePlayers(players: NflRedraftTradePlayerInput[]): NflRedraftTradePlayerInput[] {
  return players.filter((player) => !player.droppedAt)
}

function normalizePlayer(input: NflRedraftTradePlayerInput): NflRedraftTradePlayerInput {
  return {
    ...input,
    playerId: String(input.playerId),
    playerName: input.playerName || input.playerId,
    position: String(input.position || 'UNK').toUpperCase(),
    team: input.team ?? null,
    sport: String(input.sport ?? 'NFL').toUpperCase(),
    slotType: input.slotType ?? 'BENCH',
  }
}

function faabAmount(asset: Pick<NflRedraftTradeAssetInput, 'faabAmount' | 'metadata'>): number {
  const metadata = recordOrEmpty(asset.metadata)
  const raw = asset.faabAmount ?? metadata.amount ?? metadata.faab ?? metadata.faabAmount
  return Math.floor(finiteNumber(raw, 0))
}

function event(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType | string
  occurredAtIso?: string
  actorUserId?: string | null
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.type,
    createdAt: input.occurredAtIso,
    actorUserId: input.actorUserId ?? null,
    payload: input.payload ?? {},
  })
}

export function buildTradeRuntimeEvent(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType | string
  occurredAt?: Date | string | null
  actorUserId?: string | null
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.type,
    createdAt: input.occurredAt,
    actorUserId: input.actorUserId ?? null,
    payload: input.payload ?? {},
  })
}

export function resolveNflRedraftTradeSettings(input: {
  rules: NflRedraftTradeRulesInput
  week: number
  activeRosterLimit?: number | null
  pickInventorySupported?: boolean | null
}): NflRedraftTradeSettings {
  const deadlineWeek = input.rules.trades.deadlineWeek == null ? null : positiveInt(input.rules.trades.deadlineWeek, 0)
  const draftPickTrading = Boolean(input.rules.trades.draftPickTrading || input.rules.draft.pickTradingEnabled)
  return {
    reviewHours: positiveInt(input.rules.trades.reviewHours, 48) || 48,
    deadlineWeek: deadlineWeek && deadlineWeek > 0 ? deadlineWeek : null,
    draftPickTrading,
    activeRosterLimit: Math.max(1, positiveInt(input.activeRosterLimit, positiveInt(input.rules.roster.size, 0))),
    lockAllMoves: Boolean(input.rules.roster.lockAllMoves || input.rules.permissions.memberMovesLocked),
    deadlinePassed: Boolean(deadlineWeek && deadlineWeek > 0 && input.week > deadlineWeek),
    pickExecutionStatus: draftPickTrading ? (input.pickInventorySupported ? 'supported' : 'reference_only') : 'disabled',
  }
}

function toTeamState(input: {
  settings: NflRedraftTradeSettings
  roster: NflRedraftTradeRosterInput
}): NflRedraftTradeTeamState {
  const players = activePlayers(input.roster.players.map(normalizePlayer))
  return {
    rosterId: input.roster.rosterId,
    displayName: input.roster.displayName ?? null,
    ownerId: input.roster.ownerId ?? null,
    ownerName: input.roster.ownerName ?? null,
    faabBalance: Math.max(0, finiteNumber(input.roster.faabBalance, 0)),
    waiverPriority: positiveInt(input.roster.waiverPriority, 999),
    activeRosterCount: players.length,
    activeRosterLimit: input.settings.activeRosterLimit,
    rosterFull: players.length >= input.settings.activeRosterLimit,
    players,
    lockedPlayerIds: players.filter((player) => player.isLocked).map((player) => player.playerId),
    validationIssues: input.roster.validationIssues ?? [],
  }
}

function toAssetState(input: NflRedraftTradeAssetInput, index: number): NflRedraftTradeAssetState {
  const assetType = normalizeAssetType(input.assetType) ?? 'future_consideration'
  return {
    assetId: input.assetId?.trim() || `asset:${index + 1}`,
    fromRosterId: input.fromRosterId,
    toRosterId: input.toRosterId,
    assetType,
    playerId: input.playerId?.trim() || null,
    playerName: input.playerName?.trim() || null,
    pickSeason: input.pickSeason == null ? null : positiveInt(input.pickSeason, 0),
    pickRound: input.pickRound == null ? null : positiveInt(input.pickRound, 0),
    pickNumber: input.pickNumber == null ? null : positiveInt(input.pickNumber, 0),
    faabAmount: assetType === 'faab' ? faabAmount(input) : null,
    metadata: recordOrEmpty(input.metadata),
  }
}

function toVoteState(input: NflRedraftTradeVoteInput, index: number, now: Date): NflRedraftTradeVoteState {
  return {
    voteId: input.voteId?.trim() || `vote:${input.rosterId}:${index + 1}`,
    rosterId: input.rosterId,
    vote: normalizeVote(input.vote),
    reason: textOrNull(input.reason),
    createdAtIso: iso(input.createdAtIso, now),
  }
}

function toProposalState(input: NflRedraftTradeProposalInput, now: Date): NflRedraftTradeProposalState {
  const assets = input.assets.map(toAssetState)
  const votes = (input.votes ?? []).map((vote, index) => toVoteState(vote, index, now))
  const vetoThreshold = Math.max(1, positiveInt(input.vetoThreshold, 4) || 4)
  return {
    proposalId: input.proposalId,
    proposerRosterId: input.proposerRosterId,
    receiverRosterId: input.receiverRosterId,
    status: normalizeStatus(input.status),
    vetoMode: normalizeVetoMode(input.vetoMode),
    vetoThreshold,
    reason: textOrNull(input.reason),
    expiresAtIso: nullableIso(input.expiresAtIso),
    createdAtIso: iso(input.createdAtIso, now),
    acceptedAtIso: nullableIso(input.acceptedAtIso),
    rejectedAtIso: nullableIso(input.rejectedAtIso),
    cancelledAtIso: nullableIso(input.cancelledAtIso),
    processedAtIso: nullableIso(input.processedAtIso),
    assets,
    votes,
    voteCounts: {
      approve: votes.filter((vote) => vote.vote === 'approve').length,
      veto: votes.filter((vote) => vote.vote === 'veto').length,
      threshold: vetoThreshold,
    },
  }
}

function toTransactionState(input: NflRedraftTradeTransactionInput): NflRedraftTradeTransactionState {
  return {
    transactionId: input.transactionId,
    rosterId: input.rosterId,
    type: input.type,
    createdAtIso: input.createdAtIso,
    proposalId: input.proposalId ?? null,
    metadata: input.metadata ?? {},
  }
}

export function buildNflRedraftTradeRuntimeState(input: {
  leagueId: string
  seasonId: string
  season: number
  week: number
  rules: NflRedraftTradeRulesInput
  rosters: NflRedraftTradeRosterInput[]
  proposals?: NflRedraftTradeProposalInput[]
  transactions?: NflRedraftTradeTransactionInput[]
  now?: Date
  activeRosterLimit?: number | null
  pickInventorySupported?: boolean | null
}): NflRedraftTradeRuntimeState {
  const now = input.now ?? new Date()
  const settings = resolveNflRedraftTradeSettings({
    rules: input.rules,
    week: input.week,
    activeRosterLimit: input.activeRosterLimit,
    pickInventorySupported: input.pickInventorySupported,
  })
  const teams = input.rosters.map((roster) => toTeamState({ settings, roster }))
  const proposals = (input.proposals ?? [])
    .map((proposal) => toProposalState(proposal, now))
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
  const transactions = (input.transactions ?? [])
    .map(toTransactionState)
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))

  return {
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    season: input.season,
    week: input.week,
    sport: 'NFL',
    generatedAtIso: now.toISOString(),
    settings,
    teams,
    proposals,
    transactions,
    coverage: {
      rosterCount: teams.length,
      pendingTrades: proposals.filter((proposal) => proposal.status === 'pending').length,
      processedTrades: proposals.filter((proposal) => proposal.status === 'accepted' || proposal.status === 'processed').length,
      transactionCount: transactions.length,
      voteCount: proposals.reduce((sum, proposal) => sum + proposal.votes.length, 0),
      lockedPlayers: teams.reduce((sum, team) => sum + team.lockedPlayerIds.length, 0),
    },
  }
}

function playerOwnerMap(teams: NflRedraftTradeTeamState[]): Map<string, { rosterId: string; player: NflRedraftTradePlayerInput }> {
  const out = new Map<string, { rosterId: string; player: NflRedraftTradePlayerInput }>()
  for (const team of teams) {
    for (const player of team.players) out.set(player.playerId, { rosterId: team.rosterId, player })
  }
  return out
}

function validationFailure(
  code: Exclude<NflRedraftTradeValidationResult, { ok: true }>['code'],
  message: string,
): NflRedraftTradeValidationResult {
  return { ok: false, code, message }
}

export function validateNflRedraftTradeProposal(input: {
  state: NflRedraftTradeRuntimeState
  proposerRosterId: string
  receiverRosterId: string
  assets: NflRedraftTradeAssetInput[] | NflRedraftTradeAssetState[]
  now?: Date
  commissionerOverride?: boolean
  existingProposalId?: string | null
}): NflRedraftTradeValidationResult {
  const settings = input.state.settings
  if (settings.lockAllMoves && !input.commissionerOverride) {
    return validationFailure('MOVE_LOCKED', 'Roster moves are locked by league settings.')
  }
  if (settings.deadlinePassed && !input.commissionerOverride) {
    return validationFailure('TRADE_DEADLINE_PASSED', `Trade deadline passed after Week ${settings.deadlineWeek}.`)
  }
  if (input.proposerRosterId === input.receiverRosterId) {
    return validationFailure('SAME_ROSTER', 'Trade rosters must be different.')
  }

  const proposer = input.state.teams.find((team) => team.rosterId === input.proposerRosterId)
  const receiver = input.state.teams.find((team) => team.rosterId === input.receiverRosterId)
  if (!proposer || !receiver) return validationFailure('ROSTER_NOT_FOUND', 'Both trade rosters must exist in this season.')

  const assets = input.assets.map((asset, index) => toAssetState(asset, index))
  if (assets.length === 0) return validationFailure('NO_ASSETS', 'Trade must include at least one asset.')

  const rosterIds = new Set([input.proposerRosterId, input.receiverRosterId])
  const ownerByPlayerId = playerOwnerMap(input.state.teams)
  const seenAssets = new Set<string>()
  const playerDelta = new Map<string, number>([
    [input.proposerRosterId, 0],
    [input.receiverRosterId, 0],
  ])
  const faabDelta = new Map<string, number>([
    [input.proposerRosterId, 0],
    [input.receiverRosterId, 0],
  ])
  const incoming = new Map<string, string[]>([
    [input.proposerRosterId, []],
    [input.receiverRosterId, []],
  ])
  const outgoing = new Map<string, string[]>([
    [input.proposerRosterId, []],
    [input.receiverRosterId, []],
  ])
  const warnings: string[] = []

  for (const asset of assets) {
    if (!rosterIds.has(asset.fromRosterId) || !rosterIds.has(asset.toRosterId) || asset.fromRosterId === asset.toRosterId) {
      return validationFailure('ASSET_DIRECTION_INVALID', 'Trade asset direction must move between the two trade rosters.')
    }

    const key =
      asset.assetType === 'player'
        ? `player:${asset.playerId ?? ''}`
        : asset.assetType === 'faab'
          ? `faab:${asset.fromRosterId}:${asset.toRosterId}`
          : asset.assetType === 'draft_pick'
            ? `pick:${asset.fromRosterId}:${asset.pickSeason}:${asset.pickRound}:${asset.pickNumber ?? ''}`
            : `future:${asset.fromRosterId}:${asset.toRosterId}`
    if (seenAssets.has(key) && asset.assetType !== 'future_consideration') {
      return validationFailure('DUPLICATE_ASSET', 'Trade includes the same asset more than once.')
    }
    seenAssets.add(key)

    if (asset.assetType === 'player') {
      if (!asset.playerId) return validationFailure('INVALID_ASSET', 'Player trade assets require playerId.')
      const owner = ownerByPlayerId.get(asset.playerId)
      if (!owner || owner.rosterId !== asset.fromRosterId) {
        return validationFailure('PLAYER_NOT_OWNED', `${asset.playerName ?? asset.playerId} is not active on the sending roster.`)
      }
      if (owner.player.isLocked && !input.commissionerOverride) {
        return validationFailure('LOCKED_PLAYER', `${owner.player.playerName} is locked and cannot be traded.`)
      }
      playerDelta.set(asset.fromRosterId, (playerDelta.get(asset.fromRosterId) ?? 0) - 1)
      playerDelta.set(asset.toRosterId, (playerDelta.get(asset.toRosterId) ?? 0) + 1)
      outgoing.get(asset.fromRosterId)?.push(asset.playerId)
      incoming.get(asset.toRosterId)?.push(asset.playerId)
      continue
    }

    if (asset.assetType === 'faab') {
      const amount = asset.faabAmount ?? 0
      if (amount <= 0) return validationFailure('INVALID_ASSET', 'FAAB trade assets require a positive whole amount.')
      faabDelta.set(asset.fromRosterId, (faabDelta.get(asset.fromRosterId) ?? 0) - amount)
      faabDelta.set(asset.toRosterId, (faabDelta.get(asset.toRosterId) ?? 0) + amount)
      continue
    }

    if (asset.assetType === 'draft_pick') {
      if (!settings.draftPickTrading) {
        return validationFailure('DRAFT_PICK_TRADING_DISABLED', 'Draft pick trading is disabled for this redraft league.')
      }
      if (!asset.pickSeason || !asset.pickRound) {
        return validationFailure('INVALID_ASSET', 'Draft pick assets require pickSeason and pickRound.')
      }
      if (settings.pickExecutionStatus === 'reference_only') {
        warnings.push('Draft pick asset recorded as reference-only; no redraft pick inventory was available to mutate.')
      }
      continue
    }

    if (asset.assetType === 'future_consideration') {
      warnings.push('Future consideration is recorded for history only and does not mutate rosters.')
      continue
    }
  }

  const impacts: NflRedraftTradeRosterImpact[] = []
  for (const team of [proposer, receiver]) {
    const count = team.activeRosterCount + (playerDelta.get(team.rosterId) ?? 0)
    if (count > settings.activeRosterLimit) {
      return validationFailure('ROSTER_LIMIT', `${team.displayName ?? team.rosterId} would exceed the roster limit after this trade.`)
    }
    const faabAfter = team.faabBalance + (faabDelta.get(team.rosterId) ?? 0)
    if (faabAfter < 0 && !input.commissionerOverride) {
      return validationFailure('INSUFFICIENT_FAAB', `${team.displayName ?? team.rosterId} does not have enough FAAB for this trade.`)
    }
    const teamWarnings = team.validationIssues.length
      ? [`${team.displayName ?? team.rosterId} already has lineup warnings that may remain after the trade.`]
      : []
    impacts.push({
      rosterId: team.rosterId,
      beforeCount: team.activeRosterCount,
      afterCount: count,
      outgoingPlayers: outgoing.get(team.rosterId) ?? [],
      incomingPlayers: incoming.get(team.rosterId) ?? [],
      faabBefore: team.faabBalance,
      faabAfter,
      warnings: teamWarnings,
    })
    warnings.push(...teamWarnings)
  }

  return { ok: true, warnings: Array.from(new Set(warnings)), rosterImpact: impacts }
}

function cloneTeams(teams: NflRedraftTradeTeamState[]): NflRedraftTradeTeamState[] {
  return teams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player })),
    lockedPlayerIds: [...team.lockedPlayerIds],
    validationIssues: team.validationIssues.map((issue) => ({ ...issue })),
  }))
}

function rebuildTeam(team: NflRedraftTradeTeamState, settings: NflRedraftTradeSettings): NflRedraftTradeTeamState {
  return {
    ...team,
    activeRosterCount: team.players.length,
    rosterFull: team.players.length >= settings.activeRosterLimit,
    lockedPlayerIds: team.players.filter((player) => player.isLocked).map((player) => player.playerId),
  }
}

function transactionId(prefix: string, proposalId: string): string {
  return `${prefix}:${proposalId}`
}

export function executeNflRedraftTrade(input: {
  state: NflRedraftTradeRuntimeState
  proposalId: string
  actorUserId?: string | null
  now?: Date
  commissionerOverride?: boolean
}): NflRedraftTradeExecutionResult {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const proposal = input.state.proposals.find((row) => row.proposalId === input.proposalId)
  if (!proposal || proposal.status !== 'pending') {
    return {
      ok: false,
      validation: validationFailure('EXPIRED', 'Trade proposal is not pending.'),
      events: [],
    }
  }
  if (proposal.expiresAtIso && Date.parse(proposal.expiresAtIso) < now.getTime()) {
    return {
      ok: false,
      validation: validationFailure('EXPIRED', 'Trade proposal has expired.'),
      events: [
        event({
          leagueId: input.state.leagueId,
          type: 'trade.expired',
          occurredAtIso: nowIso,
          actorUserId: input.actorUserId ?? null,
          payload: { seasonId: input.state.seasonId, proposalId: proposal.proposalId },
        }),
      ],
    }
  }
  const validation = validateNflRedraftTradeProposal({
    state: input.state,
    proposerRosterId: proposal.proposerRosterId,
    receiverRosterId: proposal.receiverRosterId,
    assets: proposal.assets,
    now,
    commissionerOverride: input.commissionerOverride,
    existingProposalId: proposal.proposalId,
  })
  if (!validation.ok) return { ok: false, validation, events: [] }

  const teams = cloneTeams(input.state.teams)
  const teamById = new Map(teams.map((team) => [team.rosterId, team]))
  const faabDelta = new Map<string, number>()

  for (const asset of proposal.assets) {
    const from = teamById.get(asset.fromRosterId)
    const to = teamById.get(asset.toRosterId)
    if (!from || !to) continue
    if (asset.assetType === 'player' && asset.playerId) {
      const idx = from.players.findIndex((player) => player.playerId === asset.playerId)
      if (idx < 0) continue
      const [player] = from.players.splice(idx, 1)
      to.players.push({ ...player, slotType: 'BENCH', acquisitionType: 'trade', isLocked: false })
      teamById.set(from.rosterId, rebuildTeam(from, input.state.settings))
      teamById.set(to.rosterId, rebuildTeam(to, input.state.settings))
    } else if (asset.assetType === 'faab' && asset.faabAmount) {
      faabDelta.set(asset.fromRosterId, (faabDelta.get(asset.fromRosterId) ?? 0) - asset.faabAmount)
      faabDelta.set(asset.toRosterId, (faabDelta.get(asset.toRosterId) ?? 0) + asset.faabAmount)
    }
  }

  for (const [rosterId, delta] of faabDelta) {
    const team = teamById.get(rosterId)
    if (team) team.faabBalance = Math.max(0, team.faabBalance + delta)
  }

  const nextTeams = teams.map((team) => rebuildTeam(teamById.get(team.rosterId) ?? team, input.state.settings))
  const updatedProposal: NflRedraftTradeProposalState = {
    ...proposal,
    status: 'accepted',
    acceptedAtIso: nowIso,
    processedAtIso: nowIso,
  }
  const transaction: NflRedraftTradeTransactionState = {
    transactionId: transactionId('trade-processed', proposal.proposalId),
    rosterId: proposal.proposerRosterId,
    type: 'trade_processed',
    createdAtIso: nowIso,
    proposalId: proposal.proposalId,
    metadata: {
      proposerRosterId: proposal.proposerRosterId,
      receiverRosterId: proposal.receiverRosterId,
      assets: proposal.assets.map((asset) => ({
        assetType: asset.assetType,
        fromRosterId: asset.fromRosterId,
        toRosterId: asset.toRosterId,
        playerId: asset.playerId,
        pickSeason: asset.pickSeason,
        pickRound: asset.pickRound,
        pickNumber: asset.pickNumber,
        faabAmount: asset.faabAmount,
      })),
      rosterImpact: validation.rosterImpact,
      warnings: validation.warnings,
    },
  }
  const touchedRosters = Array.from(new Set([proposal.proposerRosterId, proposal.receiverRosterId]))
  const events: CanonicalLeagueRuntimeEvent[] = [
    event({
      leagueId: input.state.leagueId,
      type: 'trade.accepted',
      occurredAtIso: nowIso,
      actorUserId: input.actorUserId ?? null,
      payload: { seasonId: input.state.seasonId, proposalId: proposal.proposalId },
    }),
    event({
      leagueId: input.state.leagueId,
      type: 'trade.executed',
      occurredAtIso: nowIso,
      actorUserId: input.actorUserId ?? null,
      payload: { seasonId: input.state.seasonId, proposalId: proposal.proposalId, rosterIds: touchedRosters },
    }),
    event({
      leagueId: input.state.leagueId,
      type: 'trade.processed',
      occurredAtIso: nowIso,
      actorUserId: input.actorUserId ?? null,
      payload: { seasonId: input.state.seasonId, proposalId: proposal.proposalId, transactionId: transaction.transactionId },
    }),
    ...touchedRosters.map((rosterId) =>
      event({
        leagueId: input.state.leagueId,
        type: 'trade.roster.updated',
        occurredAtIso: nowIso,
        actorUserId: input.actorUserId ?? null,
        payload: { seasonId: input.state.seasonId, proposalId: proposal.proposalId, rosterId },
      }),
    ),
    event({
      leagueId: input.state.leagueId,
      type: 'trade.transaction.recorded',
      occurredAtIso: nowIso,
      actorUserId: input.actorUserId ?? null,
      payload: { seasonId: input.state.seasonId, proposalId: proposal.proposalId, transactionId: transaction.transactionId },
    }),
  ]
  if (input.commissionerOverride) {
    events.push(
      event({
        leagueId: input.state.leagueId,
        type: 'commissioner.trade_override',
        occurredAtIso: nowIso,
        actorUserId: input.actorUserId ?? null,
        payload: { seasonId: input.state.seasonId, proposalId: proposal.proposalId, action: 'execute' },
      }),
    )
  }

  return { ok: true, proposal: updatedProposal, teams: nextTeams, transaction, rosterImpact: validation.rosterImpact, events }
}

export function buildTradeLifecycleEvents(input: {
  state: NflRedraftTradeRuntimeState
  proposalId: string
  type: NflRedraftTradeLifecycleEvent
  actorUserId?: string | null
  now?: Date
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent[] {
  const nowIso = (input.now ?? new Date()).toISOString()
  const typeMap: Record<NflRedraftTradeLifecycleEvent, CanonicalLeagueRuntimeEventType | string> = {
    proposed: 'trade.proposed',
    rejected: 'trade.rejected',
    cancelled: 'trade.cancelled',
    expired: 'trade.expired',
    vetoed: 'trade.vetoed',
    league_vote_opened: 'trade.league_vote.opened',
    league_vote_cast: 'trade.league_vote.cast',
    league_vote_passed: 'trade.league_vote.passed',
    league_vote_failed: 'trade.league_vote.failed',
  }
  return [
    event({
      leagueId: input.state.leagueId,
      type: typeMap[input.type],
      occurredAtIso: nowIso,
      actorUserId: input.actorUserId ?? null,
      payload: {
        seasonId: input.state.seasonId,
        proposalId: input.proposalId,
        ...(input.payload ?? {}),
      },
    }),
  ]
}
