/**
 * MY TEAM'S BENCH CHECK LEARNS FROM ITS OWN GRADED CALLS (Lineup OS, 2026-11-21, owner's call).
 *
 * The bench check tells a manager to start a bench player over a starter when the bench player projects at least
 * BENCH_SWAP_POINTS more (`rosterSlots.ts`). Every such call is recorded with both projections (`benchCheckLedger.ts`)
 * and graded once the games are played: right, wrong, or the same within LEDGER_SAME_BAND (`ledgerRecord.ts`). Until
 * now that grade fed nothing: a 2.5-point edge and a 12-point edge were offered with the same certainty.
 *
 * This turns the graded calls into a confidence for the call being made, by the size of its projected edge:
 *
 *   narrow  2–4 points     clear  4–8 points     wide  8+ points
 *
 * 🛑 THE CALL IS NEVER TOUCHED. Which bench player is suggested, the verdict, the threshold and the lineup are all the
 * engine's. Only the confidence stated beside the call comes from the record — the owner's rule, the same as the
 * waiver engine's (`decision-os/waiver/calibration.ts`).
 *
 * 🛑 NFL ONLY. The record is graded in each league's own weekly points, and the edge bands are in points: a 4-point edge
 * is a different call in basketball. Only NFL calls are folded, and only NFL calls are given a confidence.
 *
 * 🛑 ONE BAD WEEK MOVES NOTHING. A band says nothing until BENCH_CALIBRATION_MIN_SAMPLE calls in it were decided (a tie
 * decides nothing); its right-rate is shrunk toward a coin flip, worth BENCH_CALIBRATION_PRIOR_WEIGHT calls, and
 * decayed by age.
 *
 * Pure: no IO. The snapshot fold, My Team and Chimmy's lineup answer share these rules.
 */

import { decayWeight, shrunkWeightedRate } from '@/lib/chimmy-outcomes/shrinkage'
import { BENCH_SWAP_POINTS } from '@/lib/core-app/rosterSlots'

export type BenchEdgeBand = 'narrow' | 'clear' | 'wide'
export type BenchCallGrade = 'right' | 'wrong' | 'same'

/** The swap threshold itself: an edge below it is a "close" call, never a recorded swap. One rule, imported. */
export const BENCH_EDGE_FLOOR = BENCH_SWAP_POINTS
/** A band says nothing until this many of its calls were decided (right or wrong)… */
export const BENCH_CALIBRATION_MIN_SAMPLE = 20
/** …and its rate is shrunk toward a coin flip, worth this many decided calls. */
export const BENCH_CALIBRATION_PRIOR_WEIGHT = 20
/** A graded call's weight halves every four weeks — the start/sit record's half-life. */
export const BENCH_CALIBRATION_HALF_LIFE_DAYS = 28

/** The one rule mapping a projected edge (points) to its band. Null under the swap threshold. */
export function benchEdgeBand(edge: number): BenchEdgeBand | null {
  if (typeof edge !== 'number' || !Number.isFinite(edge) || edge < BENCH_EDGE_FLOOR) return null
  return edge < 4 ? 'narrow' : edge < 8 ? 'clear' : 'wide'
}

export const BENCH_EDGE_LABEL: Record<BenchEdgeBand, string> = { narrow: '2–4 points', clear: '4–8 points', wide: '8+ points' }

/** Raw and decayed counts for one band. */
export type BenchEdgeCounts = {
  n: number
  right: number
  wrong: number
  same: number
  /** Decayed weight of the decided calls, and of the right ones. */
  wDecided: number
  wRight: number
}

export type BenchEdgeLedger = Partial<Record<BenchEdgeBand, BenchEdgeCounts>>

export type GradedBenchCall = { edge: number; call: BenchCallGrade; ageDays: number }

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/** Graded calls → per-band counts. An edge outside the bands is dropped, never clamped into one. */
export function foldBenchEdgeBands(calls: readonly GradedBenchCall[]): BenchEdgeLedger {
  const out: BenchEdgeLedger = {}
  for (const c of calls) {
    const band = benchEdgeBand(c.edge)
    if (!band || (c.call !== 'right' && c.call !== 'wrong' && c.call !== 'same')) continue
    const b = (out[band] ??= { n: 0, right: 0, wrong: 0, same: 0, wDecided: 0, wRight: 0 })
    b.n += 1
    b[c.call] += 1
    if (c.call === 'same') continue
    const w = decayWeight(c.ageDays, BENCH_CALIBRATION_HALF_LIFE_DAYS)
    b.wDecided += w
    if (c.call === 'right') b.wRight += w
  }
  for (const b of Object.values(out)) {
    if (!b) continue
    b.wDecided = round4(b.wDecided)
    b.wRight = round4(b.wRight)
  }
  return out
}

export type BenchBandRecord = {
  /** Share of decided calls that were right, shrunk toward 0.5 — 0–1. */
  rightRate: number
  /** Decided calls behind it (ties excluded). */
  decided: number
}

export type BenchCalibration = Partial<Record<BenchEdgeBand, BenchBandRecord>>

/** Each band with enough decided calls, its right-rate shrunk toward a coin flip. Null when none qualifies. */
export function benchCalibrationFrom(bands: BenchEdgeLedger | null | undefined): BenchCalibration | null {
  if (!bands || typeof bands !== 'object') return null
  const out: BenchCalibration = {}
  for (const band of ['narrow', 'clear', 'wide'] as const) {
    const b = bands[band]
    if (!b) continue
    const decided = b.right + b.wrong
    const rate = shrunkWeightedRate(
      { hits: b.wRight, n: b.wDecided, rawN: decided },
      { priorRate: 0.5, priorWeight: BENCH_CALIBRATION_PRIOR_WEIGHT, minSample: BENCH_CALIBRATION_MIN_SAMPLE },
    )
    if (rate == null || !Number.isFinite(rate)) continue
    out[band] = { rightRate: rate, decided }
  }
  return Object.keys(out).length > 0 ? out : null
}

export type BenchConfidenceLevel = 'high' | 'medium' | 'low'

/** What the record says about a call of this size. */
export type BenchCallRecord = { band: BenchEdgeBand; rightPct: number; decided: number; level: BenchConfidenceLevel }

/** The record for a call with this projected edge, or null when its band has none (the call is shown as before). */
export function benchCallRecord(edge: number, calibration: BenchCalibration | null | undefined): BenchCallRecord | null {
  const band = benchEdgeBand(edge)
  const rec = band ? calibration?.[band] : undefined
  if (!band || !rec || !(rec.decided > 0) || !Number.isFinite(rec.rightRate)) return null
  const rightPct = Math.round(rec.rightRate * 100)
  const level: BenchConfidenceLevel = rec.rightRate >= 0.7 ? 'high' : rec.rightRate >= 0.55 ? 'medium' : 'low'
  return { band, rightPct, decided: rec.decided, level }
}
