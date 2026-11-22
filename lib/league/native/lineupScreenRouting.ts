/**
 * Which native leagues get the lineup screen (`NativeLineupScreen`, tap to swap) on the team tab, and
 * which keep the classic Team tab. Dynasty leagues use the lineup screen: taxi and IR live there.
 * Devy and C2C keep the classic tab, the only place a devy squad and college rights can be moved;
 * IDP and best ball keep it too (IDP slot editing, and best ball sets no lineup).
 */
const COLLEGE_ROSTER_VARIANTS = new Set(['devy', 'devy_dynasty', 'c2c', 'merged_devy_c2c'])

export function hasCollegeRoster(variant: string | null | undefined): boolean {
  return COLLEGE_ROSTER_VARIANTS.has(String(variant ?? '').toLowerCase())
}

export function usesNativeLineupScreen(league: { leagueVariant?: string | null; idp: boolean; bestBall: boolean }): boolean {
  return !league.idp && !league.bestBall && !hasCollegeRoster(league.leagueVariant)
}

export type NativeScreen = 'matchup' | 'lineup' | 'waivers' | 'trades' | 'standings'

/**
 * Which native screen a tab opens, or null for the classic tab component.
 *
 * A league hosted here gets all five. Since 2026-11-22 an IMPORTED league shown in the workspace (not embedded in
 * the dashboard iframe) gets Matchup, Team, Trades and Standings too, so every league looks the same. An import keeps
 * the classic Waivers, and the classic Team tab when it has a college roster (`collegeRoster`: C2C / devy, whose
 * two-lineup roster lives there). Everywhere, IDP / best ball / college-variant leagues keep the classic Team tab and
 * Big Brother keeps its own standings.
 */
export function nativeScreenFor(tab: string, league: {
  hosted: boolean
  inWorkspace: boolean
  leagueVariant?: string | null
  idp: boolean
  bestBall: boolean
  /** collegeProFormatOf(league) !== null: a C2C or devy league by type or variant. */
  collegeRoster: boolean
}): NativeScreen | null {
  if (!league.hosted && !league.inWorkspace) return null
  switch (tab) {
    case 'matchups':
    case 'matchup':
      return 'matchup'
    case 'team':
    case 'roster':
    case 'squad':
      return usesNativeLineupScreen(league) && (league.hosted || !league.collegeRoster) ? 'lineup' : null
    case 'waivers':
      return league.hosted ? 'waivers' : null
    case 'trades':
      return 'trades'
    case 'standings':
      return league.leagueVariant === 'big_brother' ? null : 'standings'
    default:
      return null
  }
}
