import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getAdminAccessState: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/adminAuth", () => ({
  getAdminAccessState: mocks.getAdminAccessState,
}))

vi.mock("@/components/admin/V3WeightsPanel", () => ({
  V3WeightsPanel: () => <div data-testid="v3-weights-panel-stub" />,
}))

vi.mock("@/components/admin/UsageAnalyticsPanel", () => ({
  UsageAnalyticsPanel: () => <div data-testid="usage-analytics-panel-stub" />,
}))

describe("league model-admin page authorization", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("redirects unauthenticated users to admin login with a league-scoped return path", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({ status: "unauthenticated", source: "none" })
    const { default: ModelAdminPage } = await import("@/app/leagues/[leagueId]/admin/model/page")

    await expect(
      ModelAdminPage({ params: { leagueId: "league-1" } }),
    ).rejects.toThrow("redirect:/admin-login?next=%2Fleagues%2Fleague-1%2Fadmin%2Fmodel")
  })

  it("renders access denied for authenticated non-admin users and never mounts protected panels", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "forbidden",
      source: "app_session",
      user: { id: "user-1", email: "member@example.com" },
    })
    const { default: ModelAdminPage } = await import("@/app/leagues/[leagueId]/admin/model/page")

    render(await ModelAdminPage({ params: { leagueId: "league-1" } }))

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByTestId("v3-weights-panel-stub")).not.toBeInTheDocument()
    expect(screen.queryByTestId("usage-analytics-panel-stub")).not.toBeInTheDocument()
  })

  it("denies a league commissioner who is not a site admin", async () => {
    // Commissioner status confers no admin access - the canonical gate reports
    // forbidden. See model-admin-authorization-policy.test.ts, which proves this
    // against the real lib/adminAuth rather than this mock.
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "forbidden",
      source: "app_session",
      user: { id: "commish-1", email: "commissioner@example.com", username: "leaguecommish" },
    })
    const { default: ModelAdminPage } = await import("@/app/leagues/[leagueId]/admin/model/page")

    render(await ModelAdminPage({ params: { leagueId: "league-1" } }))

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByTestId("v3-weights-panel-stub")).not.toBeInTheDocument()
    expect(screen.queryByTestId("usage-analytics-panel-stub")).not.toBeInTheDocument()
  })

  it("renders both model admin panels for admins", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "admin",
      source: "app_session",
      user: { id: "admin-1", email: "founder@example.com", role: "admin" },
    })
    const { default: ModelAdminPage } = await import("@/app/leagues/[leagueId]/admin/model/page")

    render(await ModelAdminPage({ params: { leagueId: "league-1" } }))

    expect(screen.getByText("Model Admin")).toBeInTheDocument()
    expect(screen.getByText(/League league-1/)).toBeInTheDocument()
    expect(screen.getByTestId("v3-weights-panel-stub")).toBeInTheDocument()
    expect(screen.getByTestId("usage-analytics-panel-stub")).toBeInTheDocument()
  })
})
