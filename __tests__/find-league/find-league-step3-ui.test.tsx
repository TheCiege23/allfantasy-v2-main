// @vitest-environment jsdom
/**
 * Step 3 on the page: a saved search's link reopens the same search, "Alert me" saves what is
 * on screen, the vibe chips filter, and the card shows who runs the league.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const url = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock("@/hooks/useUserTimezone", () => ({ useUserTimezone: () => ({ timezone: "America/New_York" }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => url.params }))

import { FindLeagueClient } from "@/app/find-league/FindLeagueClient"
import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

let calls: Array<{ url: string; method: string; body?: string }>

beforeEach(() => {
  calls = []
  url.params = new URLSearchParams()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input)
      calls.push({ url: u, method: init?.method ?? "GET", body: init?.body as string | undefined })
      if (u.startsWith("/api/find-league/saved-searches") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, search: { id: "S1", label: "NFL · casual", query: "sport=NFL&vibe=casual", lastAlertedAt: null } }))
      }
      if (u.startsWith("/api/find-league/saved-searches")) return new Response(JSON.stringify({ searches: [] }))
      if (u.startsWith("/api/discover/leagues")) {
        return new Response(JSON.stringify({ leagues: [], total: 0, page: 1, limit: 12, totalPages: 0 }))
      }
      return new Response(JSON.stringify({ status: "empty", rails: [] }))
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const discoverParams = () =>
  calls.filter((c) => c.url.startsWith("/api/discover/leagues")).map((c) => new URL(c.url, "http://x").searchParams)

describe("Find a League, step 3", () => {
  it("opens with every filter a saved search's link carries", async () => {
    url.params = new URLSearchParams("sport=NFL&style=dynasty&vibe=casual&teamCountMin=10&teamCountMax=12&draftWhen=upcoming")
    render(<FindLeagueClient />)
    await waitFor(() => expect(discoverParams().length).toBe(1))
    const p = discoverParams()[0]
    expect(p.get("sport")).toBe("NFL")
    expect(p.get("style")).toBe("dynasty")
    expect(p.get("vibe")).toBe("casual")
    expect(p.get("teamCountMin")).toBe("10")
    expect(p.get("teamCountMax")).toBe("12")
    expect(p.get("draftWhen")).toBe("upcoming")
  })

  it("filters by vibe, and saves the search on screen", async () => {
    render(<FindLeagueClient />)
    const vibes = await screen.findByTestId("find-league-vibes")
    expect((screen.getByTestId("find-league-save-search") as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(Array.from(vibes.querySelectorAll("button")).find((b) => b.textContent === "Casual")!)
    await waitFor(() => expect(discoverParams().at(-1)?.get("vibe")).toBe("casual"))

    fireEvent.click(screen.getByTestId("find-league-save-search"))
    expect(await screen.findByTestId("find-league-saved-S1")).toBeTruthy()
    const post = calls.find((c) => c.method === "POST")!
    const body = JSON.parse(post.body ?? "{}")
    expect(new URLSearchParams(body.query).get("vibe")).toBe("casual")
    expect(body.label).toBe("casual")
  })
})

describe("the card", () => {
  it("shows the vibe and who runs the league", () => {
    const league = {
      source: "fantasy",
      id: "lg1",
      name: "Gridiron Gang",
      description: null,
      sport: "NFL",
      memberCount: 6,
      maxMembers: 12,
      joinUrl: "/join?code=abc",
      detailUrl: "/leagues/lg1",
      ownerName: "Kenny",
      ownerAvatar: null,
      creatorSlug: null,
      creatorName: null,
      tournamentName: null,
      season: 2026,
      scoringMode: "ppr",
      isPaid: false,
      isPrivate: false,
      createdAt: "2026-01-01T00:00:00Z",
      fillPct: 50,
      leagueType: "fantasy",
      leagueStyle: "dynasty",
      draftType: "snake",
      draftStatus: "pre_draft",
      teamCount: 12,
      draftDate: null,
      commissionerName: "Kenny",
      aiFeatures: [],
      vibes: ["trash_talk", "trade_happy"],
      commissionerUsername: "kenny",
      commissionerLeaguesRun: 3,
      commissionerSinceYear: 2025,
    } as DiscoveryCard
    render(<FindLeagueCard league={league} />)
    expect(screen.getByTestId("find-league-vibes-lg1").textContent).toBe("Trash talkTrade happy")
    const commish = screen.getByTestId("find-league-commish-lg1")
    expect(commish.textContent).toContain("Runs 3 AllFantasy leagues · since 2025")
    expect(commish.querySelector("a")?.getAttribute("href")).toBe("/profile/kenny")
  })
})
