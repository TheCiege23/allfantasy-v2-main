import 'server-only'

import { fetchFantraxScheduleWithScores, getFantraxLeagueInfo, getFantraxStandings } from './fantraxApi'

const ROAD_TO_GLORY_NFL_ID = 'tau9a8fomvmq84sx'

export function fetchRoadToGloryNflSnapshot() {
  return fetchRoadToGlorySnapshot(ROAD_TO_GLORY_NFL_ID)
}

export async function fetchRoadToGlorySnapshot(sourceId: string, now = new Date()) {
  const [league, records] = await Promise.all([
    getFantraxLeagueInfo(sourceId, { excludePlayerInfo: true }),
    getFantraxStandings(sourceId),
  ])
  if (!league.ok || !records.ok) throw new Error('Fantrax league or standings unavailable.')
  const info = league.data
  const season = Number(info.seasonYear)
  const teamCount = Object.keys(info.teamInfo).length
  const teamIds = new Set(records.data.map(row => row.teamId))
  if (!Number.isInteger(season) || season < 2000 || !info.leagueName?.trim() || !teamCount ||
      teamIds.size !== teamCount || records.data.length !== teamCount ||
      records.data.some(row => !info.teamInfo[row.teamId] || !row.teamName || !row.rank)) {
    throw new Error('Unexpected Road To Glory standings.')
  }

  // The public scoring feed also carries separately managed consolation brackets.
  const schedule = await fetchFantraxScheduleWithScores(sourceId, info, { now, includeUnscheduled: false })
  if (!schedule.position || schedule.periodsFailed) throw new Error('Fantrax scoring periods unavailable.')
  const standings = records.data.map(row => ({
    rosterId: row.teamId,
    rank: row.rank,
    team: row.teamName,
    division: info.teamInfo[row.teamId].division?.trim() ?? '',
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pointsFor: row.pointsFor,
  })).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))

  const weeks = []
  const periods = [...(info.scoringPeriods ?? [])].sort((a, b) => a.number - b.number)
  for (const period of periods) {
    if (period.number > schedule.position.scoredThrough) break
    const fixtures = schedule.rows.filter(row => row.week === period.number)
    if (!fixtures.some(row => row.played)) continue
    const matchups = fixtures.map((row, index) => {
      const first = { rosterId: row.awayTeamId, team: row.awayTeam, points: row.awayScore }
      const second = { rosterId: row.homeTeamId, team: row.homeTeam, points: row.homeScore }
      const winner = first.points == null || second.points == null || first.points === second.points
        ? null
        : first.points > second.points ? first.team : second.team
      return { id: index + 1, first, second, winner }
    })
    weeks.push({
      week: period.number,
      completed: !!period.endDate && Date.parse(period.endDate) <= now.getTime(),
      matchups,
    })
  }
  return {
    sourceLeagueId: sourceId, league: info.leagueName.trim(), season, fetchedAt: new Date().toISOString(), standings, weeks,
  }
}
