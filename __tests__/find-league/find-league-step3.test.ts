/**
 * Find a League step 3: vibe tags, the commissioner card, saved-search alerts, and Chimmy search.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

const db = vi.hoisted(() => ({
  league: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
  savedLeagueSearch: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
}))
const session = vi.hoisted(() => ({ value: { user: { id: "u1" } } as null | { user: { id: string } } }))
const discover = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => vi.fn(async () => true))
const lock = vi.hoisted(() => ({ value: null as null | string }))
const commish = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => session.value) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/platform/notification-service", () => ({ createPlatformNotification: notify }))
vi.mock("@/lib/ranking/tier-visibility", async (orig) => ({
  ...(await orig<typeof import("@/lib/ranking/tier-visibility")>()),
  resolveUserCareerTier: vi.fn(async () => 2),
}))
vi.mock("@/lib/geo/accountGeoLockServer", () => ({ readAccountGeoLockFresh: vi.fn(async () => lock.value) }))
vi.mock("@/lib/league/permissions", () => ({ requireCommissionerRole: commish }))
vi.mock("@/lib/get-base-url", () => ({ getBaseUrl: () => "https://allfantasy.ai" }))
vi.mock("@/lib/public-discovery/PublicDiscoveryService", () => ({ discoverPublicLeagues: discover }))

import { normalizeLeagueVibes, readLeagueVibes } from "@/lib/public-discovery/vibes"
import { parseLeagueSearch } from "@/lib/public-discovery/findLeagueFilters"
import { queryPublicFantasyLeagueCards } from "@/lib/public-discovery/DiscoveryQueryLayer"
import { canonicalSearchQuery, checkSavedSearch, discoverInputFromQuery, SEEN_CAP } from "@/lib/public-discovery/savedSearchAlerts"
import { runSavedSearchAlerts } from "@/lib/public-discovery/runSavedSearchAlerts"
import { findOpenLeaguesForChimmy } from "@/lib/public-discovery/chimmyLeagueSearch"
import { DELETE as deleteSaved, POST as saveSearch } from "@/app/api/find-league/saved-searches/route"
import { PUT as putVibes } from "@/app/api/commissioner/leagues/[leagueId]/vibes/route"

function card(id: string, o: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: "fantasy",
    id,
    name: `League ${id}`,
    description: null,
    sport: "NFL",
    memberCount: 4,
    maxMembers: 12,
    joinUrl: "/join?code=x",
    detailUrl: `/leagues/${id}`,
    ownerName: "c",
    ownerAvatar: null,
    creatorSlug: null,
    creatorName: null,
    tournamentName: null,
    season: 2026,
    scoringMode: "ppr",
    isPaid: false,
    isPrivate: false,
    createdAt: "2026-10-01T00:00:00Z",
    fillPct: 33,
    leagueType: "fantasy",
    leagueStyle: "dynasty",
    draftType: "snake",
    draftStatus: "pre_draft",
    teamCount: 12,
    draftDate: null,
    commissionerName: "c",
    aiFeatures: [],
    ...o,
  }
}

const req = (body: unknown, qs = "") =>
  ({ json: async () => body, nextUrl: new URL(`https://allfantasy.ai/x${qs}`) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { id: "u1" } }
  lock.value = null
  db.roster.findMany.mockResolvedValue([])
  db.leagueTeam.findMany.mockResolvedValue([])
  db.appUser.findMany.mockResolvedValue([])
  db.league.groupBy.mockResolvedValue([])
})

describe("vibes", () => {
  it("keeps known tags only, at most three, no repeats", () => {
    expect(normalizeLeagueVibes(["casual", "nope", "casual", "competitive", "trash_talk", "low_key"])).toEqual([
      "casual",
      "competitive",
      "trash_talk",
    ])
    expect(readLeagueVibes({ findLeagueVibes: "casual" })).toEqual([])
  })

  it("the search box understands them — but 'chill' stays a rank band", () => {
    expect(parseLeagueSearch("casual dynasty for beginners").vibe).toBe("beginner_friendly")
    expect(parseLeagueSearch("competitive 12 team").vibe).toBe("competitive")
    expect(parseLeagueSearch("chill redraft").vibe).toBeUndefined()
  })
})

describe("the card carries vibes and the commissioner card", () => {
  it("counts only leagues the commissioner runs here", async () => {
    db.league.findMany.mockResolvedValue([
      {
        id: "L",
        userId: "commish",
        platform: "manual",
        isCommissioner: false,
        name: "Gridiron",
        sport: "NFL",
        season: 2026,
        leagueVariant: null,
        leagueSize: 10,
        scoring: "ppr",
        isDynasty: false,
        settings: { league_privacy_visibility: "public", inviteCode: "x", findLeagueVibes: ["casual", "active_chat"] },
        timezone: null,
        createdAt: new Date("2026-10-01T00:00:00Z"),
        updatedAt: new Date("2026-10-01T00:00:00Z"),
        leagueSettings: null,
        draftSessions: [],
        user: { username: "kenny", displayName: "Kenny", avatarUrl: null, createdAt: new Date("2025-03-01T00:00:00Z") },
      },
    ])
    db.league.groupBy.mockResolvedValue([{ userId: "commish", _count: { _all: 3 } }])

    const [c] = await queryPublicFantasyLeagueCards({ sport: null, query: null })
    expect(c).toMatchObject({
      vibes: ["casual", "active_chat"],
      commissionerUsername: "kenny",
      commissionerLeaguesRun: 3,
      commissionerSinceYear: 2025,
    })
    const where = db.league.groupBy.mock.calls[0][0].where
    expect(where.platform.in).toContain("manual")
    expect(where.platform.in).not.toContain("sleeper")
  })
})

describe("who may set a league's vibe", () => {
  it("a native league asks the commissioner check", async () => {
    db.league.findUnique.mockResolvedValue({ id: "L", userId: "x", platform: "manual", isCommissioner: false, settings: {} })
    db.league.update.mockResolvedValue({})
    const res = await putVibes(req({ vibes: ["casual", "bogus"] }), { params: Promise.resolve({ leagueId: "L" }) })
    expect(commish).toHaveBeenCalledWith("L", "u1", "league")
    expect((await res.json()).vibes).toEqual(["casual"])
  })

  it("an imported league needs the verified commissioner's own copy", async () => {
    db.league.findUnique.mockResolvedValue({ id: "L", userId: "u1", platform: "sleeper", isCommissioner: false, settings: {} })
    const res = await putVibes(req({ vibes: ["casual"] }), { params: Promise.resolve({ leagueId: "L" }) })
    expect(res.status).toBe(403)
    expect(db.league.update).not.toHaveBeenCalled()
  })
})

describe("saved searches", () => {
  it("one search, one key: neutral values, paging and sort drop out, order is fixed", () => {
    expect(canonicalSearchQuery("sort=newest&entryFee=all&visibility=public&style=dynasty&sport=NFL&page=3")).toBe(
      "sport=NFL&style=dynasty"
    )
    expect(canonicalSearchQuery("draftWhen=upcoming&viewerTz=America/Chicago")).toBe("draftWhen=upcoming")
    expect(canonicalSearchQuery("draftWhen=weekend&viewerTz=America/Chicago")).toContain("viewerTz=")
    expect(canonicalSearchQuery("entryFee=all&sort=popularity")).toBeNull()
  })

  it("reads back newest-first, whatever sort it was saved under", () => {
    expect(discoverInputFromQuery("sport=NFL&vibe=casual&teamCountMin=12")).toMatchObject({
      sport: "NFL",
      vibe: "casual",
      teamCountMin: 12,
      sort: "newest",
    })
  })

  it("the first check only records what already exists", () => {
    const out = checkSavedSearch({ label: "NFL", seenLeagueIds: [], firstCheck: true, results: [card("a")] })
    expect(out).toEqual({ seen: ["fantasy:a"], alert: null })
  })

  it("later checks name new open leagues, free ones only, and count the rest", () => {
    const out = checkSavedSearch({
      label: "NFL dynasty",
      seenLeagueIds: ["fantasy:old"],
      firstCheck: false,
      results: [
        card("old"),
        card("full", { memberCount: 12 }),
        card("paid", { isPaid: true }),
        card("new1"),
      ],
    })
    expect(out.alert).toEqual({
      title: '2 new leagues match "NFL dynasty"',
      body: "League new1 and 1 more. Seats are open now.",
    })
    expect(out.seen.slice(0, 2).sort()).toEqual(["fantasy:new1", "fantasy:paid"])
  })

  it("remembers a bounded number of leagues", () => {
    const seen = Array.from({ length: SEEN_CAP }, (_, i) => `fantasy:s${i}`)
    const out = checkSavedSearch({ label: "x", seenLeagueIds: seen, firstCheck: false, results: [card("n")] })
    expect(out.seen).toHaveLength(SEEN_CAP)
    expect(out.seen[0]).toBe("fantasy:n")
  })

  it("caps saved searches at five and keeps a duplicate as one", async () => {
    db.savedLeagueSearch.findUnique.mockResolvedValue(null)
    db.savedLeagueSearch.count.mockResolvedValue(5)
    expect((await saveSearch(req({ query: "sport=NFL", label: "NFL" }))).status).toBe(409)

    db.savedLeagueSearch.findUnique.mockResolvedValue({ id: "S1", label: "NFL", query: "sport=NFL" })
    const body = await (await saveSearch(req({ query: "sort=newest&sport=NFL", label: "NFL" }))).json()
    expect(body).toMatchObject({ alreadySaved: true })
    expect(db.savedLeagueSearch.findUnique.mock.calls[1][0].where.userId_query.query).toBe("sport=NFL")
  })

  it("refuses an empty search and a signed-out save", async () => {
    expect((await saveSearch(req({ query: "sort=newest" }))).status).toBe(400)
    session.value = null
    expect((await saveSearch(req({ query: "sport=NFL" }))).status).toBe(401)
  })

  it("only deletes the owner's own search", async () => {
    db.savedLeagueSearch.deleteMany.mockResolvedValue({ count: 0 })
    await deleteSaved(req(null, "?id=someone-elses"))
    expect(db.savedLeagueSearch.deleteMany).toHaveBeenCalledWith({ where: { id: "someone-elses", userId: "u1" } })
  })
})

describe("the daily saved-search check", () => {
  const now = new Date("2026-11-02T12:00:00Z")

  it("alerts once with a link to the search, and records what it saw", async () => {
    db.savedLeagueSearch.findMany.mockResolvedValue([
      { id: "S1", userId: "u1", label: "NFL", query: "sport=NFL", seenLeagueIds: [], lastCheckedAt: new Date("2026-11-01T12:00:00Z") },
    ])
    discover.mockResolvedValue({ leagues: [card("a")] })
    db.savedLeagueSearch.update.mockResolvedValue({})

    const run = await runSavedSearchAlerts({ baseUrl: "https://allfantasy.ai", now })
    expect(run).toMatchObject({ due: 1, checked: 1, alerted: 1, errors: [] })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", meta: expect.objectContaining({ actionHref: "/find-league?sport=NFL" }) })
    )
    expect(db.savedLeagueSearch.update.mock.calls[0][0].data).toMatchObject({ seenLeagueIds: ["fantasy:a"], lastCheckedAt: now, lastAlertedAt: now })
  })

  it("one broken search does not stop the rest", async () => {
    db.savedLeagueSearch.findMany.mockResolvedValue([
      { id: "bad", userId: "u1", label: "x", query: "sport=NFL", seenLeagueIds: [], lastCheckedAt: null },
      { id: "good", userId: "u2", label: "y", query: "sport=NBA", seenLeagueIds: [], lastCheckedAt: null },
    ])
    discover.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ leagues: [] })
    db.savedLeagueSearch.update.mockResolvedValue({})
    const run = await runSavedSearchAlerts({ baseUrl: "https://allfantasy.ai", now })
    expect(run.checked).toBe(1)
    expect(run.errors[0]).toContain("bad")
  })

  it("an account locked by its billing state searches free leagues only", async () => {
    lock.value = "card_paid_block"
    db.savedLeagueSearch.findMany.mockResolvedValue([
      { id: "S1", userId: "u1", label: "x", query: "sport=NFL", seenLeagueIds: [], lastCheckedAt: null },
      { id: "S2", userId: "u1", label: "y", query: "entryFee=paid", seenLeagueIds: [], lastCheckedAt: null },
    ])
    discover.mockResolvedValue({ leagues: [] })
    db.savedLeagueSearch.update.mockResolvedValue({})
    await runSavedSearchAlerts({ baseUrl: "https://allfantasy.ai", now })
    expect(discover).toHaveBeenCalledTimes(1)
    expect(discover.mock.calls[0][0].entryFee).toBe("free")
  })
})

describe("Chimmy search", () => {
  it("reads the person's words into the same filters as the page, free leagues only", async () => {
    discover.mockResolvedValue({ leagues: [card("a", { rankBand: "your_level", vibes: ["casual"] })] })
    const text = await findOpenLeaguesForChimmy("u1", "12 team dynasty snake casual weeknights")
    expect(discover.mock.calls[0][0]).toMatchObject({
      style: "dynasty",
      draftType: "snake",
      teamCountMin: 12,
      teamCountMax: 12,
      vibe: "casual",
      draftWhen: "weeknight",
      entryFee: "free",
    })
    expect(discover.mock.calls[0][2]).toMatchObject({ viewerUserId: "u1", viewerTier: 2 })
    expect(text).toContain("League a")
    expect(text).toContain("Your level")
    expect(text).toContain("https://allfantasy.ai/find-league?q=")
  })

  it("says nothing matched rather than inventing a league", async () => {
    discover.mockResolvedValue({ leagues: [card("full", { memberCount: 12 })] })
    const text = await findOpenLeaguesForChimmy(null, "auction hockey")
    expect(text).toContain("NO OPEN FREE LEAGUE MATCHED")
    expect(text).not.toContain("League full")
  })
})
