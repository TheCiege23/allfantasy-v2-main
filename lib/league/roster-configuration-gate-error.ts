/** Shared HTTP body + code for incomplete roster schema (draft start / picks / auction). */

const ROSTER_CONFIGURATION_INCOMPLETE_CODE = 'ROSTER_CONFIGURATION_INCOMPLETE' as const

type RosterConfigurationIncompleteCode = typeof ROSTER_CONFIGURATION_INCOMPLETE_CODE

type RosterConfigurationIncompleteBody = {
  code: RosterConfigurationIncompleteCode
  message: string
  leagueId?: string
}

/** HTTP body message (draft start / API). */
const DEFAULT_MESSAGE = 'Complete roster configuration before starting the draft.'

/** Client banner / snapshot copy when roster schema is missing. */
export const DRAFT_ROSTER_CONFIGURATION_CLIENT_MESSAGE =
  'Roster configuration is incomplete. The commissioner must save roster slots in league settings before drafting.'

export function rosterConfigurationIncompleteBody(options?: {
  message?: string
  leagueId?: string
}): RosterConfigurationIncompleteBody {
  return {
    code: ROSTER_CONFIGURATION_INCOMPLETE_CODE,
    message: options?.message ?? DEFAULT_MESSAGE,
    ...(options?.leagueId ? { leagueId: options.leagueId } : {}),
  }
}
