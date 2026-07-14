/**
 * NFL Team Defense box-score INGESTION (G8 residual) — pure tests.
 *
 * Locks the ingestion contract: the week-merge is idempotent and
 * stat-correction-safe, the synthetic DEF player id normalizes team aliases, and
 * a payload with no recognized DST keys yields nothing (no fabrication). The full
 * DB pipeline (ingest → score-sync → DEF PlayerWeeklyScore scores) is proven on
 * staging by the engine E2E steps D3–D5.
 */
import { describe, expect, it } from 'vitest'
import {
  mergeWeekIntoTeamDefenseGameLog,
  buildTeamDefensePlayerId,
} from '@/lib/redraft/teamDefenseStatsIngest'
import { normalizeNflTeamDefenseWeeklyStats } from '@/lib/redraft/playerWeeklyScoreService'

describe('G8 feed — synthetic DEF player id', () => {
  it('builds nfl:def:<ABBR> and normalizes team aliases', () => {
    expect(buildTeamDefensePlayerId('KC')).toBe('nfl:def:KC')
    expect(buildTeamDefensePlayerId('kc')).toBe('nfl:def:KC')
    expect(buildTeamDefensePlayerId('JAC')).toBe('nfl:def:JAX') // alias
    expect(buildTeamDefensePlayerId(' wsh ')).toBe('nfl:def:WAS')
  })
})

describe('G8 feed — week merge is idempotent + stat-correction safe', () => {
  it('inserts a week into an empty/absent game log', () => {
    expect(mergeWeekIntoTeamDefenseGameLog(null, 3, { def_sack: 2 })).toEqual([{ week: 3, def_sack: 2 }])
  })

  it('replaces (not appends) when the same week is re-ingested — stat correction', () => {
    const first = mergeWeekIntoTeamDefenseGameLog(null, 3, { def_sack: 2, def_int: 1 })
    const corrected = mergeWeekIntoTeamDefenseGameLog(first, 3, { def_sack: 4, def_int: 1 })
    expect(corrected).toEqual([{ week: 3, def_sack: 4, def_int: 1 }])
    expect(corrected).toHaveLength(1) // no duplicate week
  })

  it('preserves other weeks and keeps the log sorted', () => {
    const log = mergeWeekIntoTeamDefenseGameLog([{ week: 1, def_sack: 1 }], 3, { def_sack: 2 })
    const merged = mergeWeekIntoTeamDefenseGameLog(log, 2, { def_sack: 5 })
    expect(merged.map((r) => r.week)).toEqual([1, 2, 3])
  })

  it('re-running the exact same ingest is a no-op on the data', () => {
    const a = mergeWeekIntoTeamDefenseGameLog([{ week: 5, def_td: 1 }], 5, { def_td: 1 })
    const b = mergeWeekIntoTeamDefenseGameLog(a, 5, { def_td: 1 })
    expect(b).toEqual([{ week: 5, def_td: 1 }])
  })
})

describe('G8 feed — no fabrication', () => {
  it('a payload with no recognized DST keys normalizes to {} (ingestion skips it)', () => {
    expect(normalizeNflTeamDefenseWeeklyStats({ pass_yds: 300, foo: 1 })).toEqual({})
  })

  it('maps a realistic provider team-defense payload to canonical def_* keys', () => {
    const provider = { sacks: 3, interceptions: 2, fumbles_recovered: 1, safeties: 0, blocked_kicks: 1, defensive_td: 1, ret_td: 1, points_allowed: 13, yards_allowed: 280 }
    expect(normalizeNflTeamDefenseWeeklyStats(provider)).toEqual({
      def_sack: 3,
      def_int: 2,
      def_fr: 1,
      def_safety: 0,
      def_blk_kick: 1,
      def_td: 1,
      def_st_td: 1,
      def_points_allowed: 13,
      def_yds_allowed: 280,
    })
  })
})
