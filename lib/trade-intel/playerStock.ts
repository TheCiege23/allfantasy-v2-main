import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Which way a player's market value has moved over the last thirty days.
 *
 * The data is real and already collected: `PlayerValueSnapshot` carries a daily row per player with
 * `trend30d` populated on 16,567 of 16,567 rows, twenty consecutive capture days, keyed by
 * `sleeperId` — the same id the roster rows already resolve by. Nothing computes anything here; it
 * reads what the snapshot job has already written.
 *
 * ⚠ COVERAGE IS GOOD BUT NOT TOTAL, AND THE GAP HAS A SHAPE. Measured 2026-09-05: 201 of 203 roster
 * players on one league, 183 of 214 on another. Almost every miss is a KICKER or a TEAM DEFENCE —
 * the same positions FantasyCalc does not price at all — so a row with no value usually has no
 * trend either, and the two absences agree rather than contradicting each other.
 */

export type StockDirection = 'up' | 'down' | 'flat'

export type PlayerStock = {
  /** Change in market value over 30 days, in the same units as the value beside it. */
  trend30d: number
  /** The value that change is measured against, which is what makes the threshold meaningful. */
  value: number
  direction: StockDirection
}

/**
 * How much movement counts as movement.
 *
 * 🛑 AN EXACT ZERO IS THE WRONG TEST AND WOULD MAKE `flat` UNREACHABLE. `trend30d` is a raw delta
 * in value units, so a 9,000-point player drifting by 30 is noise that would render as a confident
 * arrow. A threshold proportional to the player's OWN value keeps "no real change" meaning the same
 * thing for a 10,000-point quarterback and a 300-point rookie — an absolute threshold would call
 * every star volatile and every fringe player stable.
 */
const FLAT_BAND = 0.01

export function directionFor(trend30d: number, value: number): StockDirection {
  if (!Number.isFinite(trend30d) || !Number.isFinite(value) || value <= 0) return 'flat'
  if (Math.abs(trend30d) < value * FLAT_BAND) return 'flat'
  return trend30d > 0 ? 'up' : 'down'
}

/**
 * The latest stock reading for each id, in one query.
 *
 * ⚠ THE FORMAT IS A PARAMETER AND MUST MATCH THE VALUE ON THE SAME ROW. The snapshot table holds
 * four series per player — DYNASTY/REDRAFT crossed with ONE_QB/SUPERFLEX — and the rosters route
 * deliberately pins its values to dynasty one-QB so a player cannot carry two different numbers on
 * one screen. An arrow drawn from a different series would contradict the number it sits beside,
 * which is worse than no arrow.
 */
export async function resolvePlayerStock(
  sleeperIds: readonly string[],
  opts: { format?: string; qbFormat?: string } = {},
): Promise<Map<string, PlayerStock>> {
  const out = new Map<string, PlayerStock>()
  const ids = [...new Set(sleeperIds.map((i) => String(i ?? '').trim()).filter(Boolean))]
  if (ids.length === 0) return out

  const format = opts.format ?? 'DYNASTY'
  const qbFormat = opts.qbFormat ?? 'ONE_QB'

  /*
   * `DISTINCT ON` takes the newest row per player in one pass. The alternative — a max(capturedAt)
   * subquery joined back — reads the table twice to answer the same question.
   */
  const rows = await prisma.$queryRaw<Array<{ sleeperId: string; value: number; trend30d: number | null }>>`
    SELECT DISTINCT ON ("sleeperId") "sleeperId", value, "trend30d"
    FROM "PlayerValueSnapshot"
    WHERE "sleeperId" = ANY(${ids})
      AND format = ${format}
      AND "qbFormat" = ${qbFormat}
    ORDER BY "sleeperId", "capturedAt" DESC
  `.catch(() => [] as Array<{ sleeperId: string; value: number; trend30d: number | null }>)

  for (const r of rows) {
    /*
     * ⚠ A NULL TREND IS OMITTED, NOT COERCED TO ZERO. Zero would render a confident "no change"
     * arrow for a player nobody has measured — the same mistake as pricing an unknown asset at 0
     * instead of leaving it unpriced.
     */
    if (r.trend30d == null || !Number.isFinite(Number(r.trend30d))) continue
    const trend30d = Number(r.trend30d)
    const value = Number(r.value)
    out.set(String(r.sleeperId), { trend30d, value, direction: directionFor(trend30d, value) })
  }
  return out
}
