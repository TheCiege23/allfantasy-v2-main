/**
 * [NEW] lib/big-brother/BigBrotherPhaseStateMachine.ts
 * Week state machine: HOH_OPEN → … → EVICTION_RESOLVED → JURY_UPDATE → RESET_NEXT_WEEK.
 * All transitions are deterministic and auditable. PROMPT 3.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { resolveBigBrotherDeadlines } from './schedule'
import { appendBigBrotherAudit } from './BigBrotherAuditLog'
import type { BigBrotherWeekPhase } from './types'

const VALID_PHASES: BigBrotherWeekPhase[] = [
  'HOH_OPEN',
  'HOH_LOCKED',
  'NOMINATION_OPEN',
  'NOMINATION_LOCKED',
  'VETO_DRAW',
  'VETO_CHALLENGE_OPEN',
  'VETO_DECISION_OPEN',
  'REPLACEMENT_NOMINATION_OPEN',
  'VOTING_OPEN',
  'VOTING_LOCKED',
  'EVICTION_RESOLVED',
  'JURY_UPDATE',
  'RESET_NEXT_WEEK',
]

export function isValidPhase(s: string): s is BigBrotherWeekPhase {
  return VALID_PHASES.includes(s as BigBrotherWeekPhase)
}

/** Valid transitions from each phase (deterministic). */
const TRANSITIONS: Record<BigBrotherWeekPhase, BigBrotherWeekPhase[]> = {
  HOH_OPEN: ['HOH_LOCKED'],
  HOH_LOCKED: ['NOMINATION_OPEN'],
  NOMINATION_OPEN: ['NOMINATION_LOCKED'],
  NOMINATION_LOCKED: ['VETO_DRAW'],
  VETO_DRAW: ['VETO_CHALLENGE_OPEN'],
  VETO_CHALLENGE_OPEN: ['VETO_DECISION_OPEN'],
  VETO_DECISION_OPEN: ['REPLACEMENT_NOMINATION_OPEN', 'VOTING_OPEN'], // VOTING_OPEN if veto not used
  REPLACEMENT_NOMINATION_OPEN: ['VOTING_OPEN'],
  VOTING_OPEN: ['VOTING_LOCKED'],
  VOTING_LOCKED: ['EVICTION_RESOLVED'],
  EVICTION_RESOLVED: ['JURY_UPDATE', 'RESET_NEXT_WEEK'],
  JURY_UPDATE: ['RESET_NEXT_WEEK'],
  RESET_NEXT_WEEK: [],
}

export function canTransition(from: BigBrotherWeekPhase, to: BigBrotherWeekPhase): boolean {
  const allowed = TRANSITIONS[from]
  return allowed?.includes(to) ?? false
}

export async function getCyclePhase(cycleId: string): Promise<BigBrotherWeekPhase | null> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: { phase: true },
  })
  if (!cycle?.phase) return null
  return isValidPhase(cycle.phase) ? (cycle.phase as BigBrotherWeekPhase) : 'HOH_OPEN'
}

export async function getCurrentCycleForLeague(leagueId: string): Promise<{ id: string; week: number; phase: string; createdAt: Date; voteDeadlineAt: Date | null; voteOpenedAt: Date | null } | null> {
  const cycle = await prisma.bigBrotherCycle.findFirst({
    where: { leagueId },
    orderBy: { week: 'desc' },
    select: { id: true, week: true, phase: true, createdAt: true, voteDeadlineAt: true, voteOpenedAt: true },
  })
  return cycle
}

/**
 * Transition cycle to a new phase. Validates transition; updates DB; audits.
 */
export async function transitionPhase(
  cycleId: string,
  toPhase: BigBrotherWeekPhase,
  metadata?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: { leagueId: true, configId: true, week: true, phase: true, createdAt: true, voteOpenedAt: true, voteDeadlineAt: true },
  })
  if (!cycle) return { ok: false, error: 'Cycle not found' }

  const from = (isValidPhase(cycle.phase) ? cycle.phase : 'HOH_OPEN') as BigBrotherWeekPhase
  if (!canTransition(from, toPhase)) {
    return { ok: false, error: `Invalid transition from ${from} to ${toPhase}` }
  }

  const now = new Date()
  const config = toPhase === 'VOTING_OPEN' ? await getBigBrotherConfig(cycle.leagueId) : null
  const dates = config ? resolveBigBrotherDeadlines(config, cycle) : null
  const voteOpenedAt = dates?.voting_open && dates.voting_open > now ? dates.voting_open : now
  const changed = await prisma.bigBrotherCycle.updateMany({
    where: { id: cycleId, phase: from },
    data: { phase: toPhase, ...(toPhase === 'VOTING_OPEN' ? { voteOpenedAt, voteDeadlineAt: cycle.voteDeadlineAt ?? dates?.eviction ?? null } : {}) },
  })
  if (changed.count !== 1) return { ok: false, error: 'Cycle changed; refresh and retry' }

  await appendBigBrotherAudit(cycle.leagueId, cycle.configId, 'phase_transition', {
    cycleId,
    week: cycle.week,
    fromPhase: from,
    toPhase,
    ...metadata,
  })
  return { ok: true }
}

/**
 * Create the first cycle (week 1) for a Big Brother league. Idempotent: if week 1 exists, returns it.
 * Commissioner uses this to start the game. PROMPT 6.
 */
export async function createFirstCycleIfNeeded(leagueId: string): Promise<{ ok: boolean; cycleId?: string; week?: number; error?: string }> {
  const config = await prisma.bigBrotherLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (!config) return { ok: false, error: 'Big Brother config not found' }

  const existing = await prisma.bigBrotherCycle.findFirst({
    where: { leagueId },
    orderBy: { week: 'desc' },
    select: { id: true, week: true },
  })
  if (existing) {
    if (existing.week === 1) return { ok: true, cycleId: existing.id, week: 1 }
    return { ok: false, error: 'League already has cycles; use advance to start next week' }
  }

  const cycle = await prisma.bigBrotherCycle.create({
    data: {
      leagueId,
      configId: config.id,
      week: 1,
      phase: 'HOH_OPEN',
    },
    select: { id: true, week: true },
  })
  await appendBigBrotherAudit(leagueId, config.id, 'phase_transition', { event: 'first_cycle_created', cycleId: cycle.id, week: 1 })
  return { ok: true, cycleId: cycle.id, week: cycle.week }
}
