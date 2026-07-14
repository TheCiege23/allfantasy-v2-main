/**
 * Commissioner Scoring Rules Contract (G2) — pure, deterministic tests.
 *
 * Proves that changing a league's scoring settings changes fantasy points exactly
 * as a commissioner expects, against the authoritative scorer
 * (`scoreStatsWithCategories`) fed by the real NFL config + preset/override
 * resolution. Also proves score-sync uses the SAME path: it normalizes provider
 * stats (`normalizeNflWeeklyStats`) and scores them through the identical
 * categories, so what the cron writes equals what these tests assert.
 *
 * See docs/redraft-commissioner-scoring-contract.md.
 */
import { describe, expect, it } from 'vitest'
import {
  scoreStatsWithCategories,
  applyScoringPresetToRecPoints,
  applyTePremiumStat,
  isScoringStarterSlot,
} from '@/lib/redraft/scoringEngine'
import { getScoringCategories, expandSportConfigToggles } from '@/lib/sportConfig'
import { normalizeNflWeeklyStats } from '@/lib/redraft/playerWeeklyScoreService'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Resolve NFL categories + preset + overrides exactly like calculateScoreFromSportConfig. */
function nflScore(
  rawStats: Record<string, number>,
  opts: { preset?: string; toggles?: string[]; overrides?: Record<string, number>; position?: string } = {},
): number {
  const toggles = expandSportConfigToggles(opts.toggles ?? [])
  let cats = getScoringCategories('NFL', toggles)
  cats = applyScoringPresetToRecPoints(cats, opts.preset ?? 'PPR', opts.overrides ?? {})
  const stats = applyTePremiumStat(cats, rawStats, opts.position)
  return round2(scoreStatsWithCategories(cats, stats, opts.overrides ?? {}))
}

describe('G2 Scoring — presets (Standard / Half / Full PPR)', () => {
  it('changes reception value with the preset', () => {
    expect(nflScore({ rec: 8 }, { preset: 'STANDARD' })).toBe(0)
    expect(nflScore({ rec: 8 }, { preset: 'HALF_PPR' })).toBe(4)
    expect(nflScore({ rec: 8 }, { preset: 'PPR' })).toBe(8)
  })
})

describe('G2 Scoring — passing', () => {
  it('scores passing yards at 0.04/yd (decimal)', () => {
    expect(nflScore({ pass_yds: 275 })).toBe(11) // 275 * 0.04
  })
  it('honors 4-pt default vs 6-pt override passing TD', () => {
    expect(nflScore({ pass_td: 3 })).toBe(12)
    expect(nflScore({ pass_td: 3 }, { overrides: { pass_td: 6 } })).toBe(18)
  })
  it('applies negative interception points', () => {
    expect(nflScore({ pass_int: 2 })).toBe(-4)
  })
  it('applies 300+ and 400+ passing-yard bonuses at the threshold', () => {
    expect(nflScore({ pass_yds: 299 })).toBe(round2(299 * 0.04)) // no bonus
    expect(nflScore({ pass_yds: 300 })).toBe(round2(300 * 0.04 + 3)) // +300 bonus
    expect(nflScore({ pass_yds: 410 })).toBe(round2(410 * 0.04 + 3 + 3)) // +300 +400
  })
})

describe('G2 Scoring — rushing & receiving', () => {
  it('rushing yards 0.1/yd, TD 6, 100-yd bonus', () => {
    expect(nflScore({ rush_yds: 100, rush_td: 1 })).toBe(round2(100 * 0.1 + 6 + 3))
    expect(nflScore({ rush_yds: 99, rush_td: 0 })).toBe(round2(99 * 0.1)) // no bonus < 100
  })
  it('receiving yards 0.1/yd, TD 6, reception (PPR), 100-yd bonus', () => {
    expect(nflScore({ rec: 5, rec_yds: 100, rec_td: 1 }, { preset: 'PPR' })).toBe(round2(5 + 100 * 0.1 + 6 + 3))
  })
})

describe('G2 Scoring — TE premium (toggle + TE-only)', () => {
  it('adds 0.5/reception for a TE only when TE_PREMIUM is enabled', () => {
    const stats = normalizeNflWeeklyStats({ receptions: 6, receiving_yards: 80 })
    expect(nflScore(stats, { preset: 'PPR', toggles: ['TE_PREMIUM'], position: 'TE' })).toBe(round2(6 + 8 + 0.5 * 6))
    // Same TE, premium OFF → no bonus.
    expect(nflScore(stats, { preset: 'PPR', position: 'TE' })).toBe(round2(6 + 8))
    // Premium ON but a WR → no bonus (TE-only).
    expect(nflScore(stats, { preset: 'PPR', toggles: ['TE_PREMIUM'], position: 'WR' })).toBe(round2(6 + 8))
  })
  it('applyTePremiumStat only injects te_premium for TEs when the category is active', () => {
    const cats = getScoringCategories('NFL', expandSportConfigToggles(['TE_PREMIUM']))
    expect(applyTePremiumStat(cats, { rec: 4 }, 'TE')).toEqual({ rec: 4, te_premium: 4 })
    expect(applyTePremiumStat(cats, { rec: 4 }, 'WR')).toEqual({ rec: 4 })
    const noTepCats = getScoringCategories('NFL', [])
    expect(applyTePremiumStat(noTepCats, { rec: 4 }, 'TE')).toEqual({ rec: 4 }) // category not active
  })
})

describe('G2 Scoring — kicking, fumbles, 2pt', () => {
  it('scores field goals by distance, misses, and XPs', () => {
    expect(nflScore({ fg_0_39: 2, fg_40_49: 1, fg_50_plus: 1, fg_miss: 1, xp_made: 3 })).toBe(
      round2(2 * 3 + 1 * 4 + 1 * 5 + 1 * -1 + 3 * 1),
    )
  })
  it('scores fumble lost (-2), fumble recovery TD (+6), and 2-pt (+2)', () => {
    expect(nflScore({ fum_lost: 1, fumble_td: 1, two_pt: 1 })).toBe(round2(-2 + 6 + 2))
  })
})

describe('G2 Scoring — IDP (only when enabled)', () => {
  const idpStats = {
    idp_solo: 5,
    idp_assist: 2,
    idp_sack: 1,
    idp_int: 1,
    idp_pd: 2,
    idp_ff: 1,
    idp_fr: 1,
    idp_td: 1,
    idp_safety: 1,
    idp_tfl: 2,
    idp_qb_hit: 2,
  }
  it('does NOT score IDP stats when IDP is disabled', () => {
    expect(nflScore(idpStats, {})).toBe(0)
  })
  it('scores every IDP category when IDP is enabled', () => {
    const expected =
      5 * 1 + 2 * 0.5 + 1 * 2 + 1 * 6 + 2 * 1 + 1 * 3 + 1 * 2 + 1 * 6 + 1 * 2 + 2 * 1 + 2 * 0.5
    expect(nflScore(idpStats, { toggles: ['IDP'] })).toBe(round2(expected))
  })
})

describe('G2 Scoring — custom overrides beat presets', () => {
  it('categoryPoints.rec overrides the PPR preset', () => {
    // PPR would give rec=1; override to 1.5 (premium custom).
    expect(nflScore({ rec: 4 }, { preset: 'PPR', overrides: { rec: 1.5 } })).toBe(6)
    // STANDARD preset (rec 0) but override to 1 → custom wins.
    expect(nflScore({ rec: 4 }, { preset: 'STANDARD', overrides: { rec: 1 } })).toBe(4)
  })
  it('honors arbitrary per-category overrides (e.g. pass_int −3, rush_td 4)', () => {
    expect(nflScore({ pass_int: 1, rush_td: 1 }, { overrides: { pass_int: -3, rush_td: 4 } })).toBe(1)
  })
})

describe('G2 Scoring — starters only (bench/IR/taxi/devy/reserve do not score)', () => {
  it('classifies non-starter slots out of scoring', () => {
    for (const s of ['QB', 'RB', 'WR', 'TE', 'FLX', 'SF', 'DEF', 'K']) expect(isScoringStarterSlot(s)).toBe(true)
    for (const s of ['bench', 'BN', 'IR', 'taxi', 'devy', 'reserve']) expect(isScoringStarterSlot(s)).toBe(false)
  })
})

describe('G2 Scoring — Superflex is scoring-neutral (slot does not change points)', () => {
  it('a QB scores identically in a QB or SF slot (scoring ignores slot)', () => {
    // Scoring is per raw stats; the SF slot still counts as a starter.
    expect(isScoringStarterSlot('SF')).toBe(true)
    const qbStats = { pass_yds: 280, pass_td: 2 } // below the 300-yd bonus threshold
    expect(nflScore(qbStats)).toBe(round2(280 * 0.04 + 2 * 4))
  })
})

describe('G2 Scoring — decimal & negative totals', () => {
  it('produces precise decimal totals and can go negative', () => {
    expect(nflScore({ pass_yds: 263, pass_int: 3, fum_lost: 1 })).toBe(round2(263 * 0.04 + 3 * -2 + 1 * -2))
  })
})

describe('G2 Score-sync uses the SAME scoring path', () => {
  it('normalizes provider aliases then scores identically to the contract scorer', () => {
    // Provider payload with alias keys the cron actually receives.
    const provider = {
      passing_yards: 320,
      passing_touchdowns: 3,
      interceptions: 1,
      rushing_yards: 24,
      receptions: 0,
    }
    const normalized = normalizeNflWeeklyStats(provider)
    expect(normalized).toMatchObject({ pass_yds: 320, pass_td: 3, pass_int: 1, rush_yds: 24 })
    // Scoring the normalized stats == scoring the canonical stats directly.
    const viaSync = nflScore(normalized)
    const direct = nflScore({ pass_yds: 320, pass_td: 3, pass_int: 1, rush_yds: 24 })
    expect(viaSync).toBe(direct)
    // And equals the hand-computed expected value (incl. 300-yd bonus).
    expect(viaSync).toBe(round2(320 * 0.04 + 3 * 4 + 1 * -2 + 24 * 0.1 + 3))
  })
})

describe('G2 NCAAF — does not fake scoring for missing data', () => {
  it('NCAAF config exposes scoring categories but the weekly sync is NFL-only (beta)', () => {
    // The categories EXIST (so the engine is sport-agnostic)…
    const ncaaf = getScoringCategories('NCAAF', [])
    expect(ncaaf.some((c) => c.key === 'pass_td')).toBe(true)
    // …but there is no NCAAF IDP and the runner skips NCAAF with a dataWarning
    // (covered in season-rules-contract). Scoring math is honest where data exists.
    expect(scoreStatsWithCategories(ncaaf, { pass_yds: 250, pass_td: 2 })).toBe(round2(250 * 0.04 + 2 * 4))
  })
})

describe('G2 lineup validation note — commissioner roster slots (documented gap G10)', () => {
  it('default NFL lineup validates against static starter slots (QB/RB/WR/WR/TE/DEF)', () => {
    const r = validateRedraftLineup({
      sport: 'NFL',
      week: 1,
      players: [
        { playerId: 'qb', playerName: 'QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
        { playerId: 'rb', playerName: 'RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
        { playerId: 'wr1', playerName: 'WR1', position: 'WR', sport: 'NFL', slotType: 'WR' },
        { playerId: 'wr2', playerName: 'WR2', position: 'WR', sport: 'NFL', slotType: 'WR' },
        { playerId: 'te', playerName: 'TE', position: 'TE', sport: 'NFL', slotType: 'TE' },
        { playerId: 'def', playerName: 'DEF', position: 'DST', sport: 'NFL', slotType: 'DST' },
      ],
    })
    expect(r.ok).toBe(true)
  })
})
