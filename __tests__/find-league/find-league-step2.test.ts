/**
 * Find a League step 2: leagues that play on another platform, paid-league disclosure, and the
 * paid-league state rule.
 *
 * The trust question for an external listing is "is the lister really the commissioner?" —
 * anyone in a league can import it, so the import alone proves membership, not command.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  league: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  roster: { findMany: vi.fn() },
  appUser: { findMany: vi.fn(), findUnique: vi.fn() },
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
const geo = vi.hoisted(() => ({ blocked: false }))
const notify = vi.hoisted(() => vi.fn(async () => true))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => session.value) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/platform/notification-service", () => ({ createPlatformNotification: notify }))
vi.mock("@/lib/geo/paidLeagueGeo", () => ({
  paidLeagueGeoVerdict: vi.fn(async () =>
    geo.blocked
      ? { blocked: true, stateCode: "ID", stateName: "Idaho", reason: "state" }
      : { blocked: false, stateCode: null, stateName: null, reason: null }
  ),
  paidLeagueGeoMessage: (v: { stateName: string | null }, context = "browse") =>
    `Paid leagues aren't available in ${v.stateName} (${context})`,
}))

import { listingVerification, readExternalListing, verificationLabel } from "@/lib/public-discovery/externalListing"
import { isPaidLeagueSettings, leagueEntryFee } from "@/lib/league/paidLeague"
import { queryPublicFantasyLeagueCards } from "@/lib/public-discovery/DiscoveryQueryLayer"
import { POST as requestSpot } from "@/app/api/find-league/leagues/[leagueId]/request/route"
import {
  PATCH as answerRequest,
  POST as saveListing,
} from "@/app/api/commissioner/leagues/[leagueId]/external-listing/route"

const ctx = { params: Promise.resolve({ leagueId: "L" }) }
const req = (body: unknown) => ({ json: async () => body }) as never

function importedLeague(o: Record<string, unknown> = {}) {
  return {
    id: "L",
    userId: "commish",
    platform: "sleeper",
    isCommissioner: true,
    name: "Couch Dynasty",
    sport: "NFL",
    season: 2026,
    leagueVariant: null,
    leagueSize: 12,
    scoring: "ppr",
    isDynasty: true,
    settings: { findLeagueExternal: { listed: true, openSpots: 2, note: "Active chat" } },
    timezone: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    leagueSettings: null,
    draftSessions: [],
    user: { username: "commish", displayName: "Commish", avatarUrl: null },
    ...o,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { id: "player" } }
  geo.blocked = false
  db.roster.findMany.mockResolvedValue([])
  db.appUser.findMany.mockResolvedValue([])
})

describe("who may list a league that plays elsewhere", () => {
  it("trusts the platform, then a recorded attestation, and nothing else", () => {
    expect(listingVerification({ userId: "c", isCommissioner: true, settings: {} })).toBe("provider")
    expect(
      listingVerification({ userId: "c", settings: { commissionerVerification: { method: "api", appUserId: "c" } } })
    ).toBe("provider")
    expect(
      listingVerification({ userId: "c", settings: { commissionerVerification: { method: "attestation", appUserId: "c" } } })
    ).toBe("attestation")
    // A member who imported the league is not its commissioner.
    expect(
      listingVerification({ userId: "c", settings: { commissionerVerification: { method: "membership-only", appUserId: "c" } } })
    ).toBeNull()
    // A record about someone else's import proves nothing about this copy.
    expect(
      listingVerification({ userId: "c", settings: { commissionerVerification: { method: "api", appUserId: "other" } } })
    ).toBeNull()
    expect(listingVerification({ userId: "c", settings: {} })).toBeNull()
  })

  it("says how much the label is worth", () => {
    expect(verificationLabel("provider", "sleeper")).toBe("Commissioner verified by Sleeper")
    expect(verificationLabel("attestation", "espn")).toBe("Commissioner self-reported at import")
  })

  it("clamps what the settings say", () => {
    expect(readExternalListing({ findLeagueExternal: { listed: true, openSpots: 99, note: " hi " } })).toMatchObject({
      listed: true,
      openSpots: 32,
      note: "hi",
    })
    expect(readExternalListing({}).listed).toBe(false)
  })
})

describe("discovery shows verified external listings, and only those", () => {
  it("lists a verified import as request-to-join, with the commissioner's open spots", async () => {
    db.league.findMany.mockResolvedValue([importedLeague()])
    const [card] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(card).toMatchObject({
      joinMode: "request",
      externalPlatform: "sleeper",
      listingVerification: "provider",
      listingNote: "Active chat",
      joinUrl: "",
      memberCount: 10,
      maxMembers: 12,
    })
  })

  it("drops an import whose lister the platform did not show to be commissioner", async () => {
    db.league.findMany.mockResolvedValue([importedLeague({ isCommissioner: false })])
    expect(await queryPublicFantasyLeagueCards({ sport: null, query: null })).toEqual([])
  })

  it("drops an import marked public but never listed — it can't be joined here", async () => {
    db.league.findMany.mockResolvedValue([
      importedLeague({ settings: { league_privacy_visibility: "public", inviteCode: "x" } }),
    ])
    expect(await queryPublicFantasyLeagueCards({ sport: null, query: null })).toEqual([])
  })
})

describe("paid leagues", () => {
  it("reads the fee from either key and either type", () => {
    expect(leagueEntryFee({ entryFee: 50 })).toBe(50)
    expect(leagueEntryFee({ buyIn: "25" })).toBe(25)
    expect(isPaidLeagueSettings({ entryFee: 0 })).toBe(false)
    expect(isPaidLeagueSettings({ isPaidLeague: true })).toBe(true)
  })
})

describe("POST request a spot", () => {
  beforeEach(() => {
    db.league.findUnique.mockResolvedValue(importedLeague())
    db.findLeagueSpotRequest.findUnique.mockResolvedValue(null)
    db.findLeagueSpotRequest.count.mockResolvedValue(0)
    db.findLeagueSpotRequest.create.mockResolvedValue({ id: "R1" })
    db.appUser.findUnique.mockResolvedValue({ displayName: "Pat", username: "pat" })
  })

  it("records the request and tells the commissioner", async () => {
    const res = await requestSpot(req({ message: "10 years of dynasty" }), ctx)
    expect(res.status).toBe(200)
    expect(db.findLeagueSpotRequest.create).toHaveBeenCalledWith({
      data: { leagueId: "L", requesterUserId: "player", message: "10 years of dynasty" },
      select: { id: true },
    })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "commish", type: "find_league_spot_request", title: "Pat wants a spot in Couch Dynasty" })
    )
  })

  it("refuses a league whose listing no longer stands", async () => {
    db.league.findUnique.mockResolvedValue(importedLeague({ isCommissioner: false }))
    expect((await requestSpot(req({}), ctx)).status).toBe(404)
    expect(db.findLeagueSpotRequest.create).not.toHaveBeenCalled()
  })

  it("does not ask twice", async () => {
    db.findLeagueSpotRequest.findUnique.mockResolvedValue({ id: "R1", status: "pending" })
    const body = await (await requestSpot(req({}), ctx)).json()
    expect(body).toMatchObject({ alreadyRequested: true, status: "pending" })
    expect(notify).not.toHaveBeenCalled()
  })

  it("caps requests per day", async () => {
    db.findLeagueSpotRequest.count.mockResolvedValue(10)
    expect((await requestSpot(req({}), ctx)).status).toBe(429)
  })

  it("refuses a paid league where paid leagues are restricted", async () => {
    geo.blocked = true
    db.league.findUnique.mockResolvedValue(
      importedLeague({ settings: { entryFee: 50, findLeagueExternal: { listed: true, openSpots: 1 } } })
    )
    const res = await requestSpot(req({}), ctx)
    expect(res.status).toBe(451)
    expect((await res.json()).error).toContain("Idaho")
  })
})

describe("the commissioner's listing", () => {
  beforeEach(() => {
    session.value = { user: { id: "commish" } }
  })

  it("won't list for an importer the platform didn't show to be commissioner", async () => {
    db.league.findUnique.mockResolvedValue(importedLeague({ isCommissioner: false, settings: {} }))
    const res = await saveListing(req({ listed: true, openSpots: 2 }), ctx)
    expect(res.status).toBe(403)
    expect(db.league.update).not.toHaveBeenCalled()
  })

  it("is somebody else's copy: not found", async () => {
    session.value = { user: { id: "player" } }
    db.league.findUnique.mockResolvedValue(importedLeague())
    expect((await saveListing(req({ listed: true, openSpots: 2 }), ctx)).status).toBe(404)
  })

  it("saves spots and note, keeping the rest of the settings", async () => {
    db.league.findUnique.mockResolvedValue(importedLeague({ settings: { scoringSettings: { rec: 1 } } }))
    db.league.update.mockResolvedValue({})
    const res = await saveListing(req({ listed: true, openSpots: 3, note: "Trades welcome" }), ctx)
    expect(res.status).toBe(200)
    const settings = db.league.update.mock.calls[0][0].data.settings
    expect(settings.scoringSettings).toEqual({ rec: 1 })
    expect(settings.findLeagueExternal).toMatchObject({ listed: true, openSpots: 3, note: "Trades welcome" })
  })

  it("accepting needs the invite, and then tells the player how to join", async () => {
    db.league.findUnique.mockResolvedValue(importedLeague())
    expect((await answerRequest(req({ requestId: "R1", action: "accept" }), ctx)).status).toBe(400)

    db.findLeagueSpotRequest.updateMany.mockResolvedValue({ count: 1 })
    db.findLeagueSpotRequest.findUnique.mockResolvedValue({ requesterUserId: "player" })
    const res = await answerRequest(req({ requestId: "R1", action: "accept", note: "sleeper.com/i/abc" }), ctx)
    expect(res.status).toBe(200)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "player", type: "find_league_spot_accepted", body: expect.stringContaining("sleeper.com/i/abc") })
    )
  })
})
