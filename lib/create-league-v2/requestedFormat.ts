/**
 * `/create-league?type=<format>` — open the wizard on a given format.
 *
 * Used by the per-format demos ("Create a league like this"). Applied with the SAME
 * transition a tap on that format's tile runs (`nextStateForLeagueType` / `nextStateForIdp`),
 * so draft type, team count and scoring preset are ones the format accepts. It is applied ON
 * TOP of a restored draft rather than instead of it, so a manager who had a half-filled form
 * keeps their name and choices and only the format changes.
 */
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { CreateLeagueV2State } from './state'
import { isSportAllowedForType } from './rules-engine'
import { nextStateForIdp, nextStateForLeagueType } from '@/components/create-league-v2/CreateLeagueWizard'

/** Formats a link may request. IDP is a redraft modifier, not a format id. Tournament is retired. */
export const REQUESTABLE_FORMATS = [
  'redraft', 'keeper', 'dynasty', 'best_ball', 'guillotine', 'survivor', 'survivor_guillotine',
  'zombie', 'big_brother', 'devy', 'c2c', 'salary_cap', 'pirate', 'idp',
] as const
export type RequestableFormat = (typeof REQUESTABLE_FORMATS)[number]

export function parseRequestedFormat(raw: string | null | undefined): RequestableFormat | null {
  const v = (raw ?? '').trim().toLowerCase()
  return (REQUESTABLE_FORMATS as readonly string[]).includes(v) ? (v as RequestableFormat) : null
}

export function applyRequestedFormat(state: CreateLeagueV2State, format: RequestableFormat): CreateLeagueV2State {
  if (format === 'idp') {
    const base = isSportAllowedForType(state.sport, 'redraft') ? state : { ...state, sport: 'NFL' as CreateLeagueV2State['sport'] }
    return { ...base, ...nextStateForIdp(base), leagueTypeTouched: true }
  }
  const type = format as LeagueTypeId
  // A restored NBA draft asked to become a Devy league: Devy is football-only, so the sport moves
  // to NFL first rather than producing a format/sport pair the server refuses.
  const base = isSportAllowedForType(state.sport, type) ? state : { ...state, sport: 'NFL' as CreateLeagueV2State['sport'] }
  return { ...base, ...nextStateForLeagueType(base, type), leagueTypeTouched: true }
}
