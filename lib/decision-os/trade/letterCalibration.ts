/**
 * THE TRADE GRADE LEARNS HOW SURE TO BE FROM ITS OWN GRADED DEALS (Trade OS, 2026-11-21, owner's "build Trade OS
 * out to 100%").
 *
 * Every trade grade is saved with its receipt, and the ledger grades the deal once the weeks are played
 * (`tradeLedger.ts`): did the side we graded out-score what it gave up? Until now that grade was reported beside the
 * letter as raw numbers — the letter's average net points and how often it came out ahead — and fed nothing else, so
 * an A whose deals had come out ahead four times in five and an A that was a coin flip were offered with the same
 * certainty.
 *
 * This turns each letter's graded deals into a confidence for that letter:
 *
 *   A or B  held up when the graded side OUT-scored what it gave up
 *   D or F  held up when the graded side was OUT-scored
 *   C       promises no direction, so it has no confidence; a tie decides nothing
 *
 * 🛑 THE LETTER IS NEVER TOUCHED. The grade, the values behind it, the verdict and every counter-offer are the trade
 * engine's. Only the confidence stated beside the letter comes from the record — the rule the waiver engine
 * (`decision-os/waiver/calibration.ts`) and My Team's bench check (`decision-os/lineup/benchCalibration.ts`) follow.
 * The owner declined letting graded deals move letters (2026-11-20); this does not.
 *
 * 🛑 ONLY WHERE THE LEDGER'S MEASURE FITS THE GRADE: NFL redraft (`letterRecordApplies` in
 * `chimmy-outcomes/engineRecord.ts`). A dynasty deal is priced for years, not the weeks the ledger measures.
 *
 * 🛑 ONE BAD MONTH MOVES NOTHING. A letter says nothing until TRADE_CONFIDENCE_MIN_SAMPLE of its deals were decided;
 * its held-up rate is shrunk toward a coin flip, worth TRADE_CONFIDENCE_PRIOR_WEIGHT deals, and decayed by age.
 *
 * Pure: no IO. The ledger fold, the Trade Center, the commissioner's review and Chimmy share these rules.
 */

import { decayWeight, shrunkWeightedRate } from '@/lib/chimmy-outcomes/shrinkage'

/** The letters that promise a direction, and so can be right or wrong. */
export const DIRECTIONAL_LETTERS = ['A', 'B', 'D', 'F'] as const
export type DirectionalLetter = (typeof DIRECTIONAL_LETTERS)[number]

/** A letter says nothing until this many of its deals were decided (came out ahead or behind)… */
export const TRADE_CONFIDENCE_MIN_SAMPLE = 20
/** …and its rate is shrunk toward a coin flip, worth this many decided deals. */
export const TRADE_CONFIDENCE_PRIOR_WEIGHT = 20
/** A graded deal's weight halves every six weeks: a deal is graded over the rest of the season, not one week. */
export const TRADE_CONFIDENCE_HALF_LIFE_DAYS = 42

/** Raw and decayed counts for one letter. */
export type TradeLetterCounts = {
  held: number
  missed: number
  /** Decayed weight of the decided deals, and of the ones that held up. */
  wDecided: number
  wHeld: number
}

export type TradeLetterLedger = Partial<Record<DirectionalLetter, TradeLetterCounts>>

/** One graded deal: the letter its graded side was given, that side's net points per week, and how old the grade is. */
export type GradedTradeCall = { letter: string; netPerWeek: number; ageDays: number }

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

const directional = (letter: unknown): DirectionalLetter | null => {
  const l = typeof letter === 'string' ? letter.trim().charAt(0).toUpperCase() : ''
  return (DIRECTIONAL_LETTERS as readonly string[]).includes(l) ? (l as DirectionalLetter) : null
}

/** Did the deal go the way its letter said? Null for C, a tie, or anything unreadable — those decide nothing. */
export function letterHeldUp(letter: string, netPerWeek: number): boolean | null {
  const l = directional(letter)
  if (!l || typeof netPerWeek !== 'number' || !Number.isFinite(netPerWeek) || netPerWeek === 0) return null
  return (l === 'A' || l === 'B') === netPerWeek > 0
}

/** Graded deals → per-letter counts. A deal that decides nothing is dropped, never counted against its letter. */
export function foldTradeLetterCalls(calls: readonly GradedTradeCall[]): TradeLetterLedger {
  const out: TradeLetterLedger = {}
  for (const c of calls) {
    const held = letterHeldUp(c.letter, c.netPerWeek)
    const l = directional(c.letter)
    if (held == null || !l) continue
    const b = (out[l] ??= { held: 0, missed: 0, wDecided: 0, wHeld: 0 })
    const w = decayWeight(Math.max(0, Number.isFinite(c.ageDays) ? c.ageDays : 0), TRADE_CONFIDENCE_HALF_LIFE_DAYS)
    b.wDecided += w
    if (held) {
      b.held += 1
      b.wHeld += w
    } else {
      b.missed += 1
    }
  }
  for (const b of Object.values(out)) {
    if (!b) continue
    b.wDecided = round4(b.wDecided)
    b.wHeld = round4(b.wHeld)
  }
  return out
}

export type TradeLetterRate = {
  /** Share of decided deals that held up, shrunk toward 0.5 — 0–1. */
  heldRate: number
  /** Decided deals behind it. */
  decided: number
}

export type TradeLetterCalibration = Partial<Record<DirectionalLetter, TradeLetterRate>>

const nat = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)

/** Each letter with enough decided deals, its held-up rate shrunk toward a coin flip. Null when none qualifies. */
export function tradeLetterCalibrationFrom(ledger: TradeLetterLedger | null | undefined): TradeLetterCalibration | null {
  if (!ledger || typeof ledger !== 'object') return null
  const out: TradeLetterCalibration = {}
  for (const letter of DIRECTIONAL_LETTERS) {
    const b = ledger[letter]
    if (!b || typeof b !== 'object') continue
    const decided = Math.floor(nat(b.held)) + Math.floor(nat(b.missed))
    const rate = shrunkWeightedRate(
      { hits: Math.min(nat(b.wHeld), nat(b.wDecided)), n: nat(b.wDecided), rawN: decided },
      { priorRate: 0.5, priorWeight: TRADE_CONFIDENCE_PRIOR_WEIGHT, minSample: TRADE_CONFIDENCE_MIN_SAMPLE },
    )
    if (rate == null || !Number.isFinite(rate)) continue
    out[letter] = { heldRate: rate, decided }
  }
  return Object.keys(out).length > 0 ? out : null
}

export type TradeConfidenceLevel = 'high' | 'medium' | 'low'

/** What the record says about a grade of this letter. */
export type TradeLetterConfidence = { letter: DirectionalLetter; heldPct: number; decided: number; level: TradeConfidenceLevel }

/** The one rule mapping a held-up rate to a level: the bench check's bands. */
export function tradeConfidenceLevel(heldRate: number): TradeConfidenceLevel {
  return heldRate >= 0.7 ? 'high' : heldRate >= 0.55 ? 'medium' : 'low'
}

/** The confidence for a grade of this letter, or null when its letter has no record (the grade is shown as before). */
export function tradeLetterConfidence(
  letter: string | null | undefined,
  calibration: TradeLetterCalibration | null | undefined,
): TradeLetterConfidence | null {
  const l = directional(letter)
  const rec = l ? calibration?.[l] : undefined
  if (!l || !rec || !(rec.decided > 0) || !Number.isFinite(rec.heldRate)) return null
  return { letter: l, heldPct: Math.round(rec.heldRate * 100), decided: rec.decided, level: tradeConfidenceLevel(rec.heldRate) }
}

/** Only a well-formed calibration survives a trip to the client. */
export function readTradeLetterCalibration(value: unknown): TradeLetterCalibration | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: TradeLetterCalibration = {}
  for (const letter of DIRECTIONAL_LETTERS) {
    const r = (value as Record<string, unknown>)[letter] as { heldRate?: unknown; decided?: unknown } | undefined
    if (!r || typeof r !== 'object') continue
    if (typeof r.heldRate !== 'number' || !Number.isFinite(r.heldRate) || r.heldRate < 0 || r.heldRate > 1) continue
    if (typeof r.decided !== 'number' || !Number.isFinite(r.decided) || r.decided <= 0) continue
    out[letter] = { heldRate: r.heldRate, decided: Math.floor(r.decided) }
  }
  return Object.keys(out).length > 0 ? out : null
}
