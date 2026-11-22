import { z } from 'zod'

export const HARDWOOD32_LEAGUE_ID = '1419790450268635136'
export const HARDWOOD32_WEEK = 4
const teamCount = 32
const recordPart = z.number().int().nonnegative()
const labels = z.object({ team_name: z.string().nullish() }).nullish()
const leagueSchema = z.object({
  league_id: z.literal(HARDWOOD32_LEAGUE_ID),
  name: z.string().min(1),
  season: z.string(),
  sport: z.literal('nba'),
  total_rosters: z.literal(teamCount),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})
const rosterSchema = z.object({
  roster_id: z.number().int().positive(),
  owner_id: z.string().nullish(),
  metadata: labels,
  settings: z.object({
    wins: recordPart, losses: recordPart, ties: recordPart.optional(),
    division: z.number().int().positive().nullish(),
    fpts: z.number(), fpts_decimal: z.number().int().optional(),
    fpts_against: z.number(), fpts_against_decimal: z.number().int().optional(),
  }),
})
const userSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullish(),
  metadata: labels,
})
const matchupSchema = z.object({
  roster_id: z.number().int().positive(),
  matchup_id: z.number().int().positive(),
  points: z.number().nullable(),
  custom_points: z.number().nullish(),
})

export function buildHardwood32Snapshot(input: { league: unknown; rosters: unknown; users: unknown; matchups: unknown }, fetchedAt: string) {
  const league = leagueSchema.parse(input.league)
  const rosters = z.array(rosterSchema).length(teamCount).parse(input.rosters)
  const users = new Map(z.array(userSchema).parse(input.users).map(user => [user.user_id, user]))
  const scheduled = z.array(matchupSchema).length(teamCount).parse(input.matchups)

  const teams = new Map(rosters.map(roster => {
    const manager = roster.owner_id ? users.get(roster.owner_id) : undefined
    const name = roster.metadata?.team_name?.trim() || manager?.metadata?.team_name?.trim() ||
      manager?.display_name?.trim() || `Team ${roster.roster_id}`
    if (roster.owner_id && !manager && !roster.metadata?.team_name?.trim()) throw new Error('Sleeper omitted a roster’s manager.')
    const { division, wins, losses, ties = 0, fpts, fpts_decimal = 0, fpts_against, fpts_against_decimal = 0 } = roster.settings
    const divisionName = league.metadata?.[`division_${division}`]
    return [roster.roster_id, {
      rosterId: roster.roster_id,
      team: name,
      division: typeof divisionName === 'string' && divisionName.trim() ? divisionName.trim() : division ? `Division ${division}` : '',
      wins, losses, ties,
      pointsFor: fpts + fpts_decimal / 100,
      pointsAgainst: fpts_against + fpts_against_decimal / 100,
    }]
  }))
  if (teams.size !== teamCount || new Set(scheduled.map(entry => entry.roster_id)).size !== teamCount) {
    throw new Error('Sleeper returned duplicate or missing teams.')
  }

  type Standing = (typeof teams extends Map<number, infer T> ? T : never)
  const winPct = (team: Standing) => (team.wins + team.ties / 2) / (team.wins + team.losses + team.ties || 1)
  const byRecord = (a: Standing, b: Standing) =>
    winPct(b) - winPct(a) || b.pointsFor - a.pointsFor || b.pointsAgainst - a.pointsAgainst
  let rank = 0
  const standings = [...teams.values()]
    .sort((a, b) => byRecord(a, b) || a.rosterId - b.rosterId)
    .map((team, index, sorted) => {
      if (!index || byRecord(sorted[index - 1], team)) rank = index + 1
      return { rank, ...team }
    })

  const byMatchup = new Map<number, Array<{ rosterId: number; team: string; points: number }>>()
  for (const row of scheduled) {
    const team = teams.get(row.roster_id)
    const points = row.custom_points ?? row.points
    if (!team || points == null) throw new Error('Sleeper returned an incomplete Week 4 score.')
    const sides = byMatchup.get(row.matchup_id) ?? []
    sides.push({ rosterId: row.roster_id, team: team.team, points })
    byMatchup.set(row.matchup_id, sides)
  }
  const matchups = [...byMatchup].sort(([a], [b]) => a - b).map(([id, sides]) => {
    if (sides.length !== 2) throw new Error('Sleeper did not return two teams for a Week 4 matchup.')
    const [first, second] = sides.sort((a, b) => a.rosterId - b.rosterId)
    return { id, first, second, winner: first.points > second.points ? first.team : second.points > first.points ? second.team : null }
  })
  return { sourceLeagueId: league.league_id, league: league.name, season: league.season, week: HARDWOOD32_WEEK, fetchedAt, standings, matchups }
}

export type Hardwood32Snapshot = ReturnType<typeof buildHardwood32Snapshot>
