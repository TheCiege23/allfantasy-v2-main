import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getAdminAccessState: vi.fn(),
  getAdminCommandCenterMetrics: vi.fn(),
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

vi.mock("@/lib/admin-dashboard/AdminCommandCenterService", () => ({
  getAdminCommandCenterMetrics: mocks.getAdminCommandCenterMetrics,
}))

function metricsFixture() {
  return {
    generatedAt: "2026-06-04T12:00:00.000Z",
    morning: [
      { label: "New signups", value: 1, tracked: true },
      { label: "AI cost yesterday", value: "Not tracked yet", tracked: false },
    ],
    users: [
      { label: "Total accounts", value: 4, tracked: true },
      { label: "Active users", value: "Not tracked yet", tracked: false },
    ],
    subscriptions: [{ label: "MRR estimate", value: "Not tracked yet", tracked: false }],
    tokens: [{ label: "Token balances total", value: 1000, tracked: true }],
    ai: [{ label: "Chimmy replies", value: 3, tracked: true }],
    worldCup: [{ label: "World Cup pools", value: 2, tracked: true }],
    health: [{ label: "Database", value: "healthy", tracked: true }],
    traffic: [{ label: "Analytics events today", value: 8, tracked: true }],
    integrity: [{ label: "Failed sync jobs 24h", value: 0, tracked: true }],
    dataQuality: [{ label: "Provider env gaps", value: 1, tracked: true }],
    productionReadiness: {
      env: [
        {
          id: "database",
          category: "Platform",
          label: "Database",
          status: "configured",
          severity: "critical",
          required: "DATABASE_URL",
          note: "Required.",
        },
      ],
      crons: [
        {
          id: "world-cup-official",
          category: "World Cup",
          label: "Official teams/fixtures/standings/live sync",
          status: "configured",
          schedule: "/api/brackets/world-cup/cron/sync?job=live (*/5 * * * *)",
          configuredPaths: ["/api/brackets/world-cup/cron/sync?job=live (*/5 * * * *)"],
          missing: [],
          recommended: "Live every 5m.",
          note: "Cron ready.",
        },
      ],
      trafficLocations: [
        {
          label: "Atlanta, Georgia, United States",
          country: "United States",
          region: "Georgia",
          city: "Atlanta",
          visits: 5,
          visitors: 2,
        },
      ],
      trafficNotes: ["Raw IPs are not rendered."],
    },
    emailStatus: {
      configured: false,
      missingEnv: ["RESEND_API_KEY"],
      senderConfigured: false,
      totalUsersWithEmail: 4,
      productUpdateOptOuts: 1,
      unsubscribed: 0,
      pendingEmailOutbox: 0,
      recentBroadcasts: 0,
      recentProviderFailures: 0,
      lastSendAt: null,
      lastError: null,
      audiences: [{ id: "all", label: "All signed-up users", description: "All users." }],
      /*
       * The curated SEGMENT_PANEL_AUDIENCES subset, not the full audience list.
       * EmailSegmentsPanel seeds its selected audience from `segments[0]`, so an
       * absent key throws on first render exactly the way `waitlist` did.
       */
      segments: [
        { id: "world_cup_unfinalized", label: "Unfinalized World Cup brackets", description: "Incomplete entries.", count: 3 },
        { id: "world_cup_pool_creators", label: "World Cup pool creators", description: "Created a pool.", count: 2 },
        { id: "paying", label: "Paying users", description: "Subscription or payment.", count: 1 },
        { id: "win_back", label: "Win-back — lapsed free users", description: "No recent login.", count: 0 },
      ],
    },
    sportsOperatingSystem: {
      generatedAt: "2026-06-04T12:00:00.000Z",
      summary: { ready: 1, partial: 3, missing: 2 },
      biggestDataHoles: ["News incomplete for: MLB"],
      identityFindings: [
        {
          id: "identity",
          label: "Canonical player/team identity",
          status: "partial",
          evidence: ["Some identity rows exist."],
          gaps: ["MLB: players incomplete"],
          recommendation: "Use canonical identity before AI answers.",
        },
      ],
      historicalDataFindings: [
        {
          id: "history",
          label: "Historical sports data cache",
          status: "partial",
          evidence: ["Some stats exist."],
          gaps: ["Player stats incomplete"],
          recommendation: "Import stats before career-trend answers.",
        },
      ],
      imageLogoFindings: [
        {
          id: "images",
          label: "Player headshots and team logos",
          status: "partial",
          evidence: ["Some player rows exist."],
          gaps: ["Broken-image audit missing"],
          recommendation: "Add image audit.",
        },
      ],
      fantasyValueEngine: [
        {
          id: "value",
          label: "Fantasy Value Engine",
          status: "partial",
          evidence: ["Trade tool exists."],
          gaps: ["Unified value missing"],
          recommendation: "Promote engines behind one value contract.",
        },
      ],
      tradeAnalyzer: [
        {
          id: "trade",
          label: "Trade Analyzer",
          status: "ready",
          evidence: ["Tool active."],
          gaps: [],
          recommendation: "Keep route grounded.",
        },
      ],
      draftAdvisor: [
        {
          id: "draft",
          label: "Draft Advisor",
          status: "partial",
          evidence: ["Draft room exists."],
          gaps: ["ADP readiness missing"],
          recommendation: "Use live draft brain when data is fresh.",
        },
      ],
      commissionerCopilot: [
        {
          id: "commissioner",
          label: "Commissioner Copilot",
          status: "partial",
          evidence: ["AI commissioner exists."],
          gaps: ["Reports incomplete"],
          recommendation: "Gate advanced reports.",
        },
      ],
      bracketIntelligence: [
        {
          id: "bracket",
          label: "World Cup / bracket intelligence",
          status: "partial",
          evidence: ["World Cup cache exists."],
          gaps: ["Future brackets missing"],
          recommendation: "Use cache-first fixtures.",
        },
      ],
      dataFreshness: [
        {
          id: "freshness",
          label: "Data freshness engine",
          status: "partial",
          evidence: ["lastSyncedAt exists."],
          gaps: ["Some stale rows"],
          recommendation: "Refuse missing exact facts.",
        },
      ],
      sports: [
        {
          id: "nfl",
          label: "NFL",
          identityStatus: "partial",
          historicalStatus: "partial",
          currentFactsStatus: "partial",
          imageLogoStatus: "partial",
          aiGroundingStatus: "partial",
          missingData: ["News"],
          lastSyncedAt: null,
        },
      ],
      leagueFormats: [
        {
          id: "dynasty",
          label: "Dynasty",
          supportedSports: ["NFL"],
          deterministicFeatures: ["scoring"],
          premiumAiFeatures: ["dynasty_trade_advice"],
          status: "partial",
          commissionerValue: "Premium AI should be gated.",
        },
      ],
      chimmyIntentRoutes: [
        {
          intent: "trade",
          targetEngine: "Trade Analyzer",
          status: "ready",
          requiredData: ["identity"],
          tokenPolicy: "No charge when data unavailable.",
          note: "Tracked.",
        },
      ],
      remainingGaps: ["Weather engine not proven."],
    },
    sportsIdentityHealth: {
      generatedAt: "2026-06-04T12:00:00.000Z",
      summary: {
        sportsAudited: 1,
        totalPlayers: 900,
        totalTeams: 32,
        identityProblems: 3,
        imageProblems: 4,
        providerMappingProblems: 2,
        readySports: 0,
        partialSports: 1,
        missingSports: 0,
      },
      rows: [
        {
          id: "nfl",
          sport: "NFL",
          label: "NFL",
          playerCount: 900,
          teamCount: 32,
          canonicalIdentityCount: 850,
          playersMissingProviderIds: 1,
          playersMissingTeam: 1,
          playersMissingPosition: 0,
          playersMissingStatus: 0,
          duplicatePlayerNameGroups: 1,
          duplicateTeamIdentityGroups: 0,
          duplicateProviderMappingGroups: 0,
          unmappedProviderPlayers: 2,
          unmappedProviderTeams: 0,
          inactiveOrUnknownPlayers: 0,
          activeStatusTeamMismatches: 0,
          teamMappingMismatches: 0,
          status: "partial",
          topProblems: ["Missing provider ids: 1"],
        },
      ],
      imageRows: [
        {
          id: "nfl",
          sport: "NFL",
          label: "NFL",
          playersMissingHeadshots: 3,
          teamsMissingLogos: 1,
          duplicateHeadshotGroups: 0,
          duplicateLogoGroups: 0,
          invalidHeadshotUrlPatterns: 0,
          invalidLogoUrlPatterns: 0,
          status: "partial",
          topProblems: ["Missing headshots: 3"],
        },
      ],
      providerRows: [
        {
          id: "nfl:sleeper",
          sport: "NFL",
          label: "NFL",
          provider: "Sleeper",
          providerPlayerRows: 10,
          mappedPlayerIds: 8,
          unmappedProviderPlayers: 2,
          providerTeamRows: 32,
          mappedTeamRows: 32,
          unmappedProviderTeams: 0,
          duplicatePlayerMappingGroups: 0,
          duplicateTeamMappingGroups: 0,
          status: "partial",
        },
      ],
      topProblems: [
        {
          id: "nfl:missing-headshots",
          sport: "NFL",
          label: "NFL",
          severity: "medium",
          category: "image",
          message: "Players missing usable headshot URLs.",
          count: 3,
          recommendation: "Backfill headshots.",
        },
      ],
    },
    providerTeamReconciliation: {
      generatedAt: "2026-06-04T12:00:00.000Z",
      totalProblems: 2,
      summaries: [
        {
          sport: "NFL",
          provider: "Sleeper",
          providerTeamCount: 32,
          normalizedTeamCount: 32,
          mappedTeamCount: 31,
          exactCodeMatches: 30,
          aliasMatches: 1,
          unresolvedProviderTeams: ["JAX"],
          unresolvedNormalizedTeams: [],
          conflictingMatches: [],
          duplicateProviderCodes: [],
          duplicateNormalizedAliases: [],
          notes: ["One alias still unresolved"],
        },
      ],
    },
    providerHealth: [
      {
        id: "api_football_world_cup",
        name: "API-Football / API-Sports World Cup",
        category: "World Cup soccer",
        status: "missing_env",
        configured: false,
        envVars: ["API_SPORTS_KEY"],
        dataCategories: ["teams", "fixtures"],
        consumedBy: ["World Cup sync cron"],
        storage: ["world_cup_official_fixtures"],
        requestCount24h: 0,
        avgLatencyMs24h: null,
        rateLimit: "Not tracked yet",
        importedRows: 0,
        lastSyncAt: null,
        lastError: null,
        costProtection: ["server-only provider client"],
        note: "Missing provider key.",
      },
    ],
    usersSearch: [],
    activeWorldCupPools: [],
    recentUsers: [
      {
        id: "user-1",
        username: "TheCiege26",
        emailMasked: "th***@example.com",
        createdAt: "2026-06-04T11:00:00.000Z",
        subscriptionStatus: "active",
        tokenBalance: 1000,
      },
    ],
    /*
     * Populated rather than zeroed: an empty summary satisfies the type while
     * taking only the "no signups yet" and "No waitlist signups recorded."
     * branches, leaving the month chips, the source breakdowns and the row
     * table — the parts the panel exists to show — unrendered and so untested.
     * Two rows against a total of 4 also renders the "most recent of N"
     * footer, and one confirmed plus one bare row covers both badge branches
     * and the name/source/campaign fallbacks.
     */
    waitlist: {
      total: 4,
      confirmed: 2,
      unconfirmed: 2,
      firstAt: "2026-05-18T14:05:00.000Z",
      lastAt: "2026-06-02T09:30:00.000Z",
      last30Days: 1,
      bySource: [
        { source: "landing", count: 3 },
        { source: "referral", count: 1 },
      ],
      byUtmSource: [
        { source: "newsletter", count: 2 },
        { source: "(none)", count: 2 },
      ],
      byMonth: [
        { month: "2026-05", count: 3 },
        { month: "2026-06", count: 1 },
      ],
      recent: [
        {
          email: "dynasty-fan@example.com",
          name: "Dynasty Fan",
          createdAt: "2026-06-02T09:30:00.000Z",
          confirmed: true,
          source: "landing",
          utmSource: "newsletter",
          utmCampaign: "june-beta",
        },
        {
          email: "quiet-signup@example.com",
          name: null,
          createdAt: "2026-05-18T14:05:00.000Z",
          confirmed: false,
          source: null,
          utmSource: null,
          utmCampaign: null,
        },
      ],
    },
    recentSubscriptions: [],
    recentPayments: [],
    recentTokenActivity: [],
    leaguesByPlatform: [
      { platform: "sleeper", label: "Sleeper", count: 227 },
      { platform: "espn", label: "ESPN", count: 5 },
    ],
  }
}

describe("/admin page render states", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("redirects unauthenticated users to admin login", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({ status: "unauthenticated", source: "none" })
    const { default: AdminPage } = await import("@/app/admin/page")

    await expect(AdminPage({ searchParams: {} })).rejects.toThrow("redirect:/admin-login?next=/admin")
    expect(mocks.getAdminCommandCenterMetrics).not.toHaveBeenCalled()
  })

  it("renders access denied for authenticated non-admin users", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "forbidden",
      source: "app_session",
      user: { id: "user-1", email: "member@example.com" },
    })
    const { default: AdminPage } = await import("@/app/admin/page")

    render(await AdminPage({ searchParams: {} }))

    expect(screen.getByRole("heading", { name: /access denied/i })).toBeInTheDocument()
    expect(mocks.getAdminCommandCenterMetrics).not.toHaveBeenCalled()
  })

  it("renders the command center for admins", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "admin",
      source: "app_session",
      user: { id: "admin-1", email: "founder@example.com", role: "admin" },
    })
    mocks.getAdminCommandCenterMetrics.mockResolvedValueOnce(metricsFixture())
    const { default: AdminPage } = await import("@/app/admin/page")

    render(await AdminPage({ searchParams: { q: "ciege" } }))

    expect(screen.getByRole("heading", { name: /command center/i })).toBeInTheDocument()
    expect(screen.getByTestId("admin-exit-button")).toHaveAttribute("href", "/dashboard")
    // Plural since the 29a overview strip: buildPeerGroups repeats the users,
    // traffic, subscriptions, tokens, morning, health and integrity metrics
    // above the sections that also render them, so a users label is on the
    // page twice. "World Cup pools" below is in no peer group and stays singular.
    expect(screen.getAllByText("Total accounts").length).toBeGreaterThan(0)
    expect(screen.getByText("World Cup pools")).toBeInTheDocument()
    expect(screen.getAllByText(/Provider Health/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Production Env/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Traffic \/ Visitors/i)).toBeInTheDocument()
    /*
     * Renamed from "Email Notifications" to "Email Center — send a broadcast".
     * Not cosmetic: the panel IS the mass-email tool (11 audiences, compose,
     * test-send, confirm), and it sat collapsed behind a title that read like a
     * settings toggle, so the operator did not know the capability existed. The
     * assertion tracks the copy because the copy is the fix.
     */
    expect(screen.getByText(/Email Center/i)).toBeInTheDocument()
    expect(screen.getByText(/Sports OS \/ Chimmy Brain/i)).toBeInTheDocument()
    expect(screen.getByText(/Sports OS Identity/i)).toBeInTheDocument()
    expect(screen.getByText(/Provider mapping counts/i)).toBeInTheDocument()
    expect(screen.getAllByText("Sleeper").length).toBeGreaterThan(0)
    expect(screen.getByText(/Integrity \/ Fraud/i)).toBeInTheDocument()
    expect(screen.getByText("API-Football / API-Sports World Cup")).toBeInTheDocument()
    // The panel whose fixture gap made every assertion below it dead. Asserting
    // a row, not just the heading, so a fixture that empties `recent` and falls
    // back to "No waitlist signups recorded." still fails here.
    expect(screen.getByText(/Early-access waitlist/i)).toBeInTheDocument()
    expect(screen.getByText("dynasty-fan@example.com")).toBeInTheDocument()
    expect(screen.getByText(/Recent Users/i)).toBeInTheDocument()
    // P0-1: the Closed-Beta Invitations panel renders on the healthy admin page.
    expect(screen.getByText(/Closed-Beta Invitations/i)).toBeInTheDocument()
    expect(mocks.getAdminCommandCenterMetrics).toHaveBeenCalledWith("ciege")
  })

  it("renders a recovery shell when admin metrics fail to load", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "admin",
      source: "admin_session",
      user: { id: "admin-1", email: "founder@example.com", role: "admin" },
    })
    mocks.getAdminCommandCenterMetrics.mockRejectedValueOnce(
      new Error("production metrics exploded"),
    )
    const { default: AdminPage } = await import("@/app/admin/page")

    render(await AdminPage({ searchParams: {} }))

    expect(
      screen.getByRole("heading", {
        name: /the admin shell loaded, but the data pipeline failed/i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/production metrics exploded/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /open production health/i })).toHaveAttribute(
      "href",
      "/admin/production-health",
    )
    // P0-1 SSR RESILIENCE: an unrelated admin data-loader failure must NOT hide the
    // Closed-Beta Invitations controls — an authenticated admin can still issue invites.
    expect(screen.getByText(/Closed-Beta Invitations/i)).toBeInTheDocument()
  })
})
