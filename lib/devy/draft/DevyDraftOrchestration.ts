/**
 * Devy Dynasty three-draft orchestration. PROMPT 2/6.
 * A. Startup vet draft (once) — veterans/pro only; excludes NCAA devy.
 * B. Annual rookie draft — newly drafted pro rookies only; excludes devy-held-and-promoted, excludes vets.
 * C. Annual devy draft — NCAA eligible devy only; excludes rostered devy, excludes graduated.
 * Deterministic: pick order methods, exclusion logic, draft type (snake/linear).
 */

import { prisma } from '@/lib/prisma'
import { getDevyConfig } from '../DevyLeagueConfig'
import type { DevyLeagueConfigShape } from '../types'
import type { DevyDraftPhase, DevyPickOrderMethod } from '../types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type DraftPhaseStatus = 'not_started' | 'in_progress' | 'completed'

export interface DevyDraftPhaseInfo {
  phase: DevyDraftPhase
  status: DraftPhaseStatus
  rounds: number
  draftType: 'snake' | 'linear'
  pickOrderMethod: DevyPickOrderMethod
  /** Human-readable description. */
  description: string
}

/**
 * Get the current draft phase for a league using session devyConfig.phase metadata.
 * Phase progression: startup_vet → rookie → devy (startup is one-time; rookie/devy are annual).
 *
 * devyConfig JSON on DraftSession: { phase?: DevyDraftPhase; year?: number; completedPhases?: DevyDraftPhase[] }
 */
export async function getCurrentDraftPhase(leagueId: string): Promise<{
  phase: DevyDraftPhase | null
  phaseInfo: DevyDraftPhaseInfo | null
  sessionId: string | null
}> {
  const config = await getDevyConfig(leagueId)
  if (!config) return { phase: null, phaseInfo: null, sessionId: null }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, draftType: true, rounds: true, devyConfig: true },
  })

  const toStatus = (s: string): DraftPhaseStatus =>
    s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'not_started'

  const descriptions: Record<DevyDraftPhase, string> = {
    startup_vet: 'Startup veteran draft — veterans and established pros only',
    rookie: 'Rookie draft — first-year pros; promoted devy excluded',
    devy: 'Devy draft — NCAA prospects only; graduated players excluded',
  }

  if (session) {
    const devyCfg = session.devyConfig as {
      phase?: DevyDraftPhase
      year?: number
      completedPhases?: DevyDraftPhase[]
    } | null

    const phase: DevyDraftPhase = devyCfg?.phase ?? 'startup_vet'
    const status = toStatus(session.status)
    const phaseConfig = getPhaseConfig(config, phase)

    return {
      phase,
      phaseInfo: {
        phase,
        status,
        rounds: session.rounds > 0 ? session.rounds : phaseConfig.rounds,
        draftType: (session.draftType as 'snake' | 'linear') ?? phaseConfig.draftType,
        pickOrderMethod: phaseConfig.pickOrderMethod,
        description: descriptions[phase],
      },
      sessionId: session.id,
    }
  }

  // No active session — determine the next un-started phase from config.
  const startupDone = (config.startupVetRounds ?? 0) === 0
  const phase: DevyDraftPhase = startupDone ? 'rookie' : 'startup_vet'
  const phaseConfig = getPhaseConfig(config, phase)

  return {
    phase,
    phaseInfo: {
      phase,
      status: 'not_started',
      rounds: phaseConfig.rounds,
      draftType: phaseConfig.draftType,
      pickOrderMethod: phaseConfig.pickOrderMethod,
      description: descriptions[phase],
    },
    sessionId: null,
  }
}

/**
 * Return list of phases recorded as completed for a league.
 * Reads completedPhases from session devyConfig JSON.
 */
export async function getCompletedPhases(leagueId: string): Promise<DevyDraftPhase[]> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { devyConfig: true, status: true },
  })
  if (!session) return []

  const devyCfg = session.devyConfig as {
    phase?: DevyDraftPhase
    completedPhases?: DevyDraftPhase[]
  } | null

  const completed: DevyDraftPhase[] = devyCfg?.completedPhases ?? []

  if (session.status === 'completed' && devyCfg?.phase && !completed.includes(devyCfg.phase)) {
    return [...completed, devyCfg.phase]
  }
  return completed
}

/**
 * Get config for a specific phase (rounds, draft type, pick order).
 */
export function getPhaseConfig(
  config: DevyLeagueConfigShape,
  phase: DevyDraftPhase
): { rounds: number; draftType: 'snake' | 'linear'; pickOrderMethod: DevyPickOrderMethod } {
  switch (phase) {
    case 'startup_vet':
      return {
        rounds: config.startupVetRounds ?? 0,
        draftType: config.startupDraftType,
        pickOrderMethod: 'custom',
      }
    case 'rookie':
      return {
        rounds: config.rookieDraftRounds,
        draftType: config.rookieDraftType,
        pickOrderMethod: config.rookiePickOrderMethod,
      }
    case 'devy':
      return {
        rounds: config.devyDraftRounds,
        draftType: config.devyDraftType,
        pickOrderMethod: config.devyPickOrderMethod,
      }
    default:
      return {
        rounds: 0,
        draftType: 'snake',
        pickOrderMethod: 'reverse_standings',
      }
  }
}

/**
 * Exclusion rules for pool by phase (deterministic).
 * - startup_vet: pro only; exclude NCAA devy.
 * - rookie: rookies only; exclude vets and devy-promoted.
 * - devy: NCAA eligible only; exclude rostered and graduated.
 */
export function getPoolExclusionRule(phase: DevyDraftPhase): string {
  switch (phase) {
    case 'startup_vet':
      return 'pro_only'
    case 'rookie':
      return 'rookies_only_exclude_devy_promoted_and_vets'
    case 'devy':
      return 'devy_only_exclude_rostered_and_graduated'
    default:
      return 'pro_only'
  }
}
