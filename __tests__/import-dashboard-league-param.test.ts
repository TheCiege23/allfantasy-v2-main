import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Blocker B7 was "imported league not auto-selected on dashboard; 'Go to dashboard'
 * drops leagueId", and its prescribed fix was "append `?leagueId=` and honor it in
 * selection". Implementing that literally would have been a SILENT NO-OP.
 *
 * The destination reads a differently-named param:
 *
 *   producer  components/unified-import-ui/LegacyImportResults.tsx  goDashboard()
 *   consumer  app/core/[[...screen]]/page.tsx                       sp.league
 *
 * `/dashboard` is retired (app/dashboard/page.tsx redirects to /core, query
 * preserved), and `lib/dashboard/dashboard-league-selection.ts` — which is written
 * for a `leagueId` param — has ZERO callers. So `leagueId` in the URL is read by
 * nothing, and a fix using that name would satisfy the blocker's wording while
 * changing nothing a user sees.
 *
 * This guards the only thing that actually makes the feature work: that the two
 * sides agree on the NAME. Nothing else in the repo checks a cross-file string
 * contract like this — it is not a type, so a typecheck cannot see it, and both
 * sides are individually valid whichever name they use.
 */

const PRODUCER = "components/unified-import-ui/LegacyImportResults.tsx"
const CONSUMER = "app/core/[[...screen]]/page.tsx"

function read(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8")
}

/** The query key the producer sets for league selection, or null. */
function producerParamName(src: string): string | null {
  const m = src.match(/qs\.set\(\s*['"]([A-Za-z]+)['"]\s*,\s*leagueSuccess\.leagueId\s*\)/)
  return m ? m[1] : null
}

/** The query key the consumer reads for league selection, or null. */
function consumerParamName(src: string): string | null {
  const m = src.match(/const selectedLeagueId\s*=\s*typeof sp\.([A-Za-z]+) === ['"]string['"]/)
  return m ? m[1] : null
}

describe("the import flow and /core agree on the league query param", () => {
  it("finds both files (positive control for the reader itself)", () => {
    // Without this, a moved file would make every assertion below vacuously pass.
    expect(read(PRODUCER).length).toBeGreaterThan(1000)
    expect(read(CONSUMER).length).toBeGreaterThan(1000)
  })

  it("extracts a name from each side (positive control for the matchers)", () => {
    // A matcher that silently returns null would make the equality assertion
    // below compare null to null and pass while the feature is broken.
    expect(producerParamName(read(PRODUCER))).not.toBeNull()
    expect(consumerParamName(read(CONSUMER))).not.toBeNull()
  })

  it("matchers reject the shapes they are meant to reject", () => {
    expect(producerParamName(`qs.set('rankSync', '1')`)).toBeNull()
    expect(consumerParamName(`const somethingElse = typeof sp.league === 'string'`)).toBeNull()
    // and the historical broken producer, which set no league param at all
    expect(
      producerParamName("router.push(`${target}${target.includes('?') ? '&' : '?'}rankSync=1`)"),
    ).toBeNull()
  })

  it("producer writes exactly what the consumer reads", () => {
    const written = producerParamName(read(PRODUCER))
    const readBack = consumerParamName(read(CONSUMER))
    expect(written).toBe(readBack)
  })

  it("that shared name is `league` — `leagueId` is read by nothing", () => {
    expect(consumerParamName(read(CONSUMER))).toBe("league")
  })

  it("the selection is omitted rather than faked when there is no league", () => {
    // The legacy_sleeper variant imports a career profile and has no league. The
    // param must be conditional, never a placeholder id.
    expect(read(PRODUCER)).toMatch(/if \(leagueSuccess\?\.leagueId\) qs\.set\(/)
  })
})
