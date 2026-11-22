/**
 * NHL scoring completeness, end to end on the committed fixture.
 *
 * `nhl-scoring-screen-truth.test.ts` feeds RAW fixture lines to the normalizer. The weekly scorer
 * never sees a raw line: it reads `player_game_stats.normalizedStatMap`, which the ingest builds
 * from the raw line and which keeps only NUMERIC fields. So this file runs the real path —
 *
 *   fixtures/live.NHL.json -> normalizeRiGameBox -> normalizedStatMapFor (what is stored)
 *     -> normalizeNhlGameStats -> panel store bridge -> buildLeagueStatScorer
 *
 * — and checks every panel row the screen lets a commissioner set against a count taken
 * independently from the raw fixture. A row that shows on the panel and scores 0 against real
 * data fails here, and so does a row added later without saying what it is counted from.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))

import { NHL_ALL_SCORING_CATEGORIES, NHL_UNAVAILABLE_SCORING_KEYS } from '@/lib/nhl-scoring/NhlScoringCategories'
import { NHL_SCORING_ENGINE_VERSION } from '@/lib/nhl-scoring/nhlScoringEngineContract'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { aggregateWeeklyStats, normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { normalizeRiGameBox, normalizedStatMapFor } from '@/lib/sports-data/rollingInsightsGameLogs'

type Raw = Record<string, unknown>
type StoredLine = { group: string; raw: Raw; stored: Record<string, unknown> }

function storedFixtureLines(): StoredLine[] {
  const path = join(process.cwd(), 'contracts/rolling-insights/fixtures/live.NHL.json')
  const games = (JSON.parse(readFileSync(path, 'utf8')) as { data: { NHL: unknown[] } }).data.NHL
  const out: StoredLine[] = []
  for (const game of games) {
    const box = normalizeRiGameBox(game)!
    for (const line of box.lines) out.push({ group: line.group, raw: line.raw, stored: normalizedStatMapFor(line, box) })
  }
  return out
}

const n = (v: unknown) => (typeof v === 'number' ? v : 0)
const toiMinutes = (v: unknown) => {
  const m = /^(\d+):([0-5]\d)$/.exec(String(v ?? ''))
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0
}
const goalie = (r: Raw, g: string, f: (r: Raw) => number) => (g === 'goalies' ? f(r) : 0)

/**
 * What each scorable panel row counts, written straight off the raw vendor line. Independent of the
 * alias tables on purpose: if this and the pipeline agree, the pipeline reads the field the vendor
 * actually sends.
 */
const REFERENCE: Record<string, (r: Raw, group: string) => number> = {
  goals: (r) => n(r.goals),
  assists: (r) => n(r.assists),
  points: (r) => n(r.goals) + n(r.assists),
  plus_minus: (r) => n(r.plus_minus),
  power_play_goals: (r) => n(r.power_play_goals),
  power_play_assists: (r) => n(r.power_play_assists),
  power_play_points: (r) => n(r.power_play_goals) + n(r.power_play_assists),
  short_handed_goals: (r) => n(r.short_handed_goals),
  short_handed_assists: (r) => n(r.short_handed_assists),
  short_handed_points: (r) => n(r.short_handed_goals) + n(r.short_handed_assists),
  shots_on_goal: (r) => n(r.shots_on_goal),
  faceoff_wins: (r) => n(r.faceoffs_won),
  faceoff_losses: (r) => n(r.faceoffs_lost),
  blocked_shots: (r) => n(r.blocks),
  hits: (r) => n(r.hits),
  takeaways: (r) => n(r.takeaways),
  giveaways: (r) => n(r.giveaways),
  penalty_minutes: (r) => n(r.penalty_minutes),
  shootout_goal: (r) => n(r.shootout_goals),
  hat_trick_bonus: (r) => (n(r.goals) >= 3 ? 1 : 0),
  three_assist_game: (r) => (n(r.assists) >= 3 ? 1 : 0),
  five_point_game: (r) => (n(r.goals) + n(r.assists) >= 5 ? 1 : 0),
  multi_goal_game: (r) => (n(r.goals) >= 2 ? 1 : 0),
  multi_assist_game: (r) => (n(r.assists) >= 2 ? 1 : 0),
  ten_shot_game: (r) => (n(r.shots_on_goal) >= 10 ? 1 : 0),
  five_hit_game: (r) => (n(r.hits) >= 5 ? 1 : 0),
  five_block_game: (r) => (n(r.blocks) >= 5 ? 1 : 0),
  forty_save_game: (r, g) => goalie(r, g, (x) => (n(x.saves) >= 40 ? 1 : 0)),
  fifty_save_game: (r, g) => goalie(r, g, (x) => (n(x.saves) >= 50 ? 1 : 0)),
  goalie_wins: (r) => n(r.win),
  goalie_losses: (r) => n(r.loss),
  overtime_losses: (r) => n(r.overtime_loss),
  saves: (r, g) => goalie(r, g, (x) => n(x.saves)),
  goals_against: (r) => n(r.goals_allowed),
  shots_against: (r) => n(r.shots_against),
  shutouts: (r) => n(r.shutouts),
  goalie_minutes_played: (r, g) => goalie(r, g, (x) => toiMinutes(x.time_on_ice)),
  // Rate bonuses, from the one game's own line (see nhl-rate-bonus-per-game.test.ts), each with its
  // minimum sample: 20 shots faced, 40 goalie minutes, 4 shots on goal.
  save_pct_bonus: (r, g) =>
    goalie(r, g, (x) => (n(x.shots_against) >= 20 ? Math.max(0, (n(x.saves) / n(x.shots_against) - 0.9) / 0.01) : 0)),
  gaa_bonus: (r, g) =>
    goalie(r, g, (x) => (toiMinutes(x.time_on_ice) >= 40 && (n(x.goals_allowed) * 60) / toiMinutes(x.time_on_ice) < 2.5 ? 1 : 0)),
  shooting_pct_bonus: (r) =>
    n(r.shots_on_goal) >= 4 ? Math.max(0, (n(r.goals) / n(r.shots_on_goal)) * 100 - 10) : 0,
}

const scorableRows = [...new Set(NHL_ALL_SCORING_CATEGORIES.flatMap((c) => c.rows.map((r) => r.key)))].filter(
  (key) => !NHL_UNAVAILABLE_SCORING_KEYS.has(key),
)

/** A commissioner-saved store (current engine contract) scoring ONLY `key`, at 1 point per unit. */
function onlyRowScorer(key: string) {
  const rules: Record<string, number> = {}
  for (const k of NHL_ALL_SCORING_CATEGORIES.flatMap((c) => c.rows.map((r) => r.key))) rules[k] = 0
  rules[key] = 1
  return buildLeagueStatScorer({
    sport: 'NHL',
    settings: { nhl_scoring_config: { rules, lastUpdatedBy: 'commish-1', engineVersion: NHL_SCORING_ENGINE_VERSION } },
  })!
}

describe('every scorable NHL panel row scores real fixture data, through the stored shape', () => {
  const lines = storedFixtureLines()

  it('reads the fixture at all (positive control)', () => {
    expect(lines.filter((l) => l.group === 'skaters').length).toBeGreaterThan(100)
    expect(lines.filter((l) => l.group === 'goalies').length).toBe(12)
  })

  it('every scorable row says what it is counted from', () => {
    const missing = scorableRows.filter((key) => !(key in REFERENCE))
    expect(missing, 'scorable panel rows with no reference count').toEqual([])
  })

  it.each(scorableRows.filter((key) => key in REFERENCE))('%s scores what the fixture says', (key) => {
    const scorer = onlyRowScorer(key)
    let got = 0
    let want = 0
    for (const line of lines) {
      const { stats } = normalizeNhlGameStats(line.stored)
      got += scorer(stats)
      want += REFERENCE[key](line.raw, line.group)
    }
    expect(got).toBeCloseTo(want, 6)
  })

  it('the rows the fixture really exercises are not all trivially zero', () => {
    // A reference that is 0 everywhere passes the per-row check by agreeing with a broken pipeline.
    // These fields are non-zero somewhere in the six captured games, so each must score something.
    for (const key of ['goals', 'power_play_goals', 'faceoff_wins', 'takeaways', 'giveaways', 'goalie_losses', 'shots_against', 'goalie_minutes_played', 'multi_goal_game', 'save_pct_bonus', 'gaa_bonus', 'shooting_pct_bonus']) {
      const scorer = onlyRowScorer(key)
      const total = lines.reduce((sum, l) => sum + scorer(normalizeNhlGameStats(l.stored).stats), 0)
      expect(total, key).toBeGreaterThan(0)
    }
  })
})

describe('the stored shape carries no field the scorer reports as unrecognised', () => {
  it('a weekly aggregate over the whole fixture leaves no unmapped keys', () => {
    // Every sync turns unmappedKeys into "Unrecognized NHL provider stat keys (alias table may be
    // wrong)". A key the vendor ALWAYS sends there makes that warning permanent and meaningless.
    const { unmappedKeys, gamesCounted } = aggregateWeeklyStats(
      storedFixtureLines().map((l) => l.stored),
      normalizeNhlGameStats,
    )
    expect(gamesCounted).toBeGreaterThan(100)
    expect(unmappedKeys).toEqual([])
  })
})

describe('goalie time on ice', () => {
  it('the ingest stores the vendor "mm:ss" clock as minutes', () => {
    const box = normalizeRiGameBox({
      game_ID: 'g1',
      season: '2025-2026',
      full_box: { home_team: { abbrv: 'MIN' }, away_team: { abbrv: 'TOR' } },
      player_box: { home_team: { goalies: { '9': { player: 'X', saves: 30, time_on_ice: '58:05' } } } },
    })!
    const stored = normalizedStatMapFor(box.lines[0], box) as { stats: Record<string, number> }
    expect(stored.stats.time_on_ice_minutes).toBeCloseTo(58 + 5 / 60, 6)
  })

  it('scores a goalie’s minutes, never a skater’s', () => {
    expect(normalizeNhlGameStats({ group: 'goalies', stats: { saves: 30, time_on_ice_minutes: 60 } }).stats.g_toi).toBe(60)
    expect(normalizeNhlGameStats({ group: 'skaters', stats: { goals: 1, time_on_ice_minutes: 20 } }).stats.g_toi).toBeUndefined()
  })

  it('ignores a clock it cannot read rather than guessing', () => {
    const box = normalizeRiGameBox({
      game_ID: 'g2',
      season: '2025-2026',
      full_box: { home_team: { abbrv: 'MIN' }, away_team: { abbrv: 'TOR' } },
      player_box: { home_team: { goalies: { '9': { player: 'X', saves: 30, time_on_ice: 'n/a' } } } },
    })!
    const stored = normalizedStatMapFor(box.lines[0], box) as { stats: Record<string, number> }
    expect(stored.stats.time_on_ice_minutes).toBeUndefined()
  })
})
