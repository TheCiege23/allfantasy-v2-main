/**
 * The NHL scoring screen shows what the engine scores — no more, no less.
 *
 * Every panel row is either bridged into an engine category (always, or once a commissioner saves on
 * the current contract) or marked `unavailable` and shown locked at 0. New rows are counted from
 * fields the Rolling Insights box really carries, checked against the committed fixture.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ league: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { NHL_ALL_SCORING_CATEGORIES, NHL_UNAVAILABLE_SCORING_KEYS } from '@/lib/nhl-scoring/NhlScoringCategories'
import { NHL_GATED_ENGINE_KEY_MAP, NHL_SCORING_ENGINE_VERSION } from '@/lib/nhl-scoring/nhlScoringEngineContract'
import { buildFullNhlScoringConfig } from '@/lib/nhl-scoring/NhlScoringPresets'
import { getLeagueNhlScoringConfig } from '@/lib/nhl-scoring/NhlScoringConfigService'
import { UI_SCORING_STORES, bridgeSportUiScoringStore } from '@/lib/redraft/uiScoringStoreBridge'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { getScoringCategories } from '@/lib/sportConfig'

type Line = { group: string; raw: Record<string, unknown> }

/** Player lines straight out of the committed fixture: player_box.<side>.<skaters|goalies>.<id>. */
function fixtureLines(): Line[] {
  const path = join(process.cwd(), 'contracts/rolling-insights/fixtures/live.NHL.json')
  const games = (JSON.parse(readFileSync(path, 'utf8')) as { data: { NHL: Array<Record<string, any>> } }).data.NHL
  const lines: Line[] = []
  for (const game of games) {
    for (const side of Object.values(game.player_box ?? {}) as Array<Record<string, Record<string, Record<string, unknown>>>>) {
      for (const [group, players] of Object.entries(side)) {
        for (const raw of Object.values(players)) lines.push({ group, raw })
      }
    }
  }
  return lines
}

const seededStore = () => ({ rules: buildFullNhlScoringConfig('af_default'), lastUpdatedBy: null })
const savedStore = (rules: Record<string, number>) => ({
  rules,
  lastUpdatedBy: 'commish-1',
  engineVersion: NHL_SCORING_ENGINE_VERSION,
})

beforeEach(() => vi.clearAllMocks())

describe('every panel row is honest', () => {
  it('each row is bridged to a real engine category or locked as unavailable', () => {
    const engineKeys = new Set(getScoringCategories('NHL').map((c) => c.key))
    const bridged = { ...UI_SCORING_STORES.NHL.keyMap, ...NHL_GATED_ENGINE_KEY_MAP }
    for (const row of NHL_ALL_SCORING_CATEGORIES.flatMap((c) => c.rows)) {
      if (NHL_UNAVAILABLE_SCORING_KEYS.has(row.key)) {
        expect(row.defaultValue, row.key).toBe(0)
        expect(bridged[row.key], row.key).toBeUndefined()
      } else {
        expect(bridged[row.key], `${row.key} shows on the panel but scores nothing`).toBeDefined()
        expect(engineKeys.has(bridged[row.key]), `${row.key} -> ${bridged[row.key]}`).toBe(true)
      }
    }
  })

  it('the presets set nothing the engine cannot score', () => {
    for (const [key, value] of Object.entries(buildFullNhlScoringConfig('af_default'))) {
      if (NHL_UNAVAILABLE_SCORING_KEYS.has(key)) expect(value, key).toBe(0)
    }
  })
})

describe('the new rows are counted from fields the feed really sends', () => {
  const lines = fixtureLines()

  it('reads special-teams, faceoff and possession stats off a skater line', () => {
    const skater = lines.find((l) => l.group === 'skaters' && Number(l.raw.faceoffs_won) > 0)!
    const { stats } = normalizeNhlGameStats(skater.raw)
    expect(stats.fow).toBe(Number(skater.raw.faceoffs_won))
    expect(stats.fol).toBe(Number(skater.raw.faceoffs_lost))
    expect(stats.tk).toBe(Number(skater.raw.takeaways))
    expect(stats.gv).toBe(Number(skater.raw.giveaways))
    expect(stats.ppg).toBe(Number(skater.raw.power_play_goals))
    expect(stats.pts).toBe(Number(skater.raw.goals) + Number(skater.raw.assists))
  })

  it('reads a goalie loss, OT loss and shots against', () => {
    const goalie = lines.find((l) => l.group === 'goalies' && Number(l.raw.loss) === 1)!
    const { stats } = normalizeNhlGameStats(goalie.raw)
    expect(stats.g_loss).toBe(1)
    expect(stats.g_sa).toBe(Number(goalie.raw.shots_against))
    expect(stats.g_otl).toBe(Number(goalie.raw.overtime_loss))
  })

  it('counts single-game bonuses per game, never from a week of totals', () => {
    expect(normalizeNhlGameStats({ goals: 3, assists: 2, shots_on_goal: 4 }).stats).toMatchObject({
      hat_trick: 1, multi_g_game: 1, multi_a_game: 1, five_pt_game: 1,
    })
    expect(normalizeNhlGameStats({ saves: 41, win: 1 }).stats).toMatchObject({ g_40sv_game: 1 })
    expect(normalizeNhlGameStats({ saves: 41 }).stats.g_50sv_game).toBeUndefined()
    // Two goals one night and one the next is no hat trick.
    expect(normalizeNhlGameStats({ goals: 2 }).stats.hat_trick).toBeUndefined()
  })
})

describe('existing leagues keep scoring exactly as before', () => {
  const goalieLine = { g_win: 0, g_sv: 30, g_ga: 4, g_loss: 1, g_sa: 34 }
  const skaterLine = { g: 3, a: 0, sog: 6, fow: 10, fol: 5, hat_trick: 1 }

  it('a seeded store bridges none of the newly wired rows', () => {
    const out = bridgeSportUiScoringStore('NHL', { nhl_scoring_config: seededStore() })!
    for (const engineKey of Object.values(NHL_GATED_ENGINE_KEY_MAP)) expect(out[engineKey], engineKey).toBeUndefined()
  })

  it('so its score is unchanged by the new stats arriving', () => {
    const scorer = buildLeagueStatScorer({ sport: 'NHL', settings: { nhl_scoring_config: seededStore() } })!
    const { fow, fol, hat_trick, ...base } = skaterLine
    expect(scorer(skaterLine)).toBeCloseTo(scorer(base))
    const { g_loss, g_sa, ...goalieBase } = goalieLine
    expect(scorer(goalieLine)).toBeCloseTo(scorer(goalieBase))
  })

  it('a commissioner saving the panel turns them on, at the values they saved', () => {
    const rules = { ...buildFullNhlScoringConfig('af_default'), goalie_losses: -3, hat_trick_bonus: 2, faceoff_wins: 0.1 }
    const scorer = buildLeagueStatScorer({ sport: 'NHL', settings: { nhl_scoring_config: savedStore(rules) } })!
    const { g_loss, g_sa, ...goalieBase } = goalieLine
    expect(scorer(goalieLine) - scorer(goalieBase)).toBeCloseTo(-3)
    const { fow, fol, hat_trick, ...base } = skaterLine
    expect(scorer(skaterLine) - scorer(base)).toBeCloseTo(10 * 0.1 + 5 * -0.05 + 2)
  })
})

describe('the panel is shown what scores', () => {
  it('shows newly wired rows at 0 until a commissioner saves, and unavailable rows always at 0', async () => {
    db.league.findUnique.mockResolvedValue({
      sport: 'NHL',
      settings: { nhl_scoring_config: { ...seededStore(), rules: { ...seededStore().rules, game_winning_goals: 1 } } },
    })
    const config = await getLeagueNhlScoringConfig('L1')
    expect(config.rules.faceoff_wins).toBe(0)
    expect(config.rules.hat_trick_bonus).toBe(0)
    expect(config.rules.game_winning_goals).toBe(0)
    expect(config.rules.goals).toBe(3)
  })

  it('shows a saved league its saved values for the wired rows', async () => {
    db.league.findUnique.mockResolvedValue({
      sport: 'NHL',
      settings: { nhl_scoring_config: savedStore({ ...buildFullNhlScoringConfig('af_default'), goalie_losses: -3 }) },
    })
    const config = await getLeagueNhlScoringConfig('L1')
    expect(config.rules.goalie_losses).toBe(-3)
    expect(config.rules.faceoff_wins).toBe(0.1)
  })
})
