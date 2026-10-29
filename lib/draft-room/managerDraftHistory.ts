/**
 * Manager draft history — a manager's tendency vs market ADP across their PAST
 * drafts, blended with what they have done so far in this one.
 *
 * Pure logic only — no Prisma, no fetch, no React.
 *
 * Why: `classifyManagerTendency` reads only the current draft, so every manager
 * reads "Too early" until they have made two picks with ADP. History fills that
 * gap from pick 1, and the current draft takes over as it accumulates.
 *
 * Same sign convention as draftPulse: delta = overall − adp; positive means a
 * player was taken AFTER ADP (value), negative means BEFORE (reach).
 */

import type { ManagerTendency, ManagerTendencyKind } from './draftPulse'

export type HistoryPick = {
  /** Draft the pick belongs to — used to count distinct drafts. */
  sessionId: string
  overall: number
  /** Market ADP of the player when the pick was made. */
  adpAtPick: number
}

export type ManagerHistorySummary = {
  /** Mean delta across past picks with ADP. */
  averageDelta: number
  /** Past picks with ADP. */
  sample: number
  /** Distinct past drafts those picks came from. */
  drafts: number
}

export type BlendedTendency = ManagerTendency & {
  /** Where the read comes from: this draft only, past drafts only, or both. */
  basis: 'draft' | 'history' | 'blend' | 'none'
  /** Past drafts behind the read (0 when basis is 'draft' or 'none'). */
  historyDrafts: number
}

function validAdp(adp: number): boolean {
  return Number.isFinite(adp) && adp > 0
}

/**
 * Collapse past picks into a mean delta. Picks deep in a draft drift far from ADP
 * for reasons that are not a manager's style (the board runs thin), so only picks
 * whose ADP falls inside `maxAdp` count. Returns null when nothing qualifies.
 */
export function summarizeManagerHistory(
  picks: readonly HistoryPick[],
  { maxAdp = 150 }: { maxAdp?: number } = {},
): ManagerHistorySummary | null {
  let sum = 0
  let sample = 0
  const drafts = new Set<string>()
  for (const p of picks) {
    if (!validAdp(p.adpAtPick) || !Number.isFinite(p.overall) || p.adpAtPick > maxAdp) continue
    sum += p.overall - p.adpAtPick
    sample += 1
    drafts.add(p.sessionId)
  }
  if (sample === 0) return null
  return { averageDelta: sum / sample, sample, drafts: drafts.size }
}

/**
 * Combine this draft's tendency with history. A past pick counts for
 * `historyWeight` of a pick made in this draft, so the live draft takes over as
 * it accumulates while history decides the read before then.
 */
export function blendManagerTendency(
  current: ManagerTendency,
  history: ManagerHistorySummary | null,
  { band = 2, minSample = 2, historyWeight = 0.5 }: { band?: number; minSample?: number; historyWeight?: number } = {},
): BlendedTendency {
  const curSample = current.averageDelta == null ? 0 : current.sample
  const curSum = current.averageDelta == null ? 0 : current.averageDelta * current.sample
  const histSample = history ? history.sample : 0
  const histSum = history ? history.averageDelta * history.sample : 0

  const weightedSample = curSample + histSample * historyWeight
  const totalSample = curSample + histSample
  if (totalSample < minSample || weightedSample <= 0) {
    return { kind: 'unknown', averageDelta: null, sample: totalSample, basis: 'none', historyDrafts: 0 }
  }

  const averageDelta = (curSum + histSum * historyWeight) / weightedSample
  const kind: ManagerTendencyKind =
    averageDelta <= -band ? 'reacher' : averageDelta >= band ? 'value_hunter' : 'adp_loyal'
  const basis: BlendedTendency['basis'] = histSample === 0 ? 'draft' : curSample === 0 ? 'history' : 'blend'
  return {
    kind,
    averageDelta,
    sample: totalSample,
    basis,
    historyDrafts: histSample > 0 && history ? history.drafts : 0,
  }
}
