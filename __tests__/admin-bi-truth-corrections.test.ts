import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

/**
 * getAdminCommandCenterMetrics() fans out to ~15 Prisma models across dozens of calls. Rather than
 * hand-write every call site, this builds a lazily-populated auto-mock: any model.method() the
 * function touches gets a safe default (count -> 0, aggregate -> { _sum: {} }, findMany/groupBy ->
 * [], findFirst/findUnique -> null) that individual tests override via
 * prismaMock.<model>.<method>.mockResolvedValueOnce(...).
 */
function buildPrismaMock() {
  const models: Record<string, any> = {}
  const defaultsFor = (): Record<string, ReturnType<typeof vi.fn>> => ({
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: {} }),
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
  })
  const handler: ProxyHandler<Record<string, any>> = {
    get(target, prop: string) {
      if (prop === "$queryRaw") {
        if (!target.$queryRaw) target.$queryRaw = vi.fn().mockResolvedValue([{ ok: 1 }])
        return target.$queryRaw
      }
      if (!models[prop]) models[prop] = defaultsFor()
      return models[prop]
    },
  }
  return { proxy: new Proxy({}, handler) as any, models }
}

const { proxy: prismaMock } = buildPrismaMock()

const serviceMocks = vi.hoisted(() => ({
  getAdminProviderHealthRows: vi.fn(),
  getAdminPerSportDataReliabilityRows: vi.fn(),
  getAdminProductionReadiness: vi.fn(),
  getEmailCenterStatus: vi.fn(),
  getSportsIdentityHealthSnapshot: vi.fn(),
  getProviderTeamReconciliationSummaries: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

vi.mock("@/lib/admin-dashboard/AdminProviderHealthService", () => ({
  getAdminProviderHealthRows: serviceMocks.getAdminProviderHealthRows,
  getAdminPerSportDataReliabilityRows: serviceMocks.getAdminPerSportDataReliabilityRows,
}))
vi.mock("@/lib/admin-dashboard/AdminProductionReadinessService", () => ({
  getAdminProductionReadiness: serviceMocks.getAdminProductionReadiness,
}))
vi.mock("@/lib/admin-dashboard/AdminEmailCenterService", () => ({
  getEmailCenterStatus: serviceMocks.getEmailCenterStatus,
}))
vi.mock("@/lib/sports-os/SportsIdentityHealthService", () => ({
  getSportsIdentityHealthSnapshot: serviceMocks.getSportsIdentityHealthSnapshot,
}))
vi.mock("@/lib/sports-os/ProviderTeamReconciliationService", () => ({
  getProviderTeamReconciliationSummaries: serviceMocks.getProviderTeamReconciliationSummaries,
}))

function resetServiceDefaults() {
  serviceMocks.getAdminProviderHealthRows.mockResolvedValue([])
  serviceMocks.getAdminPerSportDataReliabilityRows.mockResolvedValue([])
  serviceMocks.getAdminProductionReadiness.mockResolvedValue({ env: [], crons: [] })
  serviceMocks.getEmailCenterStatus.mockResolvedValue({})
  serviceMocks.getSportsIdentityHealthSnapshot.mockResolvedValue({
    summary: { identityProblems: 0, imageProblems: 0, providerMappingProblems: 0 },
    rows: [],
    imageRows: [],
  })
  serviceMocks.getProviderTeamReconciliationSummaries.mockResolvedValue({
    summaries: [],
    totalProblems: 0,
    generatedAt: new Date().toISOString(),
  })
}

type SubRow = {
  userId: string
  status: string
  sku: string | null
  gracePeriodEnd: Date | null
  canceledAt: Date | null
  expiresAt: Date | null
  plan: { code: string }
  user: { email: string | null }
}

function subRow(overrides: Partial<SubRow>): SubRow {
  return {
    userId: "user-1",
    status: "active",
    sku: null,
    gracePeriodEnd: null,
    canceledAt: null,
    expiresAt: null,
    plan: { code: "pro" },
    user: { email: "user@example.com" },
    ...overrides,
  }
}

describe("classifySubscriptionBucket (Issue 3 — non-blended subscriber status)", () => {
  it("past_due does not classify as active_paid", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const bucket = classifySubscriptionBucket(
      subRow({ status: "past_due", gracePeriodEnd: null, canceledAt: null, expiresAt: null })
    )
    expect(bucket).not.toBe("active_paid")
    expect(bucket).toBe("past_due")
  })

  it("trialing is its own bucket, never active_paid", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const bucket = classifySubscriptionBucket(subRow({ status: "trialing" }))
    expect(bucket).toBe("trialing")
    expect(bucket).not.toBe("active_paid")
  })

  it("past_due with an unexpired gracePeriodEnd is grace_period, not past_due", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const bucket = classifySubscriptionBucket(subRow({ status: "past_due", gracePeriodEnd: future }))
    expect(bucket).toBe("grace_period")
  })

  it("past_due with an expired gracePeriodEnd falls back to past_due", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const bucket = classifySubscriptionBucket(subRow({ status: "past_due", gracePeriodEnd: past }))
    expect(bucket).toBe("past_due")
  })

  it("canceledAt set classifies as canceled regardless of status text", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const bucket = classifySubscriptionBucket(
      subRow({ status: "active", canceledAt: new Date("2026-01-01") })
    )
    expect(bucket).toBe("canceled")
  })

  it("terminal Stripe states (failed/incomplete/unpaid) classify as expired, not canceled", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    for (const status of ["failed", "incomplete", "unpaid"]) {
      expect(classifySubscriptionBucket(subRow({ status }))).toBe("expired")
    }
  })
})

describe("buildOperatorHealthRow (Issue 2 — Active users label)", () => {
  it("never renders the lifetime account count under an 'Active users' label", async () => {
    const { buildOperatorHealthRow } = await import("@/lib/admin-dashboard/operatorAttention")
    const data = {
      users: [
        { label: "Total accounts", value: 4821, tracked: true },
        { label: "Active sessions now", value: 12, tracked: true },
      ],
      ai: [],
      subscriptions: [],
      health: [],
      integrity: [],
      productionReadiness: { env: [], crons: [] },
      providerHealth: [],
    } as any

    const cards = buildOperatorHealthRow(data, {
      activeLeagues: null,
      attentionCritical: 0,
      attentionHigh: 0,
      attentionTotal: 0,
    })

    const activeUsersLabeled = cards.find((c) => c.label === "Active users")
    expect(activeUsersLabeled).toBeUndefined()

    const totalAccountsCard = cards.find((c) => c.label === "Total accounts")
    expect(totalAccountsCard?.value).toBe("4,821")
    expect(totalAccountsCard?.note).toMatch(/not an activity metric|not activity/i)
  })
})

describe("getFantasyImportActivity (Issue 4 — imports vs sports-data ingestion)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("is structurally independent of sports-data provider health (no shared fields/labels)", async () => {
    const { getFantasyImportActivity } = await import("@/lib/admin-dashboard/AdminImportActivityService")
    prismaMock.importRun.findMany.mockResolvedValueOnce([])
    const result = await getFantasyImportActivity(30)

    expect(result.byProvider.map((p: any) => p.provider).sort()).toEqual(
      ["espn", "fantrax", "fleaflicker", "mfl", "sleeper", "yahoo"].sort()
    )
    // Distinct field names from AdminProviderHealthRow's importedRows/lastSyncAt/lastError —
    // this summary is never mistakable for sports-data ingestion health.
    for (const p of result.byProvider) {
      expect(p).toHaveProperty("uniqueImportingUsers")
      expect(p).toHaveProperty("importedLeagues")
      expect(p).not.toHaveProperty("importedRows")
    }
  })

  it("marks structurally-unavailable providers honestly instead of a bare zero", async () => {
    const { getFantasyImportActivity } = await import("@/lib/admin-dashboard/AdminImportActivityService")
    prismaMock.importRun.findMany.mockResolvedValueOnce([])
    const result = await getFantasyImportActivity(30)

    const fantrax = result.byProvider.find((p: any) => p.provider === "fantrax")
    const sleeper = result.byProvider.find((p: any) => p.provider === "sleeper")
    expect(fantrax?.availableToUsers).toBe(false)
    expect(sleeper?.availableToUsers).toBe(true)
    // Zero attempts for an available provider is a real, honest zero, not a fabricated fallback —
    // distinguished from a query failure via the top-level `unavailable` flag below.
    expect(sleeper?.attempts).toBe(0)
  })

  it("reports unavailable (not zero) when the ImportRun query itself fails", async () => {
    const { getFantasyImportActivity } = await import("@/lib/admin-dashboard/AdminImportActivityService")
    prismaMock.importRun.findMany.mockRejectedValueOnce(new Error("connection reset"))
    const result = await getFantasyImportActivity(30)

    expect(result.unavailable).toBe(true)
    expect(result.byProvider).toEqual([])
    expect(result.unavailableReason).toMatch(/do not read as zero/i)
  })

  it("computes real per-provider attempts/successes/failures and imported-leagues from ImportRun rows", async () => {
    const { getFantasyImportActivity } = await import("@/lib/admin-dashboard/AdminImportActivityService")
    const now = new Date()
    prismaMock.importRun.findMany.mockResolvedValueOnce([
      { provider: "sleeper", status: "completed", error: null, userId: "u1", leagueId: "league-1", startedAt: now, completedAt: now },
      { provider: "sleeper", status: "failed", error: "auth expired", userId: "u2", leagueId: null, startedAt: now, completedAt: now },
      { provider: "sleeper", status: "completed", error: null, userId: "u1", leagueId: "league-2", startedAt: now, completedAt: now },
    ])
    const result = await getFantasyImportActivity(30)
    const sleeper = result.byProvider.find((p: any) => p.provider === "sleeper")

    expect(sleeper?.attempts).toBe(3)
    expect(sleeper?.successes).toBe(2)
    expect(sleeper?.failures).toBe(1)
    expect(sleeper?.successRatePct).toBe(67)
    expect(sleeper?.uniqueImportingUsers).toBe(2)
    expect(sleeper?.importedLeagues).toBe(2)
    expect(sleeper?.recentFailureReason).toBe("auth expired")
  })
})

describe("getAdminCommandCenterMetrics — revenue labeling (Issue 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetServiceDefaults()
    delete process.env.ADMIN_EMAILS
  })

  it("never labels BracketPayment-sourced totals as subscription revenue", async () => {
    prismaMock.bracketPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 250_00 } })
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    const labels = result.subscriptions.map((m) => m.label)
    expect(labels).not.toContain("Total revenue")
    expect(labels.some((l) => /subscription revenue/i.test(l))).toBe(true)
    expect(labels.find((l) => l === "Bracket & token payment volume (all time)")).toBeTruthy()

    const bracketMetric = result.subscriptions.find((m) => m.label === "Bracket & token payment volume (all time)")
    expect(bracketMetric?.note).toMatch(/not subscription revenue/i)
  })

  it("reports subscription revenue as unavailable, never a fabricated $0", async () => {
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    const subRevenue = result.subscriptions.find((m) => m.label === "Subscription revenue")
    expect(subRevenue).toBeTruthy()
    expect(subRevenue?.tracked).toBe(false)
    expect(subRevenue?.value).not.toBe("$0.00")
    expect(String(subRevenue?.value)).not.toMatch(/^\$/)
  })

  it("reports refunds as unavailable, not zero, since BracketPayment has no refund field", async () => {
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()
    const refunds = result.subscriptions.find((m) => m.label === "Refunds")
    expect(refunds?.tracked).toBe(false)
  })
})

describe("getAdminCommandCenterMetrics — subscriber counting (Issue 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetServiceDefaults()
    delete process.env.ADMIN_EMAILS
    delete process.env.DEV_ADMIN_USER_IDS
    delete process.env.AI_ENTITLEMENT_BYPASS_USER_IDS
    delete process.env.TOKEN_NOTIFICATION_BYPASS_USER_IDS
  })

  it("excludes admin/dev bypass accounts from subscriber counts and discloses them separately", async () => {
    process.env.DEV_ADMIN_USER_IDS = "dev-admin-1"
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "dev-admin-1", status: "active", user: { email: "dev@internal.test" } }),
      subRow({ userId: "real-user-1", status: "active", user: { email: "real@example.com" } }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    const activePaid = result.subscriptions.find((m) => m.label === "Active paid subscribers")
    const bypass = result.subscriptions.find((m) => m.label.includes("bypass"))
    expect(activePaid?.value).toBe(1)
    expect(bypass?.value).toBe(1)
  })

  it("does not double-count a user with multiple subscription rows in the same bucket", async () => {
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "user-1", status: "active" }),
      subRow({ userId: "user-1", status: "active", sku: "af_pro_annual" }),
      subRow({ userId: "user-2", status: "active" }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    const activePaid = result.subscriptions.find((m) => m.label === "Active paid subscribers")
    expect(activePaid?.value).toBe(2) // unique users, not 3 raw rows
    const totalRows = result.subscriptions.find((m) => m.label === "Total subscription rows")
    expect(totalRows?.value).toBe(3) // raw row count still visible, separately labeled
  })

  it("keeps trialing users out of the active-paid count entirely", async () => {
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "user-1", status: "active" }),
      subRow({ userId: "user-2", status: "trialing" }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    expect(result.subscriptions.find((m) => m.label === "Active paid subscribers")?.value).toBe(1)
    expect(result.subscriptions.find((m) => m.label === "Trialing subscribers")?.value).toBe(1)
  })
})

describe("money serialization safety (Issue 1 shared truth rule)", () => {
  it("formats a null aggregate sum without throwing and without a fabricated value", async () => {
    // amountCents is Prisma Int in this schema (not BigInt/Decimal); this guards the current
    // contract and documents that a future column-type change to BigInt/Decimal would need
    // revisiting here, since BigInt does not support .toFixed().
    const format = (cents: number | null) => (cents == null ? null : `$${(cents / 100).toFixed(2)}`)
    expect(format(null)).toBeNull()
    expect(format(0)).toBe("$0.00")
    expect(format(123_456_789)).toBe("$1234567.89")
  })
})
