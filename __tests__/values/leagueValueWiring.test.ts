import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Every surface that prices a roster against a league must load that league's own board.
 *
 * 🛑 THIS GUARDS A BUG CLASS THAT CANNOT FAIL LOUDLY. `ValuationContext.leagueValueByNameLower`
 * is OPTIONAL. Omit it and a defender is still priced — at `IDP_KICKER_BASELINE_VALUES`, a flat
 * per-position constant where the best linebacker in the league and a rookie backup are both
 * worth 800. Nothing throws, nothing logs, no behavioural test fails, and the surface looks
 * exactly as correct as one that wired it. Three of seven pricing paths shipped without it for
 * that reason, so the same defender carried two prices depending on which screen asked.
 *
 * A behavioural test cannot cover this: each site would need its own league, roster and Sleeper
 * fixture, and the failure mode is a MISSING call rather than a wrong result. Reading the source
 * is the check that matches the defect.
 *
 * ⚠ EACH ASSERTION CARRIES ITS OWN POSITIVE CONTROL. "File mentions X" passes trivially, so
 * every site is first required to still BE a pricing site — if `pricePlayer`/`priceAssets`
 * disappears from one, the premise changed and this test says so instead of quietly passing.
 */

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\r/g, '')

/**
 * Source with comments removed.
 *
 * ⚠ REQUIRED, AND THE FIRST RUN OF THIS FILE PROVED IT. The "no `/redraft/i.test`" guard below
 * went red on a comment that QUOTES the old pattern while explaining why it was removed — the
 * check could not tell the defect from its own documentation, and the only way to make it pass
 * would have been to stop describing the bug. A source guard that reads prose as code punishes
 * writing things down, which is the opposite of what it is for.
 *
 * Deliberately crude: block comments and line comments, with `://` spared so a URL survives. It
 * is not a JavaScript parser and does not need to be — it only has to stop English from being
 * mistaken for a call.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Either seam is acceptable: the shared helper, or a direct load of the same board. */
const RESOLVES_BOARD = /resolveLeagueValuePatch|loadLeagueTradeValues/
const PRICES_PLAYERS = /pricePlayer\(|priceAssets\(/

/**
 * Surfaces that price players AND know which league they are pricing for. Every one of these
 * must reach the board.
 */
const MUST_WIRE: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'app/api/trade-evaluator/route.ts',
    why: 'the primary trade grade',
  },
  {
    file: 'app/api/trade-finder/matchmaking/route.ts',
    why: 'ranks every roster in the league to find trade partners',
  },
  {
    file: 'lib/trade-engine/trade-context-assembler.ts',
    why: 'assembles the context a proposed trade is graded against',
  },
  {
    file: 'lib/trade-value-console/runTradeConsoleAnalysis.ts',
    why: 'the trade value console',
  },
  {
    file: 'lib/season-strategy.ts',
    why: 'roster totals here decide the contend/rebuild call',
  },
  {
    file: 'lib/decision-log.ts',
    why: 'records the roster value a decision is later judged against',
  },
  {
    file: 'lib/trade-engine/league-context-assembler.ts',
    why: 'builds the league-wide value map the decision engine reads',
  },
]

/**
 * Surfaces that price players and genuinely have NO league — they must keep passing nothing.
 *
 * 🛑 THESE ARE NOT OVERSIGHTS, AND "FIXING" ONE WOULD BE THE WORSE BUG. An IDP value is computed
 * against a specific league's starting slots and scoring; applying one league's board to a trade
 * that belongs to another is wrong AND confident, which is worse than the flat constant.
 */
const MUST_NOT_WIRE: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'app/api/instant/trade/route.ts',
    why: 'parses a trade out of free text; league size is guessed from the prose and there is no league id at all',
  },
  {
    file: 'lib/trade-alternatives.ts',
    why: 'receives a UserTrade, which carries transactionId and parties but no league id',
  },
]

describe('league value board wiring', () => {
  describe.each(MUST_WIRE)('$file', ({ file, why }) => {
    const src = read(file)

    it(`is still a pricing surface (${why})`, () => {
      expect(PRICES_PLAYERS.test(src)).toBe(true)
    })

    it('loads this league’s own IDP and kicker board', () => {
      expect(RESOLVES_BOARD.test(src)).toBe(true)
    })

    it('attaches the board to the valuation context it prices with', () => {
      expect(src).toMatch(/leagueValueByNameLower|\.\.\.leagueValuePatch|\.\.\.\(await resolveLeagueValuePatch/)
    })
  })

  describe.each(MUST_NOT_WIRE)('$file', ({ file, why }) => {
    const src = read(file)

    it(`is still a pricing surface (${why})`, () => {
      expect(PRICES_PLAYERS.test(src)).toBe(true)
    })

    it('does NOT load a board, because it has no league to load one for', () => {
      expect(RESOLVES_BOARD.test(src)).toBe(false)
    })
  })
})

describe('format is resolved in one place', () => {
  /*
   * 🛑 THE REGEX THAT COULD NEVER MATCH. `/api/trade-finder/matchmaking` derived dynasty-or-not
   * with `!/redraft/i.test(String(settings.type))`. Sleeper's `settings.type` is a NUMBER — 0
   * redraft, 1 keeper, 2 dynasty — so the pattern tested "0" for the word "redraft", never
   * matched, and every league was read as dynasty. It picks the IDP ceiling, the kicker value
   * and which decay curve is used, so it was wrong silently and no test noticed.
   */
  it('no pricing surface tests a Sleeper settings value for the STRING "redraft"', () => {
    const offenders = [...MUST_WIRE, ...MUST_NOT_WIRE]
      .map(({ file }) => ({ file, src: code(file) }))
      .filter(({ src }) => /\/redraft\/i\.test/.test(src))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('the shared helper derives format through getLeagueType rather than re-deriving it', () => {
    const helper = read('lib/values/leagueValuePatch.ts')
    expect(helper).toMatch(/getLeagueType/)
    /* The positive control: if the helper stops deciding format, this file guards nothing. */
    expect(helper).toMatch(/isDynasty/)
  })
})
