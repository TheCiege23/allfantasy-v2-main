import { prisma } from "@/lib/prisma"
import {
  getAdminPerSportDataReliabilityRows,
  getAdminProviderHealthRows,
  type AdminSportDataReliabilityRow,
  type AdminProviderHealthRow,
} from "@/lib/admin-dashboard/AdminProviderHealthService"
import {
  getChimmySportReadiness,
  getDashboardAiToolAvailability,
  getSportImportMatrix,
  type ChimmySportReadiness,
  type DashboardAiToolAvailability,
  type SportImportMatrixRow,
} from "@/lib/admin-dashboard/SportImportMatrixService"
import {
  getAdminProductionReadiness,
  type AdminProductionReadiness,
} from "@/lib/admin-dashboard/AdminProductionReadinessService"
import {
  getEmailCenterStatus,
  type AdminEmailStatus,
} from "@/lib/admin-dashboard/AdminEmailCenterService"
import {
  buildSportsOperatingSystemAudit,
  type SportsOperatingSystemAudit,
} from "@/lib/sports-os/SportsOperatingSystemReadinessService"
import {
  getSportsIdentityHealthSnapshot,
  type SportsIdentityHealthSnapshot,
} from "@/lib/sports-os/SportsIdentityHealthService"
import {
  getProviderTeamReconciliationSummaries,
  type ProviderTeamReconciliationSummary,
} from "@/lib/sports-os/ProviderTeamReconciliationService"
import { maskAdminEmail } from "@/lib/admin-dashboard/format"

type MetricValue = number | string

export type AdminMetric = {
  label: string
  value: MetricValue
  tracked: boolean
  note?: string
}

export type AdminUserSearchRow = {
  id: string
  username: string
  displayName: string | null
  emailMasked: string
  createdAt: string
  subscriptionStatus: string
  tokenBalance: number | null
  worldCupEntries: number
  worldCupPoolsCreated: number
}

export type AdminActivePoolRow = {
  id: string
  name: string
  ownerUsername: string | null
  entries: number
  participants: number
  chatEvents: number
}

export type AdminRecentUserRow = {
  id: string
  username: string
  emailMasked: string
  createdAt: string
  subscriptionStatus: string
  tokenBalance: number | null
}

export type AdminRecentSubscriptionRow = {
  id: string
  username: string
  emailMasked: string
  plan: string
  sku: string | null
  status: string
  createdAt: string
  updatedAt: string
  currentPeriodEnd: string | null
}

export type AdminRecentPaymentRow = {
  id: string
  username: string
  emailMasked: string
  status: string
  paymentType: string
  amount: string
  createdAt: string
  completedAt: string | null
}

export type AdminRecentTokenActivityRow = {
  id: string
  username: string
  emailMasked: string
  entryType: string
  tokenDelta: number
  balanceAfter: number
  createdAt: string
  description: string | null
}

export type AdminCommandCenterMetrics = {
  generatedAt: string
  morning: AdminMetric[]
  users: AdminMetric[]
  subscriptions: AdminMetric[]
  tokens: AdminMetric[]
  ai: AdminMetric[]
  worldCup: AdminMetric[]
  health: AdminMetric[]
  providerHealth: AdminProviderHealthRow[]
  sportDataReliability: AdminSportDataReliabilityRow[]
  sportImportMatrix: SportImportMatrixRow[]
  aiToolAvailability: DashboardAiToolAvailability[]
  chimmySportReadiness: ChimmySportReadiness[]
  productionReadiness: AdminProductionReadiness
  emailStatus: AdminEmailStatus
  sportsOperatingSystem: SportsOperatingSystemAudit
  sportsIdentityHealth: SportsIdentityHealthSnapshot
  providerTeamReconciliation: {
    summaries: ProviderTeamReconciliationSummary[]
    totalProblems: number
    generatedAt: string
  }
  traffic: AdminMetric[]
  integrity: AdminMetric[]
  dataQuality: AdminMetric[]
  usersSearch: AdminUserSearchRow[]
  activeWorldCupPools: AdminActivePoolRow[]
  recentUsers: AdminRecentUserRow[]
  waitlist: AdminWaitlistSummary
  recentSubscriptions: AdminRecentSubscriptionRow[]
  recentPayments: AdminRecentPaymentRow[]
  recentTokenActivity: AdminRecentTokenActivityRow[]
}

/**
 * The early-access waitlist, surfaced for the first time.
 *
 * ⚠ THE LIST WAS NEVER LOST — IT WAS NEVER SHOWN. `EarlyAccessSignup` has been
 * collecting since April and nothing in the admin panel read it, so the only way
 * to know it existed was to query the database. That is why this exists.
 *
 * ⚠ `confirmedAt` IS NOT DECORATION. A signup that never confirmed is a weaker
 * consent signal than one that did, and it is the single most important field if
 * this list is ever emailed. It is reported as its own count rather than folded
 * into the total, so nobody reads "146 signups" as "146 people who opted in".
 *
 * ⚠ NO EMAIL ADDRESSES IN THE AGGREGATE COUNTS. The rows carry addresses because
 * an operator needs to see who signed up, but every count below is derived
 * server-side — the page never has to hold the full list to render a number.
 */
export type AdminWaitlistRow = {
  email: string
  name: string | null
  createdAt: string
  confirmed: boolean
  source: string | null
  utmSource: string | null
  utmCampaign: string | null
}

export type AdminWaitlistSummary = {
  total: number
  confirmed: number
  unconfirmed: number
  /** Oldest and newest signup, so the age of the list is visible at a glance. */
  firstAt: string | null
  lastAt: string | null
  /** Signups in the last 30 days — is this list alive or dormant? */
  last30Days: number
  bySource: Array<{ source: string; count: number }>
  byUtmSource: Array<{ source: string; count: number }>
  byMonth: Array<{ month: string; count: number }>
  recent: AdminWaitlistRow[]
}

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"]
const FAILED_OR_CANCELED_STATUSES = ["failed", "canceled", "cancelled", "incomplete", "unpaid"]

/**
 * Read the waitlist and summarise it.
 *
 * Counts are grouped in the database rather than by pulling every row and
 * counting in JS — the list is small today, and a page that degrades as the
 * waitlist grows is the wrong shape for the one screen meant to watch it grow.
 */
async function loadWaitlist(): Promise<AdminWaitlistSummary> {
  const empty: AdminWaitlistSummary = {
    total: 0, confirmed: 0, unconfirmed: 0, firstAt: null, lastAt: null,
    last30Days: 0, bySource: [], byUtmSource: [], byMonth: [], recent: [],
  }
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const [total, confirmed, last30Days, first, last, sources, utms, recent] = await Promise.all([
      prisma.earlyAccessSignup.count(),
      prisma.earlyAccessSignup.count({ where: { confirmedAt: { not: null } } }),
      prisma.earlyAccessSignup.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.earlyAccessSignup.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.earlyAccessSignup.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.earlyAccessSignup.groupBy({ by: ["source"], _count: { _all: true } }),
      prisma.earlyAccessSignup.groupBy({ by: ["utmSource"], _count: { _all: true } }),
      prisma.earlyAccessSignup.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          email: true, name: true, createdAt: true, confirmedAt: true,
          source: true, utmSource: true, utmCampaign: true,
        },
      }),
    ])

    /*
     * Months come from the same rows the table renders rather than a second
     * query — 146 dates is nothing, and it keeps the histogram and the list
     * provably consistent.
     */
    const all = await prisma.earlyAccessSignup.findMany({ select: { createdAt: true } })
    const monthCounts = new Map<string, number>()
    for (const r of all) {
      const key = r.createdAt.toISOString().slice(0, 7)
      monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1)
    }

    const rank = (rows: Array<{ _count: { _all: number } }>, key: (r: never) => string | null) =>
      rows
        .map((r) => ({ source: key(r as never) ?? "(none)", count: r._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)

    return {
      total,
      confirmed,
      unconfirmed: total - confirmed,
      firstAt: first?.createdAt.toISOString() ?? null,
      lastAt: last?.createdAt.toISOString() ?? null,
      last30Days,
      bySource: rank(sources, (r: { source: string | null }) => r.source),
      byUtmSource: rank(utms, (r: { utmSource: string | null }) => r.utmSource),
      byMonth: [...monthCounts.entries()].sort().map(([month, count]) => ({ month, count })),
      recent: recent.map((r) => ({
        email: r.email,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        confirmed: r.confirmedAt != null,
        source: r.source,
        utmSource: r.utmSource,
        utmCampaign: r.utmCampaign,
      })),
    }
  } catch {
    // The admin page must render even if this one table is unavailable.
    return empty
  }
}

function metric(label: string, value: MetricValue, note?: string): AdminMetric {
  return { label, value, tracked: true, note }
}

function notTracked(label: string, note = "Not tracked yet"): AdminMetric {
  return { label, value: note, tracked: false, note }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

function startOfUtcDay(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(/[\n\r,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

function classifySubscriptionCycle(sku: string | null | undefined, planCode: string | null | undefined): "annual" | "monthly" | "unknown" {
  const value = `${sku ?? ""} ${planCode ?? ""}`.toLowerCase()
  if (/\b(annual|year|yearly|yr)\b/.test(value)) return "annual"
  if (/\b(month|monthly|mo)\b/.test(value)) return "monthly"
  return "unknown"
}

async function countAdminUsers(): Promise<number> {
  const adminEmails = parseAdminEmails()
  if (adminEmails.length === 0) return 0
  return prisma.appUser.count({
    where: {
      OR: adminEmails.map((email) => ({
        email: { equals: email, mode: "insensitive" as const },
      })),
    },
  })
}

async function getUserSearchRows(query: string): Promise<AdminUserSearchRow[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const rows = await prisma.appUser.findMany({
    where: {
      OR: [
        { username: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      createdAt: true,
      userSubscriptions: {
        select: { status: true, plan: { select: { code: true } } },
        orderBy: { updatedAt: "desc" },
        take: 3,
      },
      tokenBalance: { select: { balance: true } },
      _count: {
        select: {
          worldCupBracketEntries: true,
          worldCupBracketChallengesOwned: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  })

  return rows.map((user) => {
    const subscriptionStatus =
      user.userSubscriptions.find((sub) => ACTIVE_SUBSCRIPTION_STATUSES.includes(sub.status.toLowerCase()))?.status ??
      user.userSubscriptions[0]?.status ??
      "free"
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      emailMasked: maskAdminEmail(user.email),
      createdAt: user.createdAt.toISOString(),
      subscriptionStatus,
      tokenBalance: user.tokenBalance?.balance ?? null,
      worldCupEntries: user._count.worldCupBracketEntries,
      worldCupPoolsCreated: user._count.worldCupBracketChallengesOwned,
    }
  })
}

async function getMostActiveWorldCupPools(): Promise<AdminActivePoolRow[]> {
  const pools = await prisma.worldCupBracketChallenge.findMany({
    select: {
      id: true,
      name: true,
      owner: { select: { username: true } },
      _count: {
        select: {
          entries: true,
          participants: true,
          chatEvents: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })

  return pools
    .map((pool) => ({
      id: pool.id,
      name: pool.name,
      ownerUsername: pool.owner.username,
      entries: pool._count.entries,
      participants: pool._count.participants,
      chatEvents: pool._count.chatEvents,
    }))
    .sort((a, b) => b.entries + b.participants + b.chatEvents - (a.entries + a.participants + a.chatEvents))
    .slice(0, 8)
}

async function getRecentUsers(): Promise<AdminRecentUserRow[]> {
  const rows = await prisma.appUser.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
      userSubscriptions: {
        select: { status: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      tokenBalance: { select: { balance: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  })

  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    emailMasked: maskAdminEmail(user.email),
    createdAt: user.createdAt.toISOString(),
    subscriptionStatus: user.userSubscriptions[0]?.status ?? "free",
    tokenBalance: user.tokenBalance?.balance ?? null,
  }))
}

async function getRecentSubscriptions(): Promise<AdminRecentSubscriptionRow[]> {
  const rows = await prisma.userSubscription.findMany({
    select: {
      id: true,
      sku: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      currentPeriodEnd: true,
      plan: { select: { code: true, name: true } },
      user: { select: { username: true, email: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
  })

  return rows.map((sub) => ({
    id: sub.id,
    username: sub.user.username,
    emailMasked: maskAdminEmail(sub.user.email),
    plan: sub.plan.name || sub.plan.code,
    sku: sub.sku,
    status: sub.status,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
  }))
}

async function getRecentPayments(): Promise<AdminRecentPaymentRow[]> {
  const rows = await prisma.bracketPayment.findMany({
    select: {
      id: true,
      status: true,
      amountCents: true,
      paymentType: true,
      createdAt: true,
      completedAt: true,
      user: { select: { username: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  })

  return rows.map((payment) => ({
    id: payment.id,
    username: payment.user.username,
    emailMasked: maskAdminEmail(payment.user.email),
    status: payment.status,
    paymentType: payment.paymentType,
    amount: `$${(payment.amountCents / 100).toFixed(2)}`,
    createdAt: payment.createdAt.toISOString(),
    completedAt: payment.completedAt?.toISOString() ?? null,
  }))
}

async function getRecentTokenActivity(): Promise<AdminRecentTokenActivityRow[]> {
  const rows = await prisma.tokenLedger.findMany({
    select: {
      id: true,
      entryType: true,
      tokenDelta: true,
      balanceAfter: true,
      description: true,
      createdAt: true,
      user: { select: { username: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  })

  return rows.map((entry) => ({
    id: entry.id,
    username: entry.user.username,
    emailMasked: maskAdminEmail(entry.user.email),
    entryType: entry.entryType,
    tokenDelta: entry.tokenDelta,
    balanceAfter: entry.balanceAfter,
    createdAt: entry.createdAt.toISOString(),
    description: entry.description,
  }))
}

export async function getAdminCommandCenterMetrics(searchQuery = ""): Promise<AdminCommandCenterMetrics> {
  const today = startOfUtcDay()
  const sevenHoursAgo = hoursAgo(7)
  const sevenDaysAgo = daysAgo(7)
  const thirtyDaysAgo = daysAgo(30)

  const [
    totalAccounts,
    accountsToday,
    accounts7Days,
    accounts30Days,
    activeSubscriptionUsers,
    adminUsers,
    subscriptions,
    failedOrCanceledSubscriptions,
    bracketPaymentsCompleted,
    bracketPaymentRevenue,
    stripeEvents,
    tokenGranted,
    tokenSpent,
    tokenBalanceSummary,
    tokenBalanceUsers,
    tokenBalances,
    chatConversations,
    chatMessages,
    chimmyMessages,
    worldCupPools,
    worldCupEntries,
    finalizedEntries,
    worldCupParticipants,
    wcPoolsWithMembers,
    worldCupChatEvents,
    worldCupInvites,
    worldCupInviteUseSummary,
    worldCupPoolsToday,
    worldCupEntriesToday,
    inviteLinks,
    inviteEvents,
    platformChatMessages,
    tokenSalesPayments,
    tokenSalesRevenue,
    activeWorldCupPools,
    usersSearch,
    recentUsers,
    recentSubscriptions,
    recentPayments,
    recentTokenActivity,
    databaseHealth,
    providerHealth,
    sportDataReliability,
    productionReadiness,
    emailStatus,
    sportsIdentityHealth,
    providerTeamReconciliation,
    analyticsEventsToday,
    analyticsEvents7Days,
    uniqueSessionsToday,
    uniqueSessions7Days,
    visitorLocationsToday,
    visitorLocations7Days,
    worldCupVisitors7Days,
    topReferrers,
    multipleAccountsSameLocation,
    syncJobsFailed24h,
    activeSessionsNow,
    loginSessionsToday,
    loginSessions7Days,
    subscriptionsCreatedToday,
    subscriptionsCreated7Days,
    revenueToday,
    revenue7Days,
    wcEntries7Days,
    wcPools7Days,
    tokenGrantedToday,
    tokenSpentToday,
    couponRedemptions,
    couponRedemptionsRedeemed,
    // ── 7-hour rolling window ────────────────────────────────────────────────
    accounts7h,
    loginSessions7h,
    wcPools7h,
    wcEntries7h,
    revenue7h,
    subscriptionsCreated7h,
    tokenGranted7h,
    tokenSpent7h,
    firstLoginSignal,
  ] = await Promise.all([
    prisma.appUser.count(),
    prisma.appUser.count({ where: { createdAt: { gte: today } } }),
    prisma.appUser.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.appUser.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.userSubscription.groupBy({
      by: ["userId"],
      where: { status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
    }),
    countAdminUsers(),
    prisma.userSubscription.findMany({
      select: {
        status: true,
        sku: true,
        plan: { select: { code: true } },
      },
    }),
    prisma.userSubscription.count({
      where: { status: { in: FAILED_OR_CANCELED_STATUSES } },
    }),
    prisma.bracketPayment.count({ where: { status: { in: ["completed", "paid", "succeeded"] } } }),
    prisma.bracketPayment.aggregate({
      where: { status: { in: ["completed", "paid", "succeeded"] } },
      _sum: { amountCents: true },
    }),
    prisma.stripeWebhookEvent.count(),
    prisma.tokenLedger.aggregate({
      where: { tokenDelta: { gt: 0 } },
      _sum: { tokenDelta: true },
    }),
    prisma.tokenLedger.aggregate({
      where: { tokenDelta: { lt: 0 } },
      _sum: { tokenDelta: true },
    }),
    prisma.userTokenBalance.aggregate({
      _sum: {
        balance: true,
        lifetimePurchased: true,
        lifetimeSpent: true,
      },
    }),
    prisma.userTokenBalance.count(),
    prisma.userTokenBalance.findMany({
      select: {
        balance: true,
        lifetimePurchased: true,
        lifetimeSpent: true,
        user: { select: { username: true, email: true } },
      },
      orderBy: { lifetimeSpent: "desc" },
      take: 8,
    }),
    prisma.chatConversation.count(),
    prisma.chatHistory.count(),
    prisma.chatHistory.count({ where: { role: { in: ["assistant", "chimmy"] } } }),
    prisma.worldCupBracketChallenge.count(),
    prisma.worldCupBracketEntry.count(),
    prisma.worldCupBracketEntry.count({ where: { OR: [{ isComplete: true }, { submittedAt: { not: null } }] } }),
    prisma.worldCupBracketParticipant.count(),
    prisma.worldCupBracketChallenge.count({ where: { participants: { some: {} } } }),
    prisma.worldCupBracketChatEvent.count(),
    prisma.worldCupBracketInvite.count(),
    prisma.worldCupBracketInvite.aggregate({
      _sum: { useCount: true },
    }),
    prisma.worldCupBracketChallenge.count({ where: { createdAt: { gte: today } } }),
    prisma.worldCupBracketEntry.count({ where: { createdAt: { gte: today } } }),
    prisma.inviteLink.count(),
    prisma.inviteLinkEvent.count(),
    prisma.platformChatMessage.count(),
    prisma.bracketPayment.count({
      where: {
        status: { in: ["completed", "paid", "succeeded"] },
        paymentType: { contains: "token", mode: "insensitive" },
      },
    }),
    prisma.bracketPayment.aggregate({
      where: {
        status: { in: ["completed", "paid", "succeeded"] },
        paymentType: { contains: "token", mode: "insensitive" },
      },
      _sum: { amountCents: true },
    }),
    getMostActiveWorldCupPools(),
    getUserSearchRows(searchQuery),
    getRecentUsers(),
    getRecentSubscriptions(),
    getRecentPayments(),
    getRecentTokenActivity(),
    prisma.$queryRaw`SELECT 1`.then(() => "healthy").catch(() => "down"),
    getAdminProviderHealthRows(),
    getAdminPerSportDataReliabilityRows(),
    getAdminProductionReadiness(),
    getEmailCenterStatus(),
    getSportsIdentityHealthSnapshot(),
    getProviderTeamReconciliationSummaries().catch(() => ({ summaries: [], totalProblems: 0, generatedAt: new Date().toISOString() })),
    prisma.analyticsEvent.count({ where: { createdAt: { gte: today } } }),
    prisma.analyticsEvent.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.analyticsEvent.groupBy({
      by: ["sessionId"],
      where: { createdAt: { gte: today }, sessionId: { not: null } },
    }),
    prisma.analyticsEvent.groupBy({
      by: ["sessionId"],
      where: { createdAt: { gte: sevenDaysAgo }, sessionId: { not: null } },
    }),
    prisma.visitorLocation.count({ where: { lastSeen: { gte: today } } }).catch(() => 0),
    prisma.visitorLocation.count({ where: { lastSeen: { gte: sevenDaysAgo } } }).catch(() => 0),
    prisma.analyticsEvent.count({
      where: {
        createdAt: { gte: sevenDaysAgo },
        OR: [
          { path: { contains: "world-cup", mode: "insensitive" } },
          { path: { contains: "brackets", mode: "insensitive" } },
        ],
      },
    }),
    prisma.analyticsEvent.groupBy({
      by: ["referrer"],
      where: { createdAt: { gte: sevenDaysAgo }, referrer: { not: null } },
      _count: { _all: true },
    }).then((rows) => rows.sort((a, b) => b._count._all - a._count._all).slice(0, 5)).catch(() => []),
    prisma.visitorLocation
      .findMany({
        where: { visits: { gte: 5 } },
        select: { country: true, region: true, city: true, visits: true },
        orderBy: { visits: "desc" },
        take: 5,
      })
      .catch(() => []),
    prisma.syncJobRun.count({
      where: {
        status: { in: ["failed", "error"] },
        startedAt: { gte: daysAgo(1) },
      },
    }).catch(() => 0),
    // ── Login / session metrics ───────────────────────────────────────────────
    // NOTE: these counts deliberately do NOT come from AuthSession. That model has
    // no createdAt column (id/sessionToken/userId/expires only), so the previous
    // `authSession.count({ where: { createdAt } })` threw
    // PrismaClientValidationError on every call and the `.catch(() => 0)` rendered
    // it as a confident bold "0" on a live site. IdentitySignal is the real
    // login-event source and does have createdAt — see recordIdentitySignal()
    // wired into authOptions.events.signIn.
    prisma.authSession.count({ where: { expires: { gt: new Date() } } }).catch(() => 0),
    prisma.identitySignal.count({ where: { context: "login", createdAt: { gte: today } } }).catch(() => 0),
    prisma.identitySignal.count({ where: { context: "login", createdAt: { gte: sevenDaysAgo } } }).catch(() => 0),
    // ── Subscription velocity ────────────────────────────────────────────────
    prisma.userSubscription.count({ where: { createdAt: { gte: today } } }),
    prisma.userSubscription.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    // ── Revenue breakdown ────────────────────────────────────────────────────
    prisma.bracketPayment.aggregate({
      where: { status: { in: ["completed", "paid", "succeeded"] }, createdAt: { gte: today } },
      _sum: { amountCents: true },
    }),
    prisma.bracketPayment.aggregate({
      where: { status: { in: ["completed", "paid", "succeeded"] }, createdAt: { gte: sevenDaysAgo } },
      _sum: { amountCents: true },
    }),
    // ── World Cup 7-day velocity ─────────────────────────────────────────────
    prisma.worldCupBracketEntry.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.worldCupBracketChallenge.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    // ── Token activity today ─────────────────────────────────────────────────
    prisma.tokenLedger.aggregate({
      where: { tokenDelta: { gt: 0 }, createdAt: { gte: today } },
      _sum: { tokenDelta: true },
    }),
    prisma.tokenLedger.aggregate({
      where: { tokenDelta: { lt: 0 }, createdAt: { gte: today } },
      _sum: { tokenDelta: true },
    }),
    // ── Coupon redemptions ───────────────────────────────────────────────────
    prisma.sponsorCouponRedemption.count().catch(() => 0),
    prisma.sponsorCouponRedemption.count({ where: { status: "redeemed" } }).catch(() => 0),
    // ── 7-hour rolling window ────────────────────────────────────────────────
    prisma.appUser.count({ where: { createdAt: { gte: sevenHoursAgo } } }),
    prisma.identitySignal.count({ where: { context: "login", createdAt: { gte: sevenHoursAgo } } }).catch(() => 0),
    prisma.worldCupBracketChallenge.count({ where: { createdAt: { gte: sevenHoursAgo } } }),
    prisma.worldCupBracketEntry.count({ where: { createdAt: { gte: sevenHoursAgo } } }),
    prisma.bracketPayment.aggregate({
      where: { status: { in: ["completed", "paid", "succeeded"] }, createdAt: { gte: sevenHoursAgo } },
      _sum: { amountCents: true },
    }),
    prisma.userSubscription.count({ where: { createdAt: { gte: sevenHoursAgo } } }),
    prisma.tokenLedger.aggregate({
      where: { tokenDelta: { gt: 0 }, createdAt: { gte: sevenHoursAgo } },
      _sum: { tokenDelta: true },
    }),
    prisma.tokenLedger.aggregate({
      where: { tokenDelta: { lt: 0 }, createdAt: { gte: sevenHoursAgo } },
      _sum: { tokenDelta: true },
    }),
    // Oldest captured login signal. Distinguishes "genuinely zero logins" from
    // "login tracking has not recorded anything yet", so the cards below can say
    // which one it is instead of showing a bold 0 for both.
    prisma.identitySignal
      .findFirst({
        where: { context: "login" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      })
      .catch(() => null),
  ])

  /*
   * Fetched separately rather than as a 77th entry in the Promise.all above.
   * That array is positional — the destructure and the array must stay in
   * lockstep — and adding to it is exactly where an off-by-one silently assigns
   * the wrong table to the wrong field. One extra round trip is cheaper than
   * that class of bug.
   */
  const waitlist = await loadWaitlist()

  // Login counts are only meaningful once IdentitySignal has captured at least one
  // login. Before that, a "0" would be indistinguishable from the old silent-zero
  // bug, so report it as untracked instead of as data.
  const loginTrackingStartedAt = firstLoginSignal?.createdAt ?? null
  const loginMetric = (label: string, value: number, note: string): AdminMetric =>
    loginTrackingStartedAt
      ? metric(label, value, `${note} · tracked since ${loginTrackingStartedAt.toISOString().slice(0, 10)}`)
      : notTracked(label, "No login signals captured yet — sign in once to start tracking")

  const cycleCounts = subscriptions.reduce(
    (acc, sub) => {
      const cycle = classifySubscriptionCycle(sub.sku, sub.plan.code)
      acc[cycle] += 1
      return acc
    },
    { annual: 0, monthly: 0, unknown: 0 }
  )
  const activeSubscriptionUserCount = activeSubscriptionUsers.length
  const completedRevenueCents = bracketPaymentRevenue._sum.amountCents ?? null
  const inviteAccepts = worldCupInviteUseSummary._sum.useCount ?? 0
  const inviteAcceptancePct =
    worldCupInvites > 0 ? `${Math.round((inviteAccepts / worldCupInvites) * 100)}%` : "0%"
  const tokenSalesRevenueCents = tokenSalesRevenue._sum.amountCents ?? 0
  const providerGapCount = providerHealth.filter((row) => row.status === "missing_env" || row.status === "scaffold_only" || row.status === "not_production_ready").length
  const providerConfiguredCount = providerHealth.filter((row) => row.configured).length
  const sportImportMatrix = getSportImportMatrix(sportDataReliability)
  const aiToolAvailability = getDashboardAiToolAvailability(sportDataReliability)
  const chimmySportReadiness = getChimmySportReadiness(sportDataReliability)
  const sportsOperatingSystem = buildSportsOperatingSystemAudit({
    importMatrix: sportImportMatrix,
    aiToolAvailability,
    identityHealth: sportsIdentityHealth,
  })

  return {
    generatedAt: new Date().toISOString(),
    morning: [
      metric("Signups last 7h", accounts7h, "Rolling 7-hour window"),
      metric("Signups today", accountsToday, "UTC day"),
      loginMetric("Logins last 7h", loginSessions7h, "Rolling 7-hour window"),
      loginMetric("Logins today", loginSessionsToday, "UTC day"),
      metric("Active sessions now", activeSessionsNow),
      metric("Active subscribers", activeSubscriptionUserCount),
      metric("Pools last 7h", wcPools7h, "WC pools created last 7h"),
      metric("Brackets last 7h", wcEntries7h, "WC entries created last 7h"),
      metric("Pools today", worldCupPoolsToday, "UTC day"),
      metric("Brackets today", worldCupEntriesToday, "UTC day"),
      metric("Revenue last 7h", `$${((revenue7h._sum.amountCents ?? 0) / 100).toFixed(2)}`, "Rolling 7h"),
      metric("Revenue today", `$${((revenueToday._sum.amountCents ?? 0) / 100).toFixed(2)}`, "UTC day"),
      metric("Revenue 7 days", `$${((revenue7Days._sum.amountCents ?? 0) / 100).toFixed(2)}`),
      metric("Invite acceptance", inviteAcceptancePct, `${inviteAccepts} accepted / ${worldCupInvites} sent`),
      notTracked("AI cost yesterday", "No unified AI cost ledger is tracked yet"),
      metric("API health", `${providerConfiguredCount}/${providerHealth.length} configured`, `${providerGapCount} gaps`),
      metric("Top pools", activeWorldCupPools.length, "Ranked below by participants, entries, and chat"),
    ],
    users: [
      metric("Total accounts", totalAccounts),
      metric("Created last 7h", accounts7h, "Rolling 7-hour window"),
      metric("Created today", accountsToday, "UTC day"),
      metric("Created 7 days", accounts7Days),
      metric("Created 30 days", accounts30Days),
      loginMetric("Logins last 7h", loginSessions7h, "Rolling 7-hour window"),
      loginMetric("Logins today", loginSessionsToday, "UTC day"),
      loginMetric("Logins 7 days", loginSessions7Days, "Rolling 7 days"),
      metric("Active sessions now", activeSessionsNow, "Sessions where expires > now()"),
      metric("Free users", Math.max(0, totalAccounts - activeSubscriptionUserCount), "Derived from active subscriptions"),
      metric("Pro/subscribed users", activeSubscriptionUserCount),
      metric("Admin users", adminUsers, "Derived from ADMIN_EMAILS allowlist"),
    ],
    subscriptions: [
      metric("Total subscriptions", subscriptions.length),
      metric("New subscriptions last 7h", subscriptionsCreated7h, "Rolling 7-hour window"),
      metric("New subscriptions today", subscriptionsCreatedToday, "UTC day"),
      metric("New subscriptions 7 days", subscriptionsCreated7Days),
      metric("Monthly subscriptions", cycleCounts.monthly, "Derived from plan code/SKU text"),
      metric("Annual subscriptions", cycleCounts.annual, "Derived from plan code/SKU text"),
      metric("Unknown billing cycle", cycleCounts.unknown),
      metric("Failed/canceled subscriptions", failedOrCanceledSubscriptions),
      metric("Stripe webhook events", stripeEvents),
      metric("Completed payments (all time)", bracketPaymentsCompleted),
      completedRevenueCents === null
        ? notTracked("Total revenue", "No completed bracket payments recorded")
        : metric("Total revenue", `$${(completedRevenueCents / 100).toFixed(2)}`),
      metric("Revenue last 7h", `$${((revenue7h._sum.amountCents ?? 0) / 100).toFixed(2)}`, "Rolling 7-hour window"),
      metric("Revenue today", `$${((revenueToday._sum.amountCents ?? 0) / 100).toFixed(2)}`, "UTC day"),
      metric("Revenue 7 days", `$${((revenue7Days._sum.amountCents ?? 0) / 100).toFixed(2)}`),
      metric("Token sales revenue", `$${(tokenSalesRevenueCents / 100).toFixed(2)}`, `${tokenSalesPayments} completed token payment rows`),
      metric("Coupon redemptions", couponRedemptions, `${couponRedemptionsRedeemed} redeemed`),
      notTracked("MRR estimate", "Subscription prices are not reliably stored on subscription rows"),
    ],
    tokens: [
      metric("Token balances total", tokenBalanceSummary._sum.balance ?? 0),
      metric("Tokens granted last 7h", tokenGranted7h._sum.tokenDelta ?? 0, "Rolling 7-hour window"),
      metric("Tokens spent last 7h", Math.abs(tokenSpent7h._sum.tokenDelta ?? 0), "Rolling 7-hour window"),
      metric("Tokens granted today", tokenGrantedToday._sum.tokenDelta ?? 0, "UTC day"),
      metric("Tokens spent today", Math.abs(tokenSpentToday._sum.tokenDelta ?? 0), "UTC day"),
      metric("Total tokens granted (all time)", tokenGranted._sum.tokenDelta ?? 0),
      metric("Total tokens spent (all time)", Math.abs(tokenSpent._sum.tokenDelta ?? 0)),
      metric("Users with token balances", tokenBalanceUsers, "Top spenders listed below"),
      metric("Lifetime tokens purchased", tokenBalanceSummary._sum.lifetimePurchased ?? 0),
      metric("Lifetime tokens spent", tokenBalanceSummary._sum.lifetimeSpent ?? 0),
      ...tokenBalances.slice(0, 5).map((row) =>
        metric(
          `@${row.user.username}`,
          `${row.balance} left / ${row.lifetimeSpent} spent`,
          maskAdminEmail(row.user.email)
        )
      ),
    ],
    ai: [
      metric("AI conversations", chatConversations),
      metric("AI/chat messages", chatMessages),
      metric("Chimmy replies", chimmyMessages, "Derived from chat_history role"),
      notTracked("Failed AI requests", "No unified failed-AI request table found"),
    ],
    worldCup: [
      metric("World Cup pools", worldCupPools),
      metric("Pools with members", wcPoolsWithMembers, "Pools where ≥1 participant has joined"),
      metric("Pools last 7h", wcPools7h, "Rolling 7-hour window"),
      metric("Pools today", worldCupPoolsToday, "UTC day"),
      metric("Pools 7 days", wcPools7Days),
      metric("Bracket entries", worldCupEntries),
      metric("Entries last 7h", wcEntries7h, "Rolling 7-hour window"),
      metric("Entries today", worldCupEntriesToday, "UTC day"),
      metric("Entries 7 days", wcEntries7Days),
      metric("Finalized entries", finalizedEntries, "isComplete or submittedAt set"),
      metric("Pool participants", worldCupParticipants),
      metric("World Cup chat events", worldCupChatEvents),
      metric("World Cup invites sent", worldCupInvites),
      metric("Invite accepts", inviteAccepts, inviteAcceptancePct + " acceptance rate"),
      metric("Universal invite links", inviteLinks),
      metric("Invite activity events", inviteEvents),
      metric("Shared chat messages", platformChatMessages),
    ],
    health: [
      metric("Database", databaseHealth),
      metric("Generated", new Date().toLocaleString("en-US", { timeZone: "America/New_York" }), "America/New_York"),
      metric("Providers configured", providerHealth.filter((row) => row.configured).length),
      metric("Provider gaps", providerGapCount),
      metric("Sport data rows", sportDataReliability.length, "Per-sport reliability table below"),
    ],
    traffic: [
      metric("Analytics events today", analyticsEventsToday, "Server/client tracked events"),
      metric("Analytics events 7 days", analyticsEvents7Days),
      metric("Unique sessions today", uniqueSessionsToday.length || "Not tracked yet", "Requires sessionId on analytics events"),
      metric("Unique sessions 7 days", uniqueSessions7Days.length || "Not tracked yet"),
      metric("Approx unique IPs today", visitorLocationsToday || "Not tracked yet", "Uses aggregate VisitorLocation rows only"),
      metric("Approx unique IPs 7 days", visitorLocations7Days || "Not tracked yet"),
      metric("World Cup visitor events", worldCupVisitors7Days, "7-day paths containing world-cup/brackets"),
      metric(
        "Top referrers",
        topReferrers.length,
        topReferrers
          .map((row) => `${row.referrer ?? "unknown"} (${row._count._all})`)
          .join(", ") || "Not tracked yet"
      ),
    ],
    integrity: [
      metric("High-repeat visitor locations", multipleAccountsSameLocation.length, "Approximate geo rows with 5+ visits; no raw IP rendered"),
      metric("Failed sync jobs 24h", syncJobsFailed24h),
      notTracked("Duplicate-account confidence score", "Requires privacy-safe IP/session/device aggregation beyond current tables"),
      notTracked("Lock bypass attempts", "No unified lock-bypass event table is tracked yet"),
    ],
    dataQuality: [
      metric("Provider env gaps", providerGapCount),
      metric("Sports with stale warnings", sportDataReliability.filter((row) => row.staleWarnings.length > 0).length),
      metric("Identity problems", sportsIdentityHealth.summary.identityProblems, "Derived from cached player/team/identity tables"),
      metric("Image/logo problems", sportsIdentityHealth.summary.imageProblems, "No external image probes; URL metadata only"),
      metric("Provider mapping problems", sportsIdentityHealth.summary.providerMappingProblems, "Cached provider rows compared to canonical identity/team metadata"),
      metric("Duplicate player name groups", sportsIdentityHealth.rows.reduce((sum, row) => sum + row.duplicatePlayerNameGroups, 0)),
      metric("Duplicate team identity groups", sportsIdentityHealth.rows.reduce((sum, row) => sum + row.duplicateTeamIdentityGroups, 0)),
      metric("Inactive/unknown cached players", sportsIdentityHealth.rows.reduce((sum, row) => sum + row.inactiveOrUnknownPlayers, 0)),
      metric("Missing headshots", sportsIdentityHealth.imageRows.reduce((sum, row) => sum + row.playersMissingHeadshots, 0)),
      metric("Missing team logos", sportsIdentityHealth.imageRows.reduce((sum, row) => sum + row.teamsMissingLogos, 0)),
      metric("Team mapping mismatches", sportsIdentityHealth.rows.reduce((sum, row) => sum + row.teamMappingMismatches, 0)),
      notTracked("Remote image HTTP health", "Intentionally disabled on page render; run only from admin/cron-safe checks"),
    ],
    providerHealth,
    sportDataReliability,
    sportImportMatrix,
    aiToolAvailability,
    chimmySportReadiness,
    productionReadiness,
    emailStatus,
    sportsOperatingSystem,
    sportsIdentityHealth,
    providerTeamReconciliation,
    usersSearch,
    activeWorldCupPools,
    recentUsers,
    waitlist,
    recentSubscriptions,
    recentPayments,
    recentTokenActivity,
  }
}
