import type { CanonicalLeagueRules } from '@/lib/league-runtime/canonicalLeagueRules'
import type {
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime/leagueRuntimeEvents'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'

export type NflRedraftWaiverMode = 'faab' | 'rolling' | 'reverse_standings' | 'standard' | 'fcfs'
export type NflRedraftWaiverClaimStatus = 'pending' | 'approved' | 'denied' | 'cancelled'
export type NflRedraftWaiverResultType =
  | 'won'
  | 'failed'
  | 'cancelled'
  | 'free_agent_added'
  | 'conditional_group_satisfied'

export type NflRedraftWaiverSettings = {
  mode: NflRedraftWaiverMode
  faabEnabled: boolean
  faabBudget: number
  faabMinBid: number
  claimWindowOpen: boolean
  freeAgencyOpen: boolean
  continuous: boolean
  processingDays: number[]
  processingTimeUtc: string | null
  priorityBehavior: 'rolling' | 'static' | 'reverse_standings' | 'none'
  tiebreakRule: 'waiver_priority' | 'earliest_claim' | 'claim_id'
  instantFreeAgencyAfterClear: boolean
  activeRosterLimit: number
  lockAllMoves: boolean
}

export type NflRedraftWaiverPlayerInput = {
  playerId: string
  playerName: string
  position: string
  team?: string | null
  sport?: string | null
  slotType?: string | null
  isLocked?: boolean | null
  injuryStatus?: string | null
  droppedAt?: Date | string | null
  acquisitionType?: string | null
}

export type NflRedraftWaiverRosterInput = {
  rosterId: string
  displayName?: string | null
  ownerName?: string | null
  ownerId?: string | null
  faabBalance?: number | null
  waiverPriority?: number | null
  players: NflRedraftWaiverPlayerInput[]
  validationIssues?: Array<{ code: string; severity: string; message: string; playerId?: string | null }>
}

export type NflRedraftWaiverClaimInput = {
  claimId: string
  rosterId: string
  addPlayerId: string
  addPlayerName: string
  addPlayerPosition?: string | null
  addPlayerTeam?: string | null
  dropPlayerId?: string | null
  dropPlayerName?: string | null
  bidAmount?: number | null
  priority?: number | null
  conditionalGroupId?: string | null
  conditionalRank?: number | null
  status?: NflRedraftWaiverClaimStatus | string | null
  submittedAtIso?: string | null
  actorUserId?: string | null
}

export type NflRedraftWaiverTransactionInput = {
  transactionId: string
  rosterId: string
  type: string
  createdAtIso: string
  claimId?: string | null
  addPlayerId?: string | null
  addPlayerName?: string | null
  dropPlayerId?: string | null
  dropPlayerName?: string | null
  bidAmount?: number | null
  faabSpent?: number | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

export type NflRedraftWaiverTeamState = {
  rosterId: string
  displayName: string | null
  ownerName: string | null
  ownerId: string | null
  faabBalance: number
  waiverPriority: number
  activeRosterCount: number
  activeRosterLimit: number
  rosterFull: boolean
  players: NflRedraftWaiverPlayerInput[]
  lockedPlayerIds: string[]
  validationIssues: Array<{ code: string; severity: string; message: string; playerId?: string | null }>
}

export type NflRedraftWaiverClaimState = {
  claimId: string
  rosterId: string
  addPlayerId: string
  addPlayerName: string
  addPlayerPosition: string | null
  addPlayerTeam: string | null
  dropPlayerId: string | null
  dropPlayerName: string | null
  bidAmount: number
  priority: number
  waiverPriorityAtSubmit: number
  conditionalGroupId: string
  conditionalRank: number
  status: NflRedraftWaiverClaimStatus
  submittedAtIso: string
  actorUserId: string | null
}

export type NflRedraftWaiverTransactionState = {
  transactionId: string
  rosterId: string
  type: string
  createdAtIso: string
  claimId: string | null
  addPlayerId: string | null
  addPlayerName: string | null
  dropPlayerId: string | null
  dropPlayerName: string | null
  bidAmount: number | null
  faabSpent: number | null
  reason: string | null
  metadata: Record<string, unknown>
}

export type NflRedraftWaiverValidationResult =
  | { ok: true; warnings: string[] }
  | {
      ok: false
      code:
        | 'CLAIM_WINDOW_CLOSED'
        | 'DUPLICATE_PENDING_CLAIM'
        | 'FREE_AGENCY_CLOSED'
        | 'INSUFFICIENT_FAAB'
        | 'INVALID_DROP'
        | 'INVALID_FAAB_BID'
        | 'LOCKED_PLAYER'
        | 'MOVE_LOCKED'
        | 'PLAYER_ALREADY_ROSTERED'
        | 'PLAYER_UNAVAILABLE'
        | 'ROSTER_FULL'
        | 'ROSTER_NOT_FOUND'
      message: string
    }

export type NflRedraftWaiverProcessResult = {
  claimId: string
  rosterId: string
  resultType: NflRedraftWaiverResultType
  success: boolean
  addPlayerId: string
  addPlayerName: string
  dropPlayerId: string | null
  dropPlayerName: string | null
  bidAmount: number
  faabSpent: number
  priorityBefore: number
  priorityAfter: number
  faabBefore: number
  faabAfter: number
  reason: string | null
  transaction: NflRedraftWaiverTransactionState
}

export type NflRedraftWaiverProcessState = {
  results: NflRedraftWaiverProcessResult[]
  teams: NflRedraftWaiverTeamState[]
  events: CanonicalLeagueRuntimeEvent[]
}

export type NflRedraftFreeAgentAddInput = {
  rosterId: string
  addPlayerId: string
  addPlayerName: string
  addPlayerPosition?: string | null
  addPlayerTeam?: string | null
  dropPlayerId?: string | null
  dropPlayerName?: string | null
  actorUserId?: string | null
  commissionerOverride?: boolean
}

export type NflRedraftFreeAgentAddResult =
  | {
      ok: true
      result: NflRedraftWaiverProcessResult
      teams: NflRedraftWaiverTeamState[]
      events: CanonicalLeagueRuntimeEvent[]
    }
  | { ok: false; validation: NflRedraftWaiverValidationResult; events: CanonicalLeagueRuntimeEvent[] }

export type NflRedraftWaiverRuntimeState = {
  leagueId: string
  seasonId: string
  season: number
  week: number
  sport: 'NFL'
  generatedAtIso: string
  settings: NflRedraftWaiverSettings
  teams: NflRedraftWaiverTeamState[]
  priorityOrder: Array<{ rosterId: string; displayName: string | null; waiverPriority: number; faabBalance: number }>
  pendingClaims: NflRedraftWaiverClaimState[]
  transactions: NflRedraftWaiverTransactionState[]
  freeAgents: NflRedraftWaiverPlayerInput[]
  coverage: {
    rosterCount: number
    pendingClaims: number
    processedTransactions: number
    freeAgentCount: number
    faabTeams: number
    lockedPlayers: number
  }
}

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

function normalizeMode(value: unknown, faabEnabled: boolean): NflRedraftWaiverMode {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (raw.includes('faab') || faabEnabled) return 'faab'
  if (raw.includes('reverse')) return 'reverse_standings'
  if (raw.includes('fcfs') || raw.includes('free_agent')) return 'fcfs'
  if (raw.includes('standard')) return 'standard'
  return 'rolling'
}

function normalizeStatus(value: unknown): NflRedraftWaiverClaimStatus {
  const raw = String(value ?? 'pending').trim().toLowerCase()
  if (raw === 'approved' || raw === 'processed' || raw === 'won') return 'approved'
  if (raw === 'denied' || raw === 'failed' || raw === 'lost') return 'denied'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  return 'pending'
}

function iso(value: unknown, fallback: Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback.toISOString()
}

function activePlayers(players: NflRedraftWaiverPlayerInput[]): NflRedraftWaiverPlayerInput[] {
  return players.filter((player) => !player.droppedAt)
}

function claimGroupKey(claim: Pick<NflRedraftWaiverClaimInput, 'claimId' | 'conditionalGroupId'>): string {
  const explicit = String(claim.conditionalGroupId ?? '').trim()
  return explicit || `claim:${claim.claimId}`
}

function claimRank(value: unknown): number {
  const n = positiveInt(value, 1)
  return n > 0 ? n : 1
}

function normalizePriority(value: unknown, fallback: number): number {
  const n = positiveInt(value, fallback)
  return n > 0 ? n : fallback
}

function transactionId(prefix: string, id: string): string {
  return `${prefix}:${id}`
}

function normalizePlayer(input: NflRedraftWaiverPlayerInput): NflRedraftWaiverPlayerInput {
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

function toTeamState(input: {
  settings: NflRedraftWaiverSettings
  roster: NflRedraftWaiverRosterInput
}): NflRedraftWaiverTeamState {
  const players = activePlayers(input.roster.players.map(normalizePlayer))
  const waiverPriority = normalizePriority(input.roster.waiverPriority, 999)
  const faabBalance = Math.max(0, finiteNumber(input.roster.faabBalance, input.settings.faabBudget))
  return {
    rosterId: input.roster.rosterId,
    displayName: input.roster.displayName ?? null,
    ownerName: input.roster.ownerName ?? null,
    ownerId: input.roster.ownerId ?? null,
    faabBalance,
    waiverPriority,
    activeRosterCount: players.length,
    activeRosterLimit: input.settings.activeRosterLimit,
    rosterFull: players.length >= input.settings.activeRosterLimit,
    players,
    lockedPlayerIds: players.filter((player) => player.isLocked).map((player) => player.playerId),
    validationIssues: input.roster.validationIssues ?? [],
  }
}

function toClaimState(input: {
  claim: NflRedraftWaiverClaimInput
  teamById: Map<string, NflRedraftWaiverTeamState>
  now: Date
}): NflRedraftWaiverClaimState {
  const team = input.teamById.get(input.claim.rosterId)
  const priority = normalizePriority(input.claim.priority, 1)
  return {
    claimId: input.claim.claimId,
    rosterId: input.claim.rosterId,
    addPlayerId: input.claim.addPlayerId,
    addPlayerName: input.claim.addPlayerName || input.claim.addPlayerId,
    addPlayerPosition: input.claim.addPlayerPosition ?? null,
    addPlayerTeam: input.claim.addPlayerTeam ?? null,
    dropPlayerId: input.claim.dropPlayerId?.trim() || null,
    dropPlayerName: input.claim.dropPlayerName ?? null,
    bidAmount: Math.max(0, finiteNumber(input.claim.bidAmount, 0)),
    priority,
    waiverPriorityAtSubmit: team?.waiverPriority ?? normalizePriority(input.claim.priority, 999),
    conditionalGroupId: claimGroupKey(input.claim),
    conditionalRank: claimRank(input.claim.conditionalRank ?? input.claim.priority ?? 1),
    status: normalizeStatus(input.claim.status),
    submittedAtIso: iso(input.claim.submittedAtIso, input.now),
    actorUserId: input.claim.actorUserId ?? null,
  }
}

function toTransactionState(input: NflRedraftWaiverTransactionInput): NflRedraftWaiverTransactionState {
  return {
    transactionId: input.transactionId,
    rosterId: input.rosterId,
    type: input.type,
    createdAtIso: input.createdAtIso,
    claimId: input.claimId ?? null,
    addPlayerId: input.addPlayerId ?? null,
    addPlayerName: input.addPlayerName ?? null,
    dropPlayerId: input.dropPlayerId ?? null,
    dropPlayerName: input.dropPlayerName ?? null,
    bidAmount: input.bidAmount ?? null,
    faabSpent: input.faabSpent ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  }
}

export function resolveNflRedraftWaiverSettings(input: {
  rules: CanonicalLeagueRules
  now?: Date
  activeRosterLimit?: number | null
  claimWindowOpen?: boolean | null
  freeAgencyOpen?: boolean | null
}): NflRedraftWaiverSettings {
  const waivers = input.rules.waivers
  const faabEnabled = Boolean(waivers.faabEnabled || waivers.type?.toLowerCase().includes('faab'))
  const mode = normalizeMode(waivers.type, faabEnabled)
  const priorityText = String(waivers.priorityBehavior ?? '').toLowerCase()
  const priorityBehavior =
    mode === 'fcfs'
      ? 'none'
      : priorityText.includes('static')
        ? 'static'
        : priorityText.includes('reverse')
          ? 'reverse_standings'
          : 'rolling'
  const tiebreakText = String(waivers.tiebreakRule ?? '').toLowerCase()
  const tiebreakRule =
    tiebreakText.includes('earliest') || tiebreakText.includes('timestamp')
      ? 'earliest_claim'
      : tiebreakText.includes('claim_id')
        ? 'claim_id'
        : 'waiver_priority'
  const activeRosterLimit = positiveInt(input.activeRosterLimit, positiveInt(input.rules.roster.size, 0))

  return {
    mode,
    faabEnabled,
    faabBudget: positiveInt(waivers.faabBudget, 100),
    faabMinBid: positiveInt(waivers.faabMinBid, 0),
    claimWindowOpen: input.claimWindowOpen ?? !input.rules.roster.lockAllMoves,
    freeAgencyOpen:
      input.freeAgencyOpen ??
      ((mode === 'fcfs' || Boolean(waivers.instantFreeAgencyAfterClear)) && !input.rules.roster.lockAllMoves),
    continuous: Boolean(waivers.continuous),
    processingDays: waivers.processingDays ?? [],
    processingTimeUtc: waivers.processingTimeUtc ?? null,
    priorityBehavior,
    tiebreakRule,
    instantFreeAgencyAfterClear: Boolean(waivers.instantFreeAgencyAfterClear),
    activeRosterLimit,
    lockAllMoves: Boolean(input.rules.roster.lockAllMoves),
  }
}

export function buildNflRedraftWaiverRuntimeState(input: {
  leagueId: string
  seasonId: string
  season: number
  week: number
  rules: CanonicalLeagueRules
  rosters: NflRedraftWaiverRosterInput[]
  claims?: NflRedraftWaiverClaimInput[]
  transactions?: NflRedraftWaiverTransactionInput[]
  freeAgents?: NflRedraftWaiverPlayerInput[]
  now?: Date
  activeRosterLimit?: number | null
  claimWindowOpen?: boolean | null
  freeAgencyOpen?: boolean | null
}): NflRedraftWaiverRuntimeState {
  const now = input.now ?? new Date()
  const settings = resolveNflRedraftWaiverSettings({
    rules: input.rules,
    now,
    activeRosterLimit: input.activeRosterLimit,
    claimWindowOpen: input.claimWindowOpen,
    freeAgencyOpen: input.freeAgencyOpen,
  })
  const teams = input.rosters.map((roster) => toTeamState({ settings, roster }))
  const teamById = new Map(teams.map((team) => [team.rosterId, team]))
  const pendingClaims = (input.claims ?? [])
    .map((claim) => toClaimState({ claim, teamById, now }))
    .filter((claim) => claim.status === 'pending')
    .sort((a, b) => orderClaimStates(a, b, teamById, settings))
  const transactions = (input.transactions ?? []).map(toTransactionState).sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
  const freeAgents = (input.freeAgents ?? []).map(normalizePlayer)
  const priorityOrder = [...teams]
    .sort((a, b) => a.waiverPriority - b.waiverPriority || a.rosterId.localeCompare(b.rosterId))
    .map((team) => ({
      rosterId: team.rosterId,
      displayName: team.displayName,
      waiverPriority: team.waiverPriority,
      faabBalance: team.faabBalance,
    }))

  return {
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    season: input.season,
    week: input.week,
    sport: 'NFL',
    generatedAtIso: now.toISOString(),
    settings,
    teams,
    priorityOrder,
    pendingClaims,
    transactions,
    freeAgents,
    coverage: {
      rosterCount: teams.length,
      pendingClaims: pendingClaims.length,
      processedTransactions: transactions.length,
      freeAgentCount: freeAgents.length,
      faabTeams: teams.filter((team) => team.faabBalance > 0).length,
      lockedPlayers: teams.reduce((sum, team) => sum + team.lockedPlayerIds.length, 0),
    },
  }
}

function orderClaimStates(
  a: NflRedraftWaiverClaimState,
  b: NflRedraftWaiverClaimState,
  teamById: Map<string, NflRedraftWaiverTeamState>,
  settings: NflRedraftWaiverSettings,
): number {
  if (a.conditionalRank !== b.conditionalRank) return a.conditionalRank - b.conditionalRank
  if (settings.mode === 'faab') {
    if (a.bidAmount !== b.bidAmount) return b.bidAmount - a.bidAmount
  }
  if (settings.mode !== 'fcfs' && settings.tiebreakRule === 'waiver_priority') {
    const pa = teamById.get(a.rosterId)?.waiverPriority ?? a.waiverPriorityAtSubmit
    const pb = teamById.get(b.rosterId)?.waiverPriority ?? b.waiverPriorityAtSubmit
    if (pa !== pb) return pa - pb
  }
  const ta = Date.parse(a.submittedAtIso)
  const tb = Date.parse(b.submittedAtIso)
  if (settings.tiebreakRule !== 'claim_id' && ta !== tb) return ta - tb
  if (a.priority !== b.priority) return a.priority - b.priority
  return a.claimId.localeCompare(b.claimId)
}

function rosteredPlayerMap(teams: NflRedraftWaiverTeamState[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const team of teams) {
    for (const player of team.players) {
      map.set(player.playerId, team.rosterId)
    }
  }
  return map
}

function freeAgentMap(freeAgents: NflRedraftWaiverPlayerInput[]): Map<string, NflRedraftWaiverPlayerInput> {
  return new Map(freeAgents.map((player) => [player.playerId, player]))
}

export function validateNflRedraftWaiverClaim(input: {
  state: NflRedraftWaiverRuntimeState
  claim: NflRedraftWaiverClaimInput
  existingClaimId?: string | null
  requireClaimWindow?: boolean
  commissionerOverride?: boolean
  skipFaabValidation?: boolean
}): NflRedraftWaiverValidationResult {
  const settings = input.state.settings
  if (settings.lockAllMoves && !input.commissionerOverride) {
    return { ok: false, code: 'MOVE_LOCKED', message: 'Roster moves are locked by league settings.' }
  }
  if (input.requireClaimWindow !== false && !settings.claimWindowOpen && !input.commissionerOverride) {
    return { ok: false, code: 'CLAIM_WINDOW_CLOSED', message: 'Waiver claims are closed for this period.' }
  }
  const team = input.state.teams.find((row) => row.rosterId === input.claim.rosterId)
  if (!team) return { ok: false, code: 'ROSTER_NOT_FOUND', message: 'Roster not found for this season.' }

  const duplicate = input.state.pendingClaims.find(
    (claim) =>
      claim.claimId !== input.existingClaimId &&
      claim.rosterId === input.claim.rosterId &&
      claim.addPlayerId === input.claim.addPlayerId,
  )
  if (duplicate) {
    return { ok: false, code: 'DUPLICATE_PENDING_CLAIM', message: 'This roster already has a pending claim for that player.' }
  }

  const rosteredBy = rosteredPlayerMap(input.state.teams)
  const currentOwner = rosteredBy.get(input.claim.addPlayerId)
  if (currentOwner) {
    return {
      ok: false,
      code: 'PLAYER_ALREADY_ROSTERED',
      message: currentOwner === team.rosterId ? 'Player is already on this roster.' : 'Player is already rostered in this season.',
    }
  }
  if (input.state.freeAgents.length > 0 && !freeAgentMap(input.state.freeAgents).has(input.claim.addPlayerId)) {
    return { ok: false, code: 'PLAYER_UNAVAILABLE', message: 'Player is not available in the waiver pool.' }
  }

  const dropPlayerId = input.claim.dropPlayerId?.trim() || null
  const dropPlayer = dropPlayerId ? team.players.find((player) => player.playerId === dropPlayerId) : null
  if (dropPlayerId && !dropPlayer) {
    return { ok: false, code: 'INVALID_DROP', message: 'Drop player is not active on this roster.' }
  }
  if (dropPlayer?.isLocked && !input.commissionerOverride) {
    return { ok: false, code: 'LOCKED_PLAYER', message: 'Drop player is locked and cannot be moved.' }
  }
  if (team.activeRosterCount >= team.activeRosterLimit && !dropPlayerId) {
    return { ok: false, code: 'ROSTER_FULL', message: 'Roster is full; a drop is required.' }
  }

  const bid = finiteNumber(input.claim.bidAmount, 0)
  if (!input.skipFaabValidation && (settings.mode === 'faab' || settings.faabEnabled)) {
    if (!Number.isFinite(bid) || bid < 0 || Math.floor(bid) !== bid) {
      return { ok: false, code: 'INVALID_FAAB_BID', message: 'FAAB bid must be a non-negative whole number.' }
    }
    if (bid < settings.faabMinBid) {
      return { ok: false, code: 'INVALID_FAAB_BID', message: `Minimum FAAB bid is $${settings.faabMinBid}.` }
    }
    if (bid > team.faabBalance && !input.commissionerOverride) {
      return { ok: false, code: 'INSUFFICIENT_FAAB', message: 'Insufficient FAAB balance.' }
    }
  }

  return { ok: true, warnings: [] }
}

export function validateNflRedraftFreeAgentAdd(input: {
  state: NflRedraftWaiverRuntimeState
  add: NflRedraftFreeAgentAddInput
}): NflRedraftWaiverValidationResult {
  if (!input.state.settings.freeAgencyOpen && !input.add.commissionerOverride) {
    return { ok: false, code: 'FREE_AGENCY_CLOSED', message: 'Free agency is closed for this league state.' }
  }
  return validateNflRedraftWaiverClaim({
    state: input.state,
    claim: {
      claimId: `free-agent:${input.add.rosterId}:${input.add.addPlayerId}`,
      rosterId: input.add.rosterId,
      addPlayerId: input.add.addPlayerId,
      addPlayerName: input.add.addPlayerName,
      addPlayerPosition: input.add.addPlayerPosition,
      addPlayerTeam: input.add.addPlayerTeam,
      dropPlayerId: input.add.dropPlayerId,
      dropPlayerName: input.add.dropPlayerName,
      bidAmount: 0,
      status: 'pending',
    },
    requireClaimWindow: false,
    commissionerOverride: input.add.commissionerOverride,
    skipFaabValidation: true,
  })
}

function cloneTeams(teams: NflRedraftWaiverTeamState[]): NflRedraftWaiverTeamState[] {
  return teams.map((team) => ({
    ...team,
    players: team.players.map((player) => ({ ...player })),
    lockedPlayerIds: [...team.lockedPlayerIds],
    validationIssues: team.validationIssues.map((issue) => ({ ...issue })),
  }))
}

function maxPriority(teams: NflRedraftWaiverTeamState[]): number {
  return teams.reduce((max, team) => Math.max(max, team.waiverPriority), 0)
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

export function buildWaiverRuntimeEvent(input: {
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

function rebuildTeam(team: NflRedraftWaiverTeamState, settings: NflRedraftWaiverSettings): NflRedraftWaiverTeamState {
  return {
    ...team,
    activeRosterCount: team.players.length,
    rosterFull: team.players.length >= settings.activeRosterLimit,
    lockedPlayerIds: team.players.filter((player) => player.isLocked).map((player) => player.playerId),
  }
}

function applySuccessfulMove(input: {
  team: NflRedraftWaiverTeamState
  settings: NflRedraftWaiverSettings
  freeAgent?: NflRedraftWaiverPlayerInput | null
  addPlayerId: string
  addPlayerName: string
  addPlayerPosition?: string | null
  addPlayerTeam?: string | null
  dropPlayerId?: string | null
  acquisitionType: 'waiver' | 'free_agent'
}): { team: NflRedraftWaiverTeamState; dropped: NflRedraftWaiverPlayerInput | null; added: NflRedraftWaiverPlayerInput } {
  const dropPlayerId = input.dropPlayerId?.trim() || null
  const dropped = dropPlayerId ? input.team.players.find((player) => player.playerId === dropPlayerId) ?? null : null
  const retained = dropPlayerId ? input.team.players.filter((player) => player.playerId !== dropPlayerId) : [...input.team.players]
  const added = normalizePlayer({
    playerId: input.addPlayerId,
    playerName: input.freeAgent?.playerName ?? input.addPlayerName,
    position: input.freeAgent?.position ?? input.addPlayerPosition ?? 'UNK',
    team: input.freeAgent?.team ?? input.addPlayerTeam ?? null,
    sport: 'NFL',
    slotType: 'BENCH',
    acquisitionType: input.acquisitionType,
  })
  const team = rebuildTeam({ ...input.team, players: [...retained, added] }, input.settings)
  return { team, dropped, added }
}

function failedTransaction(input: {
  claim: NflRedraftWaiverClaimState
  resultType?: NflRedraftWaiverResultType
  reason: string
  nowIso: string
}): NflRedraftWaiverTransactionState {
  return {
    transactionId: transactionId('waiver-failed', input.claim.claimId),
    rosterId: input.claim.rosterId,
    type: input.resultType === 'conditional_group_satisfied' ? 'waiver_claim_conditional_skipped' : 'waiver_claim_failed',
    createdAtIso: input.nowIso,
    claimId: input.claim.claimId,
    addPlayerId: input.claim.addPlayerId,
    addPlayerName: input.claim.addPlayerName,
    dropPlayerId: input.claim.dropPlayerId,
    dropPlayerName: input.claim.dropPlayerName,
    bidAmount: input.claim.bidAmount,
    faabSpent: 0,
    reason: input.reason,
    metadata: { conditionalGroupId: input.claim.conditionalGroupId, conditionalRank: input.claim.conditionalRank },
  }
}

export function processNflRedraftWaiverClaims(input: {
  state: NflRedraftWaiverRuntimeState
  actorUserId?: string | null
  now?: Date
  commissionerOverride?: boolean
}): NflRedraftWaiverProcessState {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const settings = input.state.settings
  const teams = cloneTeams(input.state.teams)
  const teamById = new Map(teams.map((team) => [team.rosterId, team]))
  const freeAgents = freeAgentMap(input.state.freeAgents)
  const rosteredBy = rosteredPlayerMap(teams)
  const ordered = [...input.state.pendingClaims].sort((a, b) => orderClaimStates(a, b, teamById, settings))
  const satisfiedGroups = new Set<string>()
  const results: NflRedraftWaiverProcessResult[] = []
  const events: CanonicalLeagueRuntimeEvent[] = [
    event({
      leagueId: input.state.leagueId,
      type: 'waiver.processing.started',
      occurredAtIso: nowIso,
      actorUserId: input.actorUserId ?? null,
      payload: {
        seasonId: input.state.seasonId,
        week: input.state.week,
        pendingClaims: ordered.length,
      },
    }),
  ]

  for (const claim of ordered) {
    const currentTeam = teamById.get(claim.rosterId)
    if (!currentTeam) continue
    const priorityBefore = currentTeam.waiverPriority
    const faabBefore = currentTeam.faabBalance

    const pushFail = (reason: string, resultType: NflRedraftWaiverResultType = 'failed') => {
      const tx = failedTransaction({ claim, reason, resultType, nowIso })
      results.push({
        claimId: claim.claimId,
        rosterId: claim.rosterId,
        resultType,
        success: false,
        addPlayerId: claim.addPlayerId,
        addPlayerName: claim.addPlayerName,
        dropPlayerId: claim.dropPlayerId,
        dropPlayerName: claim.dropPlayerName,
        bidAmount: claim.bidAmount,
        faabSpent: 0,
        priorityBefore,
        priorityAfter: currentTeam.waiverPriority,
        faabBefore,
        faabAfter: currentTeam.faabBalance,
        reason,
        transaction: tx,
      })
      events.push(
        event({
          leagueId: input.state.leagueId,
          type: 'waiver.claim.failed',
          occurredAtIso: nowIso,
          actorUserId: claim.actorUserId ?? input.actorUserId ?? null,
          payload: { seasonId: input.state.seasonId, week: input.state.week, claimId: claim.claimId, rosterId: claim.rosterId, reason },
        }),
        event({
          leagueId: input.state.leagueId,
          type: 'waiver.transaction.recorded',
          occurredAtIso: nowIso,
          actorUserId: input.actorUserId ?? null,
          payload: { seasonId: input.state.seasonId, transactionId: tx.transactionId, type: tx.type },
        }),
      )
    }

    if (satisfiedGroups.has(claim.conditionalGroupId)) {
      pushFail('A higher-ranked conditional claim in this group already succeeded.', 'conditional_group_satisfied')
      continue
    }

    const validation = validateNflRedraftWaiverClaim({
      state: { ...input.state, teams, pendingClaims: [] },
      claim,
      requireClaimWindow: false,
      commissionerOverride: input.commissionerOverride,
    })
    if (!validation.ok) {
      pushFail(validation.message)
      continue
    }

    const owner = rosteredBy.get(claim.addPlayerId)
    if (owner) {
      pushFail(owner === claim.rosterId ? 'Player is already on this roster.' : 'Player is no longer available.')
      continue
    }

    const freeAgent = freeAgents.get(claim.addPlayerId)
    if (input.state.freeAgents.length > 0 && !freeAgent) {
      pushFail('Player is not available in the waiver pool.')
      continue
    }

    const bid = settings.mode === 'faab' || settings.faabEnabled ? claim.bidAmount : 0
    let priorityAfter = currentTeam.waiverPriority
    if (settings.priorityBehavior === 'rolling' && settings.mode !== 'faab') {
      priorityAfter = maxPriority(teams) + 1
    }
    const faabSpent = settings.mode === 'faab' || settings.faabEnabled ? Math.min(bid, currentTeam.faabBalance) : 0
    const faabAfter = Math.max(0, currentTeam.faabBalance - faabSpent)
    const applied = applySuccessfulMove({
      team: currentTeam,
      settings,
      freeAgent,
      addPlayerId: claim.addPlayerId,
      addPlayerName: claim.addPlayerName,
      addPlayerPosition: claim.addPlayerPosition,
      addPlayerTeam: claim.addPlayerTeam,
      dropPlayerId: claim.dropPlayerId,
      acquisitionType: 'waiver',
    })
    const nextTeam = rebuildTeam({ ...applied.team, faabBalance: faabAfter, waiverPriority: priorityAfter }, settings)
    const index = teams.findIndex((team) => team.rosterId === claim.rosterId)
    if (index >= 0) teams[index] = nextTeam
    teamById.set(claim.rosterId, nextTeam)
    rosteredBy.set(claim.addPlayerId, claim.rosterId)
    if (claim.dropPlayerId) rosteredBy.delete(claim.dropPlayerId)
    satisfiedGroups.add(claim.conditionalGroupId)

    const tx: NflRedraftWaiverTransactionState = {
      transactionId: transactionId('waiver-won', claim.claimId),
      rosterId: claim.rosterId,
      type: 'waiver_claim_approved',
      createdAtIso: nowIso,
      claimId: claim.claimId,
      addPlayerId: claim.addPlayerId,
      addPlayerName: applied.added.playerName,
      dropPlayerId: applied.dropped?.playerId ?? claim.dropPlayerId,
      dropPlayerName: applied.dropped?.playerName ?? claim.dropPlayerName,
      bidAmount: claim.bidAmount,
      faabSpent,
      reason: null,
      metadata: {
        conditionalGroupId: claim.conditionalGroupId,
        conditionalRank: claim.conditionalRank,
        priorityBefore,
        priorityAfter,
        faabBefore,
        faabAfter,
      },
    }
    results.push({
      claimId: claim.claimId,
      rosterId: claim.rosterId,
      resultType: 'won',
      success: true,
      addPlayerId: claim.addPlayerId,
      addPlayerName: applied.added.playerName,
      dropPlayerId: applied.dropped?.playerId ?? claim.dropPlayerId,
      dropPlayerName: applied.dropped?.playerName ?? claim.dropPlayerName,
      bidAmount: claim.bidAmount,
      faabSpent,
      priorityBefore,
      priorityAfter,
      faabBefore,
      faabAfter,
      reason: null,
      transaction: tx,
    })

    events.push(
      event({
        leagueId: input.state.leagueId,
        type: 'waiver.claim.won',
        occurredAtIso: nowIso,
        actorUserId: claim.actorUserId ?? input.actorUserId ?? null,
        payload: { seasonId: input.state.seasonId, week: input.state.week, claimId: claim.claimId, rosterId: claim.rosterId, addPlayerId: claim.addPlayerId },
      }),
      event({
        leagueId: input.state.leagueId,
        type: 'roster.player.added',
        occurredAtIso: nowIso,
        actorUserId: claim.actorUserId ?? input.actorUserId ?? null,
        payload: { seasonId: input.state.seasonId, rosterId: claim.rosterId, playerId: claim.addPlayerId, acquisitionType: 'waiver' },
      }),
      ...(applied.dropped
        ? [
            event({
              leagueId: input.state.leagueId,
              type: 'roster.player.dropped',
              occurredAtIso: nowIso,
              actorUserId: claim.actorUserId ?? input.actorUserId ?? null,
              payload: { seasonId: input.state.seasonId, rosterId: claim.rosterId, playerId: applied.dropped.playerId, transactionType: 'waiver' },
            }),
          ]
        : []),
      ...(faabSpent > 0
        ? [
            event({
              leagueId: input.state.leagueId,
              type: 'waiver.faab.deducted',
              occurredAtIso: nowIso,
              actorUserId: input.actorUserId ?? null,
              payload: { seasonId: input.state.seasonId, rosterId: claim.rosterId, claimId: claim.claimId, faabSpent, faabBefore, faabAfter },
            }),
          ]
        : []),
      ...(priorityAfter !== priorityBefore
        ? [
            event({
              leagueId: input.state.leagueId,
              type: 'waiver.priority.updated',
              occurredAtIso: nowIso,
              actorUserId: input.actorUserId ?? null,
              payload: { seasonId: input.state.seasonId, rosterId: claim.rosterId, priorityBefore, priorityAfter },
            }),
          ]
        : []),
      event({
        leagueId: input.state.leagueId,
        type: 'waiver.transaction.recorded',
        occurredAtIso: nowIso,
        actorUserId: input.actorUserId ?? null,
        payload: { seasonId: input.state.seasonId, transactionId: tx.transactionId, type: tx.type },
      }),
    )
  }

  events.push(
    event({
      leagueId: input.state.leagueId,
      type: 'waiver.processed',
      occurredAtIso: nowIso,
      actorUserId: input.actorUserId ?? null,
      payload: {
        seasonId: input.state.seasonId,
        week: input.state.week,
        processed: results.length,
        succeeded: results.filter((result) => result.success).length,
        failed: results.filter((result) => !result.success).length,
      },
    }),
  )

  return { results, teams, events }
}

export function applyNflRedraftFreeAgentAdd(input: {
  state: NflRedraftWaiverRuntimeState
  add: NflRedraftFreeAgentAddInput
  now?: Date
}): NflRedraftFreeAgentAddResult {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const validation = validateNflRedraftFreeAgentAdd({ state: input.state, add: input.add })
  const baseEvents: CanonicalLeagueRuntimeEvent[] = []
  if (!validation.ok) return { ok: false, validation, events: baseEvents }

  const teams = cloneTeams(input.state.teams)
  const team = teams.find((row) => row.rosterId === input.add.rosterId)
  if (!team) return { ok: false, validation: { ok: false, code: 'ROSTER_NOT_FOUND', message: 'Roster not found for this season.' }, events: baseEvents }
  const freeAgent = freeAgentMap(input.state.freeAgents).get(input.add.addPlayerId)
  const applied = applySuccessfulMove({
    team,
    settings: input.state.settings,
    freeAgent,
    addPlayerId: input.add.addPlayerId,
    addPlayerName: input.add.addPlayerName,
    addPlayerPosition: input.add.addPlayerPosition,
    addPlayerTeam: input.add.addPlayerTeam,
    dropPlayerId: input.add.dropPlayerId,
    acquisitionType: 'free_agent',
  })
  const index = teams.findIndex((row) => row.rosterId === input.add.rosterId)
  if (index >= 0) teams[index] = applied.team
  const transaction: NflRedraftWaiverTransactionState = {
    transactionId: transactionId('free-agent', `${input.add.rosterId}:${input.add.addPlayerId}`),
    rosterId: input.add.rosterId,
    type: 'free_agent_added',
    createdAtIso: nowIso,
    claimId: null,
    addPlayerId: input.add.addPlayerId,
    addPlayerName: applied.added.playerName,
    dropPlayerId: applied.dropped?.playerId ?? input.add.dropPlayerId ?? null,
    dropPlayerName: applied.dropped?.playerName ?? input.add.dropPlayerName ?? null,
    bidAmount: null,
    faabSpent: null,
    reason: null,
    metadata: { commissionerOverride: input.add.commissionerOverride === true },
  }
  const result: NflRedraftWaiverProcessResult = {
    claimId: transaction.transactionId,
    rosterId: input.add.rosterId,
    resultType: 'free_agent_added',
    success: true,
    addPlayerId: input.add.addPlayerId,
    addPlayerName: applied.added.playerName,
    dropPlayerId: transaction.dropPlayerId,
    dropPlayerName: transaction.dropPlayerName,
    bidAmount: 0,
    faabSpent: 0,
    priorityBefore: team.waiverPriority,
    priorityAfter: team.waiverPriority,
    faabBefore: team.faabBalance,
    faabAfter: team.faabBalance,
    reason: null,
    transaction,
  }
  const events = [
    event({
      leagueId: input.state.leagueId,
      type: 'waiver.free_agent.added',
      occurredAtIso: nowIso,
      actorUserId: input.add.actorUserId ?? null,
      payload: { seasonId: input.state.seasonId, rosterId: input.add.rosterId, addPlayerId: input.add.addPlayerId },
    }),
    event({
      leagueId: input.state.leagueId,
      type: 'roster.player.added',
      occurredAtIso: nowIso,
      actorUserId: input.add.actorUserId ?? null,
      payload: { seasonId: input.state.seasonId, rosterId: input.add.rosterId, playerId: input.add.addPlayerId, acquisitionType: 'free_agent' },
    }),
    ...(applied.dropped
      ? [
          event({
            leagueId: input.state.leagueId,
            type: 'roster.player.dropped',
            occurredAtIso: nowIso,
            actorUserId: input.add.actorUserId ?? null,
            payload: { seasonId: input.state.seasonId, rosterId: input.add.rosterId, playerId: applied.dropped.playerId, transactionType: 'free_agent' },
          }),
        ]
      : []),
    event({
      leagueId: input.state.leagueId,
      type: 'waiver.transaction.recorded',
      occurredAtIso: nowIso,
      actorUserId: input.add.actorUserId ?? null,
      payload: { seasonId: input.state.seasonId, transactionId: transaction.transactionId, type: transaction.type },
    }),
  ]
  return { ok: true, result, teams, events }
}
