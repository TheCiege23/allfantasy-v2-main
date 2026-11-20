import 'server-only'
import { loadLeaguePlayerMetrics } from './leaguePlayerMetrics'
import { loadUnavailableBySport } from '@/lib/core-app/unavailableStarters'

export type RosterWeekRequest = { leagueId: string; season: number; week: number; ids: readonly string[] }
export type RosterWeekPlayer = { points: number | null; team: string | null; unavailable: boolean }

/** Portfolio views can span dozens of leagues. Bound board reads and share availability for each sport-week. */
export async function loadLeagueRosterWeeks(requests: RosterWeekRequest[]) {
  const result = new Map<string, Map<string, RosterWeekPlayer>>()
  const cohorts = new Map<string, { sport: string; season: number; week: number; players: Map<string, RosterWeekPlayer[]> }>()
  for (let offset = 0; offset < requests.length; offset += 4) {
    await Promise.all(requests.slice(offset, offset + 4).map(async ({ leagueId, season, week, ids }) => {
      const rosterIds = [...new Set(ids.filter(id => id && id !== '0' && !id.startsWith('name:')))]
      if (!rosterIds.length) return
      const board = await loadLeaguePlayerMetrics({ leagueId, week, rosterIds, limit: rosterIds.length, includeTradeValues: false }).catch(() => null)
      if (board?.unit !== 'fantasy points' || board.week !== week || board.season !== season) return
      const players = new Map<string, RosterWeekPlayer>()
      result.set(leagueId, players)
      const key = [board.sport, season, week].join(':')
      let cohort = cohorts.get(key)
      if (!cohort) cohorts.set(key, cohort = { sport: board.sport, season, week, players: new Map() })
      for (const row of board.rows) {
        if (!row.rosterPlayerId) continue
        const player = { points: row.weekly, team: row.team ?? null, unavailable: false }
        players.set(row.rosterPlayerId, player)
        if (row.availabilityId) {
          const matches = cohort.players.get(row.availabilityId) ?? []
          matches.push(player)
          cohort.players.set(row.availabilityId, matches)
        }
      }
    }))
  }
  await Promise.all([...cohorts.values()].map(async cohort => {
    if (!cohort.players.size) return
    const unavailable = await loadUnavailableBySport({ sleeperIds: [...cohort.players.keys()], sports: [cohort.sport],
      season: cohort.season, week: cohort.week }).catch(() => new Map<string, Set<string>>())
    for (const id of unavailable.get(cohort.sport) ?? []) {
      for (const player of cohort.players.get(id) ?? []) {
        player.points = 0
        player.unavailable = true
      }
    }
  }))
  return result
}
