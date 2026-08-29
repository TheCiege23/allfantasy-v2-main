import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Policy test for the model-admin surfaces.
 *
 * The per-route tests mock `requireAdmin` and therefore prove only that each
 * handler honors whatever the gate returns. This file exercises the REAL
 * `lib/adminAuth` module so the policy itself is under test: a league
 * commissioner who is not a site admin must be denied.
 */

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  cookiesGet: vi.fn(),
  verifyAdminSessionCookie: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/headers", () => ({ cookies: () => ({ get: mocks.cookiesGet }) }))
vi.mock("@/lib/adminSession", () => ({ verifyAdminSessionCookie: mocks.verifyAdminSessionCookie }))

/*
 * ⚠ `app/leagues/[leagueId]/admin/model/page.tsx` IS NO LONGER IN THIS LIST, AND THAT
 * IS NOT A RELAXATION.
 *
 * The screen moved onto the core shell (b2ffe5dfc) and that path became a redirect stub
 * with no gate of its own — deliberately, so there is one admin predicate rather than
 * two that can drift. The whole-file assertions below (must import adminAuth, must not
 * mention any league-scoped word) therefore stopped applying to it and it went red on
 * main, unnoticed, because vitest does not run in CI.
 *
 * The coverage moved rather than vanished: the redirect contract is pinned by
 * model-admin-page-authorization.test.tsx, and the gate at the NEW location is pinned by
 * the `core shell` describe at the bottom of this file. The whole-file form cannot be
 * reused there — the core page legitimately contains the word "commissioner" for nav
 * grouping and for an unrelated /commissioner-hub redirect — so that check is scoped to
 * the gate expression instead.
 */
const PRODUCTION_FILES = [
  "app/api/leagues/[leagueId]/v3/weights/route.ts",
  "app/api/leagues/[leagueId]/v3/drift/route.ts",
]

/** Where the model-admin screen and its gate actually live now. */
const CORE_SHELL_PAGE = "app/core/[[...screen]]/page.tsx"
/** The redirect stub left behind at the old address. */
const LEGACY_REDIRECT_PAGE = "app/leagues/[leagueId]/admin/model/page.tsx"

/** A real league commissioner who is NOT on any site-admin allowlist. */
const COMMISSIONER_SESSION = {
  user: {
    id: "commish-1",
    email: "commissioner@example.com",
    name: "League Commissioner",
    username: "leaguecommish",
  },
}

const SITE_ADMIN_EMAIL = "siteadmin@example.com"

describe("model-admin authorization policy (real lib/adminAuth)", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS
  const originalAllAccessEmails = process.env.ALL_ACCESS_EMAILS
  const originalAllAccessUsernames = process.env.ALL_ACCESS_USERNAMES

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // Pin the allowlists so the commissioner cannot match by ambient config.
    process.env.ADMIN_EMAILS = SITE_ADMIN_EMAIL
    process.env.ALL_ACCESS_EMAILS = ""
    process.env.ALL_ACCESS_USERNAMES = ""
    mocks.cookiesGet.mockReturnValue(undefined)
  })

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails
    process.env.ALL_ACCESS_EMAILS = originalAllAccessEmails
    process.env.ALL_ACCESS_USERNAMES = originalAllAccessUsernames
  })

  it("denies a league commissioner who is not a site admin", async () => {
    mocks.getServerSession.mockResolvedValueOnce(COMMISSIONER_SESSION)
    const { requireAdmin } = await import("@/lib/adminAuth")

    const gate = await requireAdmin()

    expect(gate.ok).toBe(false)
    expect(gate.ok === false && gate.res.status).toBe(403)
  })

  it("reports a commissioner session as forbidden, not admin", async () => {
    mocks.getServerSession.mockResolvedValueOnce(COMMISSIONER_SESSION)
    const { getAdminAccessState } = await import("@/lib/adminAuth")

    const state = await getAdminAccessState()

    expect(state.status).toBe("forbidden")
    expect(state.user?.role).toBeUndefined()
  })

  it("returns 401 for an unauthenticated caller", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null)
    const { requireAdmin } = await import("@/lib/adminAuth")

    const gate = await requireAdmin()

    expect(gate.ok).toBe(false)
    expect(gate.ok === false && gate.res.status).toBe(401)
  })

  it("allows a site admin on the ADMIN_EMAILS allowlist", async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: "admin-1", email: SITE_ADMIN_EMAIL, username: "siteadmin" },
    })
    const { requireAdmin } = await import("@/lib/adminAuth")

    const gate = await requireAdmin()

    expect(gate.ok).toBe(true)
    expect(gate.ok === true && gate.user.role).toBe("admin")
  })
})

describe("model-admin surfaces gate on site-admin only", () => {
  // Commissioner/league-membership predicates would widen access beyond site
  // admin. None may appear in these files.
  const LEAGUE_SCOPED_GATES = [
    "getLeagueRole",
    "isAfCommissioner",
    "assertLeagueMember",
    "resolveLeagueAccess",
    "resolveLeagueMembership",
    "canViewLeague",
    "commissioner",
  ]

  for (const file of PRODUCTION_FILES) {
    it(`${file} uses only the canonical site-admin gate`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf-8")

      expect(source).toContain("@/lib/adminAuth")
      for (const gate of LEAGUE_SCOPED_GATES) {
        expect(source.toLowerCase()).not.toContain(gate.toLowerCase())
      }
    })
  }

  for (const file of PRODUCTION_FILES.filter((f) => f.endsWith("route.ts"))) {
    it(`${file} authorizes before touching params or the request body`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf-8")

      // Every exported handler must gate before reading params/body.
      const handlerBodies = source.split(/\)\(async \(req: Request/).slice(1)
      expect(handlerBodies.length).toBe(2) // GET + POST

      for (const body of handlerBodies) {
        const gateIndex = body.indexOf("requireAdmin()")
        const paramsIndex = body.indexOf("ctx.params")
        const jsonIndex = body.indexOf("req.json()")

        expect(gateIndex).toBeGreaterThan(-1)
        expect(gateIndex).toBeLessThan(paramsIndex)
        if (jsonIndex > -1) expect(gateIndex).toBeLessThan(jsonIndex)
      }
    })
  }
})

describe("model-admin on the core shell keeps the site-admin gate", () => {
  /*
   * The screen renders inside a 1,300-line shell serving every /core segment, so a
   * whole-file scan is useless here — the page mentions "commissioner" for nav grouping
   * and redirects to /commissioner-hub for an unrelated reason. These assertions target
   * the gate expression itself, which is the thing that must not weaken.
   */
  const coreSource = () => readFileSync(resolve(process.cwd(), CORE_SHELL_PAGE), "utf-8")

  it("gates model-admin on the site-admin allowlist, not league commissionership", () => {
    const source = coreSource()

    expect(source).toContain("@/lib/adminAuth")
    // The gate expression, as one string: segment check -> getAdminAccessState -> admin.
    const gate = source.slice(source.indexOf("const modelAdminAllowed"))
    expect(gate).toContain("segment === 'model-admin'")
    expect(gate.slice(0, 400)).toContain("getAdminAccessState()")
    expect(gate.slice(0, 400)).toContain("status === 'admin'")

    for (const leagueGate of ["getLeagueRole", "isAfCommissioner", "assertLeagueMember", "resolveLeagueAccess"]) {
      expect(gate.slice(0, 400)).not.toContain(leagueGate)
    }
  })

  it("FAILS CLOSED — an errored gate denies rather than admits", () => {
    // `.catch(() => false)`. If this ever becomes `?? true` or the catch is dropped,
    // an auth outage would open the panel instead of closing it.
    const gate = coreSource().slice(0)
    const start = gate.indexOf("const modelAdminAllowed")
    expect(start).toBeGreaterThan(-1)
    expect(gate.slice(start, start + 400)).toContain("catch(() => false)")
  })

  it("renders the denial branch instead of the panels when the gate says no", () => {
    const source = coreSource()

    expect(source).toContain("!modelAdminAllowed ?")
    expect(source).toContain("This account is not on the AllFantasy admin allowlist.")
    // The panels must sit on the far side of that branch, never before it.
    expect(source.indexOf("!modelAdminAllowed ?")).toBeLessThan(source.indexOf("<V3WeightsPanel"))
  })

  it("leaves no second gate on the legacy path — it is a pure redirect", () => {
    const legacy = readFileSync(resolve(process.cwd(), LEGACY_REDIRECT_PAGE), "utf-8")

    expect(legacy).toContain("/core/model-admin")
    /*
     * Match a CALL, not the word. The stub's own comment names `getAdminAccessState`
     * while explaining why it deliberately does not call it, so a substring check reads
     * the explanation as the offence — which is exactly the false positive that makes
     * source-scanning tests untrustworthy.
     */
    expect(legacy).not.toMatch(/getAdminAccessState\s*\(/)
    expect(legacy).not.toMatch(/<V3WeightsPanel/)
  })
})
