// @vitest-environment node
/**
 * Private AllFantasy leagues in Find a League (lib/public-discovery/privateLeagueRequests.ts).
 *
 * Listed with safe fields only; "Ask to join" writes a FindLeagueSpotRequest and tells the
 * commissioner; the commissioner approves or declines; an approved player takes the seat through
 * POST /api/leagues/join (tested in __tests__/league-join/post-draft-join-lock.test.ts). The card
 * must never carry the join code — that would make every private league open to anyone who looks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => []),
  $transaction: vi.fn(),
  league: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn(async () => []) },
  roster: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  redraftLeagueMember: { findUnique: vi.fn() },
  draftSession: { findFirst: vi.fn() },
  appUser: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  findLeagueSpotRequest: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
}))
const session = vi.hoisted(() => ({ value: { user: { id: "player" } } as null | { user: { id: string } } }))
const notify = vi.hoisted(() => vi.fn(async () => true))
const seats = vi.hoisted(() => ({ held: 3, byLeague: new Map<string, number>() }))
const role = vi.hoisted(() => ({ value: null as string | null }))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => session.value) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/platform/notification-service", () => ({ createPlatformNotification: notify }))
vi.mock("@/lib/geo/paidLeagueGeo", () => ({
  paidLeagueGeoVerdict: vi.fn(async () => ({ blocked: false })),
  paidLeagueGeoMessage: vi.fn(() => "blocked"),
}))
vi.mock("@/lib/league/leagueSeats", () => ({
  countSeatsHeldByPeople: vi.fn(async () => seats.held),
  countSeatsHeldByPeopleByLeague: vi.fn(async () => seats.byLeague),
}))
vi.mock("@/lib/league/permissions", () => ({ getLeagueRole: vi.fn(async () => role.value) }))
vi.mock("@/lib/draft-room/currentDraftSession", () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))

import { GET as listRequests, PATCH as answer, POST as ask } from "@/app/api/find-league/leagues/[leagueId]/request/route"
import { queryPrivateRequestableFantasyLeagueCards } from "@/lib/public-discovery/DiscoveryQueryLayer"
import { isPrivateListingOpen, isPrivateRequestableLeague } from "@/lib/public-discovery/privateLeagueRequests"

const ctx = { params: Promise.resolve({ leagueId: "L" }) }
const req = (body: unknown) => ({ json: async () => body }) as never

const SECRET_CODE = "SECRET-JOIN-CODE-123"

function privateLeague(settings: Record<string, unknown> = {}, o: Record<string, unknown> = {}) {
  return {
    id: "L",
    name: "Friends & Family",
    userId: "commish",
    platform: "manual",
    isCommissioner: true,
    leagueSize: 12,
    settings: { league_privacy_visibility: "private", inviteCode: SECRET_CODE, ...settings },
    ...o,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { id: "player" } }
  seats.held = 3
  seats.byLeague = new Map()
  role.value = null
  db.league.findUnique.mockResolvedValue(privateLeague())
  db.roster.findUnique.mockResolvedValue(null)
  db.redraftLeagueMember.findUnique.mockResolvedValue(null)
  db.draftSession.findFirst.mockResolvedValue(null)
  db.appUser.findUnique.mockResolvedValue({ displayName: "Pat", username: "pat" })
  db.findLeagueSpotRequest.findUnique.mockResolvedValue(null)
  db.findLeagueSpotRequest.count.mockResolvedValue(0)
  db.findLeagueSpotRequest.create.mockResolvedValue({ id: "R1" })
})

describe("which private leagues are listed", () => {
  it("lists a league made here whose commissioner chose Private", () => {
    expect(isPrivateRequestableLeague(privateLeague())).toBe(true)
  })

  it.each([
    ["public (listed the open way instead)", { league_privacy_visibility: "public" }],
    ["invite only", { league_privacy_visibility: "invite_only" }],
    ["password protected", { league_privacy_visibility: "password_protected" }],
    ["no visibility ever written (legacy / structural)", { league_privacy_visibility: undefined }],
    ["created Unlisted in the wizard", { visibility: "unlisted" }],
    ["removed from the League finder", { leagueFinderDelistedAt: "2026-11-01T00:00:00.000Z" }],
  ])("does not list one that is %s", (_label, settings) => {
    expect(isPrivateRequestableLeague(privateLeague(settings))).toBe(false)
  })

  it("does not list an imported league (its seats are on the other platform)", () => {
    expect(isPrivateRequestableLeague(privateLeague({}, { platform: "sleeper" }))).toBe(false)
  })

  it("lists only while a seat is open and the draft has not started", () => {
    expect(isPrivateListingOpen({ seatsHeld: 3, leagueSize: 12, draftStatus: null })).toBe(true)
    expect(isPrivateListingOpen({ seatsHeld: 3, leagueSize: 12, draftStatus: "pre_draft" })).toBe(true)
    expect(isPrivateListingOpen({ seatsHeld: 12, leagueSize: 12, draftStatus: null })).toBe(false)
    expect(isPrivateListingOpen({ seatsHeld: 3, leagueSize: 12, draftStatus: "in_progress" })).toBe(false)
    expect(isPrivateListingOpen({ seatsHeld: 3, leagueSize: null, draftStatus: null })).toBe(false)
  })
})

describe("the private card carries safe fields only", () => {
  const row = (o: Record<string, unknown> = {}) => ({
    id: "L",
    platform: "manual",
    name: "Friends & Family",
    sport: "NFL",
    season: 2026,
    leagueVariant: null,
    leagueSize: 12,
    scoring: "ppr",
    isDynasty: false,
    settings: {
      league_privacy_visibility: "private",
      inviteCode: SECRET_CODE,
      description: "Private group chat link inside: discord.gg/secret",
      vibes: ["casual"],
      ai_adp_enabled: true,
    },
    createdAt: new Date("2026-10-01T00:00:00Z"),
    leagueSettings: { draftDateUtc: new Date("2026-11-20T01:00:00Z") },
    draftSessions: [],
    ...o,
  })

  it("names the league, its sport, format and seats — and never its code, page, people or description", async () => {
    db.league.findMany.mockResolvedValue([row()])
    seats.byLeague = new Map([["L", 4]])
    const [card] = await queryPrivateRequestableFantasyLeagueCards({ sport: null, query: null })
    expect(card).toMatchObject({
      id: "L",
      name: "Friends & Family",
      sport: "NFL",
      leagueStyle: "redraft",
      memberCount: 4,
      maxMembers: 12,
      joinMode: "approval",
      isPrivate: true,
      joinUrl: "",
      detailUrl: "",
      description: null,
      ownerAvatar: null,
      commissionerUsername: null,
      aiFeatures: [],
      vibes: [],
    })
    const json = JSON.stringify(card)
    expect(json).not.toContain(SECRET_CODE)
    expect(json).not.toContain("discord.gg")
    expect(json).not.toContain("/join?code")
  })

  it("reads no commissioner, member or roster data at all", async () => {
    db.league.findMany.mockResolvedValue([row()])
    await queryPrivateRequestableFantasyLeagueCards({ sport: null, query: null })
    const args = db.league.findMany.mock.calls[0][0] as { where: Record<string, unknown>; select: Record<string, unknown> }
    expect(args.select).not.toHaveProperty("user")
    expect(args.select).not.toHaveProperty("userId")
    expect(args.select).not.toHaveProperty("rosters")
    expect(args.select).not.toHaveProperty("teams")
    expect(args.where).toMatchObject({
      platform: { in: expect.arrayContaining(["manual"]) },
      settings: { path: ["league_privacy_visibility"], equals: "private" },
    })
  })

  it("drops full, drafted, invite-only and delisted leagues", async () => {
    db.league.findMany.mockResolvedValue([
      row({ id: "full" }),
      row({ id: "drafted", draftSessions: [{ status: "in_progress", draftType: "snake" }] }),
      row({ id: "invite", settings: { league_privacy_visibility: "invite_only", inviteCode: "x" } }),
      row({ id: "gone", settings: { league_privacy_visibility: "private", leagueFinderDelistedAt: "2026-11-01" } }),
      row({ id: "open" }),
    ])
    seats.byLeague = new Map([["full", 12], ["open", 2]])
    const cards = await queryPrivateRequestableFantasyLeagueCards({ sport: null, query: null })
    expect(cards.map((c) => c.id)).toEqual(["open"])
  })
})

describe("POST ask to join a private league", () => {
  it("records the request and tells the commissioner", async () => {
    const res = await ask(req({ message: "Long-time redraft player" }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: "pending" })
    expect(db.findLeagueSpotRequest.create).toHaveBeenCalledWith({
      data: { leagueId: "L", requesterUserId: "player", message: "Long-time redraft player" },
      select: { id: true },
    })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "commish", type: "find_league_join_request", title: "Pat asked to join Friends & Family" })
    )
  })

  it("never returns the join code", async () => {
    const res = await ask(req({}), ctx)
    expect(JSON.stringify(await res.json())).not.toContain(SECRET_CODE)
  })

  it("does not ask twice while a request is pending", async () => {
    db.findLeagueSpotRequest.findUnique.mockResolvedValue({ id: "R1", status: "pending" })
    expect(await (await ask(req({}), ctx)).json()).toMatchObject({ status: "pending", alreadyRequested: true })
    expect(db.findLeagueSpotRequest.create).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it("says so when the request was already approved", async () => {
    db.findLeagueSpotRequest.findUnique.mockResolvedValue({ id: "R1", status: "accepted" })
    expect(await (await ask(req({}), ctx)).json()).toMatchObject({ status: "accepted", leagueId: "L" })
    expect(notify).not.toHaveBeenCalled()
  })

  it("asking again after a decline reopens the same request", async () => {
    db.findLeagueSpotRequest.findUnique.mockResolvedValue({ id: "R1", status: "declined" })
    db.findLeagueSpotRequest.update.mockResolvedValue({ id: "R1" })
    expect((await ask(req({}), ctx)).status).toBe(200)
    expect(db.findLeagueSpotRequest.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "R1" } }))
    expect(db.findLeagueSpotRequest.create).not.toHaveBeenCalled()
  })

  it("a member is told they are in, and nothing is written", async () => {
    db.roster.findUnique.mockResolvedValue({ id: "r1" })
    expect(await (await ask(req({}), ctx)).json()).toMatchObject({ status: "member", alreadyMember: true })
    expect(db.findLeagueSpotRequest.create).not.toHaveBeenCalled()
  })

  it("a full league has no seat to ask for", async () => {
    seats.held = 12
    const res = await ask(req({}), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("LEAGUE_FULL")
    expect(db.findLeagueSpotRequest.create).not.toHaveBeenCalled()
  })

  it("a league that has drafted is not adding teams", async () => {
    db.draftSession.findFirst.mockResolvedValue({ status: "in_progress" })
    const res = await ask(req({}), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("DRAFT_STARTED")
  })

  it("a public league is joined directly, not by request", async () => {
    db.league.findUnique.mockResolvedValue(privateLeague({ league_privacy_visibility: "public" }))
    const res = await ask(req({}), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("PUBLIC_LEAGUE")
  })

  it.each([["invite_only"], ["password_protected"]])("a %s league takes no requests", async (visibility) => {
    db.league.findUnique.mockResolvedValue(privateLeague({ league_privacy_visibility: visibility }))
    expect((await ask(req({}), ctx)).status).toBe(404)
    expect(db.findLeagueSpotRequest.create).not.toHaveBeenCalled()
  })

  it("the commissioner cannot ask into their own league", async () => {
    session.value = { user: { id: "commish" } }
    expect((await ask(req({}), ctx)).status).toBe(400)
  })

  it("caps requests per day", async () => {
    db.findLeagueSpotRequest.count.mockResolvedValue(10)
    expect((await ask(req({}), ctx)).status).toBe(429)
  })
})

describe("the commissioner answers", () => {
  beforeEach(() => {
    session.value = { user: { id: "commish" } }
    role.value = "commissioner"
    db.league.findUnique.mockResolvedValue(privateLeague())
  })

  it("sees the queue, and whether the league is listed", async () => {
    db.findLeagueSpotRequest.findMany.mockResolvedValue([
      {
        id: "R1",
        status: "pending",
        message: "hi",
        createdAt: new Date("2026-11-01T00:00:00Z"),
        requester: { username: "pat", displayName: "Pat", avatarUrl: null },
      },
    ])
    const body = await (await listRequests(req({}), ctx)).json()
    expect(body).toMatchObject({ listed: true, hidden: false, requests: [{ id: "R1", name: "Pat", username: "pat", status: "pending" }] })
  })

  it("a player who is not a commissioner gets nothing", async () => {
    session.value = { user: { id: "player" } }
    role.value = "member"
    expect((await listRequests(req({}), ctx)).status).toBe(404)
    expect((await answer(req({ requestId: "R1", action: "approve" }), ctx)).status).toBe(404)
    expect(db.findLeagueSpotRequest.updateMany).not.toHaveBeenCalled()
  })

  it("approving tells the player where to take the seat", async () => {
    db.findLeagueSpotRequest.updateMany.mockResolvedValue({ count: 1 })
    db.findLeagueSpotRequest.findUnique.mockResolvedValue({ requesterUserId: "player" })
    const res = await answer(req({ requestId: "R1", action: "approve" }), ctx)
    expect(await res.json()).toEqual({ ok: true, status: "accepted" })
    expect(db.findLeagueSpotRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "R1", leagueId: "L", status: "pending" } })
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "player",
        type: "find_league_join_approved",
        meta: expect.objectContaining({ actionHref: "/join?approved=L" }),
      })
    )
  })

  it("declining tells the player kindly", async () => {
    db.findLeagueSpotRequest.updateMany.mockResolvedValue({ count: 1 })
    db.findLeagueSpotRequest.findUnique.mockResolvedValue({ requesterUserId: "player" })
    await answer(req({ requestId: "R1", action: "decline" }), ctx)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "player", type: "find_league_join_declined" }))
  })

  it("a request already answered is not answered twice", async () => {
    db.findLeagueSpotRequest.updateMany.mockResolvedValue({ count: 0 })
    expect((await answer(req({ requestId: "R1", action: "approve" }), ctx)).status).toBe(409)
    expect(notify).not.toHaveBeenCalled()
  })

  it("can take the league off Find a League, under the league row lock", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => []),
      league: {
        findUnique: vi.fn(async () => ({ settings: { league_privacy_visibility: "private", inviteCode: "x" } })),
        update: vi.fn(async () => ({})),
      },
    }
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
    const res = await answer(req({ listing: "hide" }), ctx)
    expect(await res.json()).toEqual({ ok: true, hidden: true })
    expect(tx.$queryRaw).toHaveBeenCalled()
    const written = (tx.league.update.mock.calls[0] as unknown as [{ data: { settings: Record<string, unknown> } }])[0].data.settings
    expect(typeof written.leagueFinderDelistedAt).toBe("string")
    expect(written.inviteCode).toBe("x")
    expect(isPrivateRequestableLeague({ platform: "manual", settings: written })).toBe(false)
  })
})
