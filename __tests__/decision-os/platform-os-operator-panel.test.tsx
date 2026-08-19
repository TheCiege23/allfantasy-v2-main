import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"

import { PlatformOsOperatorPanel } from "@/components/admin/PlatformOsOperatorPanel"

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

const SNAPSHOT = {
  generatedAt: "2026-07-09T00:00:00.000Z",
  totalMonitoredLeagues: 2,
  healthyLeagueCount: 1,
  atRiskLeagueCount: 1,
  unavailableLeagueCount: 0,
  totalActiveManagers: 12,
  totalInactiveManagers: 2,
  totalTrades: 5,
  totalWaiverClaims: 8,
  totalDraftPicks: 20,
  totalRosterActivity: 3,
  totalRetentionRiskManagers: 1,
  attentionQueue: [
    {
      id: "league_requires_review:league-2:0",
      leagueId: "league-2",
      type: "league_requires_review",
      severity: "high",
      priorityScore: 400,
      title: "Requires immediate review",
      explanation: "3 managers at risk of leaving",
      recommendedAction: null,
      timestamp: "2026-07-09T00:00:00.000Z",
      source: "league_health_engine",
    },
  ],
  trendCoverage: { available: 1, noSnapshots: 1, insufficientHistory: 0, unavailable: 0 },
  provenance: {
    source: "commissioner_os_composition",
    requestedLeagueCount: 2,
    resolvedLeagueCount: 2,
    unavailableLeagueCount: 0,
  },
  warnings: [],
}

describe("PlatformOsOperatorPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the empty state and never fetches on mount", () => {
    render(<PlatformOsOperatorPanel />)
    expect(screen.getByTestId("platform-os-empty")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("disables Fetch until a league id is entered, and never auto-fills a default", () => {
    render(<PlatformOsOperatorPanel />)
    const input = screen.getByTestId("platform-os-league-ids-input") as HTMLTextAreaElement
    const button = screen.getByTestId("platform-os-fetch-button") as HTMLButtonElement

    expect(input.value).toBe("")
    expect(button.disabled).toBe(true)

    fireEvent.change(input, { target: { value: "league-1" } })
    expect(button.disabled).toBe(false)
  })

  it("fetches the explicit, comma-separated league ids the operator entered and renders the snapshot", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SNAPSHOT))
    render(<PlatformOsOperatorPanel />)

    const input = screen.getByTestId("platform-os-league-ids-input")
    fireEvent.change(input, { target: { value: "league-1, league-2" } })
    fireEvent.click(screen.getByTestId("platform-os-fetch-button"))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/decision-os/platform-os?${new URLSearchParams({ leagueIds: "league-1, league-2" }).toString()}`,
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId("platform-os-snapshot")).toBeInTheDocument()
    })

    expect(screen.getByTestId("platform-os-snapshot").textContent).toMatch(/Monitored leagues/)
    expect(screen.getByTestId("platform-os-trend-coverage").textContent).toMatch(/1 available/)
    const attentionList = screen.getByTestId("platform-os-attention-list")
    expect(attentionList.textContent).toMatch(/league-2/)
    expect(attentionList.textContent).toMatch(/3 managers at risk of leaving/)
    expect(screen.getByTestId("platform-os-provenance").textContent).toMatch(/requested=2/)
  })

  it("renders an honest empty attention queue message when there are no signals", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...SNAPSHOT, attentionQueue: [] }))
    render(<PlatformOsOperatorPanel />)

    fireEvent.change(screen.getByTestId("platform-os-league-ids-input"), { target: { value: "league-1" } })
    fireEvent.click(screen.getByTestId("platform-os-fetch-button"))

    await waitFor(() => {
      expect(screen.getByTestId("platform-os-attention-empty")).toBeInTheDocument()
    })
  })

  it("shows the server's error message and no snapshot when unauthorized", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, { error: "Unauthorized" }))
    render(<PlatformOsOperatorPanel />)

    fireEvent.change(screen.getByTestId("platform-os-league-ids-input"), { target: { value: "league-1" } })
    fireEvent.click(screen.getByTestId("platform-os-fetch-button"))

    await waitFor(() => {
      expect(screen.getByTestId("platform-os-error")).toHaveTextContent("Unauthorized")
    })
    expect(screen.queryByTestId("platform-os-snapshot")).not.toBeInTheDocument()
  })

  it("shows the server's 400 refusal message when leagueIds resolves to nothing meaningful", async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(400, { error: "leagueIds is required (comma-separated). Platform OS never auto-discovers leagues." }),
    )
    render(<PlatformOsOperatorPanel />)

    fireEvent.change(screen.getByTestId("platform-os-league-ids-input"), { target: { value: " , , " } })
    fireEvent.click(screen.getByTestId("platform-os-fetch-button"))

    await waitFor(() => {
      expect(screen.getByTestId("platform-os-error")).toHaveTextContent(/never auto-discovers leagues/)
    })
  })

  it("surfaces honest warnings from the snapshot when present", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...SNAPSHOT, warnings: ["no_leagues_specified"] }))
    render(<PlatformOsOperatorPanel />)

    fireEvent.change(screen.getByTestId("platform-os-league-ids-input"), { target: { value: "league-1" } })
    fireEvent.click(screen.getByTestId("platform-os-fetch-button"))

    await waitFor(() => {
      expect(screen.getByTestId("platform-os-warnings")).toHaveTextContent("no_leagues_specified")
    })
  })
})
