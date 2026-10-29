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
