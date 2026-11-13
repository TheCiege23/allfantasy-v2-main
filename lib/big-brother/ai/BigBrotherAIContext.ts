/**
 * [NEW] lib/big-brother/ai/BigBrotherAIContext.ts
 * Build deterministic context for Big Brother AI presenters. AI NEVER decides outcomes.
 * AI can: frame, present, narrate, theme challenges; explain results; host/emcee. PROMPT 3.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from '../BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '../BigBrotherPhaseStateMachine'
import { getEligibility } from '../BigBrotherEligibilityEngine'
import { getFinalNomineeRosterIds } from '../BigBrotherNominationEngine'
import { getJuryMembers } from '../BigBrotherJuryEngine'

type BigBrotherAIContextType =
  | 'hoh_challenge_presenter'
  | 'veto_challenge_presenter'
  | 'ceremony_announcer'
  | 'storyteller'
  | 'chimmy_host'

/**
 * Deterministic context for AI presenters. No outcome logic — only data for narration/advice.
 */
export interface BigBrotherAIContext {
  leagueId: string
  week: number
  phase: string
  cycleId: string | null
  /** Roster IDs only; no PII. Display names resolved by client if needed. */
  hohRosterId: string | null
  nominee1RosterId: string | null
  nominee2RosterId: string | null
  finalNomineeRosterIds: string[]
  vetoWinnerRosterId: string | null
  vetoUsed: boolean
  vetoSavedRosterId: string | null
  replacementNomineeRosterId: string | null
  evictedRosterId: string | null
  juryRosterIds: string[]
  eliminatedRosterIds: string[]
  /** Challenge mode: ai_theme | deterministic_score | hybrid */
  challengeMode: string
  /** For Chimmy host: next deadline or action due */
  nextActionHint: string | null
  /** Sport for challenge theme hints (multi-sport). PROMPT 5. */
  sport: string
  /** Optional term for `rule_explain` prompts. */
  explainTerm?: string | null
}

/**
 * Build context for Big Brother AI (Chimmy host, challenge presenter, ceremony announcer).
 */
export async function buildBigBrotherAIContext(
  leagueId: string,
  _type: BigBrotherAIContextType
): Promise<BigBrotherAIContext | null> {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return null

  const current = await getCurrentCycleForLeague(leagueId)
  const eligibility = await getEligibility(leagueId, current ? { cycleId: current.id } : undefined)

  let cycleId: string | null = null
  let week = 0
  let phase = 'RESET_NEXT_WEEK'
  let hohRosterId: string | null = null
  let nominee1RosterId: string | null = null
  let nominee2RosterId: string | null = null
  let finalNomineeRosterIds: string[] = []
  let vetoWinnerRosterId: string | null = null
  let vetoUsed = false
  let vetoSavedRosterId: string | null = null
  let replacementNomineeRosterId: string | null = null
  let evictedRosterId: string | null = null

  if (current) {
    cycleId = current.id
    week = current.week
    phase = current.phase
    const cycle = await prisma.bigBrotherCycle.findUnique({
      where: { id: current.id },
      select: {
        hohRosterId: true,
        nominee1RosterId: true,
        nominee2RosterId: true,
        vetoWinnerRosterId: true,
        vetoUsed: true,
        vetoSavedRosterId: true,
        replacementNomineeRosterId: true,
        evictedRosterId: true,
      },
    })
    if (cycle) {
      hohRosterId = cycle.hohRosterId
      nominee1RosterId = cycle.nominee1RosterId
      nominee2RosterId = cycle.nominee2RosterId
      vetoWinnerRosterId = cycle.vetoWinnerRosterId
      vetoUsed = cycle.vetoUsed
      vetoSavedRosterId = cycle.vetoSavedRosterId
      replacementNomineeRosterId = cycle.replacementNomineeRosterId
      evictedRosterId = cycle.evictedRosterId
      finalNomineeRosterIds = await getFinalNomineeRosterIds(current.id)
    }
  }

  const jury = await getJuryMembers(leagueId)
  const juryRosterIds = jury.map((j) => j.rosterId)
  const eliminatedRosterIds = eligibility?.eliminatedRosterIds ?? []

  let nextActionHint: string | null = null
  if (phase === 'NOMINATION_OPEN') nextActionHint = 'HOH must nominate two players before the nomination deadline.'
  else if (phase === 'VETO_DECISION_OPEN') nextActionHint = 'Veto winner must decide: use veto or keep nominations the same.'
  else if (phase === 'REPLACEMENT_NOMINATION_OPEN') nextActionHint = 'HOH must name a replacement nominee.'
  else if (phase === 'VOTING_OPEN') nextActionHint = 'Eligible houseguests vote in private; voting closes at the eviction deadline.'

  return {
    leagueId,
    week,
    phase,
    cycleId,
    hohRosterId,
    nominee1RosterId,
    nominee2RosterId,
    finalNomineeRosterIds,
    vetoWinnerRosterId,
    vetoUsed,
    vetoSavedRosterId,
    replacementNomineeRosterId,
    evictedRosterId,
    juryRosterIds,
    eliminatedRosterIds,
    challengeMode: config.challengeMode,
    nextActionHint,
    sport: config.sport,
  }
}
