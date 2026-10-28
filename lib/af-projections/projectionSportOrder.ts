/**
 * The order the nightly projection run (`/api/cron/compute-projections`) takes its sports in.
 *
 * 🛑 NFL WAS SKIPPED ON 3 OF 14 NIGHTS IN SEASON. The run shares one time budget across seven sports
 * that take turns leading (`rotateForFairness`), and a sport the budget runs out before is deferred
 * to the next night with no warning. Measured on production 2026-10-27: NFL wrote nothing on Oct 15,
 * 19 and 20, each time behind college football (3–8 minutes on its own), so NFL projections sat up to
 * three days old in the middle of the season — the sport managers act on most, every week.
 *
 * So during the NFL season (preseason through the Super Bowl, `lib/import-os/season.ts`), NFL runs
 * FIRST every night and the other six keep their rotation behind it. NFL takes about 40 seconds, so
 * the budget always reaches it. Out of season NFL rejoins the rotation like any other sport.
 *
 * Owner's decision, 2026-10-27. A separate scheduled NFL run was the first idea, but the cron
 * registry is at its 60-entry ceiling (`scripts/cron-budget-check.mjs`); a guaranteed first slot in
 * the existing run gets the same result without one.
 */
import { isInSeason, resolveSeasonState } from '@/lib/import-os/season'

export const PRIORITY_IN_SEASON_SPORT = 'NFL'

export function projectionSportOrder(rotated: readonly string[], now: Date = new Date()): string[] {
  const nflSeason = isInSeason(resolveSeasonState({ sport: PRIORITY_IN_SEASON_SPORT, now }).state)
  if (!nflSeason || !rotated.includes(PRIORITY_IN_SEASON_SPORT)) return [...rotated]
  return [PRIORITY_IN_SEASON_SPORT, ...rotated.filter((s) => s !== PRIORITY_IN_SEASON_SPORT)]
}
