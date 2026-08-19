import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"

import CommissionerCommandCenterSection from "@/components/decision-os/CommissionerCommandCenterSection"

const fetchMock = vi.fn()

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

const LEAGUES = [
  { id: "league-1", name: "Dynasty Warriors" },
  { id: "league-2", name: "Redraft Rebels" },
]

const SNAPSHOT = {
  generatedAt: "2026-07-09T00:00:00.000Z",
  totalLeagues: 2,
  healthyLeagueCount: 1,
  atRiskLeagueCount: 1,
  unavailableLeagueCount: 0,
  totalActiveManagers: 20,
  totalInactiveManagers: 2,
  totalRetentionRiskManagers: 1,
  leagueSummaries: [
    {
      leagueId: "league-1",
      available: true,
      overallStatus: "healthy",
      leagueHealthScore: 82,
      activeManagers: 10,
      inactiveManagers: 0,
      retentionRiskCount: 0,
      urgentActionCount: 0,
      tradeCount: 5,
      waiverClaimCount: 10,
      draftPickCount: 0,
      rosterActivityCount: 3,
    },
    {
      leagueId: "league-2",
      available: true,
      overallStatus: "at_risk",
      leagueHealthScore: 41,
      activeManagers: 10,
      inactiveManagers: 2,
      retentionRiskCount: 1,
      urgentActionCount: 1,
      tradeCount: 1,
      waiverClaimCount: 2,
      draftPickCount: 0,
      rosterActivityCount: 1,
    },
  ],
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
  recentChanges: [],
  warnings: [],
  draftsApproachingCount: 1,
}

describe("CommissionerCommandCenterSection", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows an honest empty state and never fetches when there are no commissioner leagues", () => {
    render(<CommissionerCommandCenterSection commissionerLeagues={[]} onSelectLeague={vi.fn()} />)
    expect(screen.getByText(/Your multi-league overview will appear here/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows the empty state and never fetches in demo mode, even with leagues present", () => {
    render(<CommissionerCommandCenterSection commissionerLeagues={LEAGUES} demoMode onSelectLeague={vi.fn()} />)
    expect(screen.getByText(/Your multi-league overview will appear here/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fetches the command center snapshot and renders every module with real data", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SNAPSHOT))
    render(<CommissionerCommandCenterSection commissionerLeagues={LEAGUES} onSelectLeague={vi.fn()} />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/decision-os/commissioner-command-center",
        expect.objectContaining({ credentials: "same-origin" }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId("command-center-overview")).toBeInTheDocument()
    })
    expect(screen.getByTestId("league-health-ranking")).toBeInTheDocument()
    // Unique, id-based attention-queue testid (PR #185 fix — severity is not unique across items).
    expect(screen.getByTestId("attention-queue-item-league_requires_review:league-2:0")).toHaveTextContent("Redraft Rebels")
    expect(screen.getByTestId("attention-queue-item-league_requires_review:league-2:0")).toHaveTextContent(
      "3 managers at risk of leaving",
    )
    // Phase OS-B6: the standalone "Recent Changes" card was removed (redundant with Today's Brief's
    // own league highlights) — no `recent-changes-*` testid exists on the page anymore.
    expect(screen.queryByTestId("recent-changes-empty")).not.toBeInTheDocument()
    expect(screen.getByTestId("league-switcher-list")).toBeInTheDocument()

    // Phase OS-B3: Today's Brief is composed from the SAME fetched snapshot — zero additional request.
    expect(screen.getByTestId("todays-brief-card")).toBeInTheDocument()
    expect(screen.getByTestId("todays-brief-summary")).toHaveTextContent(
      "1 league needs your attention today. 1 draft approaching.",
    )
    expect(screen.getByTestId("todays-brief-priority-items")).toHaveTextContent("Redraft Rebels")

    // Phase OS-B4: Notification Center is also composed with zero additional request.
    // Phase OS-B5: ...and now routed through the Delivery Adapter Layer (resolveDeliveryPlan) rather
    // than handed to the UI directly — content is unchanged today because the real in_app adapter
    // always delivers everything, but the plan is genuinely in the render path (regression coverage).
    expect(screen.getByTestId("notification-center")).toBeInTheDocument()
    expect(screen.getByTestId("notification-center-item-notification:league_requires_review:league-2:0")).toHaveTextContent(
      "Redraft Rebels",
    )
    expect(screen.getByTestId("notification-center-unread-count")).toHaveTextContent("2") // the signal + the derived daily-brief notification
  })

  it("Phase OS-B3: Today's Brief renders an honest healthy state before the snapshot has loaded, with no extra fetch", () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {})) // never resolves — asserting the pre-fetch render only
    render(<CommissionerCommandCenterSection commissionerLeagues={LEAGUES} onSelectLeague={vi.fn()} />)

    expect(screen.getByTestId("todays-brief-card")).toBeInTheDocument()
    expect(screen.getByTestId("todays-brief-summary")).toHaveTextContent("Every league looks healthy today.")
    // Only the one command-center fetch — Today's Brief never issues its own request.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("league switching: clicking a league in the switcher calls onSelectLeague with its real id", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SNAPSHOT))
    const onSelectLeague = vi.fn()
    render(<CommissionerCommandCenterSection commissionerLeagues={LEAGUES} onSelectLeague={onSelectLeague} />)

    await waitFor(() => {
      expect(screen.getByTestId("league-switcher-item-league-2")).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId("league-switcher-item-league-2"))
    expect(onSelectLeague).toHaveBeenCalledWith("league-2")
    expect(onSelectLeague).toHaveBeenCalledTimes(1)
  })

  it("shows a real error message, not a silent failure, when the fetch fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    render(<CommissionerCommandCenterSection commissionerLeagues={LEAGUES} onSelectLeague={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId("commissioner-command-center-error")).toBeInTheDocument()
    })
  })
})
