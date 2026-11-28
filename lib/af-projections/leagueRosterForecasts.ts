import { loadLeaguePlayerMetrics } from './leaguePlayerMetrics'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { easternDayKey } from '@/lib/redraft/lineupLock'
import { isUnavailableForProjection } from '@/lib/projections/dailySportForm'

export async function leagueRosterForecasts<T extends { projectedPoints: number | null; injuryStatus?: string | null }>(
  rows: readonly T[],
  league: { id: string; sport: string | null; season: number | null; settings: unknown },
  ids: readonly (string | null)[],
  /** `afIntelligence: false` prices without AF's learned factors (a viewer without the plan); the result also carries
   * `afFactors` with the number before them, so the response gate can revert it either way. */
  options: { canonical?: boolean; day?: string | null; afIntelligence?: boolean } = {},
) {
  if (!rows.length) return [...rows]
  const now = new Date()
  const day = isDailyLineupScoringEnabled(league.settings, league.sport) ? options.day ?? easternDayKey(now) : null
  const week = day && league.sport && league.season
    ? dailySportWeekForInstant(league.sport, league.season, new Date(day + 'T16:00:00Z')) : null
  const known = ids.filter((id): id is string => Boolean(id))
  const metrics = known.length ? await loadLeaguePlayerMetrics({ leagueId: league.id, day, week,
    ...(options.canonical ? { playerIds: known } : { rosterIds: known }), limit: known.length, includeTradeValues: false,
    ...(options.afIntelligence === false ? { afIntelligence: false } : {}),
  }).catch(() => null) : null
  const byId = new Map(metrics?.rows.map(row => [options.canonical ? row.playerId : row.rosterPlayerId, row]))
  return rows.map((player, i) => {
    const row = byId.get(ids[i] ?? '')
    const points = metrics?.unit === 'fantasy points' && row ? (day ? row.daily : row.weekly) : null
    const rank = row?.positionCount ? { position: row.position, rank: row.positionRank, of: row.positionCount } : null
    const out = isUnavailableForProjection(player.injuryStatus)
    const before = row?.afFactors?.unadjusted?.[day ? 'daily' : 'weekly']
    const afFactors = points != null && !out && row?.afFactors && before != null
      ? { multiplier: row.afFactors.multiplier, reasons: row.afFactors.reasons, unadjusted: { projectedPoints: before } }
      : undefined
    return { ...player, projectedPoints: points == null ? null : out ? 0 : points,
      projectionsSource: points == null ? null : 'allfantasy', positionRank: rank,
      positionRankLabel: rank ? rank.position + rank.rank : null, ...(afFactors ? { afFactors } : {}) }
  })
}
