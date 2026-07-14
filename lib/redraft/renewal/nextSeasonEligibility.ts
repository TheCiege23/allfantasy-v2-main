import type { NextSeasonCreationViolation, NextSeasonEligibilityResult } from './nextSeasonContract'

const SUPPORTED_SPORTS = new Set(['NFL', 'NCAAF'])

export type EligibilitySourceLeague = {
  id: string
  userId: string
  sport: string
  lifecycleState: string
  teams: Array<{ isCommissioner: boolean; isCoCommissioner: boolean; claimedByUserId: string | null; platformUserId: string | null }>
}

export type EligibilitySourceSeason = {
  id: string
  leagueId: string
  sport: string
  season: number
  status: string
}

export type EligibilitySourceRoster = { id: string; ownerId: string | null; ownerName: string }

export type EligibilityCheckInput = {
  actorUserId: string
  actorRole: 'commissioner' | 'administrator'
  requestedSeason: number
  league: EligibilitySourceLeague | null
  season: EligibilitySourceSeason | null
  rosters: EligibilitySourceRoster[]
  playoffBracketStatus: string | null
  existingRenewal: { status: string; nextSeasonId: string | null } | null
  overrideEnabled: boolean
}

function violation(code: NextSeasonCreationViolation, message: string) {
  return { code, message }
}

/**
 * Pure, deterministic. Never mutates. Every branch returns a specific
 * NextSeasonCreationViolation — no generic failure strings.
 */
export function evaluateNextSeasonEligibility(input: EligibilityCheckInput): NextSeasonEligibilityResult {
  const violations: NextSeasonEligibilityResult['violations'] = []

  if (!input.league) {
    return { eligible: false, violations: [violation('SOURCE_SEASON_NOT_FOUND', 'Source league does not exist.')] }
  }
  if (!input.season) {
    return { eligible: false, violations: [violation('SOURCE_SEASON_NOT_FOUND', 'Source season does not exist.')] }
  }

  // Authorization — administrator override is checked separately below; a
  // plain commissioner must actually own/co-commission the source league.
  if (input.actorRole === 'commissioner') {
    const authorized = input.league.userId === input.actorUserId || input.league.teams.some(
      (t) => (t.isCommissioner || t.isCoCommissioner) && (t.claimedByUserId === input.actorUserId || t.platformUserId === input.actorUserId),
    )
    if (!authorized) violations.push(violation('UNAUTHORIZED', 'Actor is not a commissioner of the source league.'))
  } else if (input.actorRole === 'administrator' && !input.overrideEnabled) {
    violations.push(violation('UNAUTHORIZED', 'Administrator action requires an explicit, reasoned override.'))
  }

  if (!SUPPORTED_SPORTS.has(input.league.sport) || !SUPPORTED_SPORTS.has(input.season.sport)) {
    violations.push(violation('UNSUPPORTED_SPORT', `Sport "${input.league.sport}" is not supported for atomic next-season creation.`))
  }

  // Minimal, deterministic archive coordination (Gate C): the general
  // archiveLeague operation is itself non-transactional and unsafe (no
  // completeness gate — see the prior phase's SEASON_ARCHIVE_ARBITRATION_REPORT.md),
  // so it is not integrated into eligibility as a requirement. But this
  // check DOES block the specific corruption risk of spawning a new season
  // from a league that has already been closed out — `league.lifecycleState`
  // is read fresh, inside the same transaction, immediately before this
  // check, so a concurrent archive committing mid-race correctly triggers
  // the transaction's existing Serializable-conflict safety net rather than
  // silently producing an archived-source-with-live-destination state.
  if (input.league.lifecycleState === 'archived') {
    violations.push(violation('SOURCE_LEAGUE_ALREADY_ARCHIVED', 'Source league is already archived; renewal cannot spawn a new season from an archived league.'))
  }

  if (input.season.status !== 'complete') {
    violations.push(violation('SOURCE_SEASON_INCOMPLETE', `Source season status is "${input.season.status}", not "complete".`))
  }

  if (input.playoffBracketStatus !== null && input.playoffBracketStatus !== 'complete') {
    violations.push(violation('UNRESOLVED_CHAMPION', `Playoff bracket status is "${input.playoffBracketStatus}", not "complete".`))
  }

  if (input.rosters.length === 0) {
    violations.push(violation('UNRESOLVED_STANDINGS', 'Source season has no rosters to carry standings/ownership evidence from.'))
  }
  const incompleteMapping = input.rosters.filter((r) => !r.ownerId)
  if (incompleteMapping.length > 0) {
    violations.push(violation('MANAGER_MAPPING_INCOMPLETE', `${incompleteMapping.length} roster(s) have no owning manager.`))
  }

  if (input.requestedSeason !== input.season.season + 1) {
    violations.push(violation('INVALID_SEASON_SEQUENCE', `Requested season ${input.requestedSeason} does not immediately follow source season ${input.season.season}.`))
  }

  if (input.existingRenewal?.nextSeasonId) {
    violations.push(violation('DESTINATION_ALREADY_EXISTS', 'A destination season already exists for this renewal.'))
  } else if (input.existingRenewal && ['in_progress', 'confirming', 'ready'].includes(input.existingRenewal.status)) {
    // Renewal is open but not yet completed — not itself a violation; the
    // transaction will claim it. Distinguishing this from a fresh renewal
    // is the caller's job, not the eligibility evaluator's.
  }

  return { eligible: violations.length === 0, violations }
}
