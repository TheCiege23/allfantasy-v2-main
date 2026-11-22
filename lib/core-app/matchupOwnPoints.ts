import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

/**
 * What a starter scored, worked out by AllFantasy from his stored stat line under the league's own rules.
 *
 * 🛑 AN IMPORTED LEAGUE WITH NO PLATFORM SCORES SHOWED NO PLAYER POINTS AT ALL. Production 2026-11-21, a
 * Fantrax NFL league: "no per-player scoring has been ingested for 2026 week 11", two days after C.J.
 * Stroud's Thursday game, with his 21/27, 194 yards, 3 touchdowns printed on the same row. The stat line
 * was on file (`PlayerGameStat`, keyed on the Sleeper id), the league's scoring rules were on file, and the
 * function that prices one under the other already priced every projection on the page.
 *
 * ⚠ AN ESTIMATE, AND LABELLED AS ONE. It is never written into a cell's `actual`, which is the SOURCE
 * PLATFORM's number and feeds the live totals and win probability. The two can disagree: a stat line can be
 * missing stats (most of what is ingested for a defensive back is a snap count), and a platform rule this
 * app does not carry over (Fantrax's per-position rules, the tight-end reception bonus aside) is not applied.
 *
 * ⚠ NO NUMBER RATHER THAN A ZERO. A line none of the league's rules priced returns nothing: "this league
 * does not score what we hold for him" is not "he scored 0.0".
 */
export function ownPointsByPlayer(
  rows: ReadonlyArray<{ playerId: string; normalizedStatMap?: unknown }>,
  scoringSettings: Record<string, unknown> | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>()
  if (!scoringSettings || typeof scoringSettings !== 'object') return out
  for (const row of rows) {
    if (out.has(row.playerId)) continue
    const line = row.normalizedStatMap
    if (!line || typeof line !== 'object' || Array.isArray(line)) continue
    const scored = computeLeagueProjectedPoints(line as Record<string, unknown>, scoringSettings)
    if (!scored || !Number.isFinite(scored.points)) continue
    out.set(row.playerId, Math.round(scored.points * 100) / 100)
  }
  return out
}
