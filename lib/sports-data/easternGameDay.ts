/**
 * The calendar DAY a US game belongs to, for `player_game_stats.game_date` (a Postgres DATE).
 *
 * WHY THIS EXISTS. The Rolling Insights and CFBD writers stored the kickoff INSTANT, and Postgres
 * truncated it to its UTC date — so every game starting at 8pm Eastern or later (7pm in winter)
 * landed on the NEXT day. Measured on production 2026-09-24, rows dated one day late:
 *
 *   NCAAB  60,439 of 110,640   (3,120 of 5,728 games)
 *   MLB    16,526 of  68,496   (  556 of 2,324 games)
 *   NCAAF   4,011 of  24,571   (   54 of   335 games)
 *   NHL       382 of     733   (   10 of    19 games)
 *   SOCCER      0 of   4,159   (European kickoffs fall on the same UTC day)
 *
 * Every reader took the column at its word: Chimmy's game logs printed night games a day late,
 * and the NBA/NHL weekly fantasy window (which compares DATEs) scored a late game on a week's last
 * day in the FOLLOWING week.
 *
 * The rule is US EASTERN, because that is the vendor's own: Rolling Insights keys `/live/{date}` on
 * the Eastern day and prints that day into `game_ID` (`YYYYMMDD-{away}-{home}`, GAPS G-08), and the
 * scoreboards people check use it too. ⚠ A late West Coast or Hawaii kickoff (10:30pm Pacific) is
 * therefore dated the next day — a deliberate, consistent choice, not an accident.
 *
 * Returns a Date at UTC MIDNIGHT of that day, which is how Prisma writes a DATE column.
 */

const EASTERN = 'America/New_York'

const easternParts = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The US Eastern calendar day of an instant, as UTC midnight. DST-correct via the tz database. */
export function easternCalendarDay(instant: Date | null | undefined): Date | null {
  if (!instant || Number.isNaN(instant.getTime())) return null
  const parts = Object.fromEntries(easternParts.formatToParts(instant).map((p) => [p.type, p.value]))
  const y = Number(parts.year)
  const m = Number(parts.month)
  const d = Number(parts.day)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}

/** The day printed into a Rolling Insights `game_ID` ("20260406-12-103" → 2026-04-06), or null. */
export function gameDayFromRiGameId(gameId: string | null | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(String(gameId ?? ''))
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(Date.UTC(y, mo - 1, d))
  // Reject impossible dates (20260231) instead of letting Date roll them over into March.
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null
}
