import { runAutomation } from './BigBrotherAutomationService'
/**
 * [NEW] lib/big-brother/BigBrotherAdminService.ts
 * Commissioner/admin tools: force-advance, reopen phases, extend vote, rerun tally,
 * force waiver release, resolve veto state, replace inactive HOH/veto, repair flags,
 * config jury/tie/challenge, pause/resume. PROMPT 5.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig, upsertBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getCurrentCycleForLeague, transitionPhase, createFirstCycleIfNeeded } from './BigBrotherPhaseStateMachine'
import { runAutoNomination } from './BigBrotherNominationEnforcement'
import { closeEviction } from './BigBrotherEvictionService'
import { tallyEvictionVotes } from './BigBrotherVoteEngine'
import { releaseEvictedRoster } from './BigBrotherRosterReleaseEngine'
import { getExcludedRosterIds } from './bigBrotherGuard'
import { appendBigBrotherAudit } from './BigBrotherAuditLog'
import type { BigBrotherWeekPhase } from './types'

export type BigBrotherAdminAction =
  | 'start_week_one'
  | 'force_advance_week'
  | 'reopen_nominations'
  | 'reopen_veto'
  | 'extend_vote_window'
  | 'rerun_vote_tally'
  | 'resolve_eviction_tie'
  | 'force_waiver_release'
  | 'resolve_veto_state'
  | 'replace_inactive_hoh'
  | 'replace_inactive_veto_decision'
  | 'repair_duplicate_status'
  | 'update_config'
  | 'pause_week'
  | 'resume_week'

export interface BigBrotherAdminInput {
  leagueId: string
  action: BigBrotherAdminAction
  /** For extend_vote_window: minutes to add. For update_config: partial config. */
  params?: Record<string, unknown>
}

export interface BigBrotherAdminResult {
  ok: boolean
  message?: string
  error?: string
}

/** Run one admin action. Commissioner must be validated by route. */
export async function runBigBrotherAdminAction(input: BigBrotherAdminInput): Promise<BigBrotherAdminResult> {
  const { leagueId, action, params = {} } = input
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Big Brother league' }

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current && !['update_config', 'pause_week', 'resume_week', 'force_waiver_release', 'start_week_one'].includes(action)) {
    return { ok: false, error: 'No current cycle' }
  }

  switch (action) {
    case 'start_week_one': {
      const res = await createFirstCycleIfNeeded(leagueId)
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, message: res.cycleId ? `Week 1 cycle created (${res.cycleId})` : 'Week 1 already exists' }
    }
    case 'pause_week': {
      await upsertBigBrotherConfig(leagueId, { weekProgressionPaused: true })
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'pause_week' })
      return { ok: true, message: 'Week progression paused' }
    }
    case 'resume_week': {
      await upsertBigBrotherConfig(leagueId, { weekProgressionPaused: false })
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'resume_week' })
      return { ok: true, message: 'Week progression resumed' }
    }
    case 'update_config': {
      const upd: Record<string, unknown> = {}
      if (params.juryStartMode != null) upd.juryStartMode = String(params.juryStartMode)
      if (params.juryStartAfterEliminations != null) upd.juryStartAfterEliminations = Number(params.juryStartAfterEliminations)
      if (params.juryStartWhenRemaining != null) upd.juryStartWhenRemaining = Number(params.juryStartWhenRemaining)
      if (params.juryStartWeek != null) upd.juryStartWeek = Number(params.juryStartWeek)
      if (params.evictionTieBreakMode != null) upd.evictionTieBreakMode = String(params.evictionTieBreakMode)
      if (params.challengeMode != null) upd.challengeMode = String(params.challengeMode)
      if (params.finaleFormat != null) upd.finaleFormat = String(params.finaleFormat)
      if (Object.keys(upd).length === 0) return { ok: false, error: 'No config fields to update' }
      await upsertBigBrotherConfig(leagueId, upd as any)
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'update_config', upd })
      return { ok: true, message: 'Config updated' }
    }
    case 'reopen_nominations': {
      if (!current) return { ok: false, error: 'No cycle' }
      const phase = current.phase as BigBrotherWeekPhase
      if (phase !== 'NOMINATION_LOCKED' && phase !== 'VETO_DRAW') {
        return { ok: false, error: 'Can only reopen from NOMINATION_LOCKED or VETO_DRAW' }
      }
      await prisma.bigBrotherCycle.update({
        where: { id: current.id },
        data: { phase: 'NOMINATION_OPEN', nominee1RosterId: null, nominee2RosterId: null, vetoWinnerRosterId: null, vetoParticipantRosterIds: Prisma.JsonNull, vetoUsed: false, vetoSavedRosterId: null, replacementNomineeRosterId: null },
      })
      await prisma.bigBrotherEvictionVote.deleteMany({ where: { cycleId: current.id } })
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'reopen_nominations', cycleId: current.id })
      return { ok: true, message: 'Nominations reopened' }
    }
    case 'reopen_veto': {
      if (!current) return { ok: false, error: 'No cycle' }
      const cycle = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { phase: true, vetoUsed: true } })
      const p = cycle?.phase as string
      if (!cycle || (p !== 'REPLACEMENT_NOMINATION_OPEN' && p !== 'VOTING_OPEN')) {
        return { ok: false, error: 'Can only reopen veto from REPLACEMENT_NOMINATION_OPEN or VOTING_OPEN' }
      }
      await prisma.bigBrotherCycle.update({
        where: { id: current.id },
        data: { vetoUsed: false, vetoSavedRosterId: null, replacementNomineeRosterId: null, voteOpenedAt: null, voteDeadlineAt: null, phase: 'VETO_DECISION_OPEN' },
      })
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'reopen_veto', cycleId: current.id })
      return { ok: true, message: 'Veto decision reopened' }
    }
    case 'extend_vote_window': {
      if (!current) return { ok: false, error: 'No cycle' }
      const minutes = Math.max(1, Math.min(10080, Number(params.minutes) || 60))
      const cycle = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { voteDeadlineAt: true, phase: true, closedAt: true } })
      if (!cycle || cycle.closedAt || !['VOTING_OPEN','VOTING_LOCKED'].includes(cycle.phase)) return { ok: false, error: 'No unresolved voting window' }
      const newDeadline = new Date(Math.max(cycle.voteDeadlineAt?.getTime() ?? 0, Date.now()) + minutes * 60 * 1000)
      await prisma.bigBrotherCycle.update({ where: { id: current.id }, data: { voteDeadlineAt: newDeadline, phase: 'VOTING_OPEN' } })
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'extend_vote_window', minutes, newDeadline: newDeadline.toISOString() })
      return { ok: true, message: `Vote window extended by ${minutes} minutes` }
    }
    case 'resolve_eviction_tie': {
      if (!current || typeof params.rosterId !== 'string') return { ok: false, error: 'Choose a tied nominee' }
      const result = await closeEviction(current.id, { commissionerTieBreakRosterId: params.rosterId, postToChat: true })
      return result.ok ? { ok: true, message: 'Commissioner tie-break applied and eviction published' } : { ok: false, error: result.error }
    }
    case 'rerun_vote_tally': {
      if (!current) return { ok: false, error: 'No cycle' }
      const c = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { closedAt: true, evictedRosterId: true } })
      if (c?.closedAt || c?.evictedRosterId) return { ok: false, error: 'Eviction already closed; cannot rerun tally' }
      const tally = await tallyEvictionVotes(current.id)
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'rerun_vote_tally', cycleId: current.id, votesByTarget: tally.votesByTarget })
      return { ok: true, message: 'Tally rerun (no eviction applied); use close_eviction to apply' }
    }
    case 'force_waiver_release': {
      const rosterId = params.rosterId as string
      if (!rosterId) return { ok: false, error: 'params.rosterId required' }
      const excluded = await getExcludedRosterIds(leagueId)
      if (!excluded.includes(rosterId)) return { ok: false, error: 'Roster is not evicted' }
      await releaseEvictedRoster(leagueId, rosterId, { week: current?.week, cycleId: current?.id })
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'force_waiver_release', rosterId })
      return { ok: true, message: 'Waiver release executed for roster' }
    }
    case 'resolve_veto_state': {
      if (!current) return { ok: false, error: 'No cycle' }
      const cy = await prisma.bigBrotherCycle.findUnique({
        where: { id: current.id },
        select: { phase: true, vetoWinnerRosterId: true, vetoUsed: true, nominee1RosterId: true, nominee2RosterId: true },
      })
      if ((cy?.phase as string) !== 'VETO_DECISION_OPEN' || !cy?.vetoWinnerRosterId) {
        return { ok: false, error: 'Cycle not in VETO_DECISION_OPEN or no veto winner' }
      }
      await transitionPhase(current.id, 'VOTING_OPEN')
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'resolve_veto_state', vetoNotUsed: true, cycleId: current.id })
      return { ok: true, message: 'Veto state resolved (nominations unchanged); voting open' }
    }
    case 'replace_inactive_hoh': {
      if (!current) return { ok: false, error: 'No cycle' }
      const res = await runAutoNomination(current.id, { systemUserId: params.systemUserId as string })
      if (!res.ok) return { ok: false, error: res.error }
      await transitionPhase(current.id, 'NOMINATION_LOCKED', { adminAction: 'replace_inactive_hoh' })
      await appendBigBrotherAudit(leagueId, config.configId, 'auto_nomination', { adminAction: 'replace_inactive_hoh', cycleId: current.id, nominee1RosterId: res.nominee1, nominee2RosterId: res.nominee2 })
      return { ok: true, message: 'Auto-nomination run; HOH replaced by fallback' }
    }
    case 'replace_inactive_veto_decision': {
      if (!current) return { ok: false, error: 'No cycle' }
      const cy = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { phase: true, vetoUsed: true, vetoWinnerRosterId: true } })
      if ((cy?.phase as string) !== 'VETO_DECISION_OPEN') {
        return { ok: false, error: 'Cycle not in VETO_DECISION_OPEN' }
      }
      await transitionPhase(current.id, 'VOTING_OPEN')
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'replace_inactive_veto_decision', vetoNotUsed: true, cycleId: current.id })
      return { ok: true, message: 'Veto decision defaulted to keep nominations; voting open' }
    }
    case 'repair_duplicate_status': {
      const cycles = await prisma.bigBrotherCycle.findMany({ where: { leagueId }, orderBy: { week: 'asc' }, select: { id: true, week: true, phase: true } })
      let repaired = 0
      for (const c of cycles) {
        const phase = c.phase as string
        if (!['HOH_OPEN', 'HOH_LOCKED', 'NOMINATION_OPEN', 'NOMINATION_LOCKED', 'VETO_DRAW', 'VETO_CHALLENGE_OPEN', 'VETO_DECISION_OPEN', 'REPLACEMENT_NOMINATION_OPEN', 'VOTING_OPEN', 'VOTING_LOCKED', 'EVICTION_RESOLVED', 'JURY_UPDATE', 'RESET_NEXT_WEEK'].includes(phase)) {
          await prisma.bigBrotherCycle.update({ where: { id: c.id }, data: { phase: 'HOH_OPEN' } })
          repaired++
        }
      }
      await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', { adminAction: 'repair_duplicate_status', repaired })
      return { ok: true, message: repaired ? `Repaired ${repaired} cycle phase(s)` : 'No invalid phases found' }
    }
    case 'force_advance_week': {
      if (!current) return { ok: false, error: 'No current cycle' }
      const actions = { HOH_OPEN: 'auto_hoh', NOMINATION_OPEN: 'auto_nominate', VETO_DRAW: 'veto_draw', VETO_CHALLENGE_OPEN: 'auto_veto', VETO_DECISION_OPEN: 'veto_decision_timeout', REPLACEMENT_NOMINATION_OPEN: 'auto_replacement', VOTING_OPEN: 'close_eviction' } as const
      const result = await runAutomation({ leagueId, action: actions[current.phase as keyof typeof actions] ?? 'tick' })
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, message: result.actionTaken?.startsWith('skipped') ? `Progression waiting: ${result.actionTaken.replace('skipped_', '').replaceAll('_', ' ')}` : `Advanced to ${result.phase}` }
    }
    default:
      return { ok: false, error: `Unknown action: ${action}` }
  }
}
