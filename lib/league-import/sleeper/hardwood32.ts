import { z } from 'zod'

export const HARDWOOD32_LEAGUE_ID = '1419790450268635136'
const teamCount = 32
const recordPart = z.number().int().nonnegative()
const scoringWeek = z.number().int().min(1).max(30)
const labels = z.object({ team_name: z.string().nullish() }).nullish()
const leagueSchema = z.object({
  league_id: z.literal(HARDWOOD32_LEAGUE_ID),
  name: z.string().min(1),
  season: z.string(),
  sport: z.literal('nba'),
  total_rosters: z.literal(teamCount),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  settings: z.object({
    start_week: scoringWeek,
    leg: scoringWeek,
    last_scored_leg: scoringWeek.or(z.literal(0)),
    playoff_week_start: scoringWeek,
  }),
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
  matchup_id: z.number().int().positive().nullable(),
  points: z.number().nullable(),
  custom_points: z.number().nullish(),
})

export function readHardwood32League(raw: unknown) {
  return leagueSchema.parse(raw)
}

export function buildHardwood32Snapshot(input: {
  league: ReturnType<typeof readHardwood32League>
  rosters: unknown
  users: unknown
  weeks: ReadonlyMap<number, unknown>
}, fetchedAt: string) {
  const { league } = input
  const rosters = z.array(rosterSchema).length(teamCount).parse(input.rosters)
  const users = new Map(z.array(userSchema).parse(input.users).map(user => [user.user_id, user]))

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
  if (teams.size !== teamCount) throw new Error('Sleeper returned duplicate rosters.')

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

  const { start_week: startWeek, leg: currentWeek, last_scored_leg: lastScoredWeek, playoff_week_start: playoffStart } = league.settings
  const weeks = []
  for (let week = startWeek; week <= Math.max(currentWeek, lastScoredWeek); week++) {
    const completed = week <= lastScoredWeek
    const playoffs = week >= playoffStart
    const rows = z.array(matchupSchema).max(teamCount).parse(input.weeks.get(week))
    if (!completed && !rows.some(row => row.custom_points != null || (row.points != null && row.points !== 0))) continue
    const seen = new Set<number>()
    const byMatchup = new Map<number, Array<{ rosterId: number; team: string; points: number | null }>>()
    for (const row of rows) {
      const team = teams.get(row.roster_id)
      if (!team || seen.has(row.roster_id)) throw new Error(`Invalid Sleeper roster in Week ${week}.`)
      seen.add(row.roster_id)
      if (row.matchup_id == null && playoffs) continue
      const points = row.custom_points ?? row.points
      if (row.matchup_id == null || (completed && points == null)) throw new Error(`Incomplete Sleeper matchup in Week ${week}.`)
      const sides = byMatchup.get(row.matchup_id) ?? []
      sides.push({ rosterId: row.roster_id, team: team.team, points })
      byMatchup.set(row.matchup_id, sides)
    }
    if (!playoffs && seen.size !== teamCount) throw new Error(`Sleeper omitted teams in Week ${week}.`)
    const matchups = [...byMatchup].sort(([a], [b]) => a - b).flatMap(([id, sides]) => {
      if (playoffs && sides.length === 1) return []
      if (sides.length !== 2) throw new Error(`Invalid Sleeper matchup in Week ${week}.`)
      const [first, second] = sides.sort((a, b) => a.rosterId - b.rosterId)
      const winner = first.points == null || second.points == null || first.points === second.points
        ? null
        : first.points > second.points ? first.team : second.team
      return [{ id, first, second, winner }]
    })
    if (matchups.length) weeks.push({ week, completed, matchups })
  }
  // Existing staging sheet scripts can read Week 4 until they adopt the season export.
  const weekFour = weeks.find(week => week.week === 4)
  return {
    sourceLeagueId: league.league_id, league: league.name, season: league.season, fetchedAt, standings, weeks,
    week: 4, matchups: weekFour?.matchups ?? [],
  }
}

export type Hardwood32Snapshot = ReturnType<typeof buildHardwood32Snapshot>
