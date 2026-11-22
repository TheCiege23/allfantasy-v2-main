import { loadLeaguePlayerMetrics } from './leaguePlayerMetrics'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { easternDayKey } from '@/lib/redraft/lineupLock'
import { isUnavailableForProjection } from '@/lib/projections/dailySportForm'

export async function leagueRosterForecasts<T extends { projectedPoints: number | null; injuryStatus?: string | null }>(
  rows: readonly T[],
  league: { id: string; sport: string | null; season: number | null; settings: unknown },
  ids: readonly (string | null)[],
  options: { canonical?: boolean; day?: string | null } = {},
) {
  if (!rows.length) return [...rows]
  const now = new Date()
  const day = isDailyLineupScoringEnabled(league.settings, league.sport) ? options.day ?? easternDayKey(now) : null
  const week = day && league.sport && league.season
    ? dailySportWeekForInstant(league.sport, league.season, new Date(day + 'T16:00:00Z')) : null
  const known = ids.filter((id): id is string => Boolean(id))
  const metrics = known.length ? await loadLeaguePlayerMetrics({ leagueId: league.id, day, week,
    ...(options.canonical ? { playerIds: known } : { rosterIds: known }), limit: known.length, includeTradeValues: false,
  }).catch(() => null) : null
  const byId = new Map(metrics?.rows.map(row => [options.canonical ? row.playerId : row.rosterPlayerId, row]))
  return rows.map((player, i) => {
    const row = byId.get(ids[i] ?? '')
    const points = metrics?.unit === 'fantasy points' && row ? (day ? row.daily : row.weekly) : null
    const rank = row?.positionCount ? { position: row.position, rank: row.positionRank, of: row.positionCount } : null
    return { ...player, projectedPoints: points == null ? null : isUnavailableForProjection(player.injuryStatus) ? 0 : points,
      projectionsSource: points == null ? null : 'allfantasy', positionRank: rank,
      positionRankLabel: rank ? rank.position + rank.rank : null }
  })
}
