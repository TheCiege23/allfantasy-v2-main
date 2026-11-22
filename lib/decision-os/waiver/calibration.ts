/**
 * THE WAIVER ENGINE LEARNS FROM ITS OWN TOP CLAIMS (Waiver OS, 2026-11-20 re-score push).
 *
 * The engine scores every free agent 0–100 (`compositeScore`), and the card and the waiver panel turn
 * the top claim's score into a confidence: High from 80, Medium from 50. Until now nothing checked
 * whether a High claim actually worked out more often than a Medium one. The advice ledger now grades
 * the engine's #1 claim — recorded every week by the scheduled run (`weeklyEngineCalls.ts`) and when
 * the panel shows it — on one question: did he average a startable 10+ PPR over the three weeks after
 * the claim (`ledgerRecord.ts`, STARTABLE_PPR_PER_WEEK / ADD_WINDOW_WEEKS)? This file turns those
 * grades into a bounded correction to the confidence, the same way the start/sit rubric uses its
 * track record (`lib/chimmy-chat/confidence-rubric.ts`, step 8).
 *
 * 🛑 THE RANKING IS NEVER TOUCHED. Only the confidence shown beside the top claim moves. Which player
 * is #1, his score in the list, and the FAAB bid all stay the engine's.
 *
 * 🛑 ONLY WHERE THE LEDGER MEASURES WHAT THE LEAGUE SCORES. `engineRecord.ts` reports the ledger and
 * never applies it, and its reason is right in general: the ledger measures standard PPR, players only,
 * redraft only. So the correction applies only inside exactly that scope — a redraft NFL league that
 * scores a full point per reception (`isWaiverCalibrationScope`). There "averaged 10+ PPR" IS the
 * league's own measure of a startable pickup, and nothing is being invented. Everywhere else the
 * engine's confidence is shown unchanged, and the scheduled run records nothing.
 *
 * 🛑 ONE BAD WEEK MOVES NOTHING. A band says nothing below WAIVER_CALIBRATION_MIN_SAMPLE graded claims;
 * above it the observed rate is shrunk toward the confidence the claims were scored at (worth
 * WAIVER_CALIBRATION_PRIOR_WEIGHT claims) and decayed by age; the delta is half the gap, capped at
 * ±WAIVER_CALIBRATION_MAX_DELTA. Thin evidence moves the score by almost nothing.
 *
 * ⚠ THE RECORDED SCORE IS THE ENGINE'S RAW SCORE, never the corrected one. Correcting a score and then
 * grading the corrected score would chase its own tail; grading the raw score keeps the correction a
 * stable "raw → what actually happened" offset.
 *
 * Pure: no IO. The snapshot fold, the cron, the card and the panel all share these rules.
 */

import { normalizeLeagueScoring } from '@/lib/league-context-engine/normalizeScoring'
import { decayWeight, shrunkWeightedRate } from '@/lib/chimmy-outcomes/shrinkage'

export type WaiverConfidenceBand = 'high' | 'medium' | 'low'

/** A band says nothing until this many of its claims are graded… */
export const WAIVER_CALIBRATION_MIN_SAMPLE = 20
/** …and is shrunk toward the score it was given, worth this many claims. */
export const WAIVER_CALIBRATION_PRIOR_WEIGHT = 20
/** The most the record can move a confidence, either way. */
export const WAIVER_CALIBRATION_MAX_DELTA = 10
/** A graded claim's weight halves every four weeks — the start/sit record's half-life. */
export const WAIVER_CALIBRATION_HALF_LIFE_DAYS = 28

/** The one rule mapping a 0–100 waiver score to its band — the card's sentence and the panel's label. */
export function waiverBandFor(score: number): WaiverConfidenceBand {
  return score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low'
}

/** Raw and decayed counts for one band. */
export type WaiverBandCounts = {
  /** Graded claims, and how many became startable. */
  n: number
  startable: number
  /** Decayed totals: weight, weight of startable claims, weight × the score given (0–1). */
  w: number
  wStartable: number
  wShown: number
}

export type WaiverEngineLedger = Partial<Record<WaiverConfidenceBand, WaiverBandCounts>>

export type GradedWaiverClaim = { score: number; startable: boolean; ageDays: number }

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/** Graded claims → per-band counts. A score outside 0–100 is dropped, never clamped into a band. */
export function foldWaiverEngineBands(claims: readonly GradedWaiverClaim[]): WaiverEngineLedger {
  const out: WaiverEngineLedger = {}
  for (const c of claims) {
    if (typeof c.score !== 'number' || !Number.isFinite(c.score) || c.score < 0 || c.score > 100) continue
    const w = decayWeight(c.ageDays, WAIVER_CALIBRATION_HALF_LIFE_DAYS)
    const b = (out[waiverBandFor(c.score)] ??= { n: 0, startable: 0, w: 0, wStartable: 0, wShown: 0 })
    b.n += 1
    b.startable += c.startable ? 1 : 0
    b.w += w
    b.wStartable += c.startable ? w : 0
    b.wShown += w * (c.score / 100)
  }
  for (const b of Object.values(out)) {
    if (!b) continue
    b.w = round4(b.w)
    b.wStartable = round4(b.wStartable)
    b.wShown = round4(b.wShown)
  }
  return out
}

export type WaiverBandRecord = {
  /** Share of graded claims that became startable, shrunk toward `shownRate` — 0–1. */
  observedRate: number
  /** The mean score those claims were given — 0–1. */
  shownRate: number
  n: number
}

export type WaiverCalibration = Partial<Record<WaiverConfidenceBand, WaiverBandRecord>>

/** Each band with enough graded claims, its rate shrunk toward the score it was given. Null when none qualifies. */
export function waiverCalibrationFrom(bands: WaiverEngineLedger | null | undefined): WaiverCalibration | null {
  if (!bands || typeof bands !== 'object') return null
  const out: WaiverCalibration = {}
  for (const band of ['low', 'medium', 'high'] as const) {
    const b = bands[band]
    if (!b || !(b.w > 0) || !(b.n >= WAIVER_CALIBRATION_MIN_SAMPLE)) continue
    const shownRate = b.wShown / b.w
    const observedRate = shrunkWeightedRate(
      { hits: b.wStartable, n: b.w, rawN: b.n },
      { priorRate: shownRate, priorWeight: WAIVER_CALIBRATION_PRIOR_WEIGHT, minSample: WAIVER_CALIBRATION_MIN_SAMPLE },
    )
    if (observedRate == null || !Number.isFinite(shownRate)) continue
    out[band] = { observedRate, shownRate, n: b.n }
  }
  return Object.keys(out).length > 0 ? out : null
}

export type CalibratedWaiverScore = { score: number; delta: number; band: WaiverConfidenceBand; n: number }

/**
 * The score corrected by its own band's record, or null when that band has no record. The band is the
 * one the RAW score falls in — the band those graded claims were scored at.
 */
export function calibrateWaiverScore(score: number, calibration: WaiverCalibration | null | undefined): CalibratedWaiverScore | null {
  if (!calibration || typeof score !== 'number' || !Number.isFinite(score)) return null
  const band = waiverBandFor(score)
  const rec = calibration[band]
  if (!rec || !(rec.n > 0) || !Number.isFinite(rec.observedRate) || !Number.isFinite(rec.shownRate)) return null
  const raw = (rec.observedRate - rec.shownRate) * 100 * 0.5
  const delta = Math.max(-WAIVER_CALIBRATION_MAX_DELTA, Math.min(WAIVER_CALIBRATION_MAX_DELTA, Math.round(raw)))
  return { score: Math.max(0, Math.min(100, score + delta)), delta, band, n: rec.n }
}

/** The sentence the card adds when the record moved its confidence. Empty when it did not. */
export function calibrationNote(c: CalibratedWaiverScore | null): string {
  if (!c || c.delta === 0) return ''
  const label = c.band === 'high' ? 'High' : c.band === 'medium' ? 'Medium' : 'Low'
  return ` Adjusted ${c.delta > 0 ? '+' : ''}${c.delta} from how ${c.n} past ${label}-confidence top claims in full-PPR redraft leagues turned out.`
}

export type WaiverScopeLeague = {
  sport: string | null | undefined
  isDynasty?: boolean | null
  leagueType?: string | null
  scoring?: string | null
  settings?: unknown
  starters?: unknown
}

/**
 * True only for a redraft NFL league scoring a full point per reception — where the ledger's measure
 * (standard PPR over three weeks) is the league's own. An unknown reception format is NOT assumed PPR.
 */
export function isWaiverCalibrationScope(league: WaiverScopeLeague | null | undefined): boolean {
  if (!league) return false
  if (String(league.sport ?? '').trim().toUpperCase() !== 'NFL') return false
  if (league.isDynasty) return false
  const type = String(league.leagueType ?? 'redraft').trim().toLowerCase()
  if (type !== 'redraft') return false
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? (league.settings as Record<string, unknown>)
    : null
  const rules = normalizeLeagueScoring({ sport: 'NFL', scoringColumn: league.scoring ?? null, settings, starters: league.starters ?? null })
  return rules.labels.receptionFormat === 'ppr'
}
