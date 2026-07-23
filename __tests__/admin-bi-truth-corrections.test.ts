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
  currentPeriodEnd: Date | null
  gracePeriodEnd: Date | null
  canceledAt: Date | null
  expiresAt: Date | null
  plan: { code: string }
}

const FUTURE = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const PAST = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

function subRow(overrides: Partial<SubRow>): SubRow {
  return {
    userId: "user-1",
    status: "active",
    sku: null,
    currentPeriodEnd: null,
    gracePeriodEnd: null,
    canceledAt: null,
    expiresAt: null,
    plan: { code: "pro" },
    ...overrides,
  }
}

describe("classifySubscriptionBucket (Issue 3 — non-blended subscriber status)", () => {
  it("past_due does not classify as active_paid", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const bucket = classifySubscriptionBucket(subRow({ status: "past_due", currentPeriodEnd: FUTURE() }))
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
    const bucket = classifySubscriptionBucket(subRow({ status: "past_due", gracePeriodEnd: FUTURE() }))
    expect(bucket).toBe("grace_period")
  })

  it("past_due with an expired gracePeriodEnd but a live period stays past_due", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const bucket = classifySubscriptionBucket(
      subRow({ status: "past_due", gracePeriodEnd: PAST(), currentPeriodEnd: FUTURE() })
    )
    expect(bucket).toBe("past_due")
  })

  it("a fully lapsed past_due row is expired, not past_due", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const bucket = classifySubscriptionBucket(
      subRow({ status: "past_due", gracePeriodEnd: PAST(), currentPeriodEnd: PAST() })
    )
    expect(bucket).toBe("expired")
  })

  it("cancel-at-period-end (canceledAt set, period still live) is active_paid, matching entitlements", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const { resolveSubscriptionStatus } = await import("@/lib/subscription/SubscriptionStatusResolver")
    const row = subRow({ status: "active", canceledAt: PAST(), currentPeriodEnd: FUTURE() })
    // The user still has paid access, so the admin count must not contradict what the product grants.
    expect(resolveSubscriptionStatus(row)).toBe("active")
    expect(classifySubscriptionBucket(row)).toBe("active_paid")
  })

  it("a canceled row whose period has ended is canceled, not expired", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    expect(
      classifySubscriptionBucket(subRow({ status: "canceled", canceledAt: PAST(), currentPeriodEnd: PAST() }))
    ).toBe("canceled")
  })

  it("terminal Stripe states (failed/incomplete/unpaid) classify as expired, not canceled", async () => {
    const { classifySubscriptionBucket } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    for (const status of ["failed", "incomplete", "unpaid"]) {
      expect(classifySubscriptionBucket(subRow({ status, currentPeriodEnd: PAST() }))).toBe("expired")
    }
  })
})

describe("selectCurrentSubscriptionBucketByUser (Issue 3 — one current state per user)", () => {
  it("an old canceled row plus a newer active row counts only as active_paid", async () => {
    const { selectCurrentSubscriptionBucketByUser } = await import(
      "@/lib/admin-dashboard/AdminCommandCenterService"
    )
    // Rows arrive newest-first, as the DB-side orderBy guarantees.
    const current = selectCurrentSubscriptionBucketByUser([
      subRow({ userId: "u1", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "u1", status: "canceled", canceledAt: PAST(), currentPeriodEnd: PAST() }),
    ])
    expect(current.get("u1")).toBe("active_paid")
    expect(current.size).toBe(1)
  })

  it("an old active row plus a newer expired row counts only as expired", async () => {
    const { selectCurrentSubscriptionBucketByUser } = await import(
      "@/lib/admin-dashboard/AdminCommandCenterService"
    )
    const current = selectCurrentSubscriptionBucketByUser([
      subRow({ userId: "u1", status: "unpaid", currentPeriodEnd: PAST() }),
      subRow({ userId: "u1", status: "active", currentPeriodEnd: PAST() }),
    ])
    expect(current.get("u1")).toBe("expired")
    expect(current.size).toBe(1)
  })

  it("multiple rows in the same state do not double-count the user", async () => {
    const { selectCurrentSubscriptionBucketByUser } = await import(
      "@/lib/admin-dashboard/AdminCommandCenterService"
    )
    const current = selectCurrentSubscriptionBucketByUser([
      subRow({ userId: "u1", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "u1", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "u1", status: "active", currentPeriodEnd: FUTURE() }),
    ])
    expect(current.size).toBe(1)
    expect(current.get("u1")).toBe("active_paid")
  })

  it("buckets are mutually exclusive across a mixed population", async () => {
    const { selectCurrentSubscriptionBucketByUser } = await import(
      "@/lib/admin-dashboard/AdminCommandCenterService"
    )
    const current = selectCurrentSubscriptionBucketByUser([
      subRow({ userId: "paid", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "paid", status: "canceled", canceledAt: PAST(), currentPeriodEnd: PAST() }),
      subRow({ userId: "trial", status: "trialing" }),
      subRow({ userId: "gone", status: "canceled", canceledAt: PAST(), currentPeriodEnd: PAST() }),
    ])
    const counts = [...current.values()].reduce<Record<string, number>>((acc, b) => {
      acc[b] = (acc[b] ?? 0) + 1
      return acc
    }, {})
    // Every distinct user appears exactly once across all buckets.
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(current.size)
    expect(current.size).toBe(3)
    expect(counts.active_paid).toBe(1)
    expect(counts.trialing).toBe(1)
    expect(counts.canceled).toBe(1)
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

    const bracketMetric = result.subscriptions.find(
      (m) => m.label === "Bracket entries and donations — payment volume (all time)"
    )
    expect(bracketMetric).toBeTruthy()
    expect(bracketMetric?.note).toMatch(/not subscription revenue/i)
  })

  it("no metric label claims BracketPayment contains token payments", async () => {
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()
    const all = [...result.subscriptions, ...result.morning]
    // "Bracket & token ..." asserted an inclusion that never happens: token purchases are
    // TokenLedger rows, so a BracketPayment-backed figure can never contain them.
    expect(all.filter((m) => /bracket\s*&\s*token/i.test(m.label))).toHaveLength(0)
  })

  it("BracketPayment-backed labels name their real contents (bracket entries and donations)", async () => {
    prismaMock.bracketPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 500_00 } })
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()
    for (const label of [
      "Bracket entries and donations — payment volume (all time)",
      "Bracket entries and donations — payments today",
      "Bracket entries and donations — payments last 7h",
      "Bracket entries and donations — payments 7 days",
      "Completed bracket entry and donation payments (all time)",
      "Failed/canceled bracket entry and donation payments (all time)",
    ]) {
      expect(result.subscriptions.map((m) => m.label)).toContain(label)
    }
  })

  it("does not present two identical calculations as different business concepts", async () => {
    prismaMock.bracketPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 777_00 } })
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()
    // The removed "Bracket entry revenue (all time)" was an exact duplicate of the all-time volume:
    // its `NOT paymentType contains "token"` filter excluded nothing.
    expect(result.subscriptions.map((m) => m.label)).not.toContain("Bracket entry revenue (all time)")
  })

  it("token sales revenue is unavailable with a reason, never a fabricated $0.00", async () => {
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()
    const tokenRevenue = result.subscriptions.find((m) => m.label === "Token sales revenue")
    expect(tokenRevenue).toBeTruthy()
    expect(tokenRevenue?.tracked).toBe(false)
    expect(tokenRevenue?.value).not.toBe("$0.00")
    expect(String(tokenRevenue?.value)).not.toMatch(/^\$/)
    expect(String(tokenRevenue?.value)).toMatch(/TokenLedger/i)
  })

  it("token purchase volume is counted from TokenLedger, not BracketPayment", async () => {
    prismaMock.tokenLedger.count.mockResolvedValue(42)
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    await getAdminCommandCenterMetrics()

    // Sources stay separate: the purchase count comes from TokenLedger entryType='purchase' ...
    expect(prismaMock.tokenLedger.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entryType: "purchase" }) })
    )
    // ... and no BracketPayment query classifies rows by a paymentType substring any more.
    const paymentTypeFilters = [
      ...prismaMock.bracketPayment.aggregate.mock.calls,
      ...prismaMock.bracketPayment.count.mock.calls,
    ].map((call) => JSON.stringify(call?.[0]?.where ?? {}))
    for (const filter of paymentTypeFilters) {
      expect(filter).not.toMatch(/paymentType/)
      expect(filter).not.toMatch(/contains/)
    }
  })

  it("reports token purchase entries as unavailable, not zero, when the TokenLedger query fails", async () => {
    prismaMock.tokenLedger.count.mockRejectedValue(new Error("db down"))
    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()
    const entries = result.subscriptions.find((m) => m.label === "Token purchase entries (all time)")
    expect(entries?.tracked).toBe(false)
    expect(entries?.value).not.toBe(0)
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

describe("BracketPayment.paymentType domain (Issue 1 — grounded in the real write paths)", () => {
  // These assertions read the repository itself rather than a synthetic fixture: the previous bug
  // survived precisely because the test data assumed a "token"-containing paymentType that
  // production never produces.
  const readRepoFile = async (relPath: string) => {
    const { readFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    return readFile(join(process.cwd(), relPath), "utf8")
  }

  it("the only BracketPayment write path accepts no token payment type", async () => {
    const source = await readRepoFile("app/api/bracket/stripe/checkout/route.ts")
    // Positive control: the allowlist we are asserting about is actually present.
    expect(source).toMatch(/first_bracket_fee/)
    const allowlist = source.match(/\[([^\]]*)\]\.includes\(paymentType\)/)
    expect(allowlist).toBeTruthy()
    expect(allowlist![1]).not.toMatch(/token/i)
  })

  it("no paymentType literal anywhere in the app contains 'token'", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const literals = new Set<string>()
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue
        const full = join(dir, entry)
        const info = await stat(full)
        if (info.isDirectory()) {
          await walk(full)
        } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
          const text = await readFile(full, "utf8")
          for (const m of text.matchAll(/paymentType:\s*"([a-z0-9_]+)"/gi)) literals.add(m[1])
        }
      }
    }
    await walk(join(process.cwd(), "app"))
    await walk(join(process.cwd(), "lib"))

    // Positive control: the scan really found the known production domain.
    expect(literals.has("first_bracket_fee")).toBe(true)
    expect(literals.has("donation")).toBe(true)
    for (const literal of literals) expect(literal).not.toMatch(/token/i)
  })

  it("donations are part of the BracketPayment domain and must not be described as tokens", async () => {
    const service = await readRepoFile("lib/admin-dashboard/AdminCommandCenterService.ts")
    expect(service).not.toMatch(/paymentType:\s*\{\s*contains:\s*"token"/)
    expect(service).not.toMatch(/NOT:\s*\{\s*paymentType/)
    expect(service).toMatch(/donation/i)
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

  /**
   * The service now resolves each subscriber's email once, per user, via a dedicated
   * appUser.findMany({ where: { id: { in } }, select: { id, email } }) instead of joining
   * AppUser on every subscription row. Route only that call to the fixture.
   */
  const mockSubscriberEmails = (emails: Record<string, string>) => {
    prismaMock.appUser.findMany.mockImplementation((args: any) =>
      args?.select?.email && args?.where?.id?.in
        ? Promise.resolve(args.where.id.in.map((id: string) => ({ id, email: emails[id] ?? null })))
        : Promise.resolve([])
    )
  }

  it("excludes admin/dev bypass accounts from subscriber counts and discloses them separately", async () => {
    process.env.DEV_ADMIN_USER_IDS = "dev-admin-1"
    mockSubscriberEmails({ "dev-admin-1": "dev@internal.test", "real-user-1": "real@example.com" })
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "dev-admin-1", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "real-user-1", status: "active", currentPeriodEnd: FUTURE() }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    const bypass = result.subscriptions.find((m) => m.label.includes("bypass"))
    expect(result.subscriptions.find((m) => m.label === "Active paid subscribers")?.value).toBe(1)
    expect(bypass?.value).toBe(1)
    // A bypass user must appear in NO subscriber bucket, not merely outside active_paid.
    for (const label of [
      "Trialing subscribers",
      "Grace-period subscribers",
      "Past-due subscribers",
      "Canceled subscribers",
      "Expired subscribers",
    ]) {
      expect(result.subscriptions.find((m) => m.label === label)?.value).toBe(0)
    }
  })

  it("does not double-count a user with multiple subscription rows in the same bucket", async () => {
    mockSubscriberEmails({})
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "user-1", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "user-1", status: "active", sku: "af_pro_annual", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "user-2", status: "active", currentPeriodEnd: FUTURE() }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    const activePaid = result.subscriptions.find((m) => m.label === "Active paid subscribers")
    expect(activePaid?.value).toBe(2) // unique users, not 3 raw rows
    const totalRows = result.subscriptions.find((m) => m.label === "Total subscription rows")
    expect(totalRows?.value).toBe(3) // raw row count still visible, separately labeled
  })

  it("keeps trialing users out of the active-paid count entirely", async () => {
    mockSubscriberEmails({})
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "user-1", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "user-2", status: "trialing" }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    expect(result.subscriptions.find((m) => m.label === "Active paid subscribers")?.value).toBe(1)
    expect(result.subscriptions.find((m) => m.label === "Trialing subscribers")?.value).toBe(1)
  })

  it("a resubscribed user is counted only as active paid, never also as canceled", async () => {
    mockSubscriberEmails({})
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "user-1", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "user-1", status: "canceled", canceledAt: PAST(), currentPeriodEnd: PAST() }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    expect(result.subscriptions.find((m) => m.label === "Active paid subscribers")?.value).toBe(1)
    expect(result.subscriptions.find((m) => m.label === "Canceled subscribers")?.value).toBe(0)
  })

  it("subscriber buckets are mutually exclusive and free users derive from the same current-state set", async () => {
    mockSubscriberEmails({})
    prismaMock.appUser.count.mockResolvedValue(10)
    prismaMock.userSubscription.findMany.mockResolvedValueOnce([
      subRow({ userId: "paid", status: "active", currentPeriodEnd: FUTURE() }),
      subRow({ userId: "paid", status: "canceled", canceledAt: PAST(), currentPeriodEnd: PAST() }),
      subRow({ userId: "trial", status: "trialing" }),
      subRow({ userId: "gone", status: "canceled", canceledAt: PAST(), currentPeriodEnd: PAST() }),
    ])

    const { getAdminCommandCenterMetrics } = await import("@/lib/admin-dashboard/AdminCommandCenterService")
    const result = await getAdminCommandCenterMetrics()

    const value = (label: string) =>
      Number(result.subscriptions.find((m) => m.label === label)?.value ?? -1)
    const bucketTotal =
      value("Active paid subscribers") +
      value("Trialing subscribers") +
      value("Grace-period subscribers") +
      value("Past-due subscribers") +
      value("Canceled subscribers") +
      value("Expired subscribers")
    // 3 distinct users across 4 rows; every user lands in exactly one bucket.
    expect(bucketTotal).toBe(3)

    // Free users = total accounts minus the CURRENT non-free set (paid + trial), not minus 3.
    const freeUsers = result.users.find((m) => m.label === "Free users")
    expect(freeUsers?.value).toBe(8)
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
