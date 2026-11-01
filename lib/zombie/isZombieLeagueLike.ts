/** Some league payloads identify a specialty league by format, type, or variant. */
export function isZombieLeagueLike(league: { format?: string | null; leagueType?: string | null; leagueVariant?: string | null }): boolean {
  return [league.leagueVariant, league.leagueType, league.format].some(value => String(value ?? '').trim().toLowerCase() === 'zombie')
}
