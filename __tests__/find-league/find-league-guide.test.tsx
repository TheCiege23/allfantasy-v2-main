// @vitest-environment jsdom
/**
 * Find a League in plain words (2026-11-14): search first, Sport and Sort beside it, the rest folded;
 * the picked-for-you rows only when the grid cannot show every league; each card says each fact once.
 */
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const url = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock("@/hooks/useUserTimezone", () => ({ useUserTimezone: () => ({ timezone: "America/New_York" }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => url.params }))

import { FindLeagueClient } from "@/app/find-league/FindLeagueClient"
import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"
import { cardDraft, cardSeats, moreFilterCount, showPickedRows } from "@/lib/public-discovery/findLeagueGuide"
import { findLeagueGuideMessages } from "@/lib/core-app/messages/findLeagueGuide"
import { findLeagueHeroMessages } from "@/lib/core-app/messages/findLeagueHero"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

function card(o: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: "fantasy",
    id: "L1",
    name: "Sample Hoops League",
    description: null,
    sport: "NBA",
    memberCount: 3,
    maxMembers: 4,
    joinUrl: "/join?code=SAMPLE",
    joinMode: "code",
    detailUrl: "/leagues/L1",
    ownerName: "Sample Commish",
    ownerAvatar: null,
    creatorSlug: null,
    creatorName: null,
    tournamentName: null,
    season: 2026,
    scoringMode: "points",
    isPaid: false,
    isPrivate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    fillPct: 75,
    leagueType: "fantasy",
    leagueStyle: "redraft",
    draftType: "snake",
    draftStatus: "pre_draft",
    teamCount: 4,
    draftDate: null,
    commissionerName: "SampleCommish",
    commissionerUsername: "samplecommish",
    commissionerLeaguesRun: 18,
    commissionerSinceYear: 2026,
    aiFeatures: [],
    leagueTier: 1,
    leagueCareerLevel: 14,
    rankingEffectScore: 48,
    timezone: "America/New_York",
    ...o,
  } as DiscoveryCard
}

const count = (text: string, needle: RegExp) => (text.match(needle) ?? []).length

describe("the card rules", () => {
  it("one draft line: a draft that has moved on wins over its scheduled time", () => {
    const at = "2026-11-20T01:00:00.000Z"
    expect(cardDraft({ draftStatus: "pre_draft", draftDate: null })).toEqual({ kind: "unscheduled" })
    expect(cardDraft({ draftStatus: "pre_draft", draftDate: at })).toEqual({ kind: "scheduled", iso: at })
    expect(cardDraft({ draftStatus: "in_progress", draftDate: at })).toEqual({ kind: "live" })
    expect(cardDraft({ draftStatus: "paused", draftDate: at })).toEqual({ kind: "paused" })
    expect(cardDraft({ draftStatus: "completed", draftDate: at })).toEqual({ kind: "done" })
    expect(cardDraft({ draftStatus: "pre_draft", draftDate: "not a date" })).toEqual({ kind: "unscheduled" })
  })

  it("seats left, out of the league size", () => {
    expect(cardSeats({ memberCount: 3, maxMembers: 4, teamCount: 4 })).toEqual({ kind: "open", left: 1, teams: 4 })
    expect(cardSeats({ memberCount: 12, maxMembers: 12, teamCount: 12 })).toEqual({ kind: "full", teams: 12 })
    expect(cardSeats({ memberCount: 5, maxMembers: 10, teamCount: 0 })).toEqual({ kind: "open", left: 5, teams: 10 })
    expect(cardSeats({ memberCount: 5, maxMembers: 0, teamCount: 0 })).toEqual({ kind: "count", members: 5 })
  })

  it("the picked rows only when the grid has more than one page", () => {
    expect(showPickedRows(2, false)).toBe(false)
    expect(showPickedRows(12, false)).toBe(false)
    expect(showPickedRows(13, false)).toBe(true)
    expect(showPickedRows(40, true)).toBe(false)
  })

  it("counts what More filters holds, and nothing it does not", () => {
    const none = {
      leagueType: "all", draftType: "all", draftStatus: "all", entryFee: "all", aiEnabled: false,
      teamCountMin: "", teamCountMax: "", draftWhen: "any", tzRegion: "any", vibe: "all", visibility: "public",
    }
    expect(moreFilterCount(none)).toBe(0)
    expect(moreFilterCount({ ...none, vibe: "casual", teamCountMin: "10", teamCountMax: "12" })).toBe(2)
    expect(moreFilterCount({ ...none, visibility: "all", aiEnabled: true })).toBe(2)
  })
})

describe("the card says each fact once", () => {
  afterEach(cleanup)

  it("sport, type, draft, seats, level and commissioner — once each, no codes", () => {
    render(<FindLeagueCard league={card()} />)
    const el = screen.getByTestId("find-league-card-L1")
    const text = el.textContent ?? ""
    expect(count(text, /NBA/g)).toBe(1)
    expect(count(text, /redraft/gi)).toBe(1)
    expect(count(text, /draft not scheduled/gi)).toBe(1)
    for (const gone of ["Fantasy", "Rank fit", "AI features", "League type:", "Draft status:", "Teams filled:", "Career Level", "None"]) {
      expect(text).not.toContain(gone)
    }
    expect(screen.getByTestId("find-league-facts-L1").textContent).toBe("2026 season · snake draft")
    expect(screen.getByTestId("find-league-draft-time-L1").textContent).toBe("Draft not scheduled yet")
    expect(screen.getByTestId("find-league-seats-L1").textContent).toBe("1 seat left of 4")
    expect(screen.getByTestId("find-league-level-L1").textContent).toBe("Level 14 league")
    expect(screen.getByTestId("find-league-commish-L1").textContent).toBe("Run bySampleCommish· 18 leagues since 2026")
    expect(screen.getByTestId("find-league-join-L1").textContent).toBe("Join")
    expect(screen.getByTestId("find-league-view-L1").textContent).toBe("View")
  })

  it("a league drafting now says so, and an AI league says it once as a tag", () => {
    render(<FindLeagueCard league={card({ draftStatus: "in_progress", draftDate: "2026-11-20T01:00:00.000Z", aiFeatures: ["Draft helper"] })} />)
    expect(screen.getByTestId("find-league-draft-time-L1").textContent).toBe("Drafting now")
    const text = screen.getByTestId("find-league-card-L1").textContent ?? ""
    expect(count(text, /AI-enabled/g)).toBe(1)
    expect(count(text, /Draft helper/g)).toBe(1)
  })

  it("a full league says every seat is taken", () => {
    render(<FindLeagueCard league={card({ memberCount: 4, fillPct: 100 })} />)
    expect(screen.getByTestId("find-league-seats-L1").textContent).toBe("All 4 seats taken")
    expect(screen.getByTestId("find-league-full-L1")).toBeTruthy()
  })
})

describe("the page", () => {
  let calls: string[]
  let total: number

  beforeEach(() => {
    calls = []
    total = 2
    url.params = new URLSearchParams()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input)
        calls.push(u)
        if (u.startsWith("/api/find-league/saved-searches")) return new Response(JSON.stringify({ searches: [] }))
        if (u.startsWith("/api/discover/leagues")) {
          return new Response(
            JSON.stringify({ leagues: [card(), card({ id: "L2", name: "Second Sample" })], total, totalPages: Math.ceil(total / 12), hiddenByTierPolicy: 1 }),
          )
        }
        return new Response(JSON.stringify({ status: "ok", rails: [{ kind: "filling_fast", title: "SERVER TITLE", description: "x", leagues: [card({ id: "R1" })] }] }))
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("says the Career Level rule once, then search, then the leagues — no repeat rows", async () => {
    render(<FindLeagueClient />)
    expect(await screen.findByTestId("find-league-found")).toBeTruthy()
    expect(screen.getByTestId("find-league-found").textContent).toBe("2 leagues found")
    expect(screen.getByTestId("find-league-career-rule").textContent).toContain("within 3 levels of your Career Level")
    expect(screen.getByTestId("find-league-invite-needed").textContent).toBe("1 league needs a commissioner invite.")
    expect(document.body.textContent).not.toContain("Class Division")
    expect(document.body.textContent).not.toContain("sorted by rank fit")
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(screen.getByTestId("find-league-career-rule"), screen.getByTestId("find-league-search-input"))).toBe(true)
    expect(before(screen.getByTestId("find-league-search-input"), screen.getByTestId("find-league-card-L1"))).toBe(true)
    // Every league is already on screen, so no picked-for-you rows and no request for them.
    expect(screen.queryByTestId("find-league-rails")).toBeNull()
    expect(calls.some((u) => u.startsWith("/api/find-league/recommendations"))).toBe(false)
  })

  it("shows the picked rows when there is more than one page of leagues", async () => {
    total = 30
    render(<FindLeagueClient />)
    expect(await screen.findByTestId("find-league-rails")).toBeTruthy()
    // The heading is the reader's language from the catalog, not the server's English.
    expect(screen.getByTestId("find-league-rail-filling_fast").querySelector("h2")?.textContent).toBe("Filling fast")
    expect(calls.some((u) => u.startsWith("/api/find-league/recommendations"))).toBe(true)
  })

  it("Sport and Sort beside the search; the rest folded, closed until asked", async () => {
    render(<FindLeagueClient />)
    expect(screen.getByTestId("find-league-sport")).toBeTruthy()
    expect(screen.getByTestId("find-league-sort")).toBeTruthy()
    expect(screen.queryByTestId("find-league-more")).toBeNull()
    expect(screen.queryByLabelText("League type")).toBeNull()
    const toggle = screen.getByTestId("find-league-more-toggle")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(screen.getByTestId("find-league-more")).toBeTruthy()
    expect(screen.getByLabelText("League type")).toBeTruthy()
    expect(screen.getByTestId("find-league-vibes")).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByTestId("find-league-more")).toBeNull()
  })

  it("opens More filters when a link sets one, and says how many are on", async () => {
    url.params = new URLSearchParams("vibe=casual&style=dynasty&sport=NFL")
    render(<FindLeagueClient />)
    expect(screen.getByTestId("find-league-more")).toBeTruthy()
    expect(screen.getByTestId("find-league-more-count").textContent).toBe("2 on")
    await waitFor(() => expect(calls.some((u) => u.startsWith("/api/discover/leagues"))).toBe(true))
  })

  it("a plain-English search opens the fold so its filters can be seen and changed", async () => {
    render(<FindLeagueClient />)
    fireEvent.change(screen.getByTestId("find-league-search-input"), { target: { value: "dynasty" } })
    fireEvent.click(screen.getByTestId("find-league-search-submit"))
    expect(await screen.findByTestId("find-league-more")).toBeTruthy()
    expect((screen.getByLabelText("League type") as HTMLSelectElement).value).toBe("dynasty")
  })
})

describe("the copy", () => {
  it("has Spanish for every key and never says «waiver»", () => {
    for (const cat of [findLeagueGuideMessages, findLeagueHeroMessages]) {
      const es = cat.es!
      expect(Object.keys(es).sort()).toEqual(Object.keys(cat.en).sort())
      const text = JSON.stringify(Object.values(es).map((v) => (typeof v === "function" ? String(v) : v)))
      expect(text.toLowerCase()).not.toMatch(/waiver/)
    }
    expect(findLeagueGuideMessages.en.found(1)).toBe("1 league found")
    expect(findLeagueGuideMessages.es!.found!(2)).toBe("2 ligas encontradas")
    expect(findLeagueGuideMessages.en.inviteNeeded(3)).toBe("3 leagues need a commissioner invite.")
  })
})
