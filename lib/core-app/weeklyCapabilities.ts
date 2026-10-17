/** Scoring capabilities, never inferred from missing opponents or a league name. */
export type WeeklyFormat = 'head-to-head' | 'elimination' | 'categories' | 'roto' | 'season-points'
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function weeklyFormat(league: { leagueType?: string | null; settings?: unknown }): WeeklyFormat {
  const s = object(league.settings)
  const blocks = [s, object(s.league), object(s.sleeper), object(s.sleeperLeague), object(s.sportConfig)]
  const values = [league.leagueType, ...blocks.flatMap(b => [b.scoring_mode, b.scoringMode, b.scoring_type, b.scoringType, b.format, b.leagueType])]
    .filter(v => typeof v === 'string').map(v => String(v).toLowerCase().replace(/[ -]/g, '_'))
  if (values.some(v => /guillotine|survivor|elimination/.test(v))) return 'elimination'
  if (values.some(v => /roto|rotisserie/.test(v))) return 'roto'
  if (values.some(v => /categor|h2h_each|h2h_most/.test(v))) return 'categories'
  if (values.some(v => /season_points|total_points|points_table/.test(v))) return 'season-points'
  return 'head-to-head'
}
export function nativeWeeklyLeague(league: { platform?: string | null; platformLeagueId?: string | null }): boolean {
  return ['allfantasy', 'native', 'manual', ''].includes(String(league.platform ?? '').toLowerCase()) && !league.platformLeagueId
    || ['allfantasy', 'native'].includes(String(league.platform ?? '').toLowerCase())
}
export function weeklyScopeKey(league: { id: string; platform?: string | null; platformLeagueId?: string | null }): string {
  return nativeWeeklyLeague(league) || !league.platformLeagueId ? `native:${league.id}`
    : `${String(league.platform ?? 'manual').toLowerCase()}:${league.platformLeagueId}`
}

/** Conservative arithmetic is a league status only when qualification rules are supported. */
export function canCertifyWeeklyPlayoffStatus(settings: unknown, fieldSource: string): boolean {
  if (fieldSource !== 'league') return false
  const s = object(settings)
  const blocks = [s, object(s.playoffSettings), object(s.playoff_settings), object(s.sleeper), object(s.league)]
  const enabled = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true'
  return !blocks.some(b => Number(b.division_count ?? b.numDivisions ?? 0) > 1
    || Array.isArray(b.divisions) && b.divisions.length > 1
    || Object.keys(object(b.divisions)).length > 1
    || enabled(b.divisionWinnersAdvance) || enabled(b.league_average_match) || enabled(b.medianGame) || enabled(b.median_game))
}
