import { resolveRosters, type FantraxPlayerRef, type FantraxTeamRoster, type ResolvedRoster } from './fantraxApi'

type SourceSport = 'CFB' | 'NFL' | 'NBA'
type Candidate = { sport: 'cfb' | 'nfl' | 'nba'; isDevy: boolean; resolved: ResolvedRoster[]; named: number }

/** Select the only provider directory that names the most roster players. */
export function selectFantraxSportMap(
  rosters: Record<string, FantraxTeamRoster>,
  maps: Partial<Record<SourceSport, Record<string, FantraxPlayerRef>>>,
): Candidate | null {
  const definitions = [
    { source: 'CFB', sport: 'cfb', isDevy: true },
    { source: 'NFL', sport: 'nfl', isDevy: false },
    { source: 'NBA', sport: 'nba', isDevy: false },
  ] as const
  const ranked = definitions.flatMap(({ source, sport, isDevy }) => {
    const map = maps[source]
    if (!map) return []
    const resolved = resolveRosters(rosters, map)
    return [{ sport, isDevy, resolved, named: resolved.reduce((sum, roster) => sum + roster.resolved, 0) }]
  }).sort((a, b) => b.named - a.named)
  if (!ranked[0] || ranked[0].named === 0 || ranked[0].named === ranked[1]?.named) return null
  return ranked[0]
}
