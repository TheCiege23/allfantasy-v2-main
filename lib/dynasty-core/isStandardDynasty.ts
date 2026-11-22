/** Standard dynasty shares native admission and season management, without specialty policies. */
export function isStandardDynasty(league: {
  leagueType?: string | null; leagueVariant?: string | null; isDynasty?: boolean | null
  bestBallMode?: boolean | null; guillotineMode?: boolean | null; survivorMode?: boolean | null
  settings?: unknown
}): boolean {
  const settings = league.settings && typeof league.settings === 'object'
    ? league.settings as Record<string, unknown> : {}
  const type = String(league.leagueType ?? settings.league_type ?? settings.leagueType ?? '').toLowerCase()
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  return (type === 'dynasty' || (league.isDynasty === true && ['', 'standard', 'redraft'].includes(type))) &&
    ['', 'standard', 'redraft', 'dynasty', 'dynasty_idp', 'idp'].includes(variant) &&
    !league.bestBallMode && !league.guillotineMode && !league.survivorMode &&
    !settings.bestBallMode && !settings.guillotineMode && !settings.survivorMode
}
