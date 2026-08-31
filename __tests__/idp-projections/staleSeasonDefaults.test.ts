/**
 * `@default(2025)` on a season column is a stale default that silently uses the wrong year.
 *
 * 🛑 IT IS NOT INERT, WHICH IS WHY IT SURVIVED. The places that carry it feed the stored value
 * back out as the DEFAULT season for later queries:
 *
 *   app/api/idp/cap/route.ts:35     `cfg?.season ?? new Date().getFullYear()`
 *   app/api/devy/picks/route.ts:28  `seasonParam ? Number(seasonParam) : cfg.season`
 *
 * The `?? currentYear` fallback only fires when there is NO config, so the moment a row exists
 * the API adopts its season. For the cap that meant `isSalaryActiveInSeason` hiding every
 * current-season contract — a fully-priced roster reporting zero used. For devy it meant
 * `generatePickInventory(leagueId, season, 3)` generating a season already past. Nothing throws
 * in either case; the wrong year is simply used, which is why nothing caught them and why this
 * guard asserts the CREATE CALL rather than an outcome.
 *
 * 🛑 AND THE CENSUS IS TAKEN FROM THE SCHEMA, NOT FROM A LIST TYPED HERE. The first version of
 * this file hard-coded three models, because the audit behind it ended in `head -3` and then
 * reasoned about "the other two". There were FOUR. C2CLeague was missed entirely and shipped
 * broken; a reviewing session found it by running `grep -c` with no cap.
 *
 * A census that enumerates from memory finds what it expects to find. So the first test below
 * derives the model list from prisma/schema.prisma at runtime and FAILS when a new model gains
 * this default without being classified here — which is the only version of this guard that
 * could have caught its own author.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\r/g, '')
const SCHEMA = read('prisma/schema.prisma')

/**
 * Every model whose season column takes the stale default, classified.
 * `fixedIn` names the create site that must set the value; `safe` means the model's creates
 * already pass a season explicitly and the default is never reached.
 */
const CLASSIFIED: Record<string, { file: string; safe?: true }> = {
  IDPCapConfig: { file: 'app/api/commissioner/leagues/[leagueId]/idp/cap-config/route.ts' },
  DevyLeague: { file: 'app/api/devy/route.ts' },
  C2CLeague: { file: 'app/api/c2c/route.ts' },
  TradeLearningInsight: { file: 'lib/comprehensive-trade-learning.ts', safe: true },
}

/** Model name owning each `@default(2025)` line, read from the schema itself. */
function modelsWithStaleDefault(): string[] {
  const lines = SCHEMA.split('\n')
  const out: string[] = []
  let current = ''
  for (const line of lines) {
    const m = /^model\s+(\w+)/.exec(line)
    if (m) current = m[1]
    if (line.includes('@default(2025)') && current) out.push(current)
  }
  return [...new Set(out)]
}

describe('season is taken from the league, never from the schema default', () => {
  /**
   * 🛑 THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL MISS. Derived from the file, so a
   * fifth model gaining this default fails here rather than being silently unclassified.
   */
  it('classifies every model carrying @default(2025)', () => {
    const found = modelsWithStaleDefault().sort()
    expect(found.length).toBeGreaterThan(0)
    expect(found).toEqual(Object.keys(CLASSIFIED).sort())
  })

  /** Each non-safe model's create site must set season from the league. */
  for (const [model, { file, safe }] of Object.entries(CLASSIFIED)) {
    if (safe) continue
    it(`${model}: its create sets season from the league`, () => {
      const src = read(file)
      expect(src, `${file} should read the league's season`).toMatch(/league\?\.season/)
      expect(src, `${file} should write season on create`).toMatch(/season:/)
    })
  }

  /**
   * ⚠ TradeLearningInsight IS A DELIBERATE NON-BUG, recorded so the next person auditing this
   * default does not "fix" it — and so that if a create ever stops passing season, this notices.
   */
  it('trade-learning inserts pass season explicitly rather than defaulting', () => {
    const src = read('lib/comprehensive-trade-learning.ts')
    const creates = src.split('prisma.tradeLearningInsight.create').slice(1)
    expect(creates.length).toBeGreaterThan(0)
    for (const c of creates) {
      expect(c.slice(0, c.indexOf('})'))).toMatch(/season:/)
    }
  })

  /**
   * The severities differ and the comments say so. Devy's picks route read `cfg.season` and
   * generated pick inventory from it; C2C's draft and score routes never did — they use
   * `body?.season ?? currentYear`, so only specialty-automation metadata carried the stale year.
   * Pinned so a future reader does not flatten the two into one claim.
   */
  it('does not overstate the C2C exposure', () => {
    for (const f of ['app/api/c2c/draft/route.ts', 'app/api/c2c/score/route.ts']) {
      expect(read(f)).toMatch(/new Date\(\)\.getFullYear\(\)/)
    }
  })
})
