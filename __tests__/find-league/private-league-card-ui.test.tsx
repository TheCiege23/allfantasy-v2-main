// @vitest-environment jsdom
/**
 * A private league's card in Find a League: safe fields, no page link, no code, and an
 * "Ask to join" button whose every answer (pending, approved, already in, error) has a state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("@/hooks/useUserTimezone", () => ({ useUserTimezone: () => ({ timezone: "America/New_York" }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }))

import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"
import { FindLeagueClient } from "@/app/find-league/FindLeagueClient"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

const answer = vi.hoisted(() => ({ status: 200, body: { ok: true, status: "pending" } as Record<string, unknown> }))
let calls: Array<{ url: string; method: string; body?: string }> = []

function privateCard(o: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: "fantasy",
    id: "P1",
    name: "Friends & Family",
    description: null,
    sport: "NFL",
    memberCount: 4,
    maxMembers: 12,
    joinUrl: "",
    joinMode: "approval",
    detailUrl: "",
    ownerName: "Commissioner",
    ownerAvatar: null,
    creatorSlug: null,
    creatorName: null,
    tournamentName: null,
    season: 2026,
    scoringMode: "ppr",
    isPaid: false,
    isPrivate: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    fillPct: 33,
    leagueType: "fantasy",
    leagueStyle: "best_ball",
    draftType: "snake",
    draftStatus: "pre_draft",
    teamCount: 12,
    draftDate: null,
    commissionerName: "Commissioner",
    aiFeatures: [],
    leagueTier: 1,
    ...o,
  } as DiscoveryCard
}

beforeEach(() => {
  calls = []
  answer.status = 200
  answer.body = { ok: true, status: "pending" }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined })
      return new Response(JSON.stringify(answer.body), { status: answer.status })
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("a private league's card", () => {
  it("says it is private, and offers no page, no code and no commissioner", () => {
    const { container } = render(<FindLeagueCard league={privateCard()} />)
    expect(screen.getByText("Private league")).toBeTruthy()
    expect(screen.getByTestId("find-league-private-note-P1").textContent).toContain("members-only")
    expect(screen.queryByTestId("find-league-view-P1")).toBeNull()
    expect(screen.queryByTestId("find-league-join-P1")).toBeNull()
    expect(screen.queryByTestId("find-league-commish-P1")).toBeNull()
    expect(container.querySelector('a[href*="/join?code"]')).toBeNull()
    expect(container.querySelector('a[href*="/leagues/"]')).toBeNull()
    expect(screen.getByTestId("find-league-ask-P1").textContent).toContain("Ask to join")
  })

  it("asks the commissioner, then says the request is pending", async () => {
    render(<FindLeagueCard league={privateCard()} />)
    fireEvent.click(screen.getByTestId("find-league-ask-P1"))
    fireEvent.change(screen.getByTestId("find-league-ask-message-P1"), { target: { value: "Ten years of best ball" } })
    fireEvent.click(screen.getByTestId("find-league-ask-send-P1"))
    expect(await screen.findByTestId("find-league-ask-pending-P1")).toBeTruthy()
    expect(calls[0]).toMatchObject({ url: "/api/find-league/leagues/P1/request", method: "POST" })
    expect(JSON.parse(calls[0].body!)).toEqual({ message: "Ten years of best ball" })
  })

  it("an approved request goes to take the seat", async () => {
    answer.body = { ok: true, status: "accepted", alreadyRequested: true }
    render(<FindLeagueCard league={privateCard()} />)
    fireEvent.click(screen.getByTestId("find-league-ask-P1"))
    fireEvent.click(screen.getByTestId("find-league-ask-send-P1"))
    expect((await screen.findByTestId("find-league-ask-approved-P1")).getAttribute("href")).toBe("/join?approved=P1")
  })

  it("a member is sent to the league", async () => {
    answer.body = { ok: true, status: "member", alreadyMember: true }
    render(<FindLeagueCard league={privateCard()} />)
    fireEvent.click(screen.getByTestId("find-league-ask-P1"))
    fireEvent.click(screen.getByTestId("find-league-ask-send-P1"))
    expect((await screen.findByTestId("find-league-ask-member-P1")).getAttribute("href")).toBe("/league/P1")
  })

  it("a refusal is shown in the server's words", async () => {
    answer.status = 409
    answer.body = { error: "This league is full.", code: "LEAGUE_FULL" }
    render(<FindLeagueCard league={privateCard()} />)
    fireEvent.click(screen.getByTestId("find-league-ask-P1"))
    fireEvent.click(screen.getByTestId("find-league-ask-send-P1"))
    expect((await screen.findByRole("alert")).textContent).toBe("This league is full.")
  })

  it("a public league's card still joins with its link", () => {
    render(
      <FindLeagueCard
        league={privateCard({ joinMode: "invite", isPrivate: false, joinUrl: "/join?code=OPEN1", detailUrl: "/leagues/P1" })}
      />
    )
    expect(screen.getByText("Public league")).toBeTruthy()
    expect(screen.getByTestId("find-league-join-P1").getAttribute("href")).toBe("/join?code=OPEN1")
    expect(screen.getByTestId("find-league-view-P1")).toBeTruthy()
    expect(screen.queryByTestId("find-league-ask-P1")).toBeNull()
  })
})

describe("the finder page", () => {
  it("opens on Public & private, so private leagues are listed without touching a filter", async () => {
    answer.body = { leagues: [], total: 0, page: 1, limit: 12, totalPages: 0, searches: [], rails: [] }
    render(<FindLeagueClient />)
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/discover/leagues"))).toBe(true))
    const url = new URL(calls.find((c) => c.url.startsWith("/api/discover/leagues"))!.url, "http://x")
    expect(url.searchParams.get("visibility")).toBe("all")
  })
})
