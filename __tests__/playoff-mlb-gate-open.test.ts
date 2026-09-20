import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"

/**
 * MLB pool creation, and the several places that had to agree before it could
 * be opened.
 *
 * 🛑 THE SAME DECISION IS WRITTEN IN MORE THAN ONE PLACE AND ONLY ONE IS
 * ENFORCED. The create API's zod enum is the authority; `isPlayoffPool` in the
 * create page merely decides which stack the form posts to. When they
 * disagreed, picking MLB did not fail — it succeeded against the LEGACY stack
 * and landed the user on "This pool has been migrated" with no way in. A dead
 * end, reached by a green path. These tests exist to keep the lists in step.
 */

vi.mock("server-only", () => ({}))

const root = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(root, p), "utf8")

describe("MLB playoff pools — the gate is open, consistently", () => {
  it("the create API accepts mlb", () => {
    const src = read("app/api/brackets/playoffs/route.ts")
    expect(src).toContain('sport: z.enum(["nba", "nhl", "mlb"])')
  })

  it("the sync service will sync mlb", async () => {
    const src = read("lib/playoffs/playoffSeriesSyncService.ts")
    expect(src).toMatch(/SYNCABLE_PLAYOFF_SPORTS = new Set<PlayoffSport>\(\["nba", "nhl", "mlb"\]\)/)
  })

  it("the cron sweeps mlb under sport=all", () => {
    const src = read("app/api/brackets/playoffs/cron/refresh-schedule/route.ts")
    expect(src).toContain('["nba", "nhl", "mlb"] : [sport]')
    expect(src).toContain('z.enum(["all", "nba", "nhl", "mlb"])')
  })

  /*
   * The one that actually bit. If this list falls behind the API enum, the
   * form posts MLB to the legacy stack and the user hits a wall — with no
   * error anywhere.
   */
  it("the create page routes every API-accepted sport to the playoff stack", () => {
    const api = read("app/api/brackets/playoffs/route.ts")
    const page = read("app/brackets/leagues/new/page.tsx")

    const enumMatch = api.match(/sport: z\.enum\(\[([^\]]+)\]\)/)
    expect(enumMatch, "could not find the create API sport enum").toBeTruthy()
    const apiSports = (enumMatch![1].match(/"([a-z]+)"/g) ?? []).map((s) => s.replace(/"/g, "").toUpperCase())
    expect(apiSports.length).toBeGreaterThan(0)

    const pageMatch = page.match(/PLAYOFF_POOL_SPORTS = \[([^\]]+)\]/)
    expect(pageMatch, "could not find PLAYOFF_POOL_SPORTS in the create page").toBeTruthy()
    const pageSports = (pageMatch![1].match(/"([A-Z]+)"/g) ?? []).map((s) => s.replace(/"/g, ""))

    expect([...pageSports].sort()).toEqual([...apiSports].sort())
  })

  /*
   * A card marked "live" must be a sport the API will actually accept, or the
   * hub sends people at the dead end on purpose.
   */
  it("every live sport card points at a sport the API accepts", () => {
    const api = read("app/api/brackets/playoffs/route.ts")
    const hub = read("app/brackets/page.tsx")

    const apiSports = (api.match(/sport: z\.enum\(\[([^\]]+)\]\)/)![1].match(/"([a-z]+)"/g) ?? [])
      .map((s) => s.replace(/"/g, "").toUpperCase())

    // Every playoffPoolHref(...) argument must be an accepted sport.
    const hrefSports = [...hub.matchAll(/playoffPoolHref\("([A-Z]+)"\)/g)].map((m) => m[1])
    expect(hrefSports.length).toBeGreaterThan(0)
    for (const sport of hrefSports) {
      expect(apiSports, `hub offers ${sport}`).toContain(sport)
    }
    expect(hrefSports).toContain("MLB")
  })

  it("the create form offers mlb", () => {
    const src = read("components/brackets/playoffs/PlayoffCreateForm.tsx")
    expect(src).toContain('<option value="mlb">MLB</option>')
    expect(src).toContain('"nba" | "nhl" | "mlb"')
  })
})

/**
 * The gate was held shut by four preconditions. Opening it is only correct
 * while all four still hold, so each gets a line here — a later change that
 * removes one should fail loudly rather than leave a sport creatable against
 * machinery that no longer exists.
 */
describe("MLB playoff pools — the preconditions that justified opening it", () => {
  it("MLB standings are ingested", () => {
    const src = read("lib/standings/espnStandings.ts")
    expect(src).toContain("MLB: 'baseball/mlb'")
  })

  it("seeding refuses a field that is not final", () => {
    const src = read("lib/playoffs/playoffSeeding.ts")
    expect(src).toContain("REGULAR_SEASON_GAMES")
    expect(src).toContain("mlb: 162")
    expect(src).toContain("skippedFieldNotFinal")
  })

  it("the ESPN adapter carries the round label the inference needs", () => {
    const sync = read("lib/playoffs/playoffSeriesSyncService.ts")
    const scores = read("lib/sports-live-scores-service.ts")
    expect(sync).toContain("eventName: row.eventName ?? null")
    expect(scores).toContain("comp.notes?.[0]?.headline")
  })

  it("the round patterns are the ones ESPN actually sends", () => {
    const src = read("lib/playoffs/playoffSeriesSyncService.ts")
    // ALWC/NLWC, not "wild card" — the guessed form matched nothing.
    expect(src).toContain("alwc")
    expect(src).toContain("nlwc")
    // League as a token prefix, not \bal\b, which never matches ALCS.
    expect(src).toContain("al(wc|ds|cs)")
  })
})
