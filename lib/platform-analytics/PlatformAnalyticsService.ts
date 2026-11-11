/**
 * Platform analytics: DAU, MAU, league growth, bracket participation, draft activity, trade volume, AI usage.
 * Queries match database schema (AppUser, League, AnalyticsEvent, BracketEntry, MockDraft, LeagueTrade, BracketPayment).
 */

import { prisma } from "@/lib/prisma"
import { countRealLeagues, testLeagueCountsBy, testLeagueCreatedDays } from "@/lib/demo-league/analyticsExclusion"
import type { LeagueSport } from "@prisma/client"
import { resolveDateRange, startOfDayUTC } from "./AnalyticsQueryResolver"
import { resolveSportFilter } from "./SportAnalyticsFilterResolver"

export interface DateCount {
  date: string // YYYY-MM-DD
  count: number
  uniqueUsers?: number
}

export interface PlatformAnalyticsResult {
  userGrowth: {
    dau: number
    mau: number
    signupsOverTime: DateCount[]
    activeUsersOverTime: DateCount[]
  }
  leagueGrowth: {
    totalLeagues: number
    leaguesCreatedOverTime: DateCount[]
    bySport: { sport: string; count: number }[]
  }
  toolUsage: {
    byToolKey: { toolKey: string; count: number; uniqueUsers: number }[]
    eventsOverTime: DateCount[]
  }
  aiRequests: {
    total: number
    uniqueUsers: number
    overTime: DateCount[]
  }
  revenue: {
    totalCents: number
    transactionCount: number
    overTime: DateCount[]
  }
  bracketParticipation: {
    totalEntries: number
    totalLeagues: number
    entriesOverTime: DateCount[]
  }
  draftActivity: {
    totalDrafts: number
    uniqueUsers: number
    overTime: DateCount[]
  }
  tradeVolume: {
    totalTrades: number
    overTime: DateCount[]
  }
}

/** DAU: distinct users with at least one AnalyticsEvent on the given date. */
async function getDAUForDate(date: Date): Promise<number> {
  const start = startOfDayUTC(date)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      userId: { not: null },
    },
    select: { userId: true },
    distinct: ["userId"],
  })
  return rows.length
}

/** MAU: distinct users with at least one AnalyticsEvent in the month containing the given date. */
async function getMAUForMonth(date: Date): Promise<number> {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      userId: { not: null },
    },
    select: { userId: true },
    distinct: ["userId"],
  })
  return rows.length
}

/** Signups per day (AppUser.createdAt). */
async function getSignupsOverTime(fromDate: Date, toDate: Date): Promise<DateCount[]> {
  const bucket = await prisma.appUser.groupBy({
    by: ["createdAt"],
    _count: { id: true },
    where: { createdAt: { gte: fromDate, lte: toDate } },
  })
  const byDay = new Map<string, number>()
  for (const row of bucket) {
    const d = startOfDayUTC(row.createdAt)
    const key = d.toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + row._count.id)
  }
  return fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
}

/** Active users per day (distinct userId in AnalyticsEvent). */
async function getActiveUsersOverTime(fromDate: Date, toDate: Date): Promise<DateCount[]> {
  const events = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: { gte: fromDate, lte: toDate },
      userId: { not: null },
    },
    select: { userId: true, createdAt: true },
  })
  const byDay = new Map<string, Set<string>>()
  for (const e of events) {
    const key = startOfDayUTC(e.createdAt!).toISOString().slice(0, 10)
    if (!byDay.has(key)) byDay.set(key, new Set())
    byDay.get(key)!.add(e.userId!)
  }
  return fillDateRange(fromDate, toDate, (key) => ({
    date: key,
    count: byDay.get(key)?.size ?? 0,
  }))
}

/** Leagues created per day; optional sport filter. */
async function getLeaguesCreatedOverTime(
  fromDate: Date,
  toDate: Date,
  sport: LeagueSport | null
): Promise<DateCount[]> {
  const where: { createdAt: { gte: Date; lte: Date }; sport?: LeagueSport } = {
    createdAt: { gte: fromDate, lte: toDate },
  }
  if (sport) where.sport = sport
  const bucket = await prisma.league.groupBy({
    by: ["createdAt"],
    _count: { id: true },
    where,
  })
  const byDay = new Map<string, number>()
  for (const row of bucket) {
    const key = startOfDayUTC(row.createdAt).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + row._count.id)
  }
  // Test leagues ("Create a test league") are not real leagues.
  for (const [key, n] of await testLeagueCreatedDays(where)) byDay.set(key, Math.max(0, (byDay.get(key) ?? 0) - n))
  return fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
}

/** League counts by sport. */
async function getLeaguesBySport(sport: LeagueSport | null): Promise<{ sport: string; count: number }[]> {
  const where = sport ? { sport } : {}
  const counts = await prisma.league.groupBy({
    by: ["sport"],
    _count: { id: true },
    where,
  })
  const tests = await testLeagueCountsBy("sport", where)
  return counts.map((c) => ({ sport: c.sport, count: Math.max(0, c._count.id - (tests.get(String(c.sport)) ?? 0)) }))
}

/** Tool usage: group by toolKey with count and unique users. */
async function getToolUsage(fromDate: Date, toDate: Date): Promise<{ toolKey: string; count: number; uniqueUsers: number }[]> {
  const events = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: { gte: fromDate, lte: toDate },
      toolKey: { not: null },
    },
    select: { toolKey: true, userId: true },
  })
  const byTool = new Map<string, { count: number; users: Set<string> }>()
  for (const e of events) {
    const key = e.toolKey ?? "unknown"
    if (!byTool.has(key)) byTool.set(key, { count: 0, users: new Set() })
    const t = byTool.get(key)!
    t.count++
    if (e.userId) t.users.add(e.userId)
  }
  return [...byTool.entries()].map(([toolKey, v]) => ({
    toolKey,
    count: v.count,
    uniqueUsers: v.users.size,
  })).sort((a, b) => b.count - a.count)
}

/** Events over time (count per day). */
async function getEventsOverTime(fromDate: Date, toDate: Date): Promise<DateCount[]> {
  const bucket = await prisma.analyticsEvent.groupBy({
    by: ["createdAt"],
    _count: { id: true },
    where: { createdAt: { gte: fromDate, lte: toDate } },
  })
  const byDay = new Map<string, number>()
  for (const row of bucket) {
    const key = startOfDayUTC(row.createdAt).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + row._count.id)
  }
  return fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
}

/** AI usage: events where toolKey contains 'ai' or event starts with 'ai_'. */
async function getAIUsage(fromDate: Date, toDate: Date): Promise<{
  total: number
  uniqueUsers: number
  overTime: DateCount[]
}> {
  const events = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: { gte: fromDate, lte: toDate },
      OR: [
        { toolKey: { contains: "ai", mode: "insensitive" } },
        { event: { startsWith: "ai_", mode: "insensitive" } },
      ],
    },
    select: { userId: true, createdAt: true },
  })
  const byDay = new Map<string, number>()
  const users = new Set<string>()
  for (const e of events) {
    const key = startOfDayUTC(e.createdAt).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
    if (e.userId) users.add(e.userId)
  }
  const overTime = fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
  return { total: events.length, uniqueUsers: users.size, overTime }
}

/** Revenue: BracketPayment completed, amountCents. */
async function getRevenue(fromDate: Date, toDate: Date): Promise<{
  totalCents: number
  transactionCount: number
  overTime: DateCount[]
}> {
  const rows = await prisma.bracketPayment.findMany({
    where: {
      status: "completed",
      completedAt: { not: null, gte: fromDate, lte: toDate },
    },
    select: { amountCents: true, completedAt: true },
  })
  const byDay = new Map<string, number>()
  let totalCents = 0
  for (const r of rows) {
    const at = r.completedAt!
    const key = startOfDayUTC(at).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + r.amountCents)
    totalCents += r.amountCents
  }
  const overTime = fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
  return { totalCents, transactionCount: rows.length, overTime }
}

/** Bracket entries and leagues. */
async function getBracketParticipation(fromDate: Date, toDate: Date): Promise<{
  totalEntries: number
  totalLeagues: number
  entriesOverTime: DateCount[]
}> {
  const [totalEntries, totalLeagues, entries] = await Promise.all([
    prisma.bracketEntry.count(),
    prisma.bracketLeague.count(),
    prisma.bracketEntry.findMany({
      where: { submittedAt: { gte: fromDate, lte: toDate } },
      select: { submittedAt: true },
    }),
  ])
  const byDay = new Map<string, number>()
  for (const e of entries) {
    if (!e.submittedAt) continue
    const key = startOfDayUTC(e.submittedAt).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  const entriesOverTime = fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
  return { totalEntries, totalLeagues, entriesOverTime }
}

/** Mock draft activity. */
async function getDraftActivity(fromDate: Date, toDate: Date): Promise<{
  totalDrafts: number
  uniqueUsers: number
  overTime: DateCount[]
}> {
  const where: { createdAt: { gte: Date; lte: Date } } = {
    createdAt: { gte: fromDate, lte: toDate },
  }
  const drafts = await prisma.mockDraft.findMany({
    where,
    select: { userId: true, createdAt: true },
  })
  const byDay = new Map<string, number>()
  const users = new Set(drafts.map((d) => d.userId))
  for (const d of drafts) {
    const key = startOfDayUTC(d.createdAt).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  const overTime = fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
  const totalDrafts = drafts.length
  return { totalDrafts, uniqueUsers: users.size, overTime }
}

/** LeagueTrade volume (tradeDate or createdAt). */
async function getTradeVolume(fromDate: Date, toDate: Date): Promise<{
  totalTrades: number
  overTime: DateCount[]
}> {
  const trades = await prisma.leagueTrade.findMany({
    where: {
      OR: [
        { tradeDate: { gte: fromDate, lte: toDate } },
        { createdAt: { gte: fromDate, lte: toDate } },
      ],
    },
    select: { tradeDate: true, createdAt: true },
  })
  const byDay = new Map<string, number>()
  for (const t of trades) {
    const d = t.tradeDate ?? t.createdAt
    const key = startOfDayUTC(d).toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  const overTime = fillDateRange(fromDate, toDate, (key) => ({ date: key, count: byDay.get(key) ?? 0 }))
  const totalTrades = await prisma.leagueTrade.count()
  return { totalTrades, overTime }
}

function fillDateRange(
  fromDate: Date,
  toDate: Date,
  fn: (key: string) => DateCount
): DateCount[] {
  const out: DateCount[] = []
  const start = startOfDayUTC(fromDate)
  const end = startOfDayUTC(toDate)
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t)
    const key = d.toISOString().slice(0, 10)
    out.push(fn(key))
  }
  return out
}

export async function getPlatformAnalytics(opts: {
  from?: string | null
  to?: string | null
  sport?: string | null
}): Promise<PlatformAnalyticsResult> {
  const { fromDate, toDate } = resolveDateRange(opts.from, opts.to)
  const sport = resolveSportFilter(opts.sport)

  const [
    dau,
    mau,
    signupsOverTime,
    activeUsersOverTime,
    leaguesCreatedOverTime,
    bySport,
    toolUsage,
    eventsOverTime,
    aiUsage,
    revenue,
    bracketParticipation,
    draftActivity,
    tradeVolume,
  ] = await Promise.all([
    getDAUForDate(toDate),
    getMAUForMonth(toDate),
    getSignupsOverTime(fromDate, toDate),
    getActiveUsersOverTime(fromDate, toDate),
    getLeaguesCreatedOverTime(fromDate, toDate, sport),
    getLeaguesBySport(sport),
    getToolUsage(fromDate, toDate),
    getEventsOverTime(fromDate, toDate),
    getAIUsage(fromDate, toDate),
    getRevenue(fromDate, toDate),
    getBracketParticipation(fromDate, toDate),
    getDraftActivity(fromDate, toDate),
    getTradeVolume(fromDate, toDate),
  ])

  const totalLeagues = await countRealLeagues(sport ? { sport } : undefined)

  return {
    userGrowth: {
      dau,
      mau,
      signupsOverTime,
      activeUsersOverTime,
    },
    leagueGrowth: {
      totalLeagues,
      leaguesCreatedOverTime,
      bySport,
    },
    toolUsage: {
      byToolKey: toolUsage,
      eventsOverTime,
    },
    aiRequests: aiUsage,
    revenue,
    bracketParticipation,
    draftActivity,
    tradeVolume,
  }
}
