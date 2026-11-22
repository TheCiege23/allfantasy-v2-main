/**
 * Paid fantasy leagues are restricted in some states (lib/geo/restrictedStates). Find a League
 * is where a stranger meets one, so there it shows free leagues only and says why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const discover = vi.hoisted(() => vi.fn())
const geo = vi.hoisted(() => ({ blocked: false }))

vi.mock("@/lib/public-discovery", () => ({ discoverPublicLeagues: discover }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/ranking/tier-visibility", () => ({ resolveUserCareerTier: vi.fn(async () => 1) }))
vi.mock("@/lib/http/served-origin", () => ({ getServedOrigin: () => "https://allfantasy.ai" }))
vi.mock("@/lib/commish-reputation/reputationService", () => ({ publicReputationForLeagues: vi.fn(async () => new Map()) }))
vi.mock("@/lib/geo/paidLeagueGeo", () => ({
  paidLeagueGeoVerdict: vi.fn(async () => ({ blocked: geo.blocked, stateCode: "ID", stateName: "Idaho", reason: "state" })),
  paidLeagueGeoMessage: () => "Paid leagues aren't available in Idaho, so they're hidden here.",
}))

import { GET } from "@/app/api/discover/leagues/route"

function req(qs: string) {
  return { nextUrl: new URL(`https://allfantasy.ai/api/discover/leagues${qs}`) } as never
}

beforeEach(() => {
  discover.mockReset()
  discover.mockResolvedValue({ leagues: [], total: 0, page: 1, limit: 12, totalPages: 0 })
  geo.blocked = false
})

describe("GET /api/discover/leagues and the paid-league state rule", () => {
  it("passes the viewer's fee filter through where paid leagues are allowed", async () => {
    const res = await GET(req("?entryFee=all"))
    expect(discover.mock.calls[0][0].entryFee).toBe("all")
    expect((await res.json()).paidLeaguesHidden).toBeNull()
  })

  it("asks for free leagues only where they are restricted, and says why", async () => {
    geo.blocked = true
    const res = await GET(req("?entryFee=all"))
    expect(discover.mock.calls[0][0].entryFee).toBe("free")
    expect((await res.json()).paidLeaguesHidden.message).toContain("Idaho")
  })

  it("answers a paid-only search with nothing, not with free leagues it didn't ask for", async () => {
    geo.blocked = true
    const body = await (await GET(req("?entryFee=paid"))).json()
    expect(discover).not.toHaveBeenCalled()
    expect(body).toMatchObject({ leagues: [], total: 0 })
    expect(body.paidLeaguesHidden.message).toContain("Idaho")
  })

  it("is never cached publicly — the answer depends on where the viewer is", async () => {
    const res = await GET(req(""))
    expect(res.headers.get("Cache-Control")).toContain("private")
    expect(res.headers.get("Cache-Control")).not.toContain("s-maxage")
  })
})
