import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { HighlightAnalyticsPanel } from "@/components/admin/HighlightAnalyticsPanel"

const fetchMock = vi.fn()
const report = {
  until: "2026-10-12T00:00:00Z",
  lastEventAt: null,
  surfaces: [],
  returns: { cohort: 0, matured: 0, pending: 0, returned: 0, scheduledDays: 0, rate: null, status: "no_data" },
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it("explains no observations without fabricating an availability or return rate", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => report })
  render(<HighlightAnalyticsPanel />)
  await screen.findByText(/No highlight views have been observed/)
  expect(screen.getByText(/No game-day return rate yet/)).toBeInTheDocument()
  expect(screen.queryByText(/0%/)).toBeNull()
  expect(screen.getByText(/How these measurements work/)).toBeInTheDocument()
})

it("distinguishes pending cohorts from missing schedules", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({
    ...report,
    surfaces: [{ surface: "my_team", views: 2, users: 2, withClips: 1, loadViews: 0, readyViews: 0, failedViews: 0, empty: 1, unavailable: 0, errors: 0, sourceViews: 0, availabilityRate: 0.5, loadRate: 0, embedSuccessRate: null }],
    returns: { ...report.returns, cohort: 4, pending: 4, status: "pending" },
  }) })
  render(<HighlightAnalyticsPanel />)
  await screen.findByText(/Game-day return is pending/)
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...report, returns: { ...report.returns, cohort: 4, matured: 4, status: "schedule_unavailable" } }) })
  fireEvent.click(screen.getByRole("button", { name: "Refresh report" }))
  await screen.findByText(/Game-day return is unavailable/)
})

it("shows query errors without fake data and supports retry", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false })
  render(<HighlightAnalyticsPanel />)
  await screen.findByRole("alert")
  expect(screen.queryByText(/No highlight views/)).toBeNull()
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => report })
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  await screen.findByText(/No highlight views have been observed/)
})
