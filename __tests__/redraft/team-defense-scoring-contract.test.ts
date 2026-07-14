/**
 * Team Defense / Special-Teams (DST) scoring contract (gap G8) — pure tests.
 *
 * Proves the NFL DEF roster slot now scores: every team-defense category, the
 * points-allowed tier resolver, the team-D stat normalizer (kept separate from
 * the offensive one to avoid key collisions), points-allowed derivation from a
 * game result, and that commissioner overrides flow through to DST categories.
 *
 * These run through the SAME authoritative scorer (`scoreStatsWithCategories`)
 * the cron and matchup engine use, so what is asserted here is what scores.
 * See docs/redraft-commissioner-scoring-contract.md.
 */
import { describe, expect, it } from 'vitest'
import { scoreStatsWithCategories, applyScoringPresetToRecPoints } from '@/lib/redraft/scoringEngine'
import { getScoringCategories, expandSportConfigToggles } from '@/lib/sportConfig'
import {
  normalizeNflTeamDefenseWeeklyStats,
  normalizeNflWeeklyStats,
  pointsAllowedFromGame,
  teamAbbrevFromDefPlayerId,
  isTeamDefenseRow,
} from '@/lib/redraft/playerWeeklyScoreService'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Resolve NFL categories + preset + overrides exactly like calculateScoreFromSportConfig. */
function nflScore(
  rawStats: Record<string, number>,
  opts: { preset?: string; toggles?: string[]; overrides?: Record<string, number> } = {},
): number {
  const toggles = expandSportConfigToggles(opts.toggles ?? [])
  let cats = getScoringCategories('NFL', toggles)
  cats = applyScoringPresetToRecPoints(cats, opts.preset ?? 'PPR', opts.overrides ?? {})
  return round2(scoreStatsWithCategories(cats, rawStats, opts.overrides ?? {}))
}

describe('G8 DST — team-defense categories exist and are active by default', () => {
  it('exposes the standard DST categories in the NFL config without any toggle', () => {
    const cats = getScoringCategories('NFL', [])
    for (const key of [
      'def_sack',
      'def_int',
      'def_fr',
      'def_safety',
      'def_blk_kick',
      'def_td',
      'def_st_td',
      'def_pa_0',
      'def_pa_35_plus',
    ]) {
      expect(cats.some((c) => c.key === key)).toBe(true)
    }
  })

  it('scores each DST counting category at its default', () => {
    expect(nflScore({ def_sack: 4 })).toBe(4) // 4 * 1
    expect(nflScore({ def_int: 2 })).toBe(4) // 2 * 2
    expect(nflScore({ def_fr: 1 })).toBe(2)
    expect(nflScore({ def_safety: 1 })).toBe(2)
    expect(nflScore({ def_blk_kick: 1 })).toBe(2)
    expect(nflScore({ def_td: 1 })).toBe(6)
    expect(nflScore({ def_st_td: 1 })).toBe(6)
  })
})

describe('G8 DST — points-allowed tiers', () => {
  it('maps a points-allowed value to exactly one tier', () => {
    expect(nflScore({ def_points_allowed: 0 })).toBe(10)
    expect(nflScore({ def_points_allowed: 6 })).toBe(7)
    expect(nflScore({ def_points_allowed: 7 })).toBe(4)
    expect(nflScore({ def_points_allowed: 13 })).toBe(4)
    expect(nflScore({ def_points_allowed: 14 })).toBe(1)
    expect(nflScore({ def_points_allowed: 20 })).toBe(1)
    expect(nflScore({ def_points_allowed: 21 })).toBe(0)
    expect(nflScore({ def_points_allowed: 28 })).toBe(-1)
    expect(nflScore({ def_points_allowed: 34 })).toBe(-1)
    expect(nflScore({ def_points_allowed: 35 })).toBe(-4)
    expect(nflScore({ def_points_allowed: 59 })).toBe(-4)
  })

  it('a shutout (0) scores the top tier, distinct from no data (absent → 0)', () => {
    expect(nflScore({ def_points_allowed: 0 })).toBe(10)
    expect(nflScore({})).toBe(0) // no def_points_allowed key → no tier fires
  })
})

describe('G8 DST — full line and commissioner overrides', () => {
  it('sums counting categories + the matched points-allowed tier', () => {
    // 4 sacks, 2 INT, 1 FR, 1 def TD, allowed 10 (7–13 tier = 4)
    const stats = { def_sack: 4, def_int: 2, def_fr: 1, def_td: 1, def_points_allowed: 10 }
    expect(nflScore(stats)).toBe(round2(4 * 1 + 2 * 2 + 1 * 2 + 1 * 6 + 4))
  })

  it('honors per-category overrides on DST categories (incl. tier points)', () => {
    // Override sack to 2 and the 7–13 PA tier to 6.
    expect(nflScore({ def_sack: 3 }, { overrides: { def_sack: 2 } })).toBe(6)
    expect(nflScore({ def_points_allowed: 10 }, { overrides: { def_pa_7_13: 6 } })).toBe(6)
  })

  it('yards-allowed tiers are inert by default but score when a commissioner values them', () => {
    expect(nflScore({ def_yds_allowed: 320 })).toBe(0) // default 0 pts
    expect(nflScore({ def_yds_allowed: 320 }, { overrides: { def_ya_300_349: 2 } })).toBe(2)
  })
})

describe('G8 DST — offensive and defensive stats never cross-contaminate', () => {
  it('offensive stats do not trigger any team-defense category', () => {
    expect(nflScore({ pass_yds: 300, pass_td: 3, rush_yds: 40 })).toBe(round2(300 * 0.04 + 3 * 4 + 3 + 40 * 0.1))
  })

  it('the team-D normalizer ignores offensive keys; the offensive normalizer emits no def keys', () => {
    expect(normalizeNflTeamDefenseWeeklyStats({ pass_yds: 300, pass_td: 3 })).toEqual({})
    const off = normalizeNflWeeklyStats({ passing_yards: 300, interceptions: 1 })
    expect(Object.keys(off).some((k) => k.startsWith('def_'))).toBe(false)
  })
})

describe('G8 DST — team-defense stat normalizer (provider aliases)', () => {
  it('maps Sleeper-style team-defense keys to canonical def_* keys', () => {
    const provider = { sack: 3, int: 1, fum_rec: 2, safety: 1, blk_kick: 1, def_td: 1, st_td: 1, pts_allow: 17, yds_allow: 312 }
    expect(normalizeNflTeamDefenseWeeklyStats(provider)).toEqual({
      def_sack: 3,
      def_int: 1,
      def_fr: 2,
      def_safety: 1,
      def_blk_kick: 1,
      def_td: 1,
      def_st_td: 1,
      def_points_allowed: 17,
      def_yds_allowed: 312,
    })
  })

  it('unwraps a nested { stats } payload and sums return-TD variants', () => {
    const provider = { stats: { def_sack: 2, kr_td: 1, pr_td: 1 } }
    const out = normalizeNflTeamDefenseWeeklyStats(provider)
    expect(out.def_sack).toBe(2)
    expect(out.def_st_td).toBe(2)
  })

  it('scoring the normalized team-D stats equals the hand-computed total', () => {
    const stats = normalizeNflTeamDefenseWeeklyStats({ sack: 4, int: 2, fum_rec: 1, def_td: 1, pts_allow: 10 })
    expect(nflScore(stats)).toBe(round2(4 + 4 + 2 + 6 + 4))
  })
})

describe('G8 DST — points-allowed from the game result (SportsGame derivation)', () => {
  it('a defense allows the opponent’s final score', () => {
    const game = { homeTeam: 'KC', awayTeam: 'DEN', homeScore: 24, awayScore: 10 }
    expect(pointsAllowedFromGame(game, 'KC')).toBe(10)
    expect(pointsAllowedFromGame(game, 'den')).toBe(24)
  })

  it('returns null when the team is not in the game or the score is unavailable', () => {
    expect(pointsAllowedFromGame({ homeTeam: 'KC', awayTeam: 'DEN', homeScore: 24, awayScore: 10 }, 'BUF')).toBeNull()
    expect(pointsAllowedFromGame({ homeTeam: 'KC', awayTeam: 'DEN', homeScore: null, awayScore: null }, 'KC')).toBeNull()
  })
})

describe('G8 DST — team-defense row identity', () => {
  it('recognizes DEF/DST rows and synthetic team-defense player ids', () => {
    expect(isTeamDefenseRow('nfl:def:KC', null)).toBe(true)
    expect(isTeamDefenseRow('anything', 'DEF')).toBe(true)
    expect(isTeamDefenseRow('anything', 'DST')).toBe(true)
    expect(isTeamDefenseRow('12345', 'QB')).toBe(false)
  })

  it('parses the team abbreviation from a synthetic def player id', () => {
    expect(teamAbbrevFromDefPlayerId('nfl:def:KC')).toBe('KC')
    expect(teamAbbrevFromDefPlayerId('nfl:def:gb')).toBe('GB')
    expect(teamAbbrevFromDefPlayerId('12345')).toBeNull()
  })
})
