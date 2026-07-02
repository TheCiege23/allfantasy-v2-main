import type {
  CanonicalLeagueRules,
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

export type DraftRuntimeStatus = 'pre_draft' | 'in_progress' | 'paused' | 'completed'
export type DraftRuntimeType = 'snake' | 'linear' | 'auction'
export type DraftRuntimePickSource =
  | 'user'
  | 'auto'
  | 'substitute_manager'
  | 'commissioner'
  | 'keeper'
  | 'import'

export type DraftRuntimeSlot = {
  slot: number
  rosterId: string
  displayName: string
  userId?: string | null
}

export type DraftRuntimePick = {
  overall: number
  round: number
  slot: number
  rosterId: string
  playerId?: string | null
  playerName: string
  position: string
  team?: string | null
  byeWeek?: number | null
  source?: DraftRuntimePickSource | string | null
  createdAtIso?: string | null
}

export type DraftRuntimeManagerState = {
  rosterId: string
  userId?: string | null
  displayName?: string | null
  connected: boolean
  autoPickEnabled?: boolean | null
  substituteManagerEnabled?: boolean | null
  queueCount?: number | null
  lastSeenAtIso?: string | null
}

export type DraftRuntimeQueueEntry = {
  playerId?: string | null
  playerName: string
  position: string
  rank: number
}

export type DraftRuntimePlayer = {
  playerId?: string | null
  name: string
  position: string
  team?: string | null
  rosterPosition?: string | null
  headshotUrl?: string | null
  teamLogoUrl?: string | null
  jerseyNumber?: number | null
  age?: number | null
  experience?: number | null
  byeWeek?: number | null
  injuryDesignation?: string | null
  projectedStatus?: string | null
  depthChart?: string | null
  historicalFinishes?: number[] | null
  previousSeasonStats?: Record<string, number | string | null> | null
  multiSeasonProduction?: Array<Record<string, number | string | null>> | null
  projection?: number | null
  adp?: number | null
  expertConsensusRank?: number | null
  newsCount?: number | null
  weatherContext?: string | null
  tier?: number | null
}

export type CanonicalDraftRuntimeSessionInput = {
  id: string
  leagueId: string
  status: DraftRuntimeStatus
  draftType: DraftRuntimeType
  rounds: number
  teamCount: number
  thirdRoundReversal?: boolean | null
  timerSeconds?: number | null
  timerEndAtIso?: string | null
  pausedRemainingSeconds?: number | null
  slotOrder: DraftRuntimeSlot[]
  picks: DraftRuntimePick[]
  scheduledAtIso?: string | null
  version?: number | null
  updatedAtIso?: string | null
}

export type DraftRuntimeClockState = {
  status: 'scheduled' | 'running' | 'paused' | 'expired' | 'complete' | 'none'
  timerSeconds: number | null
  timerEndAtIso: string | null
  remainingSeconds: number | null
}

export type DraftRuntimeCurrentPick = {
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string
}

export type CanonicalDraftRuntimeState = {
  leagueId: string
  draftId: string
  status: DraftRuntimeStatus
  draftType: DraftRuntimeType
  scheduledAtIso: string | null
  rounds: number
  teamCount: number
  totalPicks: number
  completedPickCount: number
  currentPick: DraftRuntimeCurrentPick | null
  clock: DraftRuntimeClockState
  slotOrder: DraftRuntimeSlot[]
  picks: DraftRuntimePick[]
  draftOrder: DraftRuntimeCurrentPick[]
  queueByRosterId: Record<string, DraftRuntimeQueueEntry[]>
  managerStates: DraftRuntimeManagerState[]
  disconnectedRosterIds: string[]
  offlineRosterIds: string[]
  runtimeInvariants: Array<{ code: string; severity: 'info' | 'warning' | 'blocking'; message: string }>
  rulesVersion: CanonicalLeagueRules['version']
}

export type DraftPickValidationInput = {
  rules: CanonicalLeagueRules
  state: CanonicalDraftRuntimeState
  rosterId: string
  player: DraftRuntimePlayer
  actorRole: 'manager' | 'commissioner' | 'system'
  source?: DraftRuntimePickSource
  entitledFeatures?: SubscriptionFeatureId[]
}

export type DraftPickValidationResult = {
  ok: boolean
  code:
    | 'OK'
    | 'DRAFT_NOT_LIVE'
    | 'NOT_ON_CLOCK'
    | 'PLAYER_UNAVAILABLE'
    | 'DUPLICATE_PLAYER'
    | 'ROSTER_FULL'
    | 'POSITION_NOT_ELIGIBLE'
    | 'PREMIUM_SUBSTITUTE_MANAGER_REQUIRED'
    | 'LEAGUE_RULE_MISMATCH'
  message: string
  evidence: string[]
}

export type SmartDraftRecommendation = {
  player: DraftRuntimePlayer
  explanation: string
  evidence: string[]
  confidence: number
  confidenceLabel: 'High' | 'Medium' | 'Low'
  risk: 'low' | 'medium' | 'high'
  alternatives: DraftRuntimePlayer[]
  rosterImpact: string
  positionalFit: string
  scoringFit: string
  valueLabel: 'value' | 'fair' | 'reach' | 'limited-evidence'
}

export type DraftFlowSignal = {
  kind: 'position_run' | 'tier_cliff' | 'value_pocket' | 'scarcity' | 'pace' | 'roster_imbalance'
  title: string
  detail: string
  evidence: string[]
  severity: 'info' | 'watch' | 'urgent'
}

export type SmartDraftRecommendationSet = {
  rosterId: string
  currentPick: DraftRuntimeCurrentPick | null
  recommendations: SmartDraftRecommendation[]
  flowSignals: DraftFlowSignal[]
  generatedAtIso: string
  insufficientEvidence: boolean
}

const FOOTBALL_BASE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE'])
const SUPERFLEX_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])
const SUBSTITUTE_MANAGER_FEATURE: SubscriptionFeatureId = 'commissioner_ai_tools'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizePosition(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toUpperCase()
  if (raw === 'DST' || raw === 'D/ST') return 'DEF'
  if (raw === 'SUPERFLEX') return 'SUPER_FLEX'
  return raw
}

function normalizePlayerKey(player: Pick<DraftRuntimePlayer, 'playerId' | 'name' | 'position'>): string {
  const id = String(player.playerId ?? '').trim().toLowerCase()
  if (id) return `id:${id}`
  return `name:${player.name.trim().toLowerCase()}|${normalizePosition(player.position).toLowerCase()}`
}

function confidenceLabel(confidence: number): SmartDraftRecommendation['confidenceLabel'] {
  if (confidence >= 80) return 'High'
  if (confidence >= 55) return 'Medium'
  return 'Low'
}

function getSlotForRound(round: number, pickInRound: number, teamCount: number, type: DraftRuntimeType, thirdRoundReversal: boolean): number {
  if (type === 'linear' || type === 'auction') return pickInRound
  if (thirdRoundReversal && round >= 3) {
    return round % 2 === 1 ? teamCount - pickInRound + 1 : pickInRound
  }
  return round % 2 === 0 ? teamCount - pickInRound + 1 : pickInRound
}

export function getDraftOrderEntry(input: {
  overall: number
  teamCount: number
  draftType: DraftRuntimeType
  thirdRoundReversal?: boolean | null
  slotOrder: DraftRuntimeSlot[]
}): DraftRuntimeCurrentPick {
  const round = Math.ceil(input.overall / input.teamCount)
  const pickInRound = ((input.overall - 1) % input.teamCount) + 1
  const slot = getSlotForRound(
    round,
    pickInRound,
    input.teamCount,
    input.draftType,
    Boolean(input.thirdRoundReversal),
  )
  const slotEntry = input.slotOrder.find((entry) => entry.slot === slot)
  return {
    overall: input.overall,
    round,
    slot,
    rosterId: slotEntry?.rosterId ?? `slot-${slot}`,
    displayName: slotEntry?.displayName ?? `Team ${slot}`,
  }
}

function buildDraftOrder(session: CanonicalDraftRuntimeSessionInput): DraftRuntimeCurrentPick[] {
  const totalPicks = Math.max(0, session.rounds * session.teamCount)
  return Array.from({ length: totalPicks }, (_, index) =>
    getDraftOrderEntry({
      overall: index + 1,
      teamCount: session.teamCount,
      draftType: session.draftType,
      thirdRoundReversal: session.thirdRoundReversal,
      slotOrder: session.slotOrder,
    }),
  )
}

function buildClock(session: CanonicalDraftRuntimeSessionInput, now: Date): DraftRuntimeClockState {
  if (session.status === 'completed') {
    return { status: 'complete', timerSeconds: session.timerSeconds ?? null, timerEndAtIso: null, remainingSeconds: null }
  }
  if (session.status === 'pre_draft') {
    return {
      status: session.scheduledAtIso ? 'scheduled' : 'none',
      timerSeconds: session.timerSeconds ?? null,
      timerEndAtIso: session.timerEndAtIso ?? null,
      remainingSeconds: null,
    }
  }
  if (session.status === 'paused') {
    return {
      status: 'paused',
      timerSeconds: session.timerSeconds ?? null,
      timerEndAtIso: null,
      remainingSeconds: session.pausedRemainingSeconds ?? null,
    }
  }
  if (!session.timerEndAtIso) {
    return { status: 'none', timerSeconds: session.timerSeconds ?? null, timerEndAtIso: null, remainingSeconds: null }
  }
  const parsed = new Date(session.timerEndAtIso)
  const remainingSeconds = Number.isNaN(parsed.getTime())
    ? null
    : Math.max(0, Math.ceil((parsed.getTime() - now.getTime()) / 1000))
  return {
    status: remainingSeconds === 0 ? 'expired' : 'running',
    timerSeconds: session.timerSeconds ?? null,
    timerEndAtIso: session.timerEndAtIso,
    remainingSeconds,
  }
}

function allowedPositionsFromRules(rules: CanonicalLeagueRules): Set<string> {
  const starters = Array.isArray(rules.roster.starters) ? rules.roster.starters.map(String) : []
  const allowed = new Set<string>()
  for (const raw of starters) {
    const slot = normalizePosition(raw)
    if (FOOTBALL_BASE_POSITIONS.includes(slot)) allowed.add(slot)
    if (slot === 'FLEX') for (const pos of FLEX_POSITIONS) allowed.add(pos)
    if (slot === 'SUPER_FLEX' || slot === 'OP') for (const pos of SUPERFLEX_POSITIONS) allowed.add(pos)
  }
  if (allowed.size === 0) {
    for (const pos of FOOTBALL_BASE_POSITIONS) allowed.add(pos)
  }
  return allowed
}

function countRosterPositions(picks: DraftRuntimePick[], rosterId: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const pick of picks) {
    if (pick.rosterId !== rosterId) continue
    const pos = normalizePosition(pick.position)
    counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}

function starterTargets(rules: CanonicalLeagueRules): Record<string, number> {
  const targets: Record<string, number> = {}
  const starters = Array.isArray(rules.roster.starters) ? rules.roster.starters.map(String) : []
  for (const raw of starters) {
    const slot = normalizePosition(raw)
    if (FOOTBALL_BASE_POSITIONS.includes(slot)) targets[slot] = (targets[slot] ?? 0) + 1
    if (slot === 'FLEX') {
      targets.RB = Math.max(targets.RB ?? 0, 2)
      targets.WR = Math.max(targets.WR ?? 0, 2)
      targets.TE = Math.max(targets.TE ?? 0, 1)
    }
    if (slot === 'SUPER_FLEX' || slot === 'OP') {
      targets.QB = Math.max(targets.QB ?? 0, 1)
    }
  }
  if (Object.keys(targets).length === 0) return { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 }
  return targets
}

export function buildCanonicalDraftRuntimeState(input: {
  rules: CanonicalLeagueRules
  session: CanonicalDraftRuntimeSessionInput
  managerStates?: DraftRuntimeManagerState[]
  queueByRosterId?: Record<string, DraftRuntimeQueueEntry[]>
  now?: Date
}): CanonicalDraftRuntimeState {
  const now = input.now ?? new Date()
  const { rules, session } = input
  const totalPicks = Math.max(0, session.rounds * session.teamCount)
  const completedPicks = session.picks.filter((pick) => pick.playerName.trim() && pick.position.trim())
  const draftOrder = buildDraftOrder(session)
  const nextOverall = completedPicks.length + 1
  const currentPick =
    session.status === 'completed' || nextOverall > totalPicks
      ? null
      : draftOrder[nextOverall - 1] ?? null
  const disconnectedRosterIds = (input.managerStates ?? [])
    .filter((manager) => manager.connected === false)
    .map((manager) => manager.rosterId)
  const offlineRosterIds = (input.managerStates ?? [])
    .filter((manager) => manager.connected === false && manager.lastSeenAtIso == null)
    .map((manager) => manager.rosterId)
  const runtimeInvariants: CanonicalDraftRuntimeState['runtimeInvariants'] = []

  if (rules.general.teamCount != null && rules.general.teamCount !== session.teamCount) {
    runtimeInvariants.push({
      code: 'TEAM_COUNT_MISMATCH',
      severity: 'blocking',
      message: `Session team count ${session.teamCount} differs from canonical rules ${rules.general.teamCount}.`,
    })
  }
  if (rules.draft.rounds != null && rules.draft.rounds !== session.rounds) {
    runtimeInvariants.push({
      code: 'ROUND_COUNT_MISMATCH',
      severity: 'blocking',
      message: `Session rounds ${session.rounds} differ from canonical rules ${rules.draft.rounds}.`,
    })
  }
  if (rules.draft.type !== session.draftType) {
    runtimeInvariants.push({
      code: 'DRAFT_TYPE_MISMATCH',
      severity: 'warning',
      message: `Session draft type ${session.draftType} differs from canonical rules ${rules.draft.type}.`,
    })
  }
  if (session.slotOrder.length !== session.teamCount) {
    runtimeInvariants.push({
      code: 'DRAFT_ORDER_INCOMPLETE',
      severity: 'blocking',
      message: 'Draft order does not include every team slot.',
    })
  }
  if (disconnectedRosterIds.length > 0) {
    runtimeInvariants.push({
      code: 'MANAGERS_DISCONNECTED',
      severity: 'warning',
      message: `${disconnectedRosterIds.length} manager slot(s) are disconnected.`,
    })
  }

  return {
    leagueId: session.leagueId,
    draftId: session.id,
    status: session.status,
    draftType: session.draftType,
    scheduledAtIso: session.scheduledAtIso ?? rules.draft.scheduledAtIso,
    rounds: session.rounds,
    teamCount: session.teamCount,
    totalPicks,
    completedPickCount: completedPicks.length,
    currentPick,
    clock: buildClock(session, now),
    slotOrder: session.slotOrder,
    picks: completedPicks,
    draftOrder,
    queueByRosterId: input.queueByRosterId ?? {},
    managerStates: input.managerStates ?? [],
    disconnectedRosterIds,
    offlineRosterIds,
    runtimeInvariants,
    rulesVersion: rules.version,
  }
}

export function validateCanonicalDraftPick(input: DraftPickValidationInput): DraftPickValidationResult {
  const { rules, state, rosterId, player } = input
  const evidence: string[] = [
    `Draft status: ${state.status}.`,
    `Canonical rules version: ${rules.version}.`,
  ]
  if (state.status !== 'in_progress') {
    return { ok: false, code: 'DRAFT_NOT_LIVE', message: 'Draft is not accepting picks.', evidence }
  }
  if (!state.currentPick) {
    return { ok: false, code: 'DRAFT_NOT_LIVE', message: 'No active pick is on the clock.', evidence }
  }
  if (state.runtimeInvariants.some((item) => item.severity === 'blocking')) {
    return {
      ok: false,
      code: 'LEAGUE_RULE_MISMATCH',
      message: 'Draft runtime has blocking rule mismatches.',
      evidence: [...evidence, ...state.runtimeInvariants.map((item) => item.message)],
    }
  }
  if (input.actorRole !== 'commissioner' && rosterId !== state.currentPick.rosterId) {
    return {
      ok: false,
      code: 'NOT_ON_CLOCK',
      message: 'Roster is not on the clock.',
      evidence: [...evidence, `On clock roster: ${state.currentPick.rosterId}.`],
    }
  }
  if (input.source === 'substitute_manager' && !(input.entitledFeatures ?? []).includes(SUBSTITUTE_MANAGER_FEATURE)) {
    return {
      ok: false,
      code: 'PREMIUM_SUBSTITUTE_MANAGER_REQUIRED',
      message: 'Commissioner Intelligence is required for substitute manager picks.',
      evidence,
    }
  }
  const playerKey = normalizePlayerKey(player)
  if (!player.name.trim() || !normalizePosition(player.position)) {
    return { ok: false, code: 'PLAYER_UNAVAILABLE', message: 'Player is missing required draft metadata.', evidence }
  }
  const duplicate = state.picks.some((pick) =>
    normalizePlayerKey({ playerId: pick.playerId, name: pick.playerName, position: pick.position }) === playerKey,
  )
  if (duplicate) {
    return { ok: false, code: 'DUPLICATE_PLAYER', message: 'Player has already been drafted.', evidence }
  }
  const rosterPickCount = state.picks.filter((pick) => pick.rosterId === rosterId).length
  if (rules.roster.size != null && rosterPickCount >= rules.roster.size) {
    return {
      ok: false,
      code: 'ROSTER_FULL',
      message: 'Roster is already at canonical draft capacity.',
      evidence: [...evidence, `Roster picks: ${rosterPickCount}/${rules.roster.size}.`],
    }
  }
  const allowedPositions = allowedPositionsFromRules(rules)
  const position = normalizePosition(player.position)
  if (!allowedPositions.has(position)) {
    return {
      ok: false,
      code: 'POSITION_NOT_ELIGIBLE',
      message: `${position} is not eligible for this league draft.`,
      evidence: [...evidence, `Eligible positions: ${Array.from(allowedPositions).join(', ')}.`],
    }
  }
  return {
    ok: true,
    code: 'OK',
    message: 'Pick satisfies canonical draft rules.',
    evidence: [
      ...evidence,
      `On clock roster: ${state.currentPick.rosterId}.`,
      `Roster picks: ${rosterPickCount}${rules.roster.size ? `/${rules.roster.size}` : ''}.`,
      `Eligible position: ${position}.`,
    ],
  }
}

function computeNeedScore(rules: CanonicalLeagueRules, state: CanonicalDraftRuntimeState, rosterId: string, position: string): number {
  const targets = starterTargets(rules)
  const counts = countRosterPositions(state.picks, rosterId)
  const pos = normalizePosition(position)
  const target = targets[pos] ?? 1
  const current = counts[pos] ?? 0
  if (current < target) return clamp(88 + (target - current) * 6, 0, 100)
  const rosterSize = rules.roster.size ?? state.rounds
  const depthTarget = pos === 'RB' || pos === 'WR' ? Math.max(target + 2, Math.ceil(rosterSize * 0.25)) : target + 1
  if (current < depthTarget) return clamp(52 + (depthTarget - current) * 8, 0, 100)
  return 22
}

function valueLabel(player: DraftRuntimePlayer, overall: number): SmartDraftRecommendation['valueLabel'] {
  if (player.adp == null && player.expertConsensusRank == null) return 'limited-evidence'
  const market = player.adp ?? player.expertConsensusRank ?? overall
  if (market <= overall - 2) return 'value'
  if (market > overall + 8) return 'reach'
  return 'fair'
}

function riskForPlayer(player: DraftRuntimePlayer, label: SmartDraftRecommendation['valueLabel']): SmartDraftRecommendation['risk'] {
  const injury = String(player.injuryDesignation ?? player.projectedStatus ?? '').toLowerCase()
  if (injury && !['healthy', 'active', ''].includes(injury)) return 'high'
  if (label === 'reach' || label === 'limited-evidence') return 'medium'
  return 'low'
}

function scorePlayer(input: {
  rules: CanonicalLeagueRules
  state: CanonicalDraftRuntimeState
  rosterId: string
  player: DraftRuntimePlayer
  availablePlayers: DraftRuntimePlayer[]
}): { score: number; evidence: string[]; label: SmartDraftRecommendation['valueLabel']; confidence: number } {
  const { rules, state, rosterId, player, availablePlayers } = input
  const overall = state.currentPick?.overall ?? state.completedPickCount + 1
  const position = normalizePosition(player.position)
  const needScore = computeNeedScore(rules, state, rosterId, position)
  const market = player.adp ?? player.expertConsensusRank ?? null
  const marketEdge = market == null ? 0 : clamp((overall - market) * 2, -24, 30)
  const samePositionRemaining = availablePlayers.filter((candidate) => normalizePosition(candidate.position) === position).length
  const scarcityScore = samePositionRemaining <= 2 ? 24 : samePositionRemaining <= Math.max(4, state.teamCount / 2) ? 12 : 0
  const projectionScore = player.projection != null ? clamp(Number(player.projection), 0, 40) : 0
  const injuryPenalty = riskForPlayer(player, valueLabel(player, overall)) === 'high' ? 22 : 0
  const score = clamp(needScore * 0.42 + marketEdge + scarcityScore + projectionScore * 0.35 - injuryPenalty, 0, 100)
  const evidence = [
    `Need score (${position}): ${needScore}/100.`,
    market == null ? 'Market rank: unavailable.' : `Market rank: ${Math.round(market)} vs pick ${overall}.`,
    `Position supply: ${samePositionRemaining} ${position} players in available pool.`,
  ]
  if (player.projection != null) evidence.push(`Projection provided by provider data: ${player.projection}.`)
  if (player.injuryDesignation) evidence.push(`Injury designation: ${player.injuryDesignation}.`)
  const confidenceBase = 48 + (market != null ? 14 : 0) + (player.projection != null ? 10 : 0) + (player.team ? 6 : 0)
  return { score, evidence, label: valueLabel(player, overall), confidence: clamp(confidenceBase + score * 0.22, 35, 92) }
}

export function buildSmartDraftRecommendations(input: {
  rules: CanonicalLeagueRules
  state: CanonicalDraftRuntimeState
  availablePlayers: DraftRuntimePlayer[]
  rosterId: string
  generatedAt?: Date
}): SmartDraftRecommendationSet {
  const generatedAtIso = (input.generatedAt ?? new Date()).toISOString()
  const allowedPositions = allowedPositionsFromRules(input.rules)
  const draftedKeys = new Set(
    input.state.picks.map((pick) =>
      normalizePlayerKey({ playerId: pick.playerId, name: pick.playerName, position: pick.position }),
    ),
  )
  const available = input.availablePlayers.filter((player) => {
    if (!player.name.trim()) return false
    if (!allowedPositions.has(normalizePosition(player.position))) return false
    return !draftedKeys.has(normalizePlayerKey(player))
  })

  const scored = available
    .map((player) => ({ player, ...scorePlayer({ ...input, player, availablePlayers: available }) }))
    .sort((a, b) => b.score - a.score || (a.player.adp ?? 9999) - (b.player.adp ?? 9999) || a.player.name.localeCompare(b.player.name))

  const recommendations = scored.slice(0, 3).map((row): SmartDraftRecommendation => {
    const position = normalizePosition(row.player.position)
    const alternatives = scored
      .filter((candidate) => candidate.player !== row.player)
      .slice(0, 3)
      .map((candidate) => candidate.player)
    const risk = riskForPlayer(row.player, row.label)
    return {
      player: row.player,
      explanation: `${row.player.name} is the strongest Smart Recommendation for this pick based on roster need, market value, and remaining ${position} supply.`,
      evidence: row.evidence,
      confidence: row.confidence,
      confidenceLabel: confidenceLabel(row.confidence),
      risk,
      alternatives,
      rosterImpact:
        row.score >= 75
          ? `Improves a priority ${position} slot for this roster build.`
          : `Adds ${position} depth without forcing an unsupported roster claim.`,
      positionalFit: `${position} fit score is ${computeNeedScore(input.rules, input.state, input.rosterId, position)}/100.`,
      scoringFit: input.rules.scoring.templateId
        ? `Evaluated against ${input.rules.scoring.templateId} scoring.`
        : 'Scoring template was unavailable; fit uses roster and market evidence only.',
      valueLabel: row.label,
    }
  })

  return {
    rosterId: input.rosterId,
    currentPick: input.state.currentPick,
    recommendations,
    flowSignals: detectDraftFlowSignals(input.rules, input.state, available),
    generatedAtIso,
    insufficientEvidence: recommendations.length === 0,
  }
}

export function detectDraftFlowSignals(
  rules: CanonicalLeagueRules,
  state: CanonicalDraftRuntimeState,
  availablePlayers: DraftRuntimePlayer[],
): DraftFlowSignal[] {
  const signals: DraftFlowSignal[] = []
  const recent = state.picks.slice(-Math.max(6, Math.min(12, state.teamCount)))
  const recentByPosition = recent.reduce<Record<string, number>>((acc, pick) => {
    const pos = normalizePosition(pick.position)
    acc[pos] = (acc[pos] ?? 0) + 1
    return acc
  }, {})
  for (const [position, count] of Object.entries(recentByPosition)) {
    const runThreshold = Math.min(4, Math.max(3, Math.ceil(recent.length * 0.6)))
    if (count >= runThreshold) {
      signals.push({
        kind: 'position_run',
        title: `${position} run detected`,
        detail: `${count} of the last ${recent.length} picks were ${position}.`,
        evidence: recent.filter((pick) => normalizePosition(pick.position) === position).map((pick) => `${pick.playerName} at ${pick.overall}`),
        severity: count >= runThreshold + 1 ? 'urgent' : 'watch',
      })
    }
  }
  const byPositionSupply = availablePlayers.reduce<Record<string, number>>((acc, player) => {
    const pos = normalizePosition(player.position)
    acc[pos] = (acc[pos] ?? 0) + 1
    return acc
  }, {})
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const supply = byPositionSupply[pos] ?? 0
    if (supply > 0 && supply <= 2) {
      signals.push({
        kind: 'scarcity',
        title: `${pos} scarcity`,
        detail: `Only ${supply} eligible ${pos} option(s) remain in the available pool.`,
        evidence: [`Canonical roster size: ${rules.roster.size ?? 'unknown'}`, `Available ${pos}: ${supply}`],
        severity: 'watch',
      })
    }
  }
  const topByAdp = availablePlayers
    .filter((player) => player.adp != null)
    .sort((a, b) => Number(a.adp) - Number(b.adp))
    .slice(0, 8)
  if (topByAdp.length >= 5 && Number(topByAdp[4].adp) - Number(topByAdp[0].adp) >= 18) {
    signals.push({
      kind: 'tier_cliff',
      title: 'Tier cliff nearby',
      detail: 'The top market-ranked cluster separates sharply from the next group.',
      evidence: topByAdp.slice(0, 5).map((player) => `${player.name}: ADP ${player.adp}`),
      severity: 'watch',
    })
  }
  if (state.clock.status === 'expired') {
    signals.push({
      kind: 'pace',
      title: 'Draft clock expired',
      detail: 'The current pick timer is expired and may require auto-pick or commissioner action.',
      evidence: [`On clock: ${state.currentPick?.displayName ?? 'unknown'}`],
      severity: 'urgent',
    })
  }
  return signals
}

export function buildDraftRuntimeEvent(input: {
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
