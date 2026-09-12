import { describe, expect, it } from 'vitest'
import { coverageAgainstExpected, emptyableHistoryCoverage } from '@/lib/league-import/coverageCompleteness'

/**
 * `full` vs `partial` decided against an INDEPENDENT expected count.
 *
 * 🛑 THE BUG: `rows.length > 0 ? 'full' : 'missing'` cannot tell SOME from ALL,
 * so eight of twelve teams' standings reported `full`. The coverage block drives
 * the nav gating and the import banner, so a partial import was presented as a
 * whole one.
 *
 * ⚠ AND THE OBVIOUS FIX IS A TAUTOLOGY HERE. In ESPN, Yahoo and MFL the
 * standings are `raw.teams.map(...)`, so comparing their length to the team
 * count agrees by construction. The comparison has to be against a count the
 * provider declared SEPARATELY — `league.size` / `league.numTeams`.
 */
describe('coverageAgainstExpected', () => {
  it('reports full only when the rows reach the declared count', () => {
    expect(coverageAgainstExpected({ actual: 12, expected: 12, unit: 'teams' })).toMatchObject({
      state: 'full',
      count: 12,
    })
  })

  it('names the shortfall rather than rounding it up to full', () => {
    const c = coverageAgainstExpected({ actual: 8, expected: 12, unit: 'teams' })
    expect(c.state).toBe('partial')
    expect(c.count).toBe(8)
    expect(c.note).toContain('8 of 12 teams')
  })

  /*
   * The case the whole helper exists for. A provider that declares nothing gives
   * no independent signal, and the honest answer is "not verified" — never
   * `full`, because that is indistinguishable from a verified complete import.
   */
  it.each([null, undefined, 0, -3, Number.NaN])(
    'refuses to claim full when the declared count is %p',
    (expected) => {
      const c = coverageAgainstExpected({ actual: 10, expected: expected as number, unit: 'teams' })
      expect(c.state).toBe('partial')
      expect(c.count).toBe(10)
      expect(c.note).toContain('could not be verified')
    }
  )

  it('reports missing when nothing came back at all', () => {
    expect(coverageAgainstExpected({ actual: 0, expected: 12, unit: 'teams' })).toMatchObject({
      state: 'missing',
      count: 0,
    })
  })

  /*
   * More rows than declared is not a shortfall. A provider can report a size that
   * lags its own roster list, and calling that `partial` would nag about an
   * import that is, if anything, over-complete.
   */
  it('treats more rows than declared as full, not as a discrepancy', () => {
    expect(coverageAgainstExpected({ actual: 14, expected: 12, unit: 'teams' })).toMatchObject({
      state: 'full',
      count: 14,
    })
  })

  it('rounds a fractional declared count down rather than failing on it', () => {
    expect(coverageAgainstExpected({ actual: 12, expected: 12.4, unit: 'teams' }).state).toBe('full')
  })
})

/**
 * `emptyableHistoryCoverage` — a collection that is allowed to be empty.
 *
 * 🛑 ZERO TRADES IS A NORMAL LEAGUE STATE AND WAS REPORTED AS A FAILURE. Every
 * adapter wrote `transactions.length > 0 ? … : 'missing'`, and `missing` does
 * two things in `summarizeImportCoverage`: it flips the `trades` capability
 * false, REMOVING THE TRADES TAB, and it prints "<Provider> doesn't publish
 * trade history". That sentence is false for Sleeper, ESPN, Yahoo and MFL.
 */
describe('emptyableHistoryCoverage', () => {
  it('calls an empty result COMPLETE when the provider was actually asked', () => {
    const c = emptyableHistoryCoverage({ fetched: true, unit: 'trades' })
    // full, not missing: nothing is absent — the league simply has not traded.
    expect(c.state).toBe('full')
    expect(c.count).toBe(0)
    expect(c.note).toContain('no trades yet')
  })

  it('reports missing only when the fetch is known not to have happened', () => {
    expect(emptyableHistoryCoverage({ fetched: false, unit: 'trades' })).toMatchObject({
      state: 'missing',
      count: 0,
    })
  })

  /*
   * Yahoo, MFL and Fantrax type transactions as a required array, so `[]` cannot
   * be told apart from an empty fetch. `partial` keeps the tab and says why;
   * `full` would over-claim and `missing` would assert a provider limitation
   * that does not exist.
   */
  it('says it cannot tell when the provider gives no fetch signal', () => {
    const c = emptyableHistoryCoverage({ fetched: null, unit: 'trades' })
    expect(c.state).toBe('partial')
    expect(c.note).toContain('does not say whether')
  })

  /*
   * The capability consequence is the reason this matters, so pin it: only the
   * known-not-fetched case may remove the tab.
   */
  it('keeps the trades capability for every case except a known failed fetch', () => {
    expect(emptyableHistoryCoverage({ fetched: true, unit: 'trades' }).state).not.toBe('missing')
    expect(emptyableHistoryCoverage({ fetched: null, unit: 'trades' }).state).not.toBe('missing')
    expect(emptyableHistoryCoverage({ fetched: false, unit: 'trades' }).state).toBe('missing')
  })
})
