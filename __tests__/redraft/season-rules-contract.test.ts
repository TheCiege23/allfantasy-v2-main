/**
 * Redraft Season Rules Contract — pure (DB-free) contract tests.
 *
 * Proves the season-critical mechanics defined in
 * `docs/redraft-season-rules-contract.md` against the real engine functions:
 * scoring (presets, passing-TD value, TE premium, negative turnovers, yardage
 * bonuses, starter-only), lineup locks, playoff seeding/tiebreakers, and
 * deterministic waiver ordering. DB-backed end-to-end assertions (single
 * ownership, FAAB deduction, champion crowned, idempotent re-runs) are exercised
 * by `scripts/run-nfl-full-season-engine-e2e.ts` against staging.
 */
import { describe, expect, it } from 'vitest'
import {
  scoreStatsWithCategories,
  applyScoringPresetToRecPoints,
  isScoringStarterSlot,
} from '@/lib/redraft/scoringEngine'
import { getScoringCategories } from '@/lib/sportConfig'
import { generatePlayoffBracket } from '@/lib/redraft/playoffEngine'
import { compareWaiverClaims, type WaiverClaimOrderFields } from '@/lib/redraft/waiverEngine'
import {
  applyRedraftLineupMoves,
  validateRedraftLineup,
  type RedraftLineupPlayer,
} from '@/lib/redraft/lineupValidation'
import { runRedraftSeasonScoring } from '@/lib/redraft/redraftSeasonScoringRunner'

// Resolve NFL categories the same way the live scorer does, then apply a preset.
function nflScore(
  rawStats: Record<string, number>,
  opts: { preset?: string; toggles?: string[]; overrides?: Record<string, number> } = {},
): number {
  const cats = applyScoringPresetToRecPoints(
    getScoringCategories('NFL', opts.toggles ?? []),
    opts.preset ?? 'PPR',
    opts.overrides ?? {},
  )
  return Math.round(scoreStatsWithCategories(cats, rawStats, opts.overrides ?? {}) * 100) / 100
}

describe('Season Rules Contract — Scoring', () => {
  it('honors PPR / Half-PPR / Standard reception scoring', () => {
    expect(nflScore({ rec: 5 }, { preset: 'PPR' })).toBe(5)
    expect(nflScore({ rec: 5 }, { preset: 'HALF_PPR' })).toBe(2.5)
    expect(nflScore({ rec: 5 }, { preset: 'STANDARD' })).toBe(0)
  })

  it('honors 4-point vs 6-point passing TD via commissioner override', () => {
    expect(nflScore({ pass_td: 3 })).toBe(12) // default 4 pts
    expect(nflScore({ pass_td: 3 }, { overrides: { pass_td: 6 } })).toBe(18)
  })

  it('honors TE premium only when the toggle is enabled', () => {
    // te_premium is a toggle-gated category scored off a te_premium stat count.
    const withoutTep = nflScore({ rec: 4, te_premium: 4 }, { preset: 'PPR' })
    const withTep = nflScore({ rec: 4, te_premium: 4 }, { preset: 'PPR', toggles: ['TE_PREMIUM'] })
    expect(withoutTep).toBe(4) // only the 4 receptions count
    expect(withTep).toBe(6) // + 0.5 * 4 TE-premium bonus
  })

  it('honors negative turnovers (INT thrown, fumble lost)', () => {
    expect(nflScore({ pass_int: 2, fum_lost: 1 })).toBe(-6) // -2*2 + -2*1
  })

  it('honors yardage scoring and 300+ passing-yard bonus thresholds', () => {
    // 320 pass yds (12.8) + 3 pass TD (12) + 300-bonus (3); 400-bonus not met.
    expect(nflScore({ pass_yds: 320, pass_td: 3 })).toBe(27.8)
    // Below the 300 threshold → no bonus.
    expect(nflScore({ pass_yds: 280, pass_td: 3 })).toBe(11.2 + 12)
  })

  it('counts only starter slots — bench/IR/taxi/devy/reserve never score', () => {
    for (const slot of ['QB', 'RB', 'WR', 'TE', 'FLX', 'DEF', 'K', 'SF']) {
      expect(isScoringStarterSlot(slot)).toBe(true)
    }
    for (const slot of ['bench', 'BN', 'IR', 'ir', 'taxi', 'devy', 'reserve', 'RESERVE']) {
      expect(isScoringStarterSlot(slot)).toBe(false)
    }
  })
})

describe('Season Rules Contract — Lineup Locks', () => {
  const base: RedraftLineupPlayer = {
    playerId: 'p1',
    playerName: 'Locked Star',
    position: 'RB',
    sport: 'NFL',
    slotType: 'RB',
  }

  it('blocks moving a locked player out of its slot', () => {
    const { players, issues } = applyRedraftLineupMoves(
      [{ ...base, isLocked: true }],
      [{ playerId: 'p1', fromSlot: 'RB', toSlot: 'BENCH' }],
    )
    expect(issues.some((i) => i.code === 'locked_player_move')).toBe(true)
    expect(players[0].slotType).toBe('RB') // unchanged
  })

  it('allows moving an unlocked player', () => {
    const { players, issues } = applyRedraftLineupMoves(
      [{ ...base, isLocked: false }],
      [{ playerId: 'p1', fromSlot: 'RB', toSlot: 'BENCH' }],
    )
    expect(issues).toHaveLength(0)
    expect(players[0].slotType).toBe('BENCH')
  })

  it('validation flags a locked player who changed slot vs the previous lineup', () => {
    const previous: RedraftLineupPlayer[] = [{ ...base, isLocked: true }]
    const moved: RedraftLineupPlayer[] = [{ ...base, isLocked: true, slotType: 'BENCH' }]
    const result = validateRedraftLineup({ sport: 'NFL', week: 3, players: moved, previousPlayers: previous })
    expect(result.issues.some((i) => i.code === 'locked_player_move')).toBe(true)
  })
})

describe('Season Rules Contract — Playoff Seeding', () => {
  type Roster = Parameters<typeof generatePlayoffBracket>[0][number]
  const roster = (id: string, wins: number, pointsFor: number): Roster =>
    ({ id, wins, pointsFor } as Roster)

  it('seeds by wins then points-for and pairs 1v4 / 2v3', () => {
    const rosters = [
      roster('d', 2, 900),
      roster('a', 5, 1200),
      roster('c', 3, 1000),
      roster('b', 5, 1100),
    ]
    const bracket = generatePlayoffBracket(rosters, 4, false, 'consolation')
    const r1 = bracket.upperBracket[0].matchups
    // Seed order: a(5,1200) > b(5,1100) > c(3) > d(2)
    expect(r1[0]).toEqual({ home: 'a', away: 'd' }) // 1 vs 4
    expect(r1[1]).toEqual({ home: 'b', away: 'c' }) // 2 vs 3
  })

  it('gives the odd top seed a bye when team count is odd', () => {
    const rosters = [
      roster('a', 5, 1200),
      roster('b', 4, 1100),
      roster('c', 3, 1000),
    ]
    const bracket = generatePlayoffBracket(rosters, 3, false, 'consolation')
    const r1 = bracket.upperBracket[0].matchups
    expect(r1).toContainEqual({ home: 'a', away: 'c' })
    expect(r1.some((m) => m.away === null)).toBe(true) // middle seed byes
  })
})

describe('Season Rules Contract — Waiver Ordering', () => {
  const claim = (o: Partial<WaiverClaimOrderFields>): WaiverClaimOrderFields => ({
    id: o.id ?? 'x',
    bidAmount: o.bidAmount ?? null,
    priority: o.priority ?? null,
    submittedAt: o.submittedAt ?? new Date('2026-01-01T00:00:00Z'),
  })

  it('resolves higher FAAB bids first', () => {
    const order = [claim({ id: 'low', bidAmount: 5 }), claim({ id: 'high', bidAmount: 20 })].sort(compareWaiverClaims)
    expect(order.map((c) => c.id)).toEqual(['high', 'low'])
  })

  it('treats a null bid as 0 so it never outranks a real bid (mixed league)', () => {
    const order = [claim({ id: 'priorityOnly', bidAmount: null, priority: 1 }), claim({ id: 'bid', bidAmount: 1 })].sort(
      compareWaiverClaims,
    )
    expect(order[0].id).toBe('bid')
  })

  it('breaks equal bids by lower priority, then submission time, then id', () => {
    const order = [
      claim({ id: 'c', bidAmount: 10, priority: 2, submittedAt: new Date('2026-01-02') }),
      claim({ id: 'a', bidAmount: 10, priority: 1, submittedAt: new Date('2026-01-03') }),
      claim({ id: 'b', bidAmount: 10, priority: 2, submittedAt: new Date('2026-01-01') }),
    ].sort(compareWaiverClaims)
    expect(order.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('is a total order — identical claims sort deterministically by id', () => {
    const t = new Date('2026-01-01')
    const a = claim({ id: 'aaa', bidAmount: 7, priority: 1, submittedAt: t })
    const b = claim({ id: 'bbb', bidAmount: 7, priority: 1, submittedAt: t })
    expect(compareWaiverClaims(a, b)).toBeLessThan(0)
    expect(compareWaiverClaims(b, a)).toBeGreaterThan(0)
  })
})

describe('Season Rules Contract — NCAAF data honesty', () => {
  const okDeps = {
    syncSeason: async (s: { id: string; currentWeek: number | null }) => ({
      seasonId: s.id,
      week: s.currentWeek ?? 1,
      scoresUpserted: 5,
      warnings: [] as string[],
    }),
    recalcMatchups: async () => undefined,
    updateStandings: async () => undefined,
  }

  it('processes NFL but SKIPS NCAAF with an explicit dataWarning (never false success)', async () => {
    const report = await runRedraftSeasonScoring(
      [
        { id: 'nfl-1', leagueId: 'lg-nfl', sport: 'NFL', currentWeek: 4 },
        { id: 'ncaaf-1', leagueId: 'lg-ncaaf', sport: 'NCAAF', currentWeek: 4 },
      ],
      okDeps,
    )
    expect(report.processedCount).toBe(1)
    expect(report.skippedCount).toBe(1)
    expect(report.dataWarnings.some((w) => w.sport === 'NCAAF' && /NFL only/i.test(w.warning))).toBe(true)
    // The NCAAF season is never reported as processed/synced.
    expect(report.processed.some((p) => p.sport === 'NCAAF')).toBe(false)
  })
})
