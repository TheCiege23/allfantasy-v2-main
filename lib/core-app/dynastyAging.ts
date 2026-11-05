/**
 * The dynasty aging rule of thumb, split out of lib/core-app/dynastyOutlook.ts (which re-exports it)
 * because that loader is `server-only` and the My Team row markers are a client component. One rule,
 * two readers: the outlook card's "aging starters" and the per-row age tone.
 */
import { getPeakAgeRange } from '@/lib/dynasty-engine/SportDynastyResolver'

/** Dynasty consensus (NFL): the age a position's production usually starts to decline. */
export const AGING_FROM: Readonly<Record<string, number>> = { QB: 34, RB: 27, WR: 29, TE: 30 }

/** Sports whose decline age comes from `getPeakAgeRange` rather than the NFL table above. */
const PEAK_RANGE_SPORTS = new Set(['NBA', 'MLB', 'NHL'])

/**
 * The age at which `position` is flagged as aging, in `sport`.
 *
 * NFL (and a call with no sport) reads `AGING_FROM` exactly as before. NBA/MLB/NHL used to fall
 * through the NFL-only table, so no basketball, baseball or hockey starter was ever flagged; they now
 * use the first age past the sport's peak (`getPeakAgeRange(sport, position).peakEnd + 1`) — the same
 * rule of thumb, from the sport's own peak-age range.
 */
export function agingThreshold(sport: string | null | undefined, position: string): number | undefined {
  const pos = String(position ?? '').toUpperCase()
  const s = String(sport ?? '').trim().toUpperCase()
  if (!pos) return undefined
  if (PEAK_RANGE_SPORTS.has(s)) return getPeakAgeRange(s, pos).peakEnd + 1
  return AGING_FROM[pos]
}
