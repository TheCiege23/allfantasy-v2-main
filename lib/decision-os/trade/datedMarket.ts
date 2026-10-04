import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'

/**
 * THE MARKET AS IT STOOD ON ONE DAY, for pricing a completed trade at the time of the trade.
 *
 * Read from `PlayerValueSnapshot` (source FANTASYCALC) and nothing else — the one dated source on the
 * live board's scale. Measured read-only on production 2026-10-03: the same player's stored value over
 * the live board's has a median ratio of 1.00 in all four books, and 0.98–1.03 rank-matched over ranks
 * 1–250. The historical JSON (`data/historical-values`) is NOT a substitute: name-joined, clamped to
 * 2026-02-05, and 1.37–4.5× the live board rank-matched.
 *
 * ── WHY THE 12-TEAM PPR CAPTURE IS THE LEAGUE'S OWN BOARD ────────────────────────────────────
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

/** One day's capture of one book, in the shape the league chart prices from. */
export type DatedMarket = {
  /** The capture stamp, YYYY-MM-DD (UTC midnight). */
  capturedOn: string
  book: MarketBook
  /** Players AND pick rows (position 'PICK' — stored from 2026-09-20 only). */
  players: FantasyCalcPlayer[]
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

/** Test seam: forget memoised captures. */
export function clearDatedMarketMemo(): void {
  daysMemo.clear()
  marketMemo.clear()
}
