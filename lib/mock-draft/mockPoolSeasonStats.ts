/**
 * Season stats for the mock draft pool — the same numbers the live draft room's stat columns show.
 *
 * The live room attaches them inside `getResolvedDraftPoolForLeague`, which needs a league. A mock
 * has none, so this runs the same three readers on the mock's own rows:
 *   - NFL: Rolling Insights identity (PlayerIdentityMap) → season box → `nflDraftSeasonLine`, scored
 *     with the mock's PPR / Half PPR / Standard setting. One season for the whole pool, as in the room.
 *   - NBA / NHL / MLB: `loadStoredDraftSeasonStats`, joined on the row's Rolling Insights id (the
 *     mock's non-NFL rows already carry it as `playerId`).
 * Everything reads Postgres; no provider is called. A row with no match keeps its dashes, and a
 * failed read leaves the whole pool as it was rather than failing the mock.
 */
import {
  defaultNflPlayerStatsSeason,
  loadRollingInsightsSeasonByDraftPoolKey,
  loadRollingInsightsStatsDetailByPlayerIds,
} from '@/lib/draft/analytics/nfl-rolling-insights-draft-analytics'
import { nflDraftSeasonLine } from '@/lib/draft-room/nflDraftSeasonLine'
import { loadStoredDraftSeasonStats } from '@/lib/draft-room/storedDraftSeasonStats'
import { attachTeamDefenseStats, loadNflTeamDefenseSeason } from '@/lib/draft-room/nflTeamDefenseSeason'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

type Row = Record<string, unknown>

export interface MockSeasonStatFields {
  /** Merged into `display.stats`, where the stat columns read them. */
  stats?: Record<string, number | null> | null
  nflDraftProjectionSplits?: unknown
  statSeason?: string | null
}

/** The mock's scoring label as the scoring engine's preset. */
export function mockScoringPreset(scoring: string | null | undefined): 'PPR' | 'HALF_PPR' | 'STANDARD' {
  const s = String(scoring ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (s === 'halfppr' || s === 'half') return 'HALF_PPR'
  if (s === 'standard' || s === 'std') return 'STANDARD'
  return 'PPR'
}

/** Pure: fold one row's season fields into it, keeping everything else (headshots, ids) untouched. */
export function mergeSeasonStatsIntoEntry<T>(entry: T, fields: MockSeasonStatFields | null | undefined): T {
  if (!fields || !entry || typeof entry !== 'object') return entry
  const row = entry as Row
  const display = (row.display && typeof row.display === 'object' ? row.display : {}) as Row
  const oldStats = (display.stats && typeof display.stats === 'object' ? display.stats : {}) as Row
  const stats: Row = { ...oldStats }
  for (const [k, v] of Object.entries(fields.stats ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v
  }
  return {
    ...row,
    display: { ...display, stats },
    ...(fields.nflDraftProjectionSplits ? { nflDraftProjectionSplits: fields.nflDraftProjectionSplits } : {}),
    ...(fields.statSeason ? { statSeason: fields.statSeason } : {}),
  } as T
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

async function nflFields(
  entries: Row[],
  scoring: string | null | undefined,
): Promise<{ fields: Array<MockSeasonStatFields | null>; season: number }> {
  const keys = entries.map((e) => {
    const nk = canonicalName(str(e.name) ?? '')
    const pk = (str(e.position) ?? '').toLowerCase()
    const sid = str(e.sleeperId) ?? str(e.playerId)
    return { nk, pk, sleeperCandidate: sid }
  })
  const statsYear = Number(defaultNflPlayerStatsSeason())
  const { identityByPoolKey } = await loadRollingInsightsSeasonByDraftPoolKey({ rows: keys })
  if (identityByPoolKey.size === 0) return { fields: entries.map(() => null), season: statsYear }

  const riIds = [...new Set([...identityByPoolKey.values()].map((v) => v.rollingInsightsPlayerId))]
  const detailById = await loadRollingInsightsStatsDetailByPlayerIds(riIds, {
    candidateSeasons: [String(statsYear), String(statsYear - 1)],
  })
  const season = Number([...detailById.values()].find((d) => d.season)?.season ?? statsYear)
  const { buildLeagueStatScorer } = await import('@/lib/redraft/scoringEngine')
  const scorer = buildLeagueStatScorer({ sport: 'NFL', settings: { sportConfig: { scoringPreset: mockScoringPreset(scoring) } } })

  const fields = entries.map((e, i) => {
    const idn = identityByPoolKey.get(`${keys[i]!.nk}|${keys[i]!.pk}`)
    const d = idn ? detailById.get(idn.rollingInsightsPlayerId) : null
    if (!d) return null
    const line = nflDraftSeasonLine(
      {
        stats: d.stats,
        fantasyPointsPerGame: d.fantasyPointsPerGame,
        fantasyPointsSeason: d.fantasyPoints,
        gamesPlayed: d.gamesPlayed ?? null,
        season: d.season ?? null,
        updatedAt: d.updatedAt ?? new Date(0),
      },
      d.stats,
      str(e.position) ?? '',
      season,
      scorer,
    )
    if (!line) return null
    return {
      stats: { fantasyPointsPerGame: line.fantasyPointsPerGame ?? null },
      nflDraftProjectionSplits: line.splits,
      statSeason: line.season ?? null,
    }
  })
  return { fields, season }
}

async function storedFields(sport: 'NBA' | 'NHL' | 'MLB', entries: Row[]): Promise<Array<MockSeasonStatFields | null>> {
  const ids = entries.map((e) => {
    const id = str(e.playerId)
    return id && /^\d+$/.test(id) ? id : null
  })
  const stored = await loadStoredDraftSeasonStats(sport, ids.filter((id): id is string => id != null), new Date().getUTCFullYear())
  return ids.map((id) => {
    const s = id ? stored.get(id) : null
    if (!s) return null
    const line = (sport === 'NBA' ? s.nbaDraftStats : s.seasonStatLine) as Record<string, number | null> | null
    return line ? { stats: line, statSeason: s.statSeason } : null
  })
}

export async function attachSeasonStatsToMockPool<T>(
  entries: T[],
  options: { sport: string; scoring?: string | null },
): Promise<T[]> {
  const sport = normalizeToSupportedSport(options.sport)
  const rows = entries as unknown as Row[]
  if (!rows.length) return entries
  try {
    if (sport === 'NFL') {
      const { fields, season } = await nflFields(rows, options.scoring)
      const withPlayers = entries.map((entry, i) => mergeSeasonStatsIntoEntry(entry, fields[i]))
      // Team defenses (DEF rows): the live pool's SACK / INT / TD / PA/G, same season.
      const { buildLeagueStatScorer } = await import('@/lib/redraft/scoringEngine')
      const scorer = buildLeagueStatScorer({ sport: 'NFL', settings: { sportConfig: { scoringPreset: mockScoringPreset(options.scoring) } } })
      const defense = await loadNflTeamDefenseSeason(season, scorer).catch(() => new Map())
      return attachTeamDefenseStats(withPlayers, defense)
    }
    const fields = sport === 'NBA' || sport === 'NHL' || sport === 'MLB' ? await storedFields(sport, rows) : null
    if (!fields) return entries
    return entries.map((entry, i) => mergeSeasonStatsIntoEntry(entry, fields[i]))
  } catch (error) {
    console.warn('[mock-draft/pool] season stats unavailable', { sport, error: String(error) })
    return entries
  }
}
