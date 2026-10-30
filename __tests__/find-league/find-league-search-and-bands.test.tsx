// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("@/hooks/useUserTimezone", () => ({ useUserTimezone: () => ({ timezone: "America/New_York" }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }))

import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"
import { FindLeagueClient } from "@/app/find-league/FindLeagueClient"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

function card(overrides: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
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
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FindLeagueCard", () => {
  it("shows the rank band, the draft on the viewer's clock, and the league's region", () => {
    render(
      <FindLeagueCard
        league={card({
          rankBand: "step_up",
          // Wed 2026-11-04 9pm Eastern.
          draftDate: "2026-11-05T02:00:00Z",
          timezone: "America/Chicago",
        })}
      />
    )
    expect(screen.getByTestId("find-league-rank-band-lg1").textContent).toBe("Step up")
    const time = screen.getByTestId("find-league-draft-time-lg1").textContent ?? ""
    expect(time).toMatch(/9:00\s?PM/)
    expect(time).toContain("(your time)")
    expect(screen.getByText("League runs on Central time")).toBeTruthy()
  })

  it("says the draft is unscheduled rather than printing a dash", () => {
    render(<FindLeagueCard league={card()} />)
    expect(screen.getByTestId("find-league-draft-time-lg1").textContent).toContain("Draft not scheduled")
    expect(screen.queryByTestId("find-league-rank-band-lg1")).toBeNull()
  })
})

describe("FindLeagueClient search", () => {
  let discoverUrls: string[]

  beforeEach(() => {
    discoverUrls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith("/api/discover/leagues")) {
          discoverUrls.push(url)
          return new Response(
            JSON.stringify({
              leagues: [card({ rankBand: "your_level" })],
              total: 1,
              page: 1,
              limit: 12,
              totalPages: 1,
              viewerTier: 3,
              viewerTierName: "Starter",
            })
          )
        }
        return new Response(JSON.stringify({ status: "anonymous", rails: [] }))
      })
    )
  })

  const lastParams = () => new URL(discoverUrls[discoverUrls.length - 1], "http://x").searchParams

  it("turns a plain-English search into filters and sends the viewer's zone", async () => {
    render(<FindLeagueClient />)
    await waitFor(() => expect(discoverUrls.length).toBeGreaterThan(0))

    fireEvent.change(screen.getByTestId("find-league-search-input"), {
      target: { value: "12 team dynasty snake, free, weeknights" },
    })
    fireEvent.click(screen.getByTestId("find-league-search-submit"))

    await waitFor(() => expect(lastParams().get("draftWhen")).toBe("weeknight"))
    const p = lastParams()
    expect(p.get("style")).toBe("dynasty")
    expect(p.get("draftType")).toBe("snake")
    expect(p.get("teamCountMin")).toBe("12")
    expect(p.get("teamCountMax")).toBe("12")
    expect(p.get("entryFee")).toBe("free")
    expect(p.get("viewerTz")).toBe("America/New_York")
    // Every word was recognised, so nothing is left to match against names.
    expect(p.get("q")).toBeNull()

    expect(screen.getByTestId("find-league-search-read-as").textContent).toContain("dynasty")
    expect((screen.getByTestId("find-league-draft-when") as HTMLSelectElement).value).toBe("weeknight")
  })

  it("offers rank band chips once results carry bands, and filters by one", async () => {
    render(<FindLeagueClient />)
    const bands = await screen.findByTestId("find-league-rank-bands")
    fireEvent.click(Array.from(bands.querySelectorAll("button")).find((b) => b.textContent === "Your level")!)
    await waitFor(() => expect(lastParams().get("rankBand")).toBe("your_level"))
  })
})
