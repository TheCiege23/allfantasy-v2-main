// @vitest-environment node
/**
 * No import adapter may FABRICATE a playoff team count.
 *
 * 🛑 WHAT THIS CAUGHT. `FleaflickerAdapter` shipped
 * `playoff_team_count: Math.max(2, Math.floor(leagueSize / 2))` — a number derived
 * from the roster count and nothing else. For a 12-team league that is 6, the single
 * most common real answer, so the invention was invisible in exactly the leagues
 * anyone would have checked.
 *
 * ⚠ AND IT IS NOT COSMETIC. `lib/data/league-home.ts` does
 * `standings.slice(0, playoff.playoff_team_count)` to seed a bracket. A league that
 * takes 4 or 8 rendered a six-team playoff picture drawn from its roster count.
 *
 * ⚠ THE FIX IS `undefined`, NOT A BETTER FORMULA, AND THAT IS THE POINT OF THE TEST.
 * No captured Fleaflicker endpoint carries a playoff setting — verified below against
 * the committed fixtures, so this is measured rather than asserted. Every sibling
 * adapter already passes `undefined` when the provider is silent; Fleaflicker was the
 * only one guessing.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/**
 * Source with comments stripped.
 *
 * 🛑 REQUIRED HERE, NOT DEFENSIVE. The adapter's new comment explains the removal by
 * quoting the formula it removed, so an assertion against raw source would match the
 * prose warning against the bug and fail on a correct file. This repo has been bitten
 * by that shape repeatedly.
 */
const codeOnly = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const ADAPTERS = [
  ['fleaflicker', 'lib/league-import/adapters/fleaflicker/FleaflickerAdapter.ts'],
  ['espn', 'lib/league-import/adapters/espn/EspnAdapter.ts'],
  ['mfl', 'lib/league-import/adapters/mfl/MflAdapter.ts'],
  ['fantrax', 'lib/league-import/adapters/fantrax/FantraxLeagueMapper.ts'],
] as const

describe('no adapter derives a playoff count from league size', () => {
  it('self-control: the stripper keeps code and drops prose', () => {
    /* Without this, the adapter's own explanation of the removed formula would
       satisfy — or trip — every assertion below. */
    const src = codeOnly(read(ADAPTERS[0][1]))
    expect(src).toContain('playoff_team_count')
    expect(codeOnly('/* Math.floor(leagueSize / 2) */\nconst a = 1')).not.toContain('Math.floor')
    expect(codeOnly('const a = 1 // note')).toContain('const a = 1')
    expect(codeOnly("const u = 'https://x.test/a'")).toContain('https://x.test/a')
  })

  it.each(ADAPTERS)('%s does not compute a playoff count from leagueSize', (_name, path) => {
    const src = codeOnly(read(path))
    const line = src.split('\n').find((l) => l.includes('playoff_team_count'))
    expect(line, `${path} no longer assigns playoff_team_count`).toBeDefined()
    /*
     * The specific shape that shipped, plus the near neighbours someone would reach
     * for next. A count must come from the provider or be absent — never from a
     * division of the roster count.
     */
    expect(line).not.toMatch(/leagueSize/)
    expect(line).not.toMatch(/Math\.(floor|ceil|round|max|min)/)
    expect(line).not.toMatch(/\/\s*2/)
  })

  it('🛑 fleaflicker says UNKNOWN rather than picking a plausible number', () => {
    const src = codeOnly(read(ADAPTERS[0][1]))
    expect(src).toMatch(/playoff_team_count:\s*undefined/)
  })

  it('and its coverage map admits the data is missing, not "partial"', () => {
    /*
     * `partial` was a claim about our own guess rather than about the provider. A
     * coverage map reporting the health of a fabrication is worse than none.
     */
    const src = read(ADAPTERS[0][1])
    const idx = src.indexOf('playoffSettings:')
    expect(idx).toBeGreaterThan(-1)
    expect(src.slice(idx, idx + 400)).toContain("state: 'missing'")
  })
})

describe('the reason it must be undefined, measured against the committed fixtures', () => {
  /*
   * ⚠ THIS IS THE HALF THAT STOPS THE FORMULA COMING BACK. "Fleaflicker does not
   * expose it" is the entire justification for `undefined`; if that ever becomes
   * false, this block goes red and the adapter should start importing the real value
   * instead of the guard being relaxed.
   */
  const playoffish = (o: unknown, path = ''): string[] => {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        playoffish(v, `${path}.${k}`),
      )
    }
    if (Array.isArray(o)) return o.length ? playoffish(o[0], `${path}[0]`) : []
    return /playoff|postseason|bracket/i.test(path) ? [path] : []
  }

  it('self-control: the walker DOES find a playoff-ish path when one exists', () => {
    /* A search that cannot match reports "no playoff field" for every input. */
    expect(playoffish({ settings: { playoffTeamCount: 6 } })).toEqual(['.settings.playoffTeamCount'])
    expect(playoffish({ a: [{ isPlayoffs: true }] })).toEqual(['.a[0].isPlayoffs'])
    expect(playoffish({ a: { b: 1 } })).toEqual([])
  })

  it('FetchLeagueRules carries no playoff setting at all', () => {
    const rules = JSON.parse(read('contracts/fleaflicker/fixtures/rules.NFL.json'))
    expect(playoffish(rules)).toEqual([])
  })

  it('the standings `league` object carries none either', () => {
    const standings = JSON.parse(read('contracts/fleaflicker/fixtures/standings.NFL.json'))
    expect(playoffish(standings.league)).toEqual([])
  })

  it('the only playoff signal is per-GAME, and it appears only once a bracket exists', () => {
    const wk1 = JSON.parse(read('contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week1.json'))
    const wk16 = JSON.parse(read('contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week16.json'))
    expect(wk1.games.filter((g: { isPlayoffs?: true }) => g.isPlayoffs)).toHaveLength(0)
    expect(wk16.games.filter((g: { isPlayoffs?: true }) => g.isPlayoffs)).toHaveLength(2)
  })

  it('🛑 `recordPostseason` counts CONSOLATION games, so it cannot size the field', () => {
    /*
     * The shortcut anyone reaching for a real count will try first: "teams with a
     * non-zero postseason record made the playoffs". In the week-16 fixture the two
     * CONSOLATION games carry postseason records of 1-1, 2-0, 2-1 and 1-2 — so that
     * heuristic returns the whole playing field, not the playoff field.
     */
    const wk16 = JSON.parse(read('contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week16.json'))
    type Side = { recordPostseason?: { wins?: number; losses?: number } }
    type Game = { isConsolation?: true; away?: Side; home?: Side }
    const consolation = wk16.games.filter((g: Game) => g.isConsolation)
    expect(consolation.length).toBeGreaterThan(0)
    const played = consolation.flatMap((g: Game) => [g.away, g.home]).filter((t): t is Side =>
      Boolean(
        t?.recordPostseason && ((t.recordPostseason.wins ?? 0) + (t.recordPostseason.losses ?? 0)) > 0,
      ),
    )
    expect(played.length).toBe(consolation.length * 2)
  })
})
