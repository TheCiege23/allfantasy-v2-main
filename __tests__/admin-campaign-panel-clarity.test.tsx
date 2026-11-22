import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { CampaignAttributionPanel } from "@/components/admin/CampaignAttributionPanel"

const fetchMock = vi.fn()
const measured = (key: string, label: string, value: number) => ({ key, label, value, status: "confirmed", definition: `${label} event count`, source: "AnalyticsEvent", note: null })
const report = {
  environment: "production",
  window: { days: 30, fromIso: "2026-09-01T00:00:00Z", toIso: "2026-10-01T00:00:00Z" },
  calculatedAtIso: "2026-10-01T00:00:00Z",
  lastEventAtIso: "2026-09-30T00:00:00Z",
  freshness: "delayed",
  sampleSize: 8,
  attributionGrouping: "first_touch",
  conversions: { visitorToSignup: 0.125, signupToActivation: 0, visitorToActivation: 0 },
  summary: [
    measured("landing_viewed", "Landing views", 8),
    measured("signups_completed", "Accounts created", 1),
    measured("dashboard_activated", "Dashboards activated", 0),
    { key: "start_clicked", label: "Start clicked", value: null, status: "not_implemented", definition: "Required stage", source: "—", note: "No emitter on the CTA." },
  ],
  campaigns: [], campaignsTruncated: false, stageInventory: [], errors: [],
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it("leads with measured stages and keeps unmeasured steps separate", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => report })
  render(<CampaignAttributionPanel />)
  await screen.findByText(/Landing, signup, and activation are measured/)
  expect(screen.getByText(/1 other funnel step has no emitter/)).toBeInTheDocument()
  const activationCard = screen.getByText("Dashboards activated", { selector: "div" }).closest(".rounded-2xl")
  expect(activationCard).not.toBeNull()
  expect(within(activationCard as HTMLElement).getByText("0")).toBeInTheDocument()
  const unmeasured = screen.getByText(/View 1 unmeasured funnel steps/).closest("details")
  expect(unmeasured).not.toHaveAttribute("open")
  fireEvent.click(screen.getByText(/View 1 unmeasured funnel steps/))
  expect(unmeasured).toHaveAttribute("open")
  expect(screen.getByText("Start clicked")).toBeInTheDocument()
})
