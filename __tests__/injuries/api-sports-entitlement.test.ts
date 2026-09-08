/**
 * Which sports `import-injuries` will spend API-Sports requests on.
 *
 * 🛑 THE SUBSCRIPTION EXCLUDES COLLEGE, and a plan gap is SILENT in this client: every team call
 * in the fanout throws, each is swallowed by a bare `catch { continue }`, `syncAPISportsInjuriesToDb`
 * returns 0, and the route reports a clean run. So listing NCAAF here would not have failed — it
 * would have spent ~33 requests a run to produce a permanent, confident "nobody is hurt in college
 * football", which is worse than not asking.
 *
 * This asserts the entitlement boundary directly, because nothing else can: no type error, no
 * runtime error, and no failing request distinguishes "not entitled" from "no injuries today".
 *
 * ⚠ IF THE PLAN LATER ADDS COLLEGE, this test is the thing to change first — and note that NCAAF
 * injuries are ESPN-only until then (3 rows for the whole of FBS when last measured). CFBD
 * supplies this repo's college player and stat data but has no injury ingestion, so it is not a
 * substitute.
 */
import { describe, expect, it } from 'vitest'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

/**
 * Read the route's own entitlement list out of source rather than re-declaring it.
 *
 * The route is a Next.js module with `server-only` transitive imports, so importing it into a
 * plain unit test drags in prisma and the whole provider stack. The list is a single literal and
 * a source read pins the real thing; a hand-copied duplicate in the test would be free to drift
 * from the module it claims to guard, which is the failure this file exists to prevent.
 */
import { readFileSync } from 'node:fs'

const SRC = readFileSync('app/api/cron/import-injuries/route.ts', 'utf8')

function entitledSports(): string[] {
  const fn = SRC.match(/function apiSportsInjurySport\(sport: Sport\)[\s\S]*?\n}/)?.[0]
  if (!fn) throw new Error('apiSportsInjurySport not found — the guard below would pass vacuously')
  return [...fn.matchAll(/"([A-Z]{3,6})"/g)].map((m) => m[1]!)
}

describe('API-Sports injury entitlement', () => {
  it('covers NFL only', () => {
    expect([...new Set(entitledSports())]).toEqual(['NFL'])
  })

  it('does NOT list NCAAF — the plan excludes college and the failure would be silent', () => {
    expect(entitledSports()).not.toContain('NCAAF')
    expect(entitledSports()).not.toContain('NCAAB')
  })

  it('never lists a sport the app does not support', () => {
    for (const s of entitledSports()) expect(SUPPORTED_SPORTS).toContain(s)
  })

  it('the call site takes the vendor code from the guard, never a cast', () => {
    // A cast at the call site is what would let a future addition silently sync NFL under
    // another sport's name — the exact drift `apiSportsInjurySport` exists to make impossible.
    expect(SRC).toContain('syncAPISportsInjuriesToDb({ sport: apiSportsVendorSport, season })')
    expect(SRC).not.toMatch(/sport: sport as "NFL"/)
  })
})
