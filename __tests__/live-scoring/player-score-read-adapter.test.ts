/**
 * Canonical player-score read adapter — deterministic unit/regression tests
 * (G11 Phase 2b). Proves the score-store unification precedence:
 *   materialized WeeklyScore  >  computed-from-PlayerWeeklyScore  >  none
 * including the regression cases the task requires: a PlayerWeeklyScore row flows
 * into the payload, DEF scores/stat lines flow, and stat corrections win.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  mergeCanonicalPlayerScores,
  type MaterializedScoreRow,
  type RawStatRow,
} from '@/lib/live-scoring/playerScoreReadAdapter'

const mat = (playerId: string, points: number, statLine: unknown = {}): [string, MaterializedScoreRow] => [
  playerId,
  { playerId, points, statLine },
]
const raw = (playerId: string, stats: Record<string, number>, isFinalized = false): [string, RawStatRow] => [
  playerId,
  { playerId, stats, isFinalized },
]

describe('canonical score adapter — precedence', () => {
  it('REGRESSION: a PlayerWeeklyScore (raw) row flows into the payload via the concept scorer', async () => {
    const out = await mergeCanonicalPlayerScores({
      requestedPlayers: [{ playerId: 'p1', position: 'QB' }],
      materialized: new Map(),
      rawStats: new Map([raw('p1', { pass_yds: 300, pass_td: 2 }, true)]),
      scoreFromStats: async ({ stats }) => (stats.pass_yds ?? 0) * 0.04 + (stats.pass_td ?? 0) * 4,
    })
    const p1 = out.get('p1')!
    expect(p1.source).toBe('computed')
    expect(p1.points).toBe(20) // 300*0.04 + 2*4
    expect(p1.statLine).toEqual({ pass_yds: 300, pass_td: 2 })
    expect(p1.isFinalized).toBe(true)
  })

  it('materialized WeeklyScore wins over raw and is NOT recomputed (no duplicated math)', async () => {
    const scorer = vi.fn(async () => 999)
    const out = await mergeCanonicalPlayerScores({
      requestedPlayers: [{ playerId: 'p1', position: 'RB' }],
      materialized: new Map([mat('p1', 17.5, { rush: 18, yds: 90, td: 1 })]),
      rawStats: new Map([raw('p1', { rush: 18, rush_yds: 90 })]),
      scoreFromStats: scorer,
    })
    const p1 = out.get('p1')!
    expect(p1.source).toBe('materialized')
    expect(p1.points).toBe(17.5)
    expect(p1.statLine).toEqual({ rush: 18, yds: 90, td: 1 })
    expect(scorer).not.toHaveBeenCalled() // committed result reused, never re-scored
  })

  it('REGRESSION: DEF (nfl:def:KC) raw stats + name-bearing id flow with the scored value', async () => {
    const out = await mergeCanonicalPlayerScores({
      requestedPlayers: [{ playerId: 'nfl:def:KC', position: 'DEF' }],
      materialized: new Map(),
      rawStats: new Map([raw('nfl:def:KC', { def_sack: 3, def_int: 1, def_points_allowed: 10 })]),
      // Mirrors the sport-config DEF scorer (R1 bridge): 3 sacks×5 + PA tier 4 = 19.
      scoreFromStats: async ({ playerId, stats }) => {
        expect(playerId).toBe('nfl:def:KC')
        return (stats.def_sack ?? 0) * 5 + 4
      },
    })
    const def = out.get('nfl:def:KC')!
    expect(def.source).toBe('computed')
    expect(def.points).toBe(19)
    expect(def.statLine).toMatchObject({ def_sack: 3, def_int: 1 })
  })

  it('REGRESSION: a stat correction (updated materialized points) wins', async () => {
    // Provider corrects a fumble: weeklyProcessor re-materialized WeeklyScore to 12.4.
    const out = await mergeCanonicalPlayerScores({
      requestedPlayers: [{ playerId: 'p1', position: 'WR' }],
      materialized: new Map([mat('p1', 12.4, { rec: 6, yds: 64, corrected: true })]),
      rawStats: new Map([raw('p1', { rec: 6, rec_yds: 64 })]),
      scoreFromStats: async () => 14.4, // stale raw-derived value must NOT be used
    })
    expect(out.get('p1')!.points).toBe(12.4)
    expect(out.get('p1')!.statLine).toMatchObject({ corrected: true })
  })

  it('no data for a requested player → neutral none (0 / null), never throws', async () => {
    const out = await mergeCanonicalPlayerScores({
      requestedPlayers: [{ playerId: 'ghost', position: 'TE' }],
      materialized: new Map(),
      rawStats: new Map(),
      scoreFromStats: async () => 5,
    })
    const ghost = out.get('ghost')!
    expect(ghost.source).toBe('none')
    expect(ghost.points).toBe(0)
    expect(ghost.statLine).toBeNull()
  })

  it('is idempotent: identical inputs produce identical output', async () => {
    const args = {
      requestedPlayers: [{ playerId: 'p1', position: 'QB' }],
      materialized: new Map<string, MaterializedScoreRow>(),
      rawStats: new Map([raw('p1', { pass_td: 3 })]),
      scoreFromStats: async ({ stats }: { stats: Record<string, number> }) => (stats.pass_td ?? 0) * 4,
    }
    const a = await mergeCanonicalPlayerScores(args)
    const b = await mergeCanonicalPlayerScores(args)
    expect(a.get('p1')).toEqual(b.get('p1'))
  })

  it('rounds computed points to 2 decimals (stable totals)', async () => {
    const out = await mergeCanonicalPlayerScores({
      requestedPlayers: [{ playerId: 'p1' }],
      materialized: new Map(),
      rawStats: new Map([raw('p1', { rec_yds: 33 })]),
      scoreFromStats: async ({ stats }) => (stats.rec_yds ?? 0) * 0.1, // 3.3000000004-ish
    })
    expect(out.get('p1')!.points).toBe(3.3)
  })
})
