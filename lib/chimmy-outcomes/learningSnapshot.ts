/**
 * WHAT CHIMMY HAS LEARNED FROM HOW ITS ADVICE TURNED OUT — the pure half (Chimmy brief item 10).
 *
 * The maintenance cron resolves every piece of recorded advice by the Receipts card's own rules
 * (`resolveChimmyAdviceOutcomes`) and folds the results into one snapshot, rebuilt from scratch on
 * every run. Two things are read back out of it:
 *
 * - **Calibration** — for start/sit calls, per confidence band: how often calls shown at that band
 *   were right. The confidence rubric uses it as a bounded ±10 modifier.
 * - **Follow-through** — per user, which pieces of advice the platform shows they acted on. The
 *   personalization profile merges it with the drawer's explicit "Did it / Not doing it" votes.
 *
 * 🛑 ONE RESULT CANNOT DOMINATE. Every rate is shrunk (`shrinkage.ts`), silent below a minimum
 * sample, and weighted by age (half-life), so a single bad week moves nothing and last month's run
 * fades behind this week's. Calibration shrinks toward the confidence that was SHOWN, so with
 * little evidence the rubric's delta is ~0 rather than a swing toward 50%.
 *
 * ⚠ REBUILT, NEVER INCREMENTED. Nothing here adds a new result onto a stored rate; the snapshot is
 * a cache of a full recompute, so a late score correction is picked up by the next run.
 *
 * ⚠ ADDS HAVE NO RIGHT/WRONG. A free agent's points are not on file when you passed on him, so an
 * add call only ever contributes follow-through, never calibration.
 */

import { confidenceLevelFor, type ChimmyConfidenceLevel, type ChimmyTrackRecord } from '@/lib/chimmy-chat/confidence-rubric'
import type { ChimmyAnswerType } from '@/lib/chimmy-chat/response-contract'
import { decayWeight, shrunkWeightedRate } from './shrinkage'

export const LEARNING_SNAPSHOT_VERSION = 1
/** How far back advice is resolved: a full NFL regular season fits inside it. */
export const LEARNING_WINDOW_DAYS = 140
/** A resolved call's weight halves every four weeks. */
export const LEARNING_HALF_LIFE_DAYS = 28
/** A confidence band says nothing until this many of its calls are resolved… */
export const CALIBRATION_MIN_SAMPLE = 20
/** …and is shrunk toward the confidence it was shown with, worth this many calls. */
export const CALIBRATION_PRIOR_WEIGHT = 20
/** The newest verdicts kept per user — more than the behaviour rates ever read. */
export const MAX_USER_VERDICTS = 60

export type AdviceOutcome = {
  userId: string
  /** `startSitAdviceKey` / `addAdviceKey` — the same key the drawer's buttons send. */
  key: string
  adviceType: 'start_sit' | 'add'
  /** The confidence the advice was shown with, 0–100. */
  confidencePct: number | null
  givenAt: Date
  /** Start/sit only. `same` (within a point) is neither right nor wrong and never counts. */
  call?: 'right' | 'wrong' | 'same'
  /** Whether the platform shows the user acted on it. `unclear` never counts. */
  followed: 'yes' | 'no' | 'unclear'
}

/** Raw and decayed counts for one confidence band. */
export type BandCounts = {
  /** Resolved right/wrong calls. */
  n: number
  right: number
  /** Decayed totals: weight, weight of right calls, weight × shown confidence (0–1). */
  w: number
  wRight: number
  wShown: number
}

export type AdviceLearningSnapshot = {
  version: typeof LEARNING_SNAPSHOT_VERSION
  computedAt: string
  windowDays: number
  halfLifeDays: number
  /** False when the run stopped at its user or time budget — what is here is right, just not everyone. */
  complete: boolean
  totals: { users: number; outcomes: number; calls: number; verdicts: number }
  calibration: { start_sit: Partial<Record<ChimmyConfidenceLevel, BandCounts>> }
  /** userId → [adviceKey, followed (1 | 0), decay weight], newest first. */
  followThrough: Record<string, Array<[string, 0 | 1, number]>>
}

const DAY_MS = 86_400_000
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

export function buildAdviceLearningSnapshot(
  outcomes: readonly AdviceOutcome[],
  opts: { now: Date; complete: boolean; users: number },
): AdviceLearningSnapshot {
  const nowMs = opts.now.getTime()
  const calibration: AdviceLearningSnapshot['calibration'] = { start_sit: {} }
  const verdicts = new Map<string, Array<{ key: string; followed: 0 | 1; w: number; at: number }>>()
  let calls = 0
  let verdictCount = 0

  for (const o of outcomes) {
    const at = o.givenAt instanceof Date ? o.givenAt.getTime() : Number.NaN
    const w = decayWeight((nowMs - at) / DAY_MS, LEARNING_HALF_LIFE_DAYS)

    const pct = o.confidencePct
    if (
      o.adviceType === 'start_sit' &&
      (o.call === 'right' || o.call === 'wrong') &&
      typeof pct === 'number' &&
      Number.isFinite(pct) &&
      pct >= 0 &&
      pct <= 100
    ) {
      const level = confidenceLevelFor(pct)
      const band = (calibration.start_sit[level] ??= { n: 0, right: 0, w: 0, wRight: 0, wShown: 0 })
      const right = o.call === 'right'
      band.n += 1
      band.right += right ? 1 : 0
      band.w += w
      band.wRight += right ? w : 0
      band.wShown += w * (pct / 100)
      calls += 1
    }

    if ((o.followed === 'yes' || o.followed === 'no') && o.userId && o.key) {
      const list = verdicts.get(o.userId) ?? []
      if (!list.some((v) => v.key === o.key)) {
        list.push({ key: o.key, followed: o.followed === 'yes' ? 1 : 0, w, at: Number.isFinite(at) ? at : 0 })
        verdicts.set(o.userId, list)
      }
    }
  }

  for (const band of Object.values(calibration.start_sit)) {
    if (!band) continue
    band.w = round4(band.w)
    band.wRight = round4(band.wRight)
    band.wShown = round4(band.wShown)
  }

  const followThrough: AdviceLearningSnapshot['followThrough'] = {}
  for (const [userId, list] of verdicts) {
    const kept = list.sort((a, b) => b.at - a.at).slice(0, MAX_USER_VERDICTS)
    followThrough[userId] = kept.map((v) => [v.key, v.followed, round4(v.w)])
    verdictCount += kept.length
  }

  return {
    version: LEARNING_SNAPSHOT_VERSION,
    computedAt: opts.now.toISOString(),
    windowDays: LEARNING_WINDOW_DAYS,
    halfLifeDays: LEARNING_HALF_LIFE_DAYS,
    complete: opts.complete,
    totals: { users: opts.users, outcomes: outcomes.length, calls, verdicts: verdictCount },
    calibration,
    followThrough,
  }
}

/** The stored JSON back into a snapshot, or null for anything this version did not write. */
export function parseAdviceLearningSnapshot(data: unknown): AdviceLearningSnapshot | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const s = data as Partial<AdviceLearningSnapshot>
  if (s.version !== LEARNING_SNAPSHOT_VERSION || typeof s.computedAt !== 'string') return null
  if (!s.calibration || typeof s.calibration !== 'object' || !s.followThrough || typeof s.followThrough !== 'object') return null
  return s as AdviceLearningSnapshot
}

/**
 * The rubric's track record for start/sit answers: each band with enough resolved calls, its
 * observed rate shrunk toward the confidence it was shown with. Null when no band qualifies.
 */
export function trackRecordsFrom(
  snapshot: AdviceLearningSnapshot | null,
): Partial<Record<ChimmyAnswerType, ChimmyTrackRecord>> | null {
  const bands = snapshot?.calibration?.start_sit
  if (!bands) return null
  const record: ChimmyTrackRecord = {}
  for (const level of ['low', 'medium', 'high'] as const) {
    const b = bands[level]
    if (!b || !(b.w > 0) || b.n < CALIBRATION_MIN_SAMPLE) continue
    const shownRate = b.wShown / b.w
    const observedRate = shrunkWeightedRate(
      { hits: b.wRight, n: b.w, rawN: b.n },
      { priorRate: shownRate, priorWeight: CALIBRATION_PRIOR_WEIGHT, minSample: CALIBRATION_MIN_SAMPLE },
    )
    if (observedRate == null || !Number.isFinite(shownRate)) continue
    record[level] = { observedRate, shownRate, n: b.n }
  }
  return Object.keys(record).length > 0 ? { start_sit: record } : null
}

/** One user's inferred verdicts, newest first. */
export function followThroughFor(
  snapshot: AdviceLearningSnapshot | null,
  userId: string,
): Array<{ key: string; followed: boolean; weight: number }> {
  const list = snapshot?.followThrough?.[userId]
  if (!Array.isArray(list)) return []
  return list
    .filter((v) => Array.isArray(v) && typeof v[0] === 'string' && (v[1] === 0 || v[1] === 1))
    .map(([key, followed, weight]) => ({
      key,
      followed: followed === 1,
      weight: Number.isFinite(weight) && weight >= 0 ? weight : 1,
    }))
}
