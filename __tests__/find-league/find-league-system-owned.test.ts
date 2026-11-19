/**
 * Find a League for a public ESPN league owned by the AllFantasy SYSTEM account (people joined it
 * by picking a team). Its listing belongs to the member PROVEN to hold ESPN's league-manager team —
 * never the system account, and never someone who only picked that team.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  teams: [] as Row[],
  claims: [] as Row[],
  users: [] as Row[],
}))

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      const c = cond as { in?: unknown[]; not?: unknown }
      if ("in" in c) return (c.in ?? []).includes(row[key])
      if ("not" in c) return row[key] !== c.not
    }
    return row[key] === cond
  })
}

const db = vi.hoisted(() => ({
  league: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn(async () => []) },
  roster: { findMany: vi.fn(async () => []) },
  leagueTeam: { findMany: vi.fn() },
  leagueManagerClaim: { findMany: vi.fn() },
  appUser: { findMany: vi.fn(), findUnique: vi.fn() },
  findLeagueSpotRequest: {
    findUnique: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: "R1" })),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(async () => 0),
  },
}))
const session = vi.hoisted(() => ({ value: { user: { id: "player" } } as null | { user: { id: string } } }))
const notify = vi.hoisted(() => vi.fn(async () => true))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => session.value) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/platform/notification-service", () => ({ createPlatformNotification: notify }))
vi.mock("@/lib/geo/paidLeagueGeo", () => ({
  paidLeagueGeoVerdict: vi.fn(async () => ({ blocked: false })),
  paidLeagueGeoMessage: () => "",
}))

import { SYSTEM_LEAGUE_OWNER_ID } from "@/lib/league-import/systemLeagueOwner"
import { queryPublicFantasyLeagueCards } from "@/lib/public-discovery/DiscoveryQueryLayer"
import { POST as requestSpot } from "@/app/api/find-league/leagues/[leagueId]/request/route"
import { POST as saveListing } from "@/app/api/commissioner/leagues/[leagueId]/external-listing/route"

const ctx = { params: Promise.resolve({ leagueId: "L" }) }
const req = (body: unknown) => ({ json: async () => body }) as never

function systemLeague(o: Row = {}) {
  return {
    id: "L",
    userId: SYSTEM_LEAGUE_OWNER_ID,
    platform: "espn",
    isCommissioner: false,
    name: "Office League",
    sport: "NFL",
    season: 2026,
    leagueVariant: null,
    leagueSize: 10,
    scoring: "ppr",
    isDynasty: false,
    settings: { findLeagueExternal: { listed: true, openSpots: 1, note: null } },
    timezone: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    leagueSettings: null,
    draftSessions: [],
    // The system account, which a card must never name as the commissioner.
    user: { username: "allfantasy", displayName: "AllFantasy", avatarUrl: null, createdAt: new Date("2026-01-01") },
    ...o,
  }
}

/** Alice holds ESPN's league-manager team (1); Bob holds team 2. */
function seed({ aliceProven }: { aliceProven: boolean }) {
  state.teams = [
    { leagueId: "L", externalId: "1", claimedByUserId: "alice", isCommissioner: true, role: "member" },
    { leagueId: "L", externalId: "2", claimedByUserId: "bob", isCommissioner: false, role: "member" },
  ]
  state.claims = [
    { leagueId: "L", afUserId: "alice", teamExternalId: "1", isConfirmed: aliceProven },
    { leagueId: "L", afUserId: "bob", teamExternalId: "2", isConfirmed: true },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { id: "player" } }
  state.users = [{ id: "alice", username: "alice", displayName: "Alice", avatarUrl: null, createdAt: new Date("2024-03-01") }]
  db.leagueTeam.findMany.mockImplementation(async ({ where }: { where: Row }) => state.teams.filter((t) => matches(t, where)))
  db.leagueManagerClaim.findMany.mockImplementation(async ({ where }: { where: Row }) =>
    state.claims.filter((c) => matches(c, where))
  )
  db.appUser.findMany.mockImplementation(async ({ where }: { where: Row }) => state.users.filter((u) => matches(u, where)))
  db.appUser.findUnique.mockResolvedValue({ displayName: "Pat", username: "pat" })
})

describe("discovery", () => {
  it("lists it under its proven commissioner, never the system account", async () => {
    seed({ aliceProven: true })
    db.league.findMany.mockResolvedValue([systemLeague()])
    const [card] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(card).toMatchObject({
      listingVerification: "provider",
      commissionerName: "Alice",
      ownerName: "Alice",
      commissionerUsername: "alice",
      commissionerSinceYear: 2024,
    })
  })

  it("drops it when the league-manager team was only picked, not proven", async () => {
    seed({ aliceProven: false })
    db.league.findMany.mockResolvedValue([systemLeague()])
    expect(await queryPublicFantasyLeagueCards({ sport: null, query: null })).toEqual([])
  })
})

describe("saving the listing", () => {
  beforeEach(() => {
    db.league.findUnique.mockResolvedValue(systemLeague({ settings: {} }))
    db.league.update.mockResolvedValue({})
  })

  it("the proven commissioner can list it", async () => {
    seed({ aliceProven: true })
    session.value = { user: { id: "alice" } }
    expect((await saveListing(req({ listed: true, openSpots: 1 }), ctx)).status).toBe(200)
    expect(db.league.update).toHaveBeenCalled()
  })

  it("someone who only picked the league-manager team cannot", async () => {
    seed({ aliceProven: false })
    session.value = { user: { id: "alice" } }
    expect((await saveListing(req({ listed: true, openSpots: 1 }), ctx)).status).toBe(404)
    expect(db.league.update).not.toHaveBeenCalled()
  })

  it("another member cannot, even with a proven claim on their own team", async () => {
    seed({ aliceProven: true })
    session.value = { user: { id: "bob" } }
    expect((await saveListing(req({ listed: true, openSpots: 1 }), ctx)).status).toBe(404)
  })
})

describe("asking for a spot", () => {
  beforeEach(() => {
    db.league.findUnique.mockResolvedValue(systemLeague())
  })

  it("the request goes to the proven commissioner, not the system account", async () => {
    seed({ aliceProven: true })
    expect((await requestSpot(req({}), ctx)).status).toBe(200)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "alice", type: "find_league_spot_request" }))
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ userId: SYSTEM_LEAGUE_OWNER_ID }))
  })

  it("the commissioner cannot ask for a spot in their own league", async () => {
    seed({ aliceProven: true })
    session.value = { user: { id: "alice" } }
    expect((await requestSpot(req({}), ctx)).status).toBe(400)
  })

  it("is closed while nobody has proven they run it", async () => {
    seed({ aliceProven: false })
    expect((await requestSpot(req({}), ctx)).status).toBe(404)
    expect(db.findLeagueSpotRequest.create).not.toHaveBeenCalled()
  })
})
