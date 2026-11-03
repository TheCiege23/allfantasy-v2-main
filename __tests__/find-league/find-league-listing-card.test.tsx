// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ t: (s: string) => s, tInterpolate: (s: string) => s }),
}))

import { FindLeagueListingCard } from "@/components/core-app/commissioner/FindLeagueListingCard"

function stubFinder(state: Record<string, unknown>) {
  const calls: Array<{ method: string }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET" })
      if (init?.method === "POST") state = { ...state, listed: true }
      if (init?.method === "DELETE") state = { ...state, listed: false }
      return new Response(JSON.stringify(init?.method ? { ok: true } : state))
    })
  )
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FindLeagueListingCard", () => {
  it("shows the open seats and lists the league in one tap", async () => {
    const calls = stubFinder({ listed: false, inviteReady: true, openSeats: 8, leagueSize: 10, seatsHeld: 2 })
    render(<FindLeagueListingCard leagueId="L" />)

    expect((await screen.findByTestId("find-league-listing-seats")).textContent).toBe("8 open seats")
    fireEvent.click(screen.getByTestId("find-league-listing-toggle"))

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true))
    expect(await screen.findByText("Listed in Find a League")).toBeTruthy()
    expect(screen.getByTestId("find-league-listing-toggle").textContent).toBe("Remove from Find a League")
  })

  it("says what is missing instead of offering a button that would fail", async () => {
    stubFinder({ listed: false, inviteReady: false, openSeats: 3, leagueSize: 10, seatsHeld: 7 })
    render(<FindLeagueListingCard leagueId="L" />)
    expect(await screen.findByTestId("find-league-listing-needs-invite")).toBeTruthy()
    expect((screen.getByTestId("find-league-listing-toggle") as HTMLButtonElement).disabled).toBe(true)
  })

  it("stays out of the way for a full league that is not listed", async () => {
    stubFinder({ listed: false, inviteReady: true, openSeats: 0, leagueSize: 10, seatsHeld: 10 })
    const { container } = render(<FindLeagueListingCard leagueId="L" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="find-league-listing-card"]')).toBeNull()
  })
})
