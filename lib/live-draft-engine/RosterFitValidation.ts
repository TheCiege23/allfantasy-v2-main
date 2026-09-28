/**
 * Draft pick roster-fit validation: position eligibility and roster size for IDP/standard leagues.
 * Ensures picked position is allowed by league template and roster does not exceed slot count.
 */

import { draftPoolRowMatchesEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
import { getDraftEligiblePositionsFromPayload, getLeagueDraftTemplatePayload } from '@/lib/league/league-draft-template-payload'

export interface RosterFitValidationInput {
  leagueId: string
  rosterId: string
  existingPicks: { rosterId: string; position: string }[]
  newPickPosition: string
}

export interface RosterFitValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate that the new pick has an allowed position and the roster won't exceed template size.
 * Uses the same effective template as the draft pool and roster gate.
 */
export async function validateRosterFitForDraftPick(input: RosterFitValidationInput): Promise<RosterFitValidationResult> {
  const payload = await getLeagueDraftTemplatePayload(input.leagueId).catch(() => null)
  if (!payload) return { valid: true }

  const draftEligible = getDraftEligiblePositionsFromPayload(payload)
  const posUpper = (input.newPickPosition || '').trim().toUpperCase()
  if (!posUpper) return { valid: false, error: 'Position is required' }
  if (!draftPoolRowMatchesEligiblePositions(input.newPickPosition, draftEligible)) {
    return {
      valid: false,
      error: `Position "${input.newPickPosition}" is not starter-eligible in this league draft. Allowed: ${[...draftEligible].sort().join(', ')}.`,
    }
  }

  const totalSlots = payload.totalRosterSlots
  const thisRosterPickCount = input.existingPicks.filter((p) => p.rosterId === input.rosterId).length
  if (thisRosterPickCount + 1 > totalSlots) {
    return {
      valid: false,
      error: `Roster would exceed maximum size (${totalSlots} slots).`,
    }
  }
  return { valid: true }
}

/**
 * Draft-targeting positions (starter-eligible, with empty-starter fallback) plus full roster union for callers that still need it.
 */
export async function getAllowedPositionsAndRosterSize(leagueId: string): Promise<{
  draftEligiblePositions: Set<string>
  rosterUnionAllowedPositions: Set<string>
  totalRosterSize: number
} | null> {
  const payload = await getLeagueDraftTemplatePayload(leagueId).catch(() => null)
  if (!payload) return null
  return {
    draftEligiblePositions: getDraftEligiblePositionsFromPayload(payload),
    rosterUnionAllowedPositions: new Set(payload.allowedPositions),
    totalRosterSize: payload.totalRosterSlots,
  }
}

/**
 * Refuse a round count the league's rosters cannot hold.
 *
 * Every pick past a roster's slot count is rejected by `validateRosterFitForDraftPick`, and a draft
 * completes only on a FULL board (`rounds × teams`), so saving more rounds than roster slots made
 * the draft impossible to finish: the last rounds could never be picked. Returns an error message,
 * or `null` when the count fits (or the league has no roster template to judge it against).
 */
export async function validateDraftRoundsFitRoster(leagueId: string, rounds: number): Promise<string | null> {
  const payload = await getLeagueDraftTemplatePayload(leagueId).catch(() => null)
  const totalSlots = payload?.totalRosterSlots
  if (!totalSlots || !Number.isFinite(totalSlots) || totalSlots <= 0) return null
  if (rounds > totalSlots) {
    return `A ${rounds}-round draft cannot finish: rosters hold ${totalSlots} players. Use ${totalSlots} rounds or fewer, or add roster slots first.`
  }
  return null
}
