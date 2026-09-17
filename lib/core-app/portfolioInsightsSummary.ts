/**
 * `/core/portfolio` insights, stored — so a request reads an aggregate instead of joining every
 * roster in every league.
 *
 * Two stores, because they answer different questions and live for different lengths of time:
 *
 * | record | key | holds | lives |
 * |---|---|---|---|
 * | the insights | `sos:sum:portfolio-insights:v1:u=<id>&fp=<leagues>&` | the full build | 20 min fresh, 6 h stale |
 * | the daily totals | `core-portfolio:totals:v1:<ET date>:u=<id>` | one number per league | 400 days |
 *
 * ── 🛑 BOTH IN `sportsDataCache`, NOT A NEW TABLE ────────────────────────────────────────────
 *
 * A table is a migration, and a migration is the user's call. The rankings snapshots made the same
 * choice for the same reason (`rankingsSnapshots.ts`): one small JSON document per user per day is
 * exactly what that table already holds, and it ships with no schema change.
 *
 * ── ⚠ THE INSIGHTS KEY CARRIES THE LEAGUE LIST, NOT THE SYNC TIME ────────────────────────────
 *
 * `portfolioFingerprint` (the home's) includes `lastSyncedAt`, so every sync is a new key and a
 * cold rebuild. For the home that is right — its facts are "what needs me now". This build reads
 * every roster in every league and costs seconds on a sixty-league account, and a Sleeper account
 * syncs often; a cold rebuild after each sync would put that cost back on the request path, which
 * is the thing this module exists to remove. So the key changes when the SET of leagues changes (an
 * import appears at once), and a sync is picked up by the 20-minute TTL with the previous build
 * served while it refreshes. The screen shows when the build was made.
 *
 * ── ⚠ NOT BEHIND THE SUMMARIES ROLLOUT FLAG ─────────────────────────────────────────────────
 *
 * `sports-os.screen-summaries` gates whether EXISTING screens switch from their live loaders to a
 * summary. These insights have no live loader to fall back to: without the store, every portfolio
 * view would run the full build. The flag's question does not apply.
 */

import 'server-only'

import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'
import { easternDateKey, shiftDateKey } from './rankingsEngine'
import { buildPortfolioInsights, dailyValuesOf, latestCaptureDay } from './portfolioInsights'
import type { PortfolioDailyTotals, PortfolioInsights, RecordedValueDay } from './portfolioInsightsTypes'

export const PORTFOLIO_INSIGHTS_SCREEN = 'portfolio-insights'
const TTL_MS = 20 * 60_000
const STALE_WHILE_REVALIDATE_MS = 6 * 60 * 60_000

export const TOTALS_KEY_PREFIX = 'core-portfolio:totals:v1:'
export const TOTALS_RETENTION_DAYS = 400
/** Stored days the chart reads back. A little over the value window, so its first day has a record. */
export const RECORDED_LOOKBACK_DAYS = 35

export function totalsKey(etDate: string, userId: string): string {
  return `${TOTALS_KEY_PREFIX}${etDate}:u=${userId}`
}

/** The league SET — ids and seasons, order-free. See the module header for why not `lastSyncedAt`. */
export function leagueSetFingerprint(rows: ReadonlyArray<{ id: string; season?: number | string | null }>): string {
  const parts = rows.map((r) => `${r.id}@${r.season ?? ''}`).sort()
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}

function isTotals(v: unknown): v is PortfolioDailyTotals {
  if (!v || typeof v !== 'object') return false
  const t = v as Partial<PortfolioDailyTotals>
  return typeof t.date === 'string' && typeof t.builtAt === 'string' && !!t.values && typeof t.values === 'object'
}

/**
 * Record today's values. Keyed by the EASTERN day it was written, holding the CAPTURE day it
 * priced — the chart aligns on the capture day, the writer dedupes on the Eastern one.
 */
export async function writeDailyTotals(
  userId: string,
  insights: PortfolioInsights | null,
  now: Date = new Date(),
  opts: { allowEmpty?: boolean } = {},
): Promise<boolean> {
  const date = insights ? latestCaptureDay(insights) : null
  const values = insights ? dailyValuesOf(insights) : {}
  const hasValues = date != null && Object.keys(values).length > 0
  if (!userId || (!hasValues && !opts.allowEmpty)) return false
  /*
   * An EMPTY record still marks the day done for the scheduled writer. Without it, a user with
   * nothing priced (a basketball-only account) would be retried first on every fire forever and
   * starve everyone queued behind them. It carries no values, so the chart ignores it.
   */
  const record: PortfolioDailyTotals = {
    date: hasValues ? date! : easternDateKey(now),
    builtAt: now.toISOString(),
    values: hasValues ? values : {},
  }
  const key = totalsKey(easternDateKey(now), userId)
  const data = record as unknown as Prisma.InputJsonValue
  const expiresAt = new Date(now.getTime() + TOTALS_RETENTION_DAYS * 86_400_000)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, data, expiresAt },
    update: { data, expiresAt },
  })
  return hasValues
}

/**
 * Stored days for the chart, oldest first, one per capture day.
 *
 * ⚠ TWO EASTERN DAYS CAN PRICE THE SAME CAPTURE DAY — the capture runs at 10:00 UTC, and a day the
 * cron missed carries yesterday's prices. The later write wins: it holds the roster as it stood
 * later, at the same prices, which is the more recent fact about the same day.
 */
export async function readRecordedValueDays(
  userId: string,
  now: Date = new Date(),
  lookbackDays = RECORDED_LOOKBACK_DAYS,
): Promise<RecordedValueDay[]> {
  if (!userId) return []
  const today = easternDateKey(now)
  const keys = Array.from({ length: lookbackDays + 1 }, (_, i) => totalsKey(shiftDateKey(today, -i), userId))
  const rows = await prisma.sportsDataCache
    .findMany({ where: { cacheKey: { in: keys } }, select: { data: true } })
    .catch(() => [] as Array<{ data: unknown }>)
  const byDay = new Map<string, PortfolioDailyTotals>()
  for (const row of rows) {
    if (!isTotals(row.data) || Object.keys(row.data.values).length === 0) continue
    const held = byDay.get(row.data.date)
    if (!held || held.builtAt < row.data.builtAt) byDay.set(row.data.date, row.data)
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({ date: t.date, values: t.values }))
}

registerScreenSummary<PortfolioInsights | null>({
  screen: PORTFOLIO_INSIGHTS_SCREEN,
  /** ⚠ Bump whenever `PortfolioInsights` changes shape — the version is part of the cache key. */
  version: 1,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null
    const now = new Date()
    const insights = await buildPortfolioInsights(userId, now)
    /*
     * The build is the moment the numbers exist, so it is where the day gets recorded. A failed
     * write costs one missing day on the chart, never the page.
     */
    await writeDailyTotals(userId, insights, now).catch(() => false)
    return insights
  },
})

export async function readPortfolioInsights(
  userId: string,
  leagueRows: ReadonlyArray<{ id: string; season?: number | string | null }>,
): Promise<Fresh<PortfolioInsights | null> | null> {
  if (!userId) return null
  return readScreenSummary<PortfolioInsights | null>(
    PORTFOLIO_INSIGHTS_SCREEN,
    { userId, fingerprint: leagueSetFingerprint(leagueRows) },
    { durable: sportsDataCacheTier() },
  )
}

/* ─────────────────────────── the daily writer ─────────────────────────── */

export type PortfolioTotalsCounts = {
  date: string | null
  considered: number
  written: number
  alreadyWritten: number
  empty: number
  failed: number
  deferred: number
  errors: string[]
}

export function emptyPortfolioTotalsCounts(): PortfolioTotalsCounts {
  return { date: null, considered: 0, written: 0, alreadyWritten: 0, empty: 0, failed: 0, deferred: 0, errors: [] }
}

/** Users built per fire. The route fires every 30 minutes, so this reaches ~480 users a day. */
export const TOTALS_USERS_PER_FIRE = 10
export const TOTALS_BUDGET_MS = 45_000
const MAX_CANDIDATES = 5000

/**
 * Record today's values for every user with a claimed team who has not been recorded yet today.
 *
 * ⚠ WHY A SCHEDULED WRITER AT ALL, when the request path records a day on every build: a history
 * nothing writes unless someone visits is a history with holes exactly where the user was away —
 * and "what happened while I was away" is the question the chart is for. The rankings snapshot
 * learned this first; this copies its shape (cheap existence check, bounded work, never throws).
 *
 * `CORE_PORTFOLIO_TOTALS_DISABLED=true` turns it off.
 */
export async function runPortfolioDailyTotals(
  now: Date = new Date(),
  opts: {
    maxUsers?: number
    budgetMs?: number
    /** The host route's shared run budget — checked between users alongside this writer's own cap. */
    budget?: { exhausted(): boolean }
    build?: typeof buildPortfolioInsights
  } = {},
): Promise<PortfolioTotalsCounts> {
  const out = emptyPortfolioTotalsCounts()
  if (String(process.env.CORE_PORTFOLIO_TOTALS_DISABLED ?? '').toLowerCase() === 'true') return out
  const started = Date.now()
  const maxUsers = opts.maxUsers ?? TOTALS_USERS_PER_FIRE
  const budgetMs = opts.budgetMs ?? TOTALS_BUDGET_MS
  const build = opts.build ?? buildPortfolioInsights
  const date = easternDateKey(now)
  out.date = date

  try {
    const owners = await prisma.leagueTeam.findMany({
      where: { claimedByUserId: { not: null } },
      select: { claimedByUserId: true },
      distinct: ['claimedByUserId'],
      take: MAX_CANDIDATES,
    })
    const userIds = owners.map((o) => o.claimedByUserId).filter((u): u is string => Boolean(u))
    out.considered = userIds.length
    if (userIds.length === 0) return out

    const done = new Set<string>()
    for (let i = 0; i < userIds.length; i += 500) {
      const chunk = userIds.slice(i, i + 500)
      const rows = await prisma.sportsDataCache.findMany({
        where: { cacheKey: { in: chunk.map((u) => totalsKey(date, u)) } },
        select: { cacheKey: true },
      })
      for (const r of rows) done.add(r.cacheKey)
    }
    const pending = userIds.filter((u) => !done.has(totalsKey(date, u)))
    out.alreadyWritten = userIds.length - pending.length

    let attempted = 0
    for (const userId of pending) {
      if (attempted >= maxUsers || Date.now() - started > budgetMs || opts.budget?.exhausted()) break
      attempted += 1
      try {
        const insights = await build(userId, now)
        if (await writeDailyTotals(userId, insights, now, { allowEmpty: true })) out.written += 1
        else out.empty += 1
      } catch (e) {
        out.failed += 1
        if (out.errors.length < 5) out.errors.push(`portfolio_totals: ${e instanceof Error ? e.message : String(e)}`)
        /* Marked done for today anyway — a user whose build throws must not block the queue. */
        await writeDailyTotals(userId, null, now, { allowEmpty: true }).catch(() => false)
      }
    }
    out.deferred = pending.length - attempted
  } catch (e) {
    out.failed += 1
    out.errors.push(`portfolio_totals: ${e instanceof Error ? e.message : String(e)}`)
  }
  return out
}
