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
type Game = { game_ID: string; status: string; player_box: Record<string, { goalies: Record<string, Raw> }> }

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
