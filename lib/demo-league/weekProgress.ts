/**
 * Which demo weeks are FINISHED — pure, so the view, its e2e harness and the tests share one rule.
 *
 * 🛑 "EVERY TEAM HAS POINTS" IS NOT "THE WEEK IS OVER". `WeeklyMatchup` has no final flag, and the
 * next week's rows already exist at 0–0, so the old test (`every row scored`) turned true the moment
 * Sunday's early games kicked off. Measured on the live demo 2026-11-15 mid-afternoon: week 10 read
 * as complete with nine of twelve teams on 19–54 points, so the standings counted half-played games
 * as wins and losses, the page showed week 11 as "upcoming", and demo Chimmy called a 52.4 in-progress
 * total a "season-low collapse".
 *
 * So a week is finished when every team has points AND it is not the week the schedule says is
 * still being played (`inProgressWeek`, worked out by the source loader from NFL game statuses).
 */
export type WeekRowLike = { week: number; pointsFor: number; pointsAgainst: number }

/** Every row of week `w` has points — necessary for "finished", never sufficient on its own. */
export function weekHasAllScores(rows: readonly WeekRowLike[], w: number): boolean {
  const inWeek = rows.filter((r) => r.week === w)
  return inWeek.length > 0 && inWeek.every((r) => r.pointsFor > 0 || r.pointsAgainst > 0)
}

/** The latest week where every team has points: the only week that can be mid-play and look done. */
export function lastScoredWeek(rows: readonly WeekRowLike[]): number | null {
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => b - a)
  return weeks.find((w) => weekHasAllScores(rows, w)) ?? null
}

/** `inProgressWeek` null means "nothing known to be mid-play" — the scores rule alone decides. */
export function makeWeekIsFinished(rows: readonly WeekRowLike[], inProgressWeek: number | null | undefined) {
  return (w: number) => w !== inProgressWeek && weekHasAllScores(rows, w)
}
