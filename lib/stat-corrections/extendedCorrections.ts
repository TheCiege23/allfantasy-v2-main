/**
 * "Extended scoring corrections" (AF Commissioner). Free leagues get what they always had: the
 * detector (./statCorrectionDetector.ts) re-checks the latest finished week for 6 days and SHOWS the
 * commissioner what changed. With this switched on, and the owner on AF Commissioner:
 *   - the last two finished weeks are re-checked, for 14 days after each is sealed;
 *   - a detected correction is APPLIED, as score adjustments (lib/score-adjustments) — the same
 *     sealed-week write a commissioner makes by hand: the score moves under the league lock and
 *     standings follow.
 *
 * ⚠ APPLY THE DIFFERENCE, NEVER THE TOTAL. The stored stats are never rewritten (that would un-seal the
 * week — see the detector), so every re-check reports the FULL correction against the original stats.
 * Each run therefore applies only what the corrected total is minus what earlier automatic corrections
 * already added to that team in that matchup. A re-run is a no-op; a second correction adds only itself.
 *
 * Never where a score has already decided something irreversible: a Guilly chop, a Survivor or other
 * elimination format, or a season that has reached the playoffs (seeds are set). Those are reported,
 * not applied.
 */
import type { MatchupCorrection } from './statCorrectionReview'
import type { ScoreAdjustment } from '@/lib/score-adjustments/scoreAdjustments'

/** League.settings key. Absent = off. */
export const EXTENDED_CORRECTIONS_KEY = 'stat_corrections_extended'
/** The actor every automatic correction is recorded under, so earlier ones can be found again. */
export const STAT_CORRECTION_ACTOR = 'system:stat-corrections'
export const FREE_CORRECTION_WINDOW_DAYS = 6
export const EXTENDED_CORRECTION_WINDOW_DAYS = 14
/** How many finished weeks an extended league re-checks. */
export const EXTENDED_CORRECTION_WEEKS = 2

export function readExtendedCorrections(settings: unknown): boolean {
  return Boolean(settings && typeof settings === 'object' && (settings as Record<string, unknown>)[EXTENDED_CORRECTIONS_KEY] === true)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** What earlier automatic corrections already added to one team in one matchup. */
export function appliedCorrection(list: readonly ScoreAdjustment[], matchupId: string, rosterId: string): number {
  let sum = 0
  for (const a of list) if (a.byUserId === STAT_CORRECTION_ACTOR && a.matchupId === matchupId && a.rosterId === rosterId) sum += a.points
  return round2(sum)
}

export type CorrectionAdjustment = { matchupId: string; rosterId: string; points: number }

/** Pure: the adjustments still owed so every corrected team ends on its corrected score. */
export function planCorrectionAdjustments(matchups: readonly MatchupCorrection[], existing: readonly ScoreAdjustment[]): CorrectionAdjustment[] {
  const out: CorrectionAdjustment[] = []
  for (const m of matchups) {
    for (const side of [m.home, m.away]) {
      const owed = round2(round2(side.after - side.before) - appliedCorrection(existing, m.matchupId, side.rosterId))
      if (Math.abs(owed) >= 0.01) out.push({ matchupId: m.matchupId, rosterId: side.rosterId, points: owed })
    }
  }
  return out
}

/** Formats where a week's score has already eliminated someone, so it must never be rewritten. */
const ELIMINATION_VARIANTS = new Set(['guillotine', 'survivor', 'survivor_guillotine', 'zombie', 'big_brother'])

export function correctionApplyRefusal(league: { leagueVariant: string | null; guillotineMode: boolean | null }, seasonStatus: string | null): 'elimination_format' | 'playoffs' | null {
  if (league.guillotineMode === true || ELIMINATION_VARIANTS.has(String(league.leagueVariant ?? '').toLowerCase())) return 'elimination_format'
  if (['playoffs', 'complete', 'completed'].includes(String(seasonStatus ?? '').toLowerCase())) return 'playoffs'
  return null
}
