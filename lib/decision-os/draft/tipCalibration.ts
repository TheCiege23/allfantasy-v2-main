/**
 * DRAFT OS LEARNS HOW SURE TO BE FROM ITS OWN GRADED TIPS (Draft OS Engine axis, 2026-11-21 — owner's "build it now").
 *
 * Every pick tip the decision card or Chimmy serves is recorded with the projections the pool carried at that moment
 * (`recommendationRecorder.ts`, `draft_recommendation_records`). Nothing graded those records except a hand-run
 * script (`scripts/draft-backtest.ts --recorded`), which compares the engine's two modes with each other. This grades
 * the tip that was SERVED against what the manager could realistically have taken instead:
 *
 *   held up — the served pick out-scored the median of the ALTERNATIVES: the DRAFT_TIP_ALTERNATIVES best-projected
 *             other players in that pool, at that moment, standard PPR from the first week not kicked off.
 *
 * and turns the graded tips into a confidence for a pick in that part of the draft:
 *
 *   early  rounds 1–3     middle  rounds 4–8     late  rounds 9+
 *
 * 🛑 THE PICK IS NEVER TOUCHED. Who is recommended, the order, the pick rules and the "what to do" are the engine's.
 * Only the confidence stated beside the pick comes from the record — the rule trades, waivers and the bench check
 * follow.
 *
 * 🛑 NFL ONLY — the ledger's standard-PPR week feed is NFL.
 *
 * 🛑 SILENT UNTIL IT KNOWS. A band says nothing until DRAFT_TIP_MIN_SAMPLE tips were decided; the rate is shrunk
 * toward a coin flip. ⚠ Tips have been recorded only since 2026-11-14, after most NFL drafts, so expect nothing
 * until next season's drafts are graded.
 *
 * Pure: no IO.
 */

import { shrunkWeightedRate } from '@/lib/chimmy-outcomes/shrinkage'

export type DraftRoundBand = 'early' | 'middle' | 'late'

export const DRAFT_TIP_ALTERNATIVES = 12
/** Fewer placed alternatives than this, and the tip is not graded — a median of two is not a market. */
export const DRAFT_TIP_MIN_ALTERNATIVES = 5
export const DRAFT_TIP_MIN_SAMPLE = 20
export const DRAFT_TIP_PRIOR_WEIGHT = 20

export function draftRoundBand(round: number | null | undefined): DraftRoundBand | null {
  if (typeof round !== 'number' || !Number.isFinite(round) || round < 1) return null
  return round <= 3 ? 'early' : round <= 8 ? 'middle' : 'late'
}

export const DRAFT_BAND_LABEL: Record<DraftRoundBand, string> = { early: 'rounds 1–3', middle: 'rounds 4–8', late: 'rounds 9+' }

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * One recorded tip → held up, missed, or null (not gradable). `points(key)` is the player's points over the
 * window, or null when he cannot be placed; keys are the recorder's own `name|position`.
 */
export function gradeDraftTip(input: {
  servedKey: string | null
  /** The pool's projections at the moment, `name|position` → projected points. */
  projections: Readonly<Record<string, number>>
  points: (key: string) => number | null
}): 'held' | 'missed' | null {
  if (!input.servedKey) return null
  const served = input.points(input.servedKey)
  if (served == null || !Number.isFinite(served)) return null
  const alternatives = Object.entries(input.projections)
    .filter(([k, v]) => k !== input.servedKey && typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, DRAFT_TIP_ALTERNATIVES)
    .map(([k]) => input.points(k))
    .filter((p): p is number => p != null && Number.isFinite(p))
  if (alternatives.length < DRAFT_TIP_MIN_ALTERNATIVES) return null
  const bar = median(alternatives)
  return served > bar ? 'held' : served < bar ? 'missed' : null
}

export type DraftTipCounts = { held: number; missed: number }
export type DraftTipLedger = Partial<Record<DraftRoundBand, DraftTipCounts>>

export function foldDraftTips(calls: ReadonlyArray<{ round: number; grade: 'held' | 'missed' | null }>): DraftTipLedger {
  const out: DraftTipLedger = {}
  for (const c of calls) {
    const band = draftRoundBand(c.round)
    if (!band || !c.grade) continue
    const b = (out[band] ??= { held: 0, missed: 0 })
    b[c.grade] += 1
  }
  return out
}

export type DraftTipCalibration = Partial<Record<DraftRoundBand, { heldRate: number; decided: number }>>

const nat = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)

export function draftTipCalibrationFrom(ledger: DraftTipLedger | null | undefined): DraftTipCalibration | null {
  if (!ledger || typeof ledger !== 'object') return null
  const out: DraftTipCalibration = {}
  for (const band of ['early', 'middle', 'late'] as const) {
    const b = ledger[band]
    if (!b || typeof b !== 'object') continue
    const held = nat(b.held)
    const decided = held + nat(b.missed)
    const rate = shrunkWeightedRate(
      { hits: held, n: decided, rawN: decided },
      { priorRate: 0.5, priorWeight: DRAFT_TIP_PRIOR_WEIGHT, minSample: DRAFT_TIP_MIN_SAMPLE },
    )
    if (rate == null || !Number.isFinite(rate)) continue
    out[band] = { heldRate: rate, decided }
  }
  return Object.keys(out).length ? out : null
}

export type DraftTipConfidence = { band: DraftRoundBand; heldPct: number; decided: number; level: 'high' | 'medium' | 'low' }

export function draftTipConfidence(round: number | null | undefined, calibration: DraftTipCalibration | null | undefined): DraftTipConfidence | null {
  const band = draftRoundBand(round)
  const rec = band ? calibration?.[band] : undefined
  if (!band || !rec || !(rec.decided > 0)) return null
  return { band, heldPct: Math.round(rec.heldRate * 100), decided: rec.decided, level: rec.heldRate >= 0.7 ? 'high' : rec.heldRate >= 0.55 ? 'medium' : 'low' }
}

/** The line said beside the pick's own confidence. */
export function draftTipRecordLine(c: DraftTipConfidence): string {
  return (
    `How Draft OS's picks in ${DRAFT_BAND_LABEL[c.band]} have held up: about ${c.heldPct}% out-scored the typical player still on the board ` +
    `(${c.decided} graded picks)${c.level === 'low' ? ', so treat this pick as closer than it looks' : ''}.`
  )
}
