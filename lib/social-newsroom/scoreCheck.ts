/** Final-score checks for the newsroom's game posts — pure, no I/O. */

/**
 * Final statuses as stored (measured 2026-10-15 across three days of `SportsGame`): `final` from
 * most writers, and TheSportsDB's own `FT`, `AOT` (after overtime) and `AP` (after penalties /
 * shootout). The last two are also how an overtime finish is known.
 */
export const FINAL_STATUS = /^(final|ft|aot|aet|ap|status_final)$/i
export const OVERTIME_STATUS = /^(aot|aet|ap)$/i

export function isFinalStatus(status: string | null | undefined): boolean {
  return FINAL_STATUS.test(String(status ?? '').trim())
}

export type ScoreRow = { source: string; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; startTime: Date | null; status: string | null }

/**
 * Does any OTHER provider report this final, and does it agree?
 *
 * 🛑 WHY THIS EXISTS. Measured 2026-10-15: Nuggets at Clippers was stored as Clippers 110–122 by
 * TheSportsDB and Clippers 122–110 by ESPN's live feed — the same game with home and away swapped
 * in one of them. A final post built from the wrong one announces the wrong winner, so a final is
 * only posted when a second provider agrees (`teamScoreAlerts` applies the same rule to pushes).
 *
 * Rows from other providers are matched to the game by kickoff (within an hour) and by the teams,
 * which are compared through the sport's team resolver because providers spell them differently
 * ("LAC" vs "Los Angeles Clippers"). A row whose teams do not resolve is ignored, not counted.
 */
export function checkFinalScore(
  game: ScoreRow,
  others: readonly ScoreRow[],
  resolve: (name: string) => string | null,
): 'confirmed' | 'single' | 'conflict' {
  const home = resolve(game.homeTeam)
  const away = resolve(game.awayTeam)
  if (!home || !away || !game.startTime) return 'single'
  let agreed = false
  for (const o of others) {
    if (o.source === game.source || !o.startTime || o.homeScore == null || o.awayScore == null) continue
    if (!isFinalStatus(o.status)) continue
    if (Math.abs(o.startTime.getTime() - game.startTime.getTime()) > 60 * 60 * 1000) continue
    const oh = resolve(o.homeTeam)
    const oa = resolve(o.awayTeam)
    let scores: [number, number] | null = null
    if (oh === home && oa === away) scores = [o.homeScore, o.awayScore]
    else if (oh === away && oa === home) scores = [o.awayScore, o.homeScore]
    if (!scores) continue
    if (scores[0] !== game.homeScore || scores[1] !== game.awayScore) return 'conflict'
    agreed = true
  }
  return agreed ? 'confirmed' : 'single'
}
