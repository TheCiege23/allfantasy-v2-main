/**
 * NHL goalie shutouts, derived from the box score.
 *
 * Rolling Insights' `/live` NHL box reports `shutouts: 0` even for a goalie who played the whole
 * game and allowed nothing (contracts/rolling-insights/GAPS.md) — Jake Oettinger 2026-10-08,
 * 60:00, 26 saves on 26 shots, the win, `shutouts: 0`. So `g_so` is derived in
 * `normalizeNhlGameStats`, on the real stored path:
 *
 *   fixtures/live.NHL.json -> normalizeRiGameBox -> normalizedStatMapFor -> normalizeNhlGameStats
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))

import { normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { normalizeRiGameBox, normalizedStatMapFor } from '@/lib/sports-data/rollingInsightsGameLogs'

type Raw = Record<string, unknown>
type Game = {
  game_ID: string
  status: string
  full_box: Record<string, { abbrv: string; score: number | null }>
  player_box: Record<string, { goalies: Record<string, Raw>; skaters: Record<string, Raw> }>
}

function fixtureGame(): Game {
  const path = join(process.cwd(), 'contracts/rolling-insights/fixtures/live.NHL.json')
  const games = (JSON.parse(readFileSync(path, 'utf8')) as { data: { NHL: Game[] } }).data.NHL
  // Joey Daccord, SEA, 60:00 — the fixture's own full-game line, reshaped below.
  return structuredClone(games.find((g) => g.game_ID === '20260315-13-32')!)
}

const OETTINGER: Raw = {
  win: 1, loss: 0, saves: 26, player: 'Jake Oettinger', status: 'ACT', position: 'G', shutouts: 0,
  time_on_ice: '60:00', goals_allowed: 0, overtime_loss: 0, shots_against: 26, position_category: 'G',
}
const BACKUP: Raw = {
  win: 0, loss: 0, saves: 0, player: 'Backup', status: 'ACT', position: 'G', shutouts: 0,
  time_on_ice: '0:00', goals_allowed: 0, overtime_loss: 0, shots_against: 0, position_category: 'G',
}

/** g_so for every goalie line of the HOME side, keyed by player name, through the stored map. */
function homeShutouts(game: Game, opts: { contextless?: boolean } = {}): Record<string, number | undefined> {
  const box = normalizeRiGameBox(game)!
  const out: Record<string, number | undefined> = {}
  for (const line of box.lines) {
    if (line.group !== 'goalies' || line.team !== 'SEA') continue
    const stored = normalizedStatMapFor(line, box)
    if (opts.contextless) {
      // A row written before the ingest counted the team's goalies.
      delete stored.teamGoaliesUsed
      delete stored.gameFinal
    }
    out[String(line.playerName)] = normalizeNhlGameStats(stored).stats.g_so
  }
  return out
}

describe('NHL shutout derived from the box score', () => {
  it('the Oettinger line — sole goalie, 60:00, 26 of 26 — gets g_so = 1 despite the vendor 0', () => {
    const game = fixtureGame()
    game.player_box.home_team.goalies = { '2263': OETTINGER, '9001': BACKUP }
    expect(homeShutouts(game)).toEqual({ 'Jake Oettinger': 1, Backup: 0 })
  })

  it('a sole goalie whose clock the vendor printed short still gets it once the game is final', () => {
    // Measured on production: Kochetkov 24 of 24 with the win at `time_on_ice: "0"`, Oettinger at 59:50.
    const game = fixtureGame()
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, time_on_ice: '0' }, '9001': BACKUP }
    expect(homeShutouts(game)['Jake Oettinger']).toBe(1)
  })

  it('a goalie pulled after allowing 0 gets 0, and so does the reliever who allowed 0', () => {
    const game = fixtureGame()
    game.player_box.home_team.goalies = {
      '2263': { ...OETTINGER, win: 0, saves: 14, shots_against: 14, time_on_ice: '40:00' },
      '9001': { ...BACKUP, player: 'Reliever', win: 1, saves: 9, shots_against: 9, time_on_ice: '20:00' },
    }
    expect(homeShutouts(game)).toEqual({ 'Jake Oettinger': 0, Reliever: 0 })
  })

  it('0 goals against under full time with no sibling data gets 0', () => {
    const game = fixtureGame()
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, time_on_ice: '59:50' } }
    expect(homeShutouts(game, { contextless: true })['Jake Oettinger']).toBe(0)
    // ...while the full clock alone is enough when the sibling data is missing.
    game.player_box.home_team.goalies = { '2263': OETTINGER }
    expect(homeShutouts(game, { contextless: true })['Jake Oettinger']).toBe(1)
  })

  it('a game still running uses the full-clock rule, not "sole goalie so far"', () => {
    const game = fixtureGame()
    game.status = 'inprogress'
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, win: 0, time_on_ice: '40:00' } }
    expect(homeShutouts(game)['Jake Oettinger']).toBe(0)
  })

  it('keeps the vendor’s 1, and never makes one game worth two', () => {
    const game = fixtureGame()
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, shutouts: 1 } }
    expect(homeShutouts(game)['Jake Oettinger']).toBe(1)
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, time_on_ice: '30:00', shutouts: 1 } }
    expect(homeShutouts(game, { contextless: true })['Jake Oettinger']).toBe(1)
  })

  it('a line with goals against > 0 gets 0', () => {
    // The fixture's own line: Daccord 60:00, 23 of 25.
    expect(homeShutouts(fixtureGame())).toEqual({ 'Joey Daccord': 0 })
    const game = fixtureGame()
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, goals_allowed: 1, saves: 25 } }
    expect(homeShutouts(game)['Jake Oettinger']).toBe(0)
  })

  it('a regulation loss with nothing allowed is an empty-net goal, not a shutout', () => {
    const game = fixtureGame()
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, win: 0, loss: 1, time_on_ice: '58:40' } }
    expect(homeShutouts(game)['Jake Oettinger']).toBe(0)
  })

  it('both goalies of a 0-0 game decided in a shootout get one — shootout goals do not count', () => {
    const game = fixtureGame()
    game.player_box.home_team.goalies = { '2263': { ...OETTINGER, win: 0, overtime_loss: 1, time_on_ice: '65:00' } }
    expect(homeShutouts(game)['Jake Oettinger']).toBe(1)
  })
})

/** g_win for every goalie line of the game, keyed by `TEAM name`, through the stored map. */
function wins(game: Game, opts: { contextless?: boolean } = {}): Record<string, number | undefined> {
  const box = normalizeRiGameBox(game)!
  const out: Record<string, number | undefined> = {}
  for (const line of box.lines) {
    if (line.group !== 'goalies') continue
    const stored = normalizedStatMapFor(line, box)
    if (opts.contextless) {
      delete stored.teamGoaliesUsed
      delete stored.gameFinal
      delete stored.teamWon
    }
    out[`${line.team} ${line.playerName}`] = normalizeNhlGameStats(stored).stats.g_win
  }
  return out
}

/** The fixture game (FLA 2 at SEA 6) with both decisions taken out, as the vendor sent weeks 1–2. */
function undecidedGame(): Game {
  const game = fixtureGame()
  for (const side of ['home_team', 'away_team']) {
    for (const g of Object.values(game.player_box[side].goalies)) Object.assign(g, { win: 0, loss: 0, overtime_loss: 0 })
  }
  return game
}

describe('NHL goalie win derived from the box score', () => {
  it('the sole goalie of the winning team gets the win the vendor left out; the loser gets none', () => {
    expect(wins(undecidedGame())).toEqual({ 'SEA Joey Daccord': 1, 'FLA Daniil Tarasov': 0 })
  })

  it('the dressed backup on the winning side is not "used", so the starter is still the sole goalie', () => {
    const game = undecidedGame()
    game.player_box.home_team.goalies['9001'] = BACKUP
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 1, 'SEA Backup': 0, 'FLA Daniil Tarasov': 0 })
  })

  it('when the winners used two goalies, neither is credited and the vendor value is kept', () => {
    const game = undecidedGame()
    game.player_box.home_team.goalies['9001'] = { ...BACKUP, player: 'Reliever', saves: 6, shots_against: 6, time_on_ice: '20:00' }
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 0, 'SEA Reliever': 0, 'FLA Daniil Tarasov': 0 })
    // ...and a vendor win in that split survives.
    game.player_box.home_team.goalies['9001'].win = 1
    expect(wins(game)['SEA Reliever']).toBe(1)
  })

  it('a row without team context keeps the vendor value — no fallback from the goalie’s own line', () => {
    expect(wins(undecidedGame(), { contextless: true })).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 0 })
    expect(wins(fixtureGame(), { contextless: true })).toEqual({ 'SEA Joey Daccord': 1, 'FLA Daniil Tarasov': 0 })
  })

  it('a game still running credits nobody, whatever the score', () => {
    const game = undecidedGame()
    game.status = 'inprogress'
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 0 })
  })

  it('goalies on the losing side never get the win, even as the sole goalie', () => {
    const game = undecidedGame()
    game.full_box.away_team.score = 7 // FLA now wins 7-6
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 1 })
  })

  it('a shootout win counts, whether the board carries the deciding goal or shows a tie', () => {
    // NHL convention: the shootout winner gets one goal on the final score.
    const game = undecidedGame()
    game.full_box.away_team.score = 3
    game.full_box.home_team.score = 2
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 1 })

    // A tie on the board is settled by the box's own evidence: the loser's OT/SO decision...
    game.full_box.away_team.score = 2
    game.player_box.home_team.goalies[Object.keys(game.player_box.home_team.goalies)[0]].overtime_loss = 1
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 1 })

    // ...or the skaters' shootout goals.
    const so = undecidedGame()
    so.full_box.away_team.score = 2
    so.full_box.home_team.score = 2
    Object.values(so.player_box.away_team.skaters)[0].shootout_goals = 1
    expect(wins(so)).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 1 })
  })

  it('a tie with no evidence, or evidence that disagrees, credits nobody', () => {
    const game = undecidedGame()
    game.full_box.away_team.score = 2
    game.full_box.home_team.score = 2
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 0 })
    Object.values(game.player_box.away_team.skaters)[0].shootout_goals = 1
    Object.values(game.player_box.home_team.skaters)[0].shootout_goals = 2
    Object.values(game.player_box.home_team.skaters)[1].shootout_goals = 0
    game.player_box.home_team.goalies[Object.keys(game.player_box.home_team.goalies)[0]].overtime_loss = 1
    // shootout goals say SEA, the OT loss says FLA
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 0, 'FLA Daniil Tarasov': 0 })
  })

  it('keeps the vendor’s 1, and never makes one game worth two wins', () => {
    const game = fixtureGame() // the vendor credited Daccord
    expect(wins(game)).toEqual({ 'SEA Joey Daccord': 1, 'FLA Daniil Tarasov': 0 })
    game.player_box.home_team.goalies[Object.keys(game.player_box.home_team.goalies)[0]].win = 2
    expect(wins(game)['SEA Joey Daccord']).toBe(1)
  })
})
