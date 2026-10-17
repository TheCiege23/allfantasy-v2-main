import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import {
  buildFantasyCalcCacheKey,
  type fantasyCalcSettingsForChart,
  parseProfileCapture,
  profileCaptureDayOfKey,
  profileCaptureKey,
  profileCaptureKeyPrefix,
  unpackProfileCapture,
} from '@/lib/fantasycalc-profile-capture'

/*
 * A chart row, typed through the chart rather than imported from `@/lib/fantasycalc`: Decision OS may
 * not import a provider client, even for a type (__tests__/fantasy-os/unified-plane-provider-boundary).
 */
type FantasyCalcPlayer = LeagueTradeChart['fcPlayers'][number]

/** The FantasyCalc profile a league's chart requests (dynasty, QBs, teams, PPR) — typed through the chart. */
export type ChartProfile = ReturnType<typeof fantasyCalcSettingsForChart>

/**
 * THE MARKET AS IT STOOD ON ONE DAY, for pricing a completed trade at the time of the trade.
 *
 * Two dated sources, both FantasyCalc on the live board's scale: the league's OWN profile captured
 * daily from 2026-10-04 (`loadProfileMarket`, below — preferred), and `PlayerValueSnapshot` (source
 * FANTASYCALC, the 12-team PPR-1 books — the fallback, and the only record before that date).
 * Measured read-only on production 2026-10-03: the same player's stored value over
 * the live board's has a median ratio of 1.00 in all four books, and 0.98–1.03 rank-matched over ranks
 * 1–250. The historical JSON (`data/historical-values`) is NOT a substitute: name-joined, clamped to
 * 2026-02-05, and 1.37–4.5× the live board rank-matched.
 *
 * ── WHY THE 12-TEAM PPR CAPTURE IS CLOSE TO THE LEAGUE'S OWN BOARD (BUT NOT IDENTICAL) ─────────
 *
 * `ingestPlayerValues` captures four books — DYNASTY or REDRAFT × SUPERFLEX or ONE_QB — all at 12
 * teams and PPR 1. Team count and reception weight move the FantasyCalc board almost uniformly (8
 * teams 0.984, PPR 0 0.98), and a uniform factor cancels in the percentage gap the letter is taken
 * on. The league's own reception shape is still applied, exactly as on today's chart, by `scoringFit`
 * against the chart's `pprNfl` — this module only replaces the market rows.
 *
 * Every read fails CLOSED to "no capture": a trade that cannot be priced on its date keeps the grade
 * it was first given (Decision 1), it is never priced on today's values under a trade-date label.
 */

/** One of the four stored books (`ingestPlayerValues.COMBOS`). */
export type MarketBook = { format: 'DYNASTY' | 'REDRAFT'; qbFormat: 'SUPERFLEX' | 'ONE_QB' }

/**
 * Which stored board a dated market came from:
 *   - `league_profile` — the league's OWN FantasyCalc profile (its team count, QBs and PPR), captured
 *     daily by the warm cron from 2026-10-04 (`loadProfileMarket`);
 *   - `standard_12_ppr1` — FantasyCalc's 12-team PPR-1 book for the league's dynasty/SF combination,
 *     `PlayerValueSnapshot` (`loadDatedMarket`), the fallback when the league's own is missing.
 */
export type DatedMarketSource = 'league_profile' | 'standard_12_ppr1'

/** One day's capture of one book, in the shape the league chart prices from. */
export type DatedMarket = {
  /** The capture stamp, YYYY-MM-DD (UTC midnight). */
  capturedOn: string
  book: MarketBook
  /** Players AND pick rows (position 'PICK' — stored from 2026-09-20 only). */
  players: FantasyCalcPlayer[]
  /** Absent means `standard_12_ppr1` — every market before the league-profile capture existed. */
  source?: DatedMarketSource
}

export function marketBookFor(chart: { chartIsDynasty: boolean; isSuperFlex: boolean }): MarketBook {
  return { format: chart.chartIsDynasty ? 'DYNASTY' : 'REDRAFT', qbFormat: chart.isSuperFlex ? 'SUPERFLEX' : 'ONE_QB' }
}

const bookKey = (b: MarketBook) => `${b.format}:${b.qbFormat}`

/*
 * Capture days per book. A new capture lands once a day, so a short memo costs at most one late
 * capture per half hour — and a capture missing from the memo only means a trade made in the last
 * few minutes waits for the next read to be priced on its date, never that it is priced wrongly.
 */
const DAYS_TTL_MS = 30 * 60 * 1000
const daysMemo = new Map<string, { at: number; days: Promise<string[]> }>()

/** The capture stamps (YYYY-MM-DD) that exist for one book. Never throws: [] means no evidence. */
export function loadCaptureDays(book: MarketBook): Promise<string[]> {
  const key = bookKey(book)
  const hit = daysMemo.get(key)
  if (hit && Date.now() - hit.at < DAYS_TTL_MS) return hit.days
  const days = (async () => {
    // Raw: Prisma's `distinct` de-duplicates in the engine AFTER reading every row (~500 a day per book).
    const rows = await prisma.$queryRaw<Array<{ day: string }>>(Prisma.sql`
      SELECT DISTINCT to_char(p."capturedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day"
      FROM "PlayerValueSnapshot" p
      WHERE p."source" = 'FANTASYCALC' AND p."format" = ${book.format} AND p."qbFormat" = ${book.qbFormat}
    `)
    return rows.map((r) => String(r.day)).sort()
  })().catch(() => {
    daysMemo.delete(key) // a failed read is not cached as "no captures"
    return [] as string[]
  })
  daysMemo.set(key, { at: Date.now(), days })
  return days
}

/*
 * A past day's capture never changes (`skipDuplicates`, append-only), so a loaded day is kept for as
 * long as the process lives — bounded, because a history page touches a handful of distinct days.
 */
const MARKET_MEMO_MAX = 64
const marketMemo = new Map<string, Promise<DatedMarket | null>>()

type SnapshotRow = {
  sleeperId: string
  name: string
  position: string | null
  value: number
  overallRank: number | null
  positionRank: number | null
  trend30d: number | null
  tradeFrequency: number | null
  marketStdDev: number | null
}

/** A stored row in the chart's shape. Fields FantasyCalc publishes that were never stored are null/0. */
export function fantasyCalcPlayerFromSnapshot(r: SnapshotRow): FantasyCalcPlayer {
  return {
    player: {
      id: 0,
      name: r.name,
      mflId: '',
      sleeperId: r.sleeperId,
      position: r.position ?? '',
      maybeBirthday: null,
      maybeHeight: null,
      maybeWeight: null,
      maybeCollege: null,
      maybeTeam: null,
      maybeAge: null,
      maybeYoe: null,
      espnId: null,
      fleaflickerId: null,
    },
    value: r.value,
    overallRank: r.overallRank ?? 0,
    positionRank: r.positionRank ?? 0,
    trend30Day: r.trend30d ?? 0,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: 0,
    combinedValue: 0,
    maybeMovingStandardDeviation: r.marketStdDev,
    maybeMovingStandardDeviationPerc: null,
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: false,
    maybeOwner: null,
    starter: false,
    maybeTier: null,
    maybeAdp: null,
    maybeTradeFrequency: r.tradeFrequency,
  }
}

/** One book's capture on one day, or null when there is none (or it cannot be read). Never throws. */
export function loadDatedMarket(book: MarketBook, day: string): Promise<DatedMarket | null> {
  const key = `${bookKey(book)}:${day}`
  const hit = marketMemo.get(key)
  if (hit) return hit
  const at = new Date(`${day}T00:00:00.000Z`)
  const load = (async () => {
    if (!Number.isFinite(at.getTime())) return null
    const rows = (await prisma.playerValueSnapshot.findMany({
      where: { source: 'FANTASYCALC', format: book.format, qbFormat: book.qbFormat, capturedAt: at },
      select: {
        sleeperId: true, name: true, position: true, value: true, overallRank: true, positionRank: true,
        trend30d: true, tradeFrequency: true, marketStdDev: true,
      },
    })) as SnapshotRow[]
    if (rows.length === 0) return null
    return { capturedOn: day, book, players: rows.map(fantasyCalcPlayerFromSnapshot) }
  })().catch(() => null)
  marketMemo.set(key, load)
  // A failure or an empty day is not memoised: the next read asks again.
  void load.then((m) => { if (!m) marketMemo.delete(key) })
  if (marketMemo.size > MARKET_MEMO_MAX) marketMemo.delete(marketMemo.keys().next().value!)
  return load
}

/* ── THE LEAGUE'S OWN PROFILE, CAPTURED DAILY (2026-10-04) ──────────────────────────────────────
 *
 * The `standard_12_ppr1` book above is FantasyCalc's generic board; a league is priced live on its
 * OWN profile (`fantasyCalcSettingsForChart`). The warm cron now stores each profile once per UTC day
 * (`lib/fantasycalc-profile-capture.ts`, a `SportsDataCache` row), so a trade graded later is priced on
 * exactly the board its league's chart would have requested — and on the 12-team book only when that
 * capture is missing (`completedTradeGrade.gradeAtTradeTime`). Captures exist from deploy onward; no
 * backfill. Read-only here: the cron is the only writer.
 */

/** A profile's FantasyCalc book, in `PlayerValueSnapshot`'s terms. */
export function marketBookForProfile(profile: ChartProfile): MarketBook {
  return { format: profile.isDynasty ? 'DYNASTY' : 'REDRAFT', qbFormat: profile.numQbs === 2 ? 'SUPERFLEX' : 'ONE_QB' }
}

/*
 * The same 30-minute memo as `loadCaptureDays`, and it cannot hide a capture a grade needs: a trade is
 * priced from a capture only when graded more than a day after it, and the capture it needs was taken
 * at or before the trade — so it had existed for over a day before any memo that could miss it.
 */
const profileCapturesMemo = new Map<string, { at: number; captures: Promise<Array<{ day: string; takenAt: string }>> }>()

/**
 * When each stored capture of this profile was TAKEN (its real time — the row's `createdAt`, written
 * as the capture's `capturedAt`). Keys only, never the boards. Never throws: [] means no evidence.
 */
export function loadProfileCaptures(profile: ChartProfile): Promise<Array<{ day: string; takenAt: string }>> {
  const key = buildFantasyCalcCacheKey(profile)
  const hit = profileCapturesMemo.get(key)
  if (hit && Date.now() - hit.at < DAYS_TTL_MS) return hit.captures
  const captures = (async () => {
    const rows = await prisma.sportsDataCache.findMany({
      where: { cacheKey: { startsWith: profileCaptureKeyPrefix(profile) } },
      select: { cacheKey: true, createdAt: true },
    })
    const out: Array<{ day: string; takenAt: string }> = []
    for (const r of rows) {
      const day = profileCaptureDayOfKey(profile, r.cacheKey)
      if (day && r.createdAt instanceof Date && Number.isFinite(r.createdAt.getTime())) out.push({ day, takenAt: r.createdAt.toISOString() })
    }
    return out.sort((a, b) => a.day.localeCompare(b.day))
  })().catch(() => {
    profileCapturesMemo.delete(key) // a failed read is not cached as "no captures"
    return [] as Array<{ day: string; takenAt: string }>
  })
  profileCapturesMemo.set(key, { at: Date.now(), captures })
  return captures
}

/**
 * One profile's capture on one day, as a dated market — or null when there is none, it will not
 * parse, or it is not this profile's board. Never throws. Memoised with the 12-team captures: a past
 * day's capture is write-once (`INSERT … ON CONFLICT DO NOTHING`) and never changes.
 */
export function loadProfileMarket(profile: ChartProfile, day: string): Promise<DatedMarket | null> {
  const cacheKey = profileCaptureKey(profile, day)
  const memoKey = `profile:${cacheKey}`
  const hit = marketMemo.get(memoKey)
  if (hit) return hit
  const load = (async () => {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey }, select: { data: true } })
    const capture = row ? parseProfileCapture(row.data) : null
    // The payload must describe the board the key names — never price a league on another profile.
    if (!capture || capture.profileKey !== buildFantasyCalcCacheKey(profile)) return null
    const players = unpackProfileCapture(capture)
    if (players.length === 0) return null
    return { capturedOn: day, book: marketBookForProfile(profile), players, source: 'league_profile' as const }
  })().catch(() => null)
  marketMemo.set(memoKey, load)
  void load.then((m) => { if (!m) marketMemo.delete(memoKey) })
  if (marketMemo.size > MARKET_MEMO_MAX) marketMemo.delete(marketMemo.keys().next().value!)
  return load
}

/** Test seam: forget memoised captures. */
export function clearDatedMarketMemo(): void {
  daysMemo.clear()
  marketMemo.clear()
  profileCapturesMemo.clear()
}
