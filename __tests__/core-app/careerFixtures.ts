import type { CareerRow } from '@/lib/core-app/careerModel'

/** A finished Sleeper dynasty league-season, overridable field by field. */
let n = 0
export function row(over: Partial<CareerRow> = {}): CareerRow {
  n += 1
  const name = over.leagueName ?? 'Dynasty Dragons'
  const platform = over.platform ?? 'sleeper'
  const season = over.season ?? 2023
  return {
    source: 'legacy',
    key: `${platform}|${season}|${name.toLowerCase()}|${n}`,
    leagueKey: name.toLowerCase(),
    leagueName: name,
    platform,
    sport: 'NFL',
    season,
    status: 'complete',
    wins: 8,
    losses: 6,
    ties: 0,
    pointsFor: 1500,
    pointsAgainst: 1400,
    madePlayoffs: false,
    playoffKnown: true,
    isChampion: false,
    teamCount: 12,
    playoffTeams: 6,
    leagueType: 'dynasty',
    scoringType: 'ppr',
    settingsLabel: 'DYNASTY · PPR · 12 TEAM',
    refId: `ref-${n}`,
    providerLeagueId: `p-${n}`,
    counted: true,
    inRollup: true,
    ...over,
  }
}
