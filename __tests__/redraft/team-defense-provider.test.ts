/**
 * NFL Team-Defense PROVIDER (Sleeper) — pure tests (G8 final).
 *
 * Locks the provider contract against the REAL Sleeper weekly DST payload shape
 * (confirmed live: keys `sack`/`int`/`fum_rec`/`def_td`/`blk_kick`/`safe`/
 * `def_st_td`/`pts_allow`/`yds_allow`). Uses fixtures only — no live HTTP. The
 * fetch + DB sync is proven against staging by the engine E2E (step D6, injected
 * fixture fetcher).
 */
import { describe, expect, it } from 'vitest'
import { extractSleeperWeekStats } from '@/lib/redraft/teamDefenseProvider'
import { normalizeNflTeamDefenseWeeklyStats } from '@/lib/redraft/playerWeeklyScoreService'

// A realistic Sleeper `grouping=week` payload for a team defense.
const SLEEPER_WEEK_PAYLOAD = {
  '5': { sack: 4, int: 2, fum_rec: 1, def_td: 1, blk_kick: 0, safe: 1, def_st_td: 1, pts_allow: 13, yds_allow: 280, ff: 2 },
  '6': { sack: 1, int: 0, fum_rec: 0, pts_allow: 31, yds_allow: 410 },
}

describe('G8 provider — extractSleeperWeekStats', () => {
  it('returns the requested week object', () => {
    expect(extractSleeperWeekStats(SLEEPER_WEEK_PAYLOAD, 5)).toMatchObject({ sack: 4, pts_allow: 13 })
  })
  it('returns null for a missing week or a non-object payload', () => {
    expect(extractSleeperWeekStats(SLEEPER_WEEK_PAYLOAD, 99)).toBeNull()
    expect(extractSleeperWeekStats(null, 5)).toBeNull()
    expect(extractSleeperWeekStats([1, 2, 3], 5)).toBeNull()
  })
})

describe('G8 provider — Sleeper DST keys normalize to canonical def_*', () => {
  it('maps the full Sleeper week (incl. safe → def_safety, def_st_td)', () => {
    const week = extractSleeperWeekStats(SLEEPER_WEEK_PAYLOAD, 5)!
    expect(normalizeNflTeamDefenseWeeklyStats(week)).toEqual({
      def_sack: 4,
      def_int: 2,
      def_fr: 1,
      def_td: 1,
      def_blk_kick: 0,
      def_safety: 1,
      def_st_td: 1,
      def_points_allowed: 13,
      def_yds_allowed: 280,
    })
    // `ff` (forced fumbles) has no team-DST category → intentionally dropped.
  })

  it('maps the REAL Sleeper KC week-1 2024 shape (sack/ff/fum_rec/pts_allow/yds_allow)', () => {
    // Exactly the keys returned by the live API for KC W1 2024.
    const real = { sack: 1, ff: 1, fum_rec: 1, pts_allow: 20, yds_allow: 452, td: 3 }
    expect(normalizeNflTeamDefenseWeeklyStats(real)).toEqual({
      def_sack: 1,
      def_fr: 1,
      def_points_allowed: 20,
      def_yds_allowed: 452,
    })
    // bare `td` is NOT mapped to def_td (Sleeper uses `def_td` for defensive TDs).
  })

  it('the safe alias was the only normalizer gap — confirm it now maps', () => {
    expect(normalizeNflTeamDefenseWeeklyStats({ safe: 1 })).toEqual({ def_safety: 1 })
  })
})
