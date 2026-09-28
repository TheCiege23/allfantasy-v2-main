/**
 * Orphan / empty team automated drafter: CPU (rules-based) or AI (optional API, fallback to CPU).
 * Commissioner chooses mode; all actions logged and auditable.
 */

import { prisma } from '@/lib/prisma'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from './orphanRosterResolver'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { computeCPUPick } from '@/lib/automated-drafter/CPUDrafterService'
import { computeAIDrafterPick, isAIDrafterProviderAvailable } from '@/lib/automated-drafter/AIDrafterService'
import { getRosterSlotLabelsForLeagueDraft } from '@/lib/draft-room'
import { buildDraftTradeAiReview, type DraftTradeAiReview } from '@/lib/live-draft-engine/DraftTradeAiReviewService'
import type { LeagueSport } from '@prisma/client'
import { getAssignmentForRoster, parseCommissionerAiManagers } from '@/lib/commissioner-ai-draft-manager'
import { mapAiStyleToCpuMode } from '@/lib/commissioner-ai-draft-manager/mapAiStyle'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type AiManagerAuditAction = 'draft_pick' | 'trade_accept' | 'trade_reject' | 'trade_counter' | 'trade_send'

export interface LogActionInput {
  leagueId: string
  rosterId: string
  action: AiManagerAuditAction
  payload: Record<string, unknown>
  reason: string | null
  triggeredBy: string | null
}

export async function logAction(input: LogActionInput): Promise<void> {
  await (prisma as any).aiManagerAuditLog.create({
    data: {
      leagueId: input.leagueId,
      rosterId: input.rosterId,
      action: input.action,
      payload: input.payload as any,
      reason: input.reason,
      triggeredBy: input.triggeredBy,
    },
  })
}

export interface ExecuteDraftPickForOrphanInput {
  leagueId: string
  triggeredByUserId: string | null
}

export interface ExecuteDraftPickForOrphanResult {
  success: boolean
  error?: string
  pick?: { playerName: string; position: string; overall: number; round: number; slot: number }
  reason?: string
  requestedMode?: 'cpu' | 'ai'
  executedMode?: 'cpu' | 'ai'
  aiProviderAvailable?: boolean
  usedFallback?: boolean
}

export type OrphanAiTradeDecision = 'accept' | 'reject' | 'counter'

export interface DeterministicOrphanTradeDecisionInput {
  giveRound: number
  giveSlot: number
  receiveRound: number
  receiveSlot: number
  teamCount: number
}

export interface DeterministicOrphanTradeDecisionResult {
  decision: OrphanAiTradeDecision
  action: 'trade_accept' | 'trade_reject' | 'trade_counter'
  reason: string
  review: DraftTradeAiReview
}

type StrategyProfile = {
  id: 'balanced' | 'value_hunter' | 'upside_chaser' | 'positional_anchor'
  label: string
  defaultMode: 'needs' | 'bpa'
  preferredPositions: string[]
}

const STRATEGY_PROFILES: StrategyProfile[] = [
  {
    id: 'balanced',
    label: 'Balanced Builder',
    defaultMode: 'needs',
    preferredPositions: ['RB', 'WR', 'QB', 'TE'],
  },
  {
    id: 'value_hunter',
    label: 'Value Hunter',
    defaultMode: 'bpa',
    preferredPositions: ['WR', 'RB', 'TE', 'QB'],
  },
  {
    id: 'upside_chaser',
    label: 'Upside Chaser',
    defaultMode: 'needs',
    preferredPositions: ['WR', 'QB', 'RB', 'TE'],
  },
  {
    id: 'positional_anchor',
    label: 'Positional Anchor',
    defaultMode: 'needs',
    preferredPositions: ['QB', 'TE', 'RB', 'WR'],
  },
]

function hashDeterministic(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  }
  return hash
}

function resolveStrategyProfile(rosterId: string, sport: string): StrategyProfile {
  const hash = hashDeterministic(`${rosterId}:${sport}`)
  return STRATEGY_PROFILES[hash % STRATEGY_PROFILES.length] ?? STRATEGY_PROFILES[0]
}

function scoreAvailablePlayerForProfile(
  player: { name: string; position: string; adp: number | null },
  profile: StrategyProfile
): number {
  const pos = String(player.position ?? '').toUpperCase()
  const prefIdx = profile.preferredPositions.findIndex((p) => p === pos)
  const positionScore = prefIdx >= 0 ? (profile.preferredPositions.length - prefIdx) * 28 : 0
  const adpScore = player.adp != null && Number.isFinite(player.adp) ? Math.max(0, 220 - player.adp) : 40
  return positionScore + adpScore
}

function buildDeterministicQueuePreview(
  available: Array<{ name: string; position: string; team: string | null; adp: number | null; byeWeek: number | null }>,
  profile: StrategyProfile
) {
  return [...available]
    .map((player, idx) => ({
      idx,
      player,
      score: scoreAvailablePlayerForProfile(player, profile),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.idx - b.idx
    })
    .slice(0, 8)
    .map((entry) => entry.player)
}

export function evaluateDeterministicTradeDecision(
  input: DeterministicOrphanTradeDecisionInput
): DeterministicOrphanTradeDecisionResult {
  const review = buildDraftTradeAiReview({
    giveRound: input.giveRound,
    giveSlot: input.giveSlot,
    receiveRound: input.receiveRound,
    receiveSlot: input.receiveSlot,
    teamCount: input.teamCount,
  })

  const decision = review.verdict as OrphanAiTradeDecision
  const action = decision === 'accept'
    ? 'trade_accept'
    : decision === 'counter'
      ? 'trade_counter'
      : 'trade_reject'
  const reason = review.summary || review.reasons[0] || 'Deterministic trade review completed.'

  return {
    decision,
    action,
    reason,
    review,
  }
}

/**
 * If current on-the-clock roster is orphan and AI manager is enabled, compute recommendation and submit pick. Log action.
 */
export async function executeDraftPickForOrphan(
  input: ExecuteDraftPickForOrphanInput
): Promise<ExecuteDraftPickForOrphanResult> {
  const { leagueId, triggeredByUserId } = input
  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  if (!uiSettings.orphanTeamAiManagerEnabled) {
    return { success: false, error: 'Orphan team AI manager is not enabled for this league.' }
  }

  const snapshot = await buildSessionSnapshot(leagueId)
  if (!snapshot || snapshot.status !== 'in_progress' || !snapshot.currentPick) {
    return { success: false, error: 'No draft in progress or no current pick.' }
  }

  const orphanRosterIds = await getOrphanRosterIdsForLeague(leagueId)
  const currentRosterId = snapshot.currentPick.rosterId
  if (!orphanRosterIds.includes(currentRosterId)) {
    return { success: false, error: 'Current pick is not an orphan roster. Only orphan rosters use the AI manager.' }
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, isDynasty: true },
  })
  if (!league) return { success: false, error: 'League not found.' }

  const draftedNames = new Set(snapshot.picks.map((p) => p.playerName))
  const sport = (league.sport as LeagueSport) ?? 'NFL'
  const pool = await getPlayerPoolForLeague(leagueId, sport, { limit: 500 })
  const available = pool
    .filter((p) => !draftedNames.has(p.full_name))
    .slice(0, 250)
    .map((p) => ({
      name: p.full_name,
      position: p.position ?? '',
      team: p.team_abbreviation ?? null,
      adp: null as number | null,
      byeWeek: null as number | null,
    }))

  if (available.length === 0) {
    return { success: false, error: 'No available players in pool for this pick.' }
  }

  const myPicks = snapshot.picks.filter((p) => p.rosterId === currentRosterId)
  const teamRoster = myPicks.map((p) => ({ position: p.position }))
  const rosterSlots = await getRosterSlotLabelsForLeagueDraft(leagueId, String(sport))

  const isSuperflex = (() => {
    const normalizedSlots = rosterSlots.map((slot) => String(slot || '').toUpperCase())
    return (
      normalizedSlots.includes('SUPER_FLEX') ||
      normalizedSlots.includes('SUPERFLEX') ||
      normalizedSlots.includes('OP') ||
      normalizedSlots.filter((slot) => slot === 'QB').length >= 2
    )
  })()

  const requestedMode = uiSettings.orphanDrafterMode ?? 'cpu'
  const aiProviderAvailable = isAIDrafterProviderAvailable()
  const shouldAttemptAIMode = requestedMode === 'ai' && aiProviderAvailable
  const strategyProfile = resolveStrategyProfile(currentRosterId, String(sport))
  const queuePreview = buildDeterministicQueuePreview(available, strategyProfile)

  const dsAi = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { commissionerAiManagers: true },
  })
  const commissionerBlob = parseCommissionerAiManagers((dsAi as { commissionerAiManagers?: unknown } | null)?.commissionerAiManagers)
  const commissionerAssign = getAssignmentForRoster(commissionerBlob, currentRosterId)
  const modeFromCommissioner = commissionerAssign ? mapAiStyleToCpuMode(commissionerAssign.aiStyle) : null

  const cpuInput = {
    available,
    teamRoster,
    rosterSlots,
    round: snapshot.currentPick.round,
    slot: snapshot.currentPick.slot,
    totalTeams: snapshot.teamCount,
    sport: String(sport),
    isDynasty: league.isDynasty ?? false,
    isSF: isSuperflex,
    mode: modeFromCommissioner ?? strategyProfile.defaultMode,
    // Deterministic strategy queue gives each orphan AI manager a stable "brain."
    queueFirst: queuePreview,
  }

  const pickResult = shouldAttemptAIMode
    ? await computeAIDrafterPick(cpuInput, { useAIProvider: true })
    : computeCPUPick(cpuInput)

  if (!pickResult) {
    return { success: false, error: 'Could not compute pick (no available players or recommendation).' }
  }
  const executedMode = pickResult.drafterMode === 'ai' ? 'ai' : 'cpu'
  const usedFallback = requestedMode === 'ai' && executedMode === 'cpu'

  const submitResult = await submitPick({
    leagueId,
    playerName: pickResult.player.name,
    position: pickResult.player.position,
    team: pickResult.player.team ?? null,
    rosterId: currentRosterId,
    source: 'auto',
  })

  if (!submitResult.success) {
    return { success: false, error: submitResult.error }
  }

  const reasonBits = [
    usedFallback
      ? aiProviderAvailable
        ? 'AI mode fell back to deterministic CPU execution for this pick.'
        : 'AI providers unavailable; deterministic CPU fallback executed.'
      : null,
    `${strategyProfile.label} profile.`,
    pickResult.reason,
    pickResult.narrative,
  ].filter(Boolean)
  const reason = reasonBits.join(' ').trim() || pickResult.reason
  await logAction({
    leagueId,
    rosterId: currentRosterId,
    action: 'draft_pick',
    payload: {
      playerName: pickResult.player.name,
      position: pickResult.player.position,
      team: pickResult.player.team,
      round: snapshot.currentPick.round,
      slot: snapshot.currentPick.slot,
      overall: snapshot.currentPick.overall,
      confidence: pickResult.confidence,
      requestedMode,
      drafterMode: executedMode,
      aiProviderAvailable,
      usedFallback,
      narrative: pickResult.narrative ?? undefined,
      strategyProfile: {
        id: strategyProfile.id,
        label: strategyProfile.label,
        defaultMode: strategyProfile.defaultMode,
        preferredPositions: strategyProfile.preferredPositions,
      },
      queuePreview: queuePreview.slice(0, 3).map((p) => ({
        name: p.name,
        position: p.position,
        team: p.team,
      })),
    },
    reason,
    triggeredBy: triggeredByUserId,
  })

  try {
    await appendPickToRosterDraftSnapshot(leagueId, currentRosterId, {
      playerName: pickResult.player.name,
      position: pickResult.player.position,
      team: pickResult.player.team ?? null,
      playerId: null,
      byeWeek: null,
    }).catch(() => {})
  } catch (_) {}

  return {
    success: true,
    pick: {
      playerName: pickResult.player.name,
      position: pickResult.player.position,
      overall: snapshot.currentPick.overall,
      round: snapshot.currentPick.round,
      slot: snapshot.currentPick.slot,
    },
    reason,
    requestedMode,
    executedMode,
    aiProviderAvailable,
    usedFallback,
  }
}

/**
 * Get recent AI manager audit entries for commissioner status.
 */
export async function getRecentAuditEntries(
  leagueId: string,
  options?: { limit?: number; rosterId?: string }
): Promise<Array<{ id: string; rosterId: string; action: string; payload: unknown; reason: string | null; triggeredBy: string | null; createdAt: Date }>> {
  const where: { leagueId: string; rosterId?: string } = { leagueId }
  if (options?.rosterId) where.rosterId = options.rosterId
  const rows = await (prisma as any).aiManagerAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 20,
    select: { id: true, rosterId: true, action: true, payload: true, reason: true, triggeredBy: true, createdAt: true },
  })
  return rows
}
