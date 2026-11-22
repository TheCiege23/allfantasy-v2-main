/**
 * ONE RULE for NFL redraft scoring.
 *
 * The weekly matchup engine scores through `calculateScoreFromSportConfig` → `buildLeagueStatScorer`,
 * which honours `settings.nfl_scoring_config` (what the commissioner's NFL scoring panel saves). The
 * live-scoring recalculation (`recalculate_week` / `apply_correction` / stat ingest →
 * `persistNflRedraftLiveScoringWeek`) used to resolve its point values from the scoring template +
 * `LeagueScoringOverride` rows + `sportConfig.categoryPoints` instead, so a recalculation could rescore a
 * week — and write RedraftMatchup + PlayerWeeklyScore — on rules the panel does not show.
 *
 * These tests score the same stat lines through both paths and require them to agree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindFirst } = vi.hoisted(() => ({ leagueFindFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: leagueFindFirst } } }))

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import {
  buildNflRedraftLiveScoringRuntimeState,
  calculateNflRedraftFantasyPoints,
  normalizeNflRedraftPlayerStats,
  type NflRedraftRuntimeTeamInput,
} from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { resolveNflRedraftLeagueScoringSettings } from '@/lib/scoring-runtime/resolveNflRedraftLiveScoringRuntime'

/** A league created on the standard template (pass TD 4, no reception points) — what the canonical rules carry. */
const rules = {
  leagueId: 'lg-panel',
  general: { sport: 'NFL', format: 'redraft' },
  scoring: {
    templateId: 'nfl_standard',
    presetId: 'nfl_standard',
    formatType: 'redraft',
    sport: 'NFL',
    activeRuleCount: 1,
    overriddenRuleCount: 0,
    activeRules: [{ statKey: 'passing_td', pointsValue: 4, category: null, isOverridden: false }],
  },
  roster: { starters: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] },
} as unknown as CanonicalLeagueRules

/** The commissioner then opened the NFL scoring panel: passing TD 6, full PPR. */
const panelLeague = {
  sport: 'NFL',
  settings: {
    nfl_scoring_config: {
      presetKey: 'custom',
      source: 'CUSTOM',
      rules: { passing_yards: 0.04, passing_td: 6, interception_thrown: -2, reception: 1, receiving_yards: 0.1, receiving_td: 6, rushing_yards: 0.1, rushing_td: 6 },
    },
  },
}

/** A league whose engine store is set directly, with TE premium and half PPR. */
const engineStoreLeague = {
  sport: 'NFL',
  settings: {
    sportConfig: { categoryPoints: { pass_td: 5, rec_td: 7 }, enableTEPremium: true, scoringPreset: 'HALF_PPR' },
  },
}

const LINES: Array<{ playerId: string; position: string; raw: Record<string, number> }> = [
  { playerId: 'qb-1', position: 'QB', raw: { passingYards: 312, passingTouchdowns: 3, interceptions: 1, rushingYards: 22 } },
  { playerId: 'wr-1', position: 'WR', raw: { receptions: 8, receivingYards: 104, receivingTouchdowns: 1 } },
  { playerId: 'te-1', position: 'TE', raw: { receptions: 6, receivingYards: 58, receivingTouchdowns: 1 } },
  { playerId: 'rb-1', position: 'RB', raw: { rushingYards: 87, rushingTouchdowns: 1, receptions: 3, receivingYards: 21 } },
]

async function mainPathPoints(league: { sport: string; settings: unknown }, stats: Record<string, number>, position: string) {
  leagueFindFirst.mockResolvedValueOnce(league)
  return calculateScoreFromSportConfig('lg-panel', 'p', 1, stats, position)
}

describe('NFL redraft week recalculation scores with the same rules as the matchup engine', () => {
  beforeEach(() => leagueFindFirst.mockReset())

  for (const [label, league] of [
    ['nfl_scoring_config panel (pass TD 6, full PPR)', panelLeague],
    ['sportConfig.categoryPoints + TE premium + half PPR', engineStoreLeague],
  ] as const) {
    it(`per player: ${label}`, async () => {
      const settings = resolveNflRedraftLeagueScoringSettings({ rules, league })
      for (const line of LINES) {
        const stats = normalizeNflRedraftPlayerStats({ playerId: line.playerId, position: line.position, rawStats: line.raw })
        const recalc = calculateNflRedraftFantasyPoints({ settings, stats, position: line.position }).points
        const main = await mainPathPoints(league, stats, line.position)
        expect({ player: line.playerId, points: recalc }).toEqual({ player: line.playerId, points: Math.round(main * 100) / 100 })
      }
    })
  }

  it('the panel values actually reach the recalculation (pass TD 6, 1 per reception)', () => {
    const settings = resolveNflRedraftLeagueScoringSettings({ rules, league: panelLeague })
    const qb = calculateNflRedraftFantasyPoints({ settings, stats: { pass_td: 1 }, position: 'QB' }).points
    const wr = calculateNflRedraftFantasyPoints({ settings, stats: { rec: 1 }, position: 'WR' }).points
    expect({ qb, wr }).toEqual({ qb: 6, wr: 1 })
  })

  it('a recalculated matchup total equals the sum of main-path starter points', async () => {
    const team: NflRedraftRuntimeTeamInput = {
      rosterId: 'r1',
      displayName: 'One',
      players: LINES.map((l) => ({ rosterId: 'r1', playerId: l.playerId, playerName: l.playerId, position: l.position, slotType: l.position })),
    }
    const scoreRows = LINES.map((l) => ({
      playerId: l.playerId,
      stats: normalizeNflRedraftPlayerStats({ playerId: l.playerId, position: l.position, rawStats: l.raw }),
    }))
    const state = buildNflRedraftLiveScoringRuntimeState({
      leagueId: 'lg-panel',
      seasonId: 's1',
      season: 2026,
      week: 1,
      rules,
      teams: [team],
      matchups: [],
      scoreRows,
      settings: resolveNflRedraftLeagueScoringSettings({ rules, league: panelLeague }),
    })
    let expected = 0
    for (const row of scoreRows) {
      const line = LINES.find((l) => l.playerId === row.playerId)!
      expected += await mainPathPoints(panelLeague, row.stats, line.position)
    }
    expect(state.teams[0].starterTotal).toBeCloseTo(expected, 2)
  })
})
