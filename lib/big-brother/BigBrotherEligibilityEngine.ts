/**
 * [NEW] lib/big-brother/BigBrotherEligibilityEngine.ts
 * Central eligibility: who can compete HOH, be nominated, veto draw, vote, jury, eliminated, chat-only.
 * Deterministic and auditable. PROMPT 3.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getExcludedRosterIds } from './bigBrotherGuard'
import { getEligibleHOHRosterIds } from './BigBrotherHOHEngine'
import { getFinalNomineeRosterIds } from './BigBrotherNominationEngine'
import { getEligibleVoterRosterIds } from './BigBrotherVoteEngine'
import { getJuryMembers } from './BigBrotherJuryEngine'

export interface BigBrotherEligibility {
  /** Can compete in HOH this week */
  canCompeteHOH: string[]
  /** Can be nominated (not HOH, not evicted) */
  canBeNominated: string[]
  /** Eligible for random veto draw (excluding HOH + 2 noms already in) */
  eligibleForVetoDraw: string[]
  /** Can vote this cycle (not evicted, not on block; HOH only in tie if config) */
  canVote: string[]
  /** Jury roster IDs (eliminated users who are jury) */
  juryRosterIds: string[]
  /** Eliminated (evicted) roster IDs */
  eliminatedRosterIds: string[]
  /** Chat/forum only: eliminated but can still use social (no competitive actions) */
  chatOnlyRosterIds: string[]
}

/**
 * Compute full eligibility for a league and optional cycle.
 * If cycleId provided, vote/canBeNominated are cycle-specific; otherwise only league-wide (eliminated, jury) are returned.
 */
export async function getEligibility(
  leagueId: string,
  options?: { cycleId?: string }
): Promise<BigBrotherEligibility | null> {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return null

  const excluded = await getExcludedRosterIds(leagueId)
  const allRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true },
  })
  const activeRosterIds = allRosters.map((r) => r.id).filter((id) => !excluded.includes(id))

  const jury = await getJuryMembers(leagueId)
  const juryRosterIds = jury.map((j) => j.rosterId)

  const base: BigBrotherEligibility = {
    canCompeteHOH: [],
    canBeNominated: activeRosterIds,
    eligibleForVetoDraw: activeRosterIds,
    canVote: [],
    juryRosterIds,
    eliminatedRosterIds: excluded,
    chatOnlyRosterIds: excluded,
  }

  if (!options?.cycleId) {
    base.canCompeteHOH = activeRosterIds
    return base
  }

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: options.cycleId },
    select: { week: true, hohRosterId: true },
  })
  if (!cycle) return base

  const eligibleHOH = await getEligibleHOHRosterIds(
    leagueId,
    config.configId,
    cycle.week,
    config.consecutiveHohAllowed
  )
  base.canCompeteHOH = eligibleHOH

  if (cycle.hohRosterId) {
    base.canBeNominated = activeRosterIds.filter((id) => id !== cycle.hohRosterId)
  }

  const finalNoms = await getFinalNomineeRosterIds(options.cycleId)
  const nomSet = new Set(finalNoms)
  base.canVote = await getEligibleVoterRosterIds(leagueId, options.cycleId, config.hohVotesOnlyInTie, config.evictionTieBreakMode === 'hoh_vote')

  const vetoFixed = cycle.hohRosterId ? [cycle.hohRosterId, ...finalNoms].filter(Boolean) : finalNoms
  base.eligibleForVetoDraw = activeRosterIds.filter((id) => !vetoFixed.includes(id))

  return base
}

/** Can this roster perform competitive actions (lineup, waiver, trade)? */
export async function canRosterCompete(leagueId: string, rosterId: string): Promise<boolean> {
  const excluded = await getExcludedRosterIds(leagueId)
  return !excluded.includes(rosterId)
}

/** Is this roster jury (eliminated but jury member)? */
export async function isJuryRoster(leagueId: string, rosterId: string): Promise<boolean> {
  const member = await prisma.bigBrotherJuryMember.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId } },
  })
  return !!member
}
