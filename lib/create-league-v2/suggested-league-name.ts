import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import { LEAGUE_TYPE_LABELS } from '@/lib/league-creation-wizard/league-type-registry'
import type { SupportedSport } from '@/lib/create-league-v2/state'

const SPORT_SHORT: Record<SupportedSport, string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAF: 'NCAAF',
  NCAAB: 'NCAAB',
  SOCCER: 'Soccer',
}

const TYPE_ADJECTIVE: Partial<Record<LeagueTypeId, string>> = {
  redraft: 'Redraft',
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  best_ball: 'Best Ball',
  guillotine: 'Guilly',
  survivor: 'Survivor',
  tournament: 'Tournament',
  devy: 'Devy',
  c2c: 'Campus to Canton',
  zombie: 'Zombie',
  salary_cap: 'Salary Cap',
  big_brother: 'Big Brother',
}

export function buildSuggestedLeagueName(args: {
  leagueType: LeagueTypeId
  sport: SupportedSport
  teamCount: number
  idpSelected: boolean
  /** Optional first name for “CJ’s …” style */
  commissionerFirstName?: string | null
}): string {
  const sportLabel = SPORT_SHORT[args.sport]
  const typeLabel =
    args.idpSelected ? 'IDP' : TYPE_ADJECTIVE[args.leagueType] ?? LEAGUE_TYPE_LABELS[args.leagueType] ?? 'Fantasy'
  const base = `${args.teamCount}-Team ${sportLabel} ${typeLabel} League`
  const first = args.commissionerFirstName?.trim()
  if (first && first.length <= 24) {
    const possessive = first.endsWith('s') ? `${first}'` : `${first}'s`
    return `${possessive} ${args.teamCount}-Team ${sportLabel} ${typeLabel} League`
  }
  return base
}
