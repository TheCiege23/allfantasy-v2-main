import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
 * ⚠ THE MOCK IS A TAGGED TEMPLATE, BECAUSE `$queryRaw` IS ONE. Prisma calls it as
 * `` prisma.$queryRaw`SELECT ...` ``, so the mock receives (strings, ...values) — and the
 * interpolations arrive as VALUES, not as text spliced into the SQL. That is what lets the
 * assertions below read the ids, the format and the qbFormat the module actually asked for.
 */
const rows = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }))
const queryRaw = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}))

import { directionFor, resolvePlayerStock } from '@/lib/trade-intel/playerStock'

beforeEach(() => {
  rows.current = []
  queryRaw.mockReset()
  queryRaw.mockImplementation(() => Promise.resolve(rows.current))
})

describe('the flat band — "measured and unmoved" is an answer, not a gap', () => {
  it('calls a real rise a rise and a real fall a fall', () => {
    expect(directionFor(900, 9000)).toBe('up')
    expect(directionFor(-900, 9000)).toBe('down')
  })

  /*
   * 🛑 THE PAIR BELOW IS THE WHOLE POINT OF A PROPORTIONAL BAND, AND EITHER TEST ALONE PROVES
   * NOTHING. The SAME 30-unit move is noise on a 9,000-point quarterback and a real 10% move on a
   * 300-point rookie. An absolute threshold answers identically for both — so only the pair
   * distinguishes the rule that shipped from the rule that was rejected.
   */
  it('🛑 a 9,000-point player drifting 30 is flat, not a confident arrow', () => {
    expect(directionFor(30, 9000)).toBe('flat')
  })

  it('🛑 the same 30 on a 300-point player IS a move — the band is proportional, not absolute', () => {
    expect(directionFor(30, 300)).toBe('up')
  })

  it('an exact zero is flat, which is the state the band exists to make reachable', () => {
    expect(directionFor(0, 5000)).toBe('flat')
  })

  it('refuses to point an arrow at a number that is not a number', () => {
    expect(directionFor(Number.NaN, 5000)).toBe('flat')
    expect(directionFor(Number.POSITIVE_INFINITY, 5000)).toBe('flat')
    expect(directionFor(100, Number.NaN)).toBe('flat')
  })

  it('⚠ a value of zero or less cannot carry a proportion, so it reports no movement', () => {
    // 1% of nothing is nothing, which would make every drift an arrow.
    expect(directionFor(100, 0)).toBe('flat')
    expect(directionFor(100, -50)).toBe('flat')
  })
})

describe('🛑 unmeasured is NOT unmoved', () => {
  it('[control] a fully measured row comes back at all', async () => {
    /*
     * Without this the next test is vacuous: a resolver that dropped EVERY row would pass
     * "the null one is absent" while reporting nothing about anybody.
     */
    rows.current = [{ sleeperId: '4046', value: 9000, trend30d: 900 }]
    const out = await resolvePlayerStock(['4046'])
    expect(out.get('4046')).toEqual({ trend30d: 900, value: 9000, direction: 'up' })
  })

  it('🛑 omits a null trend rather than coercing it to zero', async () => {
    /*
     * Zero would render a confident "no change" mark for a kicker nobody has ever priced — the
     * same mistake as pricing an unknown asset at 0 instead of leaving it unpriced.
     */
    rows.current = [
      { sleeperId: '4046', value: 9000, trend30d: 900 },
      { sleeperId: 'K-9999', value: 100, trend30d: null },
    ]
    const out = await resolvePlayerStock(['4046', 'K-9999'])
    expect(out.has('K-9999')).toBe(false)
    expect(out.has('4046')).toBe(true)
  })

  it('🛑 but a MEASURED zero is present and flat — the two absences are different', () => {
    /*
     * This is the other half of the rule. If `flat` and "no reading" collapsed into one state,
     * dropping the null row would be indistinguishable from a bug, and the mark would be lying
     * about the player it does have data for.
     */
    rows.current = [{ sleeperId: '4046', value: 9000, trend30d: 0 }]
    return resolvePlayerStock(['4046']).then((out) => {
      expect(out.get('4046')?.direction).toBe('flat')
    })
  })

  it('drops a trend that is present but not finite', async () => {
    rows.current = [{ sleeperId: '4046', value: 9000, trend30d: Number.NaN }]
    expect((await resolvePlayerStock(['4046'])).has('4046')).toBe(false)
  })
})

describe('the query asks for exactly what the screen will show', () => {
  it('⚠ pins the same format the value pass pins, so one player cannot carry two numbers', async () => {
    rows.current = []
    await resolvePlayerStock(['4046'], { format: 'DYNASTY', qbFormat: 'ONE_QB' })
    const [, ids, format, qbFormat] = queryRaw.mock.calls[0] as [unknown, string[], string, string]
    expect(ids).toEqual(['4046'])
    expect(format).toBe('DYNASTY')
    expect(qbFormat).toBe('ONE_QB')
  })

  it('dedupes and trims the ids rather than asking about the same player twice', async () => {
    await resolvePlayerStock(['4046', ' 4046 ', '', '  ', '6794'])
    const ids = (queryRaw.mock.calls[0] as [unknown, string[]])[1]
    expect(ids).toEqual(['4046', '6794'])
  })

  it('⚠ asks nothing at all when there is nobody to ask about', async () => {
    const out = await resolvePlayerStock(['', '   '])
    expect(out.size).toBe(0)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('🛑 a database failure costs the marks, never the rosters', async () => {
    /*
     * The stock mark is a decoration on a screen whose job is to price a deal. A snapshot table
     * that is missing, locked or slow must not turn a working trade screen into a 500.
     */
    queryRaw.mockImplementation(() => Promise.reject(new Error('relation does not exist')))
    const out = await resolvePlayerStock(['4046'])
    expect(out.size).toBe(0)
  })
})

describe('🛑 one mark, one rule, in both places it is drawn', () => {
  const PICKER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeAssetPicker.tsx'),
    'utf8',
  )
  const BUILDER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'),
    'utf8',
  )
  const ROUTE = readFileSync(
    resolve(process.cwd(), 'app/api/leagues/[leagueId]/trades/rosters/route.ts'),
    'utf8',
  )
  const CSS = readFileSync(resolve(process.cwd(), 'components/core-app/af-trade-center.css'), 'utf8')

  it('[control] the scans are reading the files they name', () => {
    // A scan against a path that has moved matches nothing and reads as a pass.
    expect(PICKER).toContain('export function TradeAssetPicker')
    expect(BUILDER).toContain('export function TradeCenter')
    /*
     * ⚠ NOT the route's own path — a Next.js route file does not contain it; the directory does.
     * The first version of this control asserted 'trades/rosters' and went red, which is the
     * control working: it proved the assertion was wrong before any negative rested on it.
     */
    expect(ROUTE).toContain('export type TradeableRosterPlayer')
    expect(CSS).toContain('.af-tc-row-value')
  })

  it('🛑 the builder imports the picker’s mark rather than defining a second one', () => {
    /*
     * The same player must not be rising in the picker and flat two inches away in the deal.
     * One exported component is what makes that impossible rather than merely unlikely.
     */
    /*
     * ⚠ ASSERT THE RULE, NOT THE FORMATTING. This read `toContain('import { StockMark,')` and
     * went red the moment the import was wrapped across lines — a true statement about layout,
     * not about whether the builder shares the mark. A test that fails on prettier is noise the
     * next person deletes, taking the real check with it.
     */
    expect(PICKER).toContain('export function StockMark')
    const builderImport = /import\s*\{[^}]*\bStockMark\b[^}]*\}\s*from\s*'@\/components\/core-app\/screens\/TradeAssetPicker'/
    expect(BUILDER).toMatch(builderImport)
    expect(BUILDER).not.toContain('function StockMark')
  })

  it('renders the mark on the player row in both surfaces', () => {
    expect(PICKER).toContain('<StockMark stock={p.stock} delta={p.stockDelta} />')
    expect(BUILDER).toContain('<StockMark stock={l.stock} delta={l.stockDelta} />')
  })

  it('🛑 a PICK carries no stock field at all, so it renders nothing rather than a fake flat', () => {
    /*
     * `PlayerValueSnapshot` holds players only, and a pick is priced off a static curve with no
     * thirty-day series behind it. The union enforces this: the 'pick' variant has no `stock`
     * member, so a future edit cannot quietly start drawing an arrow on one.
     */
    const pickVariant = PICKER.slice(
      PICKER.indexOf("kind: 'pick'"),
      PICKER.indexOf("kind: 'faab'"),
    )
    expect(pickVariant.length).toBeGreaterThan(100)
    expect(pickVariant).not.toContain('stock')
  })

  it('⚠ the route resolves stock in the same pinned format as the value pass', () => {
    expect(ROUTE).toContain("resolvePlayerStock(stockIds, { format: 'DYNASTY', qbFormat: 'ONE_QB' })")
  })

  /*
   * ⚠ WHETHER THE THREE DIRECTIONS ACTUALLY LOOK DIFFERENT IS ASKED IN
   * `__tests__/trade-center-screen.test.tsx`, BY RENDERING THE COMPONENT. A scan for the escape
   * sequence would fail on a source that pasted the arrow character in directly — identical
   * behaviour, red test — and would pass on three escapes that all decoded to the same glyph.
   * The question is about the effect, so the test renders.
   */

  it('🛑 the style sits at the top level, not inside one of the eight media queries', () => {
    /*
     * Inserting a rule inside a `@media` block closes the outer query early and silently drags
     * every rule below it into the narrower band — brace balance stays 0 and nothing throws.
     * `af-matchup.css` has already been bitten by exactly this.
     */
    const at = CSS.indexOf('.af-tc-stock {')
    expect(at).toBeGreaterThan(-1) // the control: a -1 would make the depth below meaningless
    const before = CSS.slice(0, at)
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length
    expect(depth).toBe(0)
  })
})
