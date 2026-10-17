/**
 * The week a redraft season is READ at when the caller names none.
 *
 * 🛑 AN IMPORTED SEASON'S `currentWeek` IS A NUMBER NOTHING MAINTAINS. The week roller
 * (`rollSeasonWeeks`) runs over `engineSeasonScope`, which is native leagues only, and the
 * importers write 1. Measured 2026-10-12: all 534 imported 2026 NFL seasons (525 Sleeper,
 * 8 ESPN, 1 Fleaflicker) carried `currentWeek = 1` while the NFL schedule was on week 5-6,
 * so `/api/redraft/season`, the roster GET and the live-scoring runtime all served week-1
 * projections, scores and matchups — and the injury read filtered `week IN (1, null)`,
 * dropping every Rolling Insights row tagged with the real week.
 *
 * So an imported season takes its week from the committed schedule, through the same
 * `resolveSeasonWeekForRedraftSeason` the score-sync cron reconciles with. A NATIVE season
 * keeps its stored week: the engine advances it only once every matchup is finalized
 * (`advance_week`), so it can deliberately lag the sport — the one native 2026 NFL season
 * sat at 5 on that same day — and the schedule must not overrule it.
 *
 * Read-only by design: nothing here writes `currentWeek` back.
 */

import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { resolveSeasonWeekForRedraftSeason, type SeasonWeekDeps } from './seasonWeekService'

export async function resolveEffectiveRedraftWeek(
  season: { id: string; currentWeek?: number | null },
  /** `League.platform`. Required on purpose: `isNativePlatform(undefined)` is TRUE, so a
   * caller that forgot to load it would silently keep every import on week 1 again. */
  platform: string | null | undefined,
  deps: SeasonWeekDeps = {},
): Promise<number> {
  const stored = Math.max(1, Math.floor(Number(season.currentWeek) || 1))
  if (isNativePlatform(platform)) return stored
  try {
    const resolved = await resolveSeasonWeekForRedraftSeason(season.id, deps)
    // The resolver declines rather than guessing (no schedule, unsupported sport); the stored
    // week is then the only answer there is, which is exactly the old behaviour.
    return resolved.ok ? Math.max(1, resolved.fantasyWeek) : stored
  } catch (error) {
    // A read path must not 500 because the schedule read failed.
    console.warn('[season-week] effective week fell back to stored currentWeek', {
      seasonId: season.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return stored
  }
}
