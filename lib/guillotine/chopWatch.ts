/**
 * Chop Watch (2026-10-29): the member chop line, live, by the chop's own rules.
 *
 * 🛑 THE CHOP LINE EVERY MEMBER SAW WAS LAST WEEK'S. The home's chop line came from `getDangerTiers`,
 * which ranks on `GuillotinePeriodScore` for the week — a table written only when that week is CHOPPED.
 * So all week long it fell back to the previous week's SEASON totals, and it always put exactly one team
 * in the chop zone and the bottom four in danger, whatever the commissioner's schedule said (double
 * chops, no-chop weeks, immunity).
 *
 * The commissioner's chop preview (./chopPreview.ts) already answers the real question — this week's
 * scores as they stand, run through the chop's own steps. This reshapes its rows into the summary's
 * `dangerTiers` and `home.scores`, so every surface drawing the chop line shows the live one, and
 * keeps the preview's commissioner-only parts (the FAAB split, the chat post, roster blockers) out.
 *
 * Pure. The loader with its cache is ./chopWatchLoad.ts.
 */
import type { ChopPreview } from './chopPreview'
import type { GuillotineDangerRow } from './types'

export type ChopWatchTier = { rosterId: string; displayName: string; tier: 'chop_zone' | 'danger' | 'safe'; pointsFromChopZone: number; immune?: true }

export type ChopWatch = {
  week: number
  /** Teams the chop takes this week (double chops, steps). */
  chopCount: number
  /** The highest score still chopped, if the week ended now. */
  chopLine: number | null
  dangerTiers: ChopWatchTier[]
  /** rosterId -> this week's points so far. */
  scores: Record<string, number>
  /** rosterId -> season points through this week, live. */
  seasonPoints: Record<string, number>
}

/**
 * The watch for `week`, or null when the preview cannot stand in for the chop line: it is about a
 * different week, there is no chop this week, or nobody has scored yet (an all-zero board would rank
 * teams by tiebreak and call it a chop zone).
 */
export function chopWatchFromPreview(preview: ChopPreview, week: number): ChopWatch | null {
  if (preview.week !== week || preview.outcome !== 'chop' || preview.rows.length === 0) return null
  if (!preview.rows.some((row) => row.points > 0)) return null
  const line = preview.chopLine ?? Math.min(...preview.rows.map((row) => row.points))
  const dangerTiers: ChopWatchTier[] = preview.rows.map((row) => ({
    rosterId: row.rosterId,
    displayName: row.name,
    tier: row.status === 'chopped' ? 'chop_zone' : row.status === 'danger' ? 'danger' : 'safe',
    // Points above the chop line: 0 or less in the chop zone. The chop line sorts on this.
    pointsFromChopZone: Math.round((row.margin ?? row.points - line) * 10) / 10,
    ...(row.status === 'immune' ? { immune: true as const } : {}),
  }))
  return {
    week,
    chopCount: preview.chopCount,
    chopLine: preview.chopLine,
    dangerTiers,
    scores: Object.fromEntries(preview.rows.map((row) => [row.rosterId, row.points])),
    seasonPoints: Object.fromEntries(preview.rows.map((row) => [row.rosterId, row.seasonPoints ?? 0])),
  }
}

/**
 * The watch in the danger engine's own row shape (`getDangerTiers`), for the surfaces that read that:
 * rank 1 is the lowest score (the preview's rows come lowest first), `projectedPoints` is this week's
 * points so far, `seasonPointsCumul` the season through this week.
 */
export function chopWatchDangerRows(watch: ChopWatch): GuillotineDangerRow[] {
  return watch.dangerTiers.map((t, i) => ({
    rosterId: t.rosterId,
    displayName: t.displayName,
    projectedPoints: watch.scores[t.rosterId] ?? 0,
    seasonPointsCumul: watch.seasonPoints[t.rosterId] ?? 0,
    tier: t.tier,
    rank: i + 1,
    pointsFromChopZone: t.pointsFromChopZone,
  }))
}
