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

const PRODUCTION_FILES = [
  "app/leagues/[leagueId]/admin/model/page.tsx",
  "app/api/leagues/[leagueId]/v3/weights/route.ts",
  "app/api/leagues/[leagueId]/v3/drift/route.ts",
]

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
