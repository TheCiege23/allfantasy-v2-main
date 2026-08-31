/**
 * `@default(2025)` on a season column is a stale default that silently uses the wrong year.
 *
 * 🛑 IT IS NOT INERT, WHICH IS WHY IT SURVIVED. Both places that carry it feed the stored value
 * straight back out as the DEFAULT season for subsequent queries:
 *
 *   app/api/idp/cap/route.ts:35     `cfg?.season ?? new Date().getFullYear()`
 *   app/api/devy/picks/route.ts:28  `seasonParam ? Number(seasonParam) : cfg.season`
 *
 * The `?? currentYear` fallback only fires when there is NO config, so the moment a row exists
 * the API adopts its season. For the cap that meant `isSalaryActiveInSeason` hiding every
 * current-season contract — a fully-priced roster reporting zero used. For devy it means
 * `generatePickInventory(leagueId, season, 3)` generating a season that has already passed.
 *
 * Nothing throws in either case. The wrong year is simply used, which is why no test caught it
 * and why this one asserts on the CREATE call rather than on an outcome.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\r/g, '')

describe('season is taken from the league, never from the schema default', () => {
  /**
   * The IDP cap config. Behavioural coverage lives in idpCapConfigWriter.test.ts; this pins the
   * source so the two stay consistent if either is refactored.
   */
  it('the cap config route sets season on create', () => {
    const src = read('app/api/commissioner/leagues/[leagueId]/idp/cap-config/route.ts')
    expect(src).toMatch(/league\?\.season/)
    expect(src).toContain('season: seasonOnCreate')
  })

  /** ⚠ The devy league config had the identical defect, found by looking for the same shape. */
  it('the devy league route sets season on create', () => {
    const src = read('app/api/devy/route.ts')
    const create = src.slice(src.indexOf('prisma.devyLeague.create'))
    const block = create.slice(0, create.indexOf('})'))
    expect(block).toMatch(/season:/)
    expect(src).toMatch(/league\?\.season/)
  })

  /**
   * ⚠ THE THIRD MODEL CARRYING `@default(2025)` IS FINE, AND SAYING SO MATTERS. Every
   * `TradeLearningInsight` create passes `season: 0` explicitly, so it never takes the default.
   * Recorded here so the next person auditing that default does not "fix" a non-bug — and so
   * that if a create ever stops passing it, this notices.
   */
  it('trade-learning inserts pass season explicitly rather than defaulting', () => {
    const src = read('lib/comprehensive-trade-learning.ts')
    const creates = src.split('prisma.tradeLearningInsight.create').slice(1)
    expect(creates.length).toBeGreaterThan(0)
    for (const c of creates) {
      expect(c.slice(0, c.indexOf('})'))).toMatch(/season:/)
    }
  })
})
