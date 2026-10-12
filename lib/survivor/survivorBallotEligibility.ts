/**
 * SURVIVOR BALLOT ELIGIBILITY — pure, deterministic. No DB, no AI.
 *
 * Computes who may vote and who may be voted for at a Elimination Council from an already-loaded
 * scope of active players plus the safety sets produced by idol plays / settings. The caller
 * (survivorCouncilService) loads players and idol plays; this module only applies the rules so
 * the logic is unit-testable without a database. Distinct filename from the legacy PascalCase
 * `SurvivorCouncilEligibility.ts` (Windows case-insensitive FS) — this is the canonical Phase 3
 * version keyed by userId, not rosterId.
 */

export interface CouncilScopePlayer {
  userId: string
  rosterId: string
  displayName: string
}

export interface ComputeEligibilityInput {
  /** Active players in the council's scope (attending tribe pre-merge, or all active post-merge). */
  scopePlayers: CouncilScopePlayer[]
  /** Self-votes allowed? (default false) */
  selfVotesAllowed: boolean
  /** Users made safe (ineligible target) by Council Pass / immunity. */
  safeUserIds?: ReadonlyArray<string>
  /** Users who forfeit their own vote this council (e.g. Council Pass when settings forfeit vote). */
  voteForfeitUserIds?: ReadonlyArray<string>
}

export interface CouncilEligibility {
  /** Users who may submit a ballot. */
  voterUserIds: string[]
  /** Users who may be targeted. */
  targetUserIds: string[]
  /** Per-voter allowed targets (self removed unless selfVotesAllowed). */
  targetsByVoter: Record<string, string[]>
}

export function computeCouncilEligibility(input: ComputeEligibilityInput): CouncilEligibility {
  const safe = new Set(input.safeUserIds ?? [])
  const forfeit = new Set(input.voteForfeitUserIds ?? [])
  const scope = input.scopePlayers.filter((p) => p.userId)

  const voterUserIds = scope.map((p) => p.userId).filter((u) => !forfeit.has(u))
  const targetUserIds = scope.map((p) => p.userId).filter((u) => !safe.has(u))

  const targetsByVoter: Record<string, string[]> = {}
  for (const voter of voterUserIds) {
    targetsByVoter[voter] = targetUserIds.filter((t) => input.selfVotesAllowed || t !== voter)
  }

  return { voterUserIds, targetUserIds, targetsByVoter }
}

/** Is the given user eligible to vote in this computed eligibility? */
export function isEligibleVoter(eligibility: CouncilEligibility, userId: string): boolean {
  return eligibility.voterUserIds.includes(userId)
}

/** May `voterUserId` target `targetUserId`? */
export function isEligibleTarget(eligibility: CouncilEligibility, voterUserId: string, targetUserId: string): boolean {
  return (eligibility.targetsByVoter[voterUserId] ?? []).includes(targetUserId)
}
