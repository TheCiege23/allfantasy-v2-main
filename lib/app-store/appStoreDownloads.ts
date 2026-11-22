import 'server-only'

import { prisma } from '@/lib/prisma'
import { fetchDailySalesReport, readAppStoreConfig, type AppStoreConfig } from './appStoreSalesFetch'

/**
 * App Store download counts for the admin Apps page, read through the durable cache.
 *
 * Apple publishes one Summary Sales Report per day (Pacific time), usually by the next
 * morning. A past day's report never changes, so each day is cached in `sportsDataCache`
 * for a year: a 30-day window costs up to 30 Apple calls once, then one indexed read.
 *
 * ⚠ A 404 MEANS TWO THINGS. Apple answers 404 both for "nothing happened that day" and
 * for "not published yet". So a 404 for yesterday is PENDING (left out, not cached); a
 * 404 two or more days back is a real zero (cached briefly at 2 days, for a year after).
 * A failed read is never cached and never shown as zero.
 */

const DAY_MS = 86_400_000
const SETTLED_TTL_MS = 365 * DAY_MS
const RECENT_TTL_MS = 6 * 60 * 60 * 1000
const PREFIX = 'appstore:sales:v1:'
const CONCURRENCY = 5

/** Product Type Identifiers (App Store Connect reporting reference). */
const FIRST_DOWNLOAD = new Set(['1', '1F', '1T', 'F1', '1E', '1EP', '1EU'])
const REDOWNLOAD = new Set(['3', '3F', '3T', 'F3'])

export type AppStoreDay = { date: string; downloads: number; redownloads: number }

export type AppStoreDownloadsResult =
  | { status: 'ok'; days: AppStoreDay[]; through: string | null; scopedToApp: boolean }
  | { status: 'not_configured'; missing: string[] }
  | { status: 'error'; reason: string }

/**
 * Downloads and re-downloads in one report. Returns null when the header has no
 * Units / Product Type Identifier column, so a format change reads as "unreadable",
 * never as zero.
 */
export function parseSalesReport(tsv: string, appId: string | null): { downloads: number; redownloads: number } | null {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return null
  const header = lines[0]!.split('\t').map((h) => h.trim().toLowerCase())
  const typeIdx = header.indexOf('product type identifier')
  const unitsIdx = header.indexOf('units')
  const appIdx = header.indexOf('apple identifier')
  if (typeIdx < 0 || unitsIdx < 0) return null
  let downloads = 0
  let redownloads = 0
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    if (appId && appIdx >= 0 && cells[appIdx]?.trim() !== appId) continue
    const type = cells[typeIdx]?.trim() ?? ''
    const units = Number(cells[unitsIdx]?.trim())
    if (!Number.isFinite(units)) continue
    if (FIRST_DOWNLOAD.has(type)) downloads += units
    else if (REDOWNLOAD.has(type)) redownloads += units
  }
  return { downloads, redownloads }
}

/** YYYY-MM-DD in Pacific time — the calendar Apple's daily reports use. */
export function pacificDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** The `count` report days ending yesterday (Pacific), newest first. */
export function reportDates(now: Date, count: number): string[] {
  const today = new Date(`${pacificDate(now)}T12:00:00Z`)
  return Array.from({ length: count }, (_, i) => new Date(today.getTime() - (i + 1) * DAY_MS).toISOString().slice(0, 10))
}

type Db = Pick<typeof prisma, 'sportsDataCache'>
type Cached = { downloads: number; redownloads: number }
type DayOutcome = { date: string; value: Cached | 'pending' }

async function readDay(
  db: Db,
  config: AppStoreConfig,
  date: string,
  ageDays: number,
  now: Date,
  fetchImpl?: typeof fetch,
): Promise<DayOutcome> {
  const key = `${PREFIX}${config.vendorNumber}:${config.appId ?? 'all'}:${date}`
  const hit = await db.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
  if (hit && hit.expiresAt > now && hit.data && typeof hit.data === 'object') return { date, value: hit.data as Cached }

  const tsv = await fetchDailySalesReport(config, date, fetchImpl)
  if (tsv === null && ageDays <= 1) return { date, value: 'pending' }
  const parsed = tsv === null ? { downloads: 0, redownloads: 0 } : parseSalesReport(tsv, config.appId)
  if (!parsed) throw new Error(`Could not read the App Store report for ${date}`)
  const ttl = ageDays >= 3 ? SETTLED_TTL_MS : RECENT_TTL_MS
  const expiresAt = new Date(now.getTime() + ttl)
  await db.sportsDataCache
    .upsert({ where: { cacheKey: key }, update: { data: parsed as never, expiresAt }, create: { cacheKey: key, data: parsed as never, expiresAt } })
    .catch(() => undefined)
  return { date, value: parsed }
}

/** Never throws. `days` report days ending yesterday (Pacific). */
export async function getAppStoreDownloads(opts: {
  days: number
  now?: Date
  db?: Db
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
}): Promise<AppStoreDownloadsResult> {
  const cfg = readAppStoreConfig(opts.env)
  if (!cfg.ok) return { status: 'not_configured', missing: cfg.missing }
  const now = opts.now ?? new Date()
  const db = opts.db ?? prisma
  const dates = reportDates(now, opts.days)
  try {
    const outcomes: DayOutcome[] = []
    for (let i = 0; i < dates.length; i += CONCURRENCY) {
      const batch = dates.slice(i, i + CONCURRENCY)
      outcomes.push(...(await Promise.all(batch.map((d, j) => readDay(db, cfg.config, d, i + j + 1, now, opts.fetchImpl)))))
    }
    const days = outcomes
      .filter((o): o is { date: string; value: Cached } => o.value !== 'pending')
      .map((o) => ({ date: o.date, ...o.value }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { status: 'ok', days, through: days.at(-1)?.date ?? null, scopedToApp: Boolean(cfg.config.appId) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', reason: /abort|timeout/i.test(message) ? 'App Store Connect did not respond in time' : message }
  }
}
