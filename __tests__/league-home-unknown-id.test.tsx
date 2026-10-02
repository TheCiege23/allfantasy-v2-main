import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /leagues/[leagueId] — what a stranger, or a typed URL, sees.
 *
 * Found live on 2026-10-01: /leagues/explore (any id at all) rendered a full
 * "League Home" shell to a signed-out visitor, with "League ID: explore" and a
 * "Legacy Identity: session_fallback" chip — internals, for a league that does
 * not exist. These pin the three fixes, and the one thing they must NOT do:
 * hide a real fantasy league the viewer simply has no roster in.
 */

const useSessionMock = vi.hoisted(() => vi.fn())
const trackMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth/react", () => ({ useSession: useSessionMock }))
vi.mock("next/navigation", () => ({
  useParams: () => ({ leagueId: "explore" }),
  useSearchParams: () => new URLSearchParams(),
}))
// Heavy panels are irrelevant to these behaviours; stub them so the test is about the page.
vi.mock("@/components/app/league/SmartDataView", () => ({ SmartDataView: () => null }))
vi.mock("@/components/PlayerDetailModal", () => ({ default: () => null }))
vi.mock("@/components/app/league-intelligence/LeagueIntelligenceGraphPanel", () => ({ default: () => null }))
vi.mock("@/components/app/league-intelligence/UnifiedRelationshipInsightsPanel", () => ({ UnifiedRelationshipInsightsPanel: () => null }))
vi.mock("@/components/simulation/LeagueForecastSection", () => ({ LeagueForecastSection: () => null }))
vi.mock("@/components/dynasty/DynastyProjectionPanel", () => ({ DynastyProjectionPanel: () => null }))
vi.mock("@/components/app/tabs/WarehouseHistoryPanel", () => ({ default: () => null }))
vi.mock("@/components/moderation/MessageModerationMenu", () => ({ MessageModerationMenu: () => null }))
vi.mock("@/hooks/useLegacyTab", () => ({ useLegacyTab: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock("@/lib/api/legacy", () => ({ postMarketRefresh: vi.fn() }))
vi.mock("@/lib/discovery-analytics/client", () => ({ trackDiscoveryLeagueView: trackMock }))

import LeagueHomeShellPage from "@/app/leagues/[leagueId]/page"

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))

/** Fake each endpoint the page calls; `myLeagues` and `roster` are the two that decide "missing". */
function stubFetch({ myLeagues, roster }: { myLeagues: [number, unknown]; roster: [number, unknown] }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/bracket/my-leagues")) return json(...myLeagues)
      if (url.includes("/api/league/roster")) return json(...roster)
      if (url.includes("/api/legacy/identity")) return json(200, { identity: { source: "session_fallback" } })
      if (url.includes("/standings")) return json(200, { standings: [] })
      if (url.includes("/api/bracket/entries")) return json(200, { entries: [] })
      if (url.includes("/chat")) return json(200, { messages: [] })
      return json(404, {})
    }),
  )
}

const authed = () => useSessionMock.mockReturnValue({ data: { user: { id: "u1", name: "Pat" } }, status: "authenticated" })

describe("/leagues/[leagueId] for an unknown id or a signed-out visitor", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it("asks a signed-out visitor to sign in, and sends them back to this league", () => {
    useSessionMock.mockReturnValue({ data: null, status: "unauthenticated" })
    stubFetch({ myLeagues: [401, {}], roster: [401, {}] })
    render(<LeagueHomeShellPage />)

    expect(screen.getByTestId("league-home-signin")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
      "href",
      `/login?callbackUrl=${encodeURIComponent("/leagues/explore")}`,
    )
    expect(screen.queryByText(/League Home/)).toBeNull()
  })

  it("shows nothing — no wall, no not-found — while the session is still loading", () => {
    useSessionMock.mockReturnValue({ data: null, status: "loading" })
    stubFetch({ myLeagues: [200, { leagues: [] }], roster: [404, { error: "League not found" }] })
    render(<LeagueHomeShellPage />)
    expect(screen.queryByTestId("league-home-signin")).toBeNull()
    expect(screen.queryByTestId("league-home-not-found")).toBeNull()
  })

  it("says the league does not exist when NEITHER source knows the id", async () => {
    authed()
    stubFetch({ myLeagues: [200, { leagues: [] }], roster: [404, { error: "League not found" }] })
    render(<LeagueHomeShellPage />)

    expect(await screen.findByTestId("league-home-not-found")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to my leagues" })).toHaveAttribute("href", "/leagues")
    // A typed URL is not a discovery view.
    expect(trackMock).not.toHaveBeenCalled()
  })

  it("still renders a REAL league the viewer has no roster in (roster says 'Roster not found')", async () => {
    authed()
    stubFetch({ myLeagues: [200, { leagues: [] }], roster: [404, { error: "Roster not found" }] })
    render(<LeagueHomeShellPage />)

    expect(await screen.findByRole("heading", { level: 1, name: "League Home" })).toBeInTheDocument()
    await waitFor(() => expect(trackMock).toHaveBeenCalled())
    expect(screen.queryByTestId("league-home-not-found")).toBeNull()
  })

  it("does not claim the league is gone when the bracket read itself failed", async () => {
    authed()
    stubFetch({ myLeagues: [500, { error: "boom" }], roster: [404, { error: "League not found" }] })
    render(<LeagueHomeShellPage />)

    expect(await screen.findByRole("heading", { level: 1, name: "League Home" })).toBeInTheDocument()
    expect(screen.queryByTestId("league-home-not-found")).toBeNull()
  })

  it("never shows the internal League ID line or the identity-resolver chip", async () => {
    authed()
    stubFetch({ myLeagues: [200, { leagues: [] }], roster: [404, { error: "Roster not found" }] })
    render(<LeagueHomeShellPage />)

    await screen.findByRole("heading", { level: 1, name: "League Home" })
    // The identity endpoint answered "session_fallback" — it must not be rendered anywhere.
    expect(screen.queryByText(/session_fallback/)).toBeNull()
    expect(screen.queryByText(/Legacy Identity/)).toBeNull()
    expect(screen.queryByText(/League ID: explore/)).toBeNull()
  })
})
