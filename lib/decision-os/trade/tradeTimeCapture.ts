/**
 * WHICH stored market capture prices a completed trade AT THE TIME OF THE TRADE. PURE, client-safe.
 *
 * Guap's ruling (2026-10-03): a completed trade's frozen original grade is priced on the market as it
 * stood when the trade happened — not on the values of the day AllFantasy first read it. The only dated
 * source on the live board's scale is `PlayerValueSnapshot` (FantasyCalc, one capture per UTC day,
 * written by `/api/cron/adp-refresh` → `ingestPlayerValues`). This module decides which capture, if
 * any, a trade may be priced on. Everything that reads the table lives in `./datedMarket.ts`.
 *
 * ── THE CAPTURE RULE ──────────────────────────────────────────────────────────────────────────
 *
 * A capture is STAMPED at UTC midnight of day D (`captureStampFor`) but TAKEN when the cron runs,
 * daily at 10:00 UTC. So a trade at 09:00 UTC on D happened before capture D existed, and is priced
 * on capture D-1; a trade at 11:00 UTC on D is priced on capture D.
 *
 *   - the latest capture TAKEN at or before the trade — never one taken after it, which would price
 *     the deal on news neither manager could have known;
 *   - at most ONE DAY between that capture and the trade. Measured day-to-day drift is 2% (dynasty)
 *     and 4% (redraft) at the median; over a week it is 8% and 18%, with a p90 of 25% and 56–64%.
 *     A week-old capture is not "the market at the time of the trade", so a gap in the series (Aug
 *     17-19, 21, 22 and 27 are missing) leaves the trade uncovered rather than reaching further back.
 *
 * A trade that no capture covers keeps the grade AllFantasy gave it when it first saw it, labelled
 * honestly (Decision 1) — never a grade priced on two dates, and never the historical JSON
 * (`data/historical-values`), which is name-joined and on a different scale.
 */

/** When the daily capture runs (`/api/cron/adp-refresh`, 10:00 UTC). */
export const CAPTURE_TAKEN_HOUR_UTC = 10

/** The most a capture may predate the trade it prices. */
export const MAX_CAPTURE_AGE_MS = 24 * 60 * 60 * 1000

/** Before this capture `ingestPlayerValues` discarded every pick row (`latestPickValueSnapshots.ts`). */
export const FIRST_PICK_CAPTURE_DAY = '2026-09-20'

/** Sleeper's epoch offset in its snowflake transaction ids. */
const SLEEPER_EPOCH_MS = 1454362509301n

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * When Sleeper created a transaction, read off its snowflake id: `(id >> 22) + 1454362509301` epoch ms.
 * Measured against `LeagueTrade.tradeDate`: median 0 s off, p90 72 min (an offer accepted later than it
 * was made). Null for anything that is not a Sleeper transaction id.
 */
export function sleeperTransactionTime(id: string | null | undefined): Date | null {
  const raw = String(id ?? '').split(':').pop()!.trim()
  if (!/^\d{15,20}$/.test(raw)) return null
  try {
    const ms = Number((BigInt(raw) >> 22n) + SLEEPER_EPOCH_MS)
    const at = new Date(ms)
    // Sleeper started in 2016; anything outside a sane window is not a snowflake we can read.
    return Number.isFinite(at.getTime()) && at.getUTCFullYear() >= 2016 && at.getUTCFullYear() < 2100 ? at : null
  } catch {
    return null
  }
}

function asDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === '') return null
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v))
  const t = d.getTime()
  // 0 is Sleeper's "not set" (`status_updated: 0`), not 1970.
  return Number.isFinite(t) && t > 0 ? d : null
}

/**
 * The moment a trade happened: its COMPLETION time when the caller has one (the ledger's `createdIso`,
 * which is Sleeper's `status_updated`), else the transaction id's own timestamp.
 *
 * ⚠ NEVER `dw_transaction_facts.createdAt`: for several writers that is when the row was written,
 * not when the trade happened.
 */
export function tradeTimeOf(args: { completedAt?: string | number | Date | null; tradeId?: string | null }): Date | null {
  return asDate(args.completedAt) ?? sleeperTransactionTime(args.tradeId)
}

/**
 * Is a grade taken at `at` a grade AT THE TIME OF THE TRADE? True when the trade happened at most
 * `MAX_CAPTURE_AGE_MS` before `at` and not after it — the same tolerance a capture is allowed. Then
 * the league's own live chart is the market at the time of the trade (`gradeAtTradeTime`), and a v1
 * original frozen then was already priced at trade time (the re-price carries it).
 */
export function gradedAtTradeTime(tradeAt: Date | null, at: Date | null): boolean {
  if (!tradeAt || !at) return false
  const gap = at.getTime() - tradeAt.getTime()
  return Number.isFinite(gap) && gap >= 0 && gap <= MAX_CAPTURE_AGE_MS
}

/** When capture `day` (YYYY-MM-DD, its UTC-midnight stamp) was taken. */
export function captureTakenAt(day: string): Date {
  return new Date(`${day}T${String(CAPTURE_TAKEN_HOUR_UTC).padStart(2, '0')}:00:00.000Z`)
}

/**
 * The capture a trade at `tradeAt` is priced on, or null when none is close enough. `days` are the
 * capture stamps (YYYY-MM-DD) that exist for the league's book, in any order.
 */
export function chooseTradeTimeCapture(
  days: ReadonlyArray<string>,
  tradeAt: Date | null,
): { day: string; takenAt: string } | null {
  return chooseCaptureTakenAt(
    days.filter((day) => DAY_RE.test(day)).map((day) => ({ day, takenAt: captureTakenAt(day).toISOString() })),
    tradeAt,
  )
}

/**
 * THE SAME RULE, for captures that record when they were really taken — a league's own FantasyCalc
 * profile, captured by the first successful warm of each UTC day (`lib/fantasycalc-profile-capture.ts`)
 * at whatever time that was, not at a fixed hour. The latest capture taken at or before the trade,
 * never after it, at most `MAX_CAPTURE_AGE_MS` older than it.
 */
export function chooseCaptureTakenAt(
  captures: ReadonlyArray<{ day: string; takenAt: string }>,
  tradeAt: Date | null,
): { day: string; takenAt: string } | null {
  if (!tradeAt || !Number.isFinite(tradeAt.getTime())) return null
  let best: { day: string; taken: number } | null = null
  for (const c of captures) {
    if (!DAY_RE.test(c.day)) continue
    const taken = Date.parse(c.takenAt)
    if (!Number.isFinite(taken)) continue
    if (taken > tradeAt.getTime()) continue // taken after the trade: never
    if (!best || taken > best.taken) best = { day: c.day, taken }
  }
  if (!best || tradeAt.getTime() - best.taken > MAX_CAPTURE_AGE_MS) return null
  return { day: best.day, takenAt: new Date(best.taken).toISOString() }
}
