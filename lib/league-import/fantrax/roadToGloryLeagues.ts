export const roadToGloryLeagues = [
  { key: 'ncaa-football', sourceId: 'goiyxz7ommwjt3es', title: 'Road To Glory NCAA Football' },
  { key: 'ncaa-basketball', sourceId: '7qkhjoyomt7op56k', title: 'Road To Glory NCAA Basketball' },
  { key: 'mlb', sourceId: 'eehabi2ymwiko1gk', title: 'Road To Glory MLB' },
  { key: 'nba', sourceId: '9lj5smn5mw7g062o', title: 'Road To Glory NBA' },
] as const

export type RoadToGloryLeague = (typeof roadToGloryLeagues)[number]

export function roadToGloryLeagueForSource(value: string | null) {
  const composite = value?.match(/^fantrax-league:([^|]+)\|/i)
  const id = composite?.[1] ?? value
  return roadToGloryLeagues.find(league => league.sourceId === id)
}
