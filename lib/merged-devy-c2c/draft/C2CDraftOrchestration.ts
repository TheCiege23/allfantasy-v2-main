/**
 * C2C draft orchestration: merged startup, separate startup, annual rookie, annual college, merged rookie+college. PROMPT 2/6.
 */

import { prisma } from '@/lib/prisma'
import { getC2CConfig } from '../C2CLeagueConfig'
import type { C2CDraftPhase, C2CPoolType } from '../types'
import type { C2CLeagueConfigShape } from '../types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type C2CDraftPhaseStatus = 'not_started' | 'in_progress' | 'completed'

export interface C2CDraftPhaseInfo {
  phase: C2CDraftPhase
  status: C2CDraftPhaseStatus
  rounds: number
  draftType: 'snake' | 'linear' | 'auction'
  description: string
}

function normalizeC2CDraftType(raw: string | null | undefined): 'snake' | 'linear' | 'auction' {
  const draft = String(raw ?? '').trim().toLowerCase()
  if (draft === 'linear') return 'linear'
  if (draft === 'auction') return 'auction'
  return 'snake'
}

/**
 * Get current C2C draft phase from draft session or config.
 */
export async function getCurrentC2CDraftPhase(leagueId: string): Promise<{
  phase: C2CDraftPhase | null
  phaseInfo: C2CDraftPhaseInfo | null
  sessionId: string | null
}> {
  const config = await getC2CConfig(leagueId)
  if (!config) return { phase: null, phaseInfo: null, sessionId: null }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, draftType: true, rounds: true },
  })

  const status: C2CDraftPhaseStatus =
    session?.status === 'completed' ? 'completed' : session?.status === 'in_progress' ? 'in_progress' : 'not_started'
  const draftType = normalizeC2CDraftType(session?.draftType) ?? config.startupDraftType
  const rounds = session?.rounds ?? 0

  if (config.mergedStartupDraft) {
    return {
      phase: 'startup_merged',
      phaseInfo: {
        phase: 'startup_merged',
        status,
        rounds,
        draftType,
        description: 'Merged startup draft (pro + college)',
      },
      sessionId: session?.id ?? null,
    }
  }

  if (config.separateStartupCollegeDraft) {
    return {
      phase: 'startup_pro',
      phaseInfo: {
        phase: 'startup_pro',
        status,
        rounds,
        draftType,
        description: 'Startup pro draft',
      },
      sessionId: session?.id ?? null,
    }
  }

  return {
    phase: 'startup_merged',
    phaseInfo: {
      phase: 'startup_merged',
      status: 'not_started',
      rounds: 0,
      draftType: config.startupDraftType,
      description: 'Merged startup draft (pro + college)',
    },
    sessionId: null,
  }
}

/**
 * Get pool type for a given C2C draft phase.
 */
export function getPoolTypeForC2CPhase(phase: C2CDraftPhase): C2CPoolType {
  switch (phase) {
    case 'startup_pro':
      return 'startup_pro'
    case 'startup_college':
      return 'startup_college'
    case 'startup_merged':
      return 'startup_merged'
    case 'rookie':
      return 'rookie'
    case 'college':
      return 'college'
    case 'merged_rookie_college':
      return 'merged_rookie_college'
    default:
      return 'startup_merged'
  }
}

/**
 * Get phase config (rounds, draft type) for C2C.
 */
export function getC2CPhaseConfig(config: C2CLeagueConfigShape, phase: C2CDraftPhase): { rounds: number; draftType: 'snake' | 'linear' | 'auction' } {
  switch (phase) {
    case 'startup_pro':
    case 'startup_college':
    case 'startup_merged':
      return { rounds: 0, draftType: config.startupDraftType }
    case 'rookie':
      return { rounds: config.rookieDraftRounds, draftType: config.rookieDraftType }
    case 'college':
      return { rounds: config.collegeDraftRounds, draftType: config.collegeDraftType }
    case 'merged_rookie_college':
      return { rounds: config.rookieDraftRounds + config.collegeDraftRounds, draftType: config.rookieDraftType }
    default:
      return { rounds: 0, draftType: 'snake' }
  }
}
