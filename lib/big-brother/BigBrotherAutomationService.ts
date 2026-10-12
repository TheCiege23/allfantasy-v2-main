import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getCurrentCycleForLeague, transitionPhase } from './BigBrotherPhaseStateMachine'
import { runAutoNomination, runAutoReplacementNominee } from './BigBrotherNominationEnforcement'
import { selectVetoCompetitors, setVetoWinner } from './BigBrotherVetoEngine'
import { getEligibleHOHRosterIds, assignHOH } from './BigBrotherHOHEngine'
import { resolveHOHWinner, resolveVetoWinner } from './BigBrotherChallengeEngine'
import { getBigBrotherWeeklyScores } from './BigBrotherScores'
import { announceHOHWinner, announceVetoDraw } from './BigBrotherChatAnnouncements'
import { closeEviction } from './BigBrotherEvictionService'
import { isFinaleReached } from './BigBrotherFinaleService'
import type { BigBrotherWeekPhase } from './types'

export interface AutomationRunInput {
  leagueId: string
  action?: 'tick' | 'close_eviction' | 'auto_nominate' | 'veto_draw' | 'veto_decision_timeout' | 'auto_replacement' | 'lock_voting' | 'auto_hoh' | 'auto_veto'
  systemUserId?: string | null
  now?: Date
}
export interface AutomationRunResult { ok: boolean; cycleId?: string; phase?: string; actionTaken?: string; error?: string }

/** One safe operation per call. The sweep decides when configured deadlines are due. */
export async function runAutomation(input: AutomationRunInput): Promise<AutomationRunResult> {
  const { leagueId, systemUserId } = input
  const now = input.now ?? new Date()
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Big Brother league' }
  if (config.weekProgressionPaused) return { ok: true, actionTaken: 'skipped_paused' }
  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return { ok: false, error: 'No current cycle' }
  const phase = current.phase as BigBrotherWeekPhase
  let action = input.action ?? 'tick'
  const changed = async (to: BigBrotherWeekPhase) => {
    const result = await transitionPhase(current.id, to, { automation: true })
    if (!result.ok) throw new Error(result.error)
    return { ok: true, cycleId: current.id, phase: to, actionTaken: `advance_${to.toLowerCase()}` }
  }
  const skipped = (reason: string): AutomationRunResult => ({ ok: true, cycleId: current.id, phase, actionTaken: `skipped_${reason}` })
  if (action === 'tick') {
    if (phase === 'HOH_LOCKED') return changed('NOMINATION_OPEN')
    if (phase === 'NOMINATION_LOCKED') return changed('VETO_DRAW')
    if (phase === 'VETO_CHALLENGE_OPEN') action = 'auto_veto'
    else if (phase === 'VOTING_LOCKED') action = 'close_eviction'
    else if (['EVICTION_RESOLVED', 'JURY_UPDATE', 'RESET_NEXT_WEEK'].includes(phase)) {
      if (await isFinaleReached(leagueId)) return skipped('finale_ready')
      if (phase === 'EVICTION_RESOLVED') return changed('JURY_UPDATE')
      if (phase === 'JURY_UPDATE') return changed('RESET_NEXT_WEEK')
      // Preserve the weekly anchor when catching up after a delayed sweep.
      const start = new Date(current.createdAt)
      start.setUTCDate(start.getUTCDate() + 7)
      if (start > now) return skipped('next_week_not_started')
      const next = await prisma.bigBrotherCycle.upsert({
        where: { configId_week: { configId: config.configId, week: current.week + 1 } },
        create: { leagueId, configId: config.configId, week: current.week + 1, phase: 'HOH_OPEN', createdAt: start }, update: {},
      })
      return { ok: true, cycleId: next.id, phase: next.phase, actionTaken: 'next_week' }
    } else return skipped('waiting_for_deadline')
  }
  if (action === 'auto_hoh' || action === 'auto_veto') {
    const isHoh = action === 'auto_hoh'
    if (phase !== (isHoh ? 'HOH_OPEN' : 'VETO_CHALLENGE_OPEN')) return { ok: false, error: 'Challenge is not open' }
    const cycle = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { vetoParticipantRosterIds: true } })
    const participants = isHoh
      ? await getEligibleHOHRosterIds(leagueId, config.configId, current.week, config.consecutiveHohAllowed)
      : Array.isArray(cycle?.vetoParticipantRosterIds) ? cycle.vetoParticipantRosterIds.filter((id): id is string => typeof id === 'string') : []
    if (!participants.length) return { ok: false, error: 'No eligible challenge competitors' }
    const scores = await getBigBrotherWeeklyScores(leagueId, current.week)
    const complete = participants.every(id => Number.isFinite(scores[id]))
    const hasSome = participants.some(id => Number.isFinite(scores[id]))
    if (config.challengeMode !== 'ai_theme' && !complete && (config.challengeMode === 'deterministic_score' || hasSome)) return skipped('awaiting_final_scores')
    const winner = await (isHoh ? resolveHOHWinner : resolveVetoWinner)({ leagueId, configId: config.configId, week: current.week, participantRosterIds: participants, challengeType: isHoh ? 'hoh' : 'veto' }, { scores: complete ? scores : undefined })
    if (!winner) return skipped('awaiting_final_scores')
    const result = isHoh ? await assignHOH(leagueId, config.configId, current.id, winner) : await setVetoWinner(current.id, winner)
    if (!result.ok) return { ok: false, error: result.error }
    if (isHoh) {
      await changed('HOH_LOCKED')
      await announceHOHWinner({ leagueId, week: current.week, hohRosterId: winner, systemUserId })
      const { applyHaveNotWaiverPenalties } = await import('./BigBrotherHaveNotPenaltyService')
      await applyHaveNotWaiverPenalties(leagueId, current.id)
      return { ok: true, cycleId: current.id, phase: 'HOH_LOCKED', actionTaken: action }
    }
    return changed('VETO_DECISION_OPEN')
  }
  if (action === 'auto_nominate') {
    if (phase !== 'NOMINATION_OPEN') return { ok: false, error: 'Nominations are not open' }
    const cycle = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { nominee1RosterId: true, nominee2RosterId: true } })
    // A submitted pair survives the timeout; auto-nomination only fills an empty pair.
    if (!cycle?.nominee1RosterId || !cycle.nominee2RosterId) {
      const result = await runAutoNomination(current.id, { systemUserId })
      if (!result.ok) return { ok: false, error: result.error }
    }
    return changed('NOMINATION_LOCKED')
  }
  if (action === 'veto_draw') {
    if (phase !== 'VETO_DRAW') return { ok: false, error: 'Veto draw is not open' }
    const result = await selectVetoCompetitors(current.id)
    if (!result.ok) return { ok: false, error: result.error }
    const next = await changed('VETO_CHALLENGE_OPEN')
    await announceVetoDraw({ leagueId, week: current.week, participantRosterIds: result.rosterIds ?? [], systemUserId })
    return next
  }
  if (action === 'veto_decision_timeout') {
    if (phase !== 'VETO_DECISION_OPEN') return { ok: false, error: 'Veto decision is not open' }
    const cycle = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { vetoUsed: true, replacementNomineeRosterId: true } })
    return changed(cycle?.vetoUsed && !cycle.replacementNomineeRosterId ? 'REPLACEMENT_NOMINATION_OPEN' : 'VOTING_OPEN')
  }
  if (action === 'auto_replacement') {
    if (phase !== 'REPLACEMENT_NOMINATION_OPEN') return { ok: false, error: 'Replacement nomination is not open' }
    const result = await runAutoReplacementNominee(current.id, { systemUserId })
    if (!result.ok) return { ok: false, error: result.error }
    return changed('VOTING_OPEN')
  }
  if (action === 'lock_voting' || action === 'close_eviction') {
    if (phase !== 'VOTING_OPEN' && phase !== 'VOTING_LOCKED') return { ok: false, error: 'Voting is not open' }
    const result = await closeEviction(current.id, { systemUserId, postToChat: true })
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, cycleId: current.id, phase: 'EVICTION_RESOLVED', actionTaken: 'close_eviction' }
  }
  return skipped('no_action')
}
