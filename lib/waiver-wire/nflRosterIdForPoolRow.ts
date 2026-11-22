/**
 * The id an NFL free agent is added to a roster under, or null to keep the list's own id.
 *
 * 🛑 THE FREE-AGENT LIST AND THE DRAFT USED TWO DIFFERENT IDS FOR THE SAME MAN. A drafted NFL player
 * is stored under his Sleeper id and a team defense under its club code (the draft pool's rule,
 * `nflPoolRowIdResolver`), and that is what scoring, projections, lineups and the player card read.
 * The free-agent list sent each row's internal pool id instead, so an add would have put a player on
 * a roster under an id none of those can read: no points, no projection, no card. Found before any
 * add had been made in a hosted NFL league (production, 2026-11-22: 176 rostered ids, every one a
 * Sleeper number or a club code); the card opened from the list was already failing for it.
 *
 * Only where the roster's id is known for certain: the row's own Sleeper id, or a team defense's
 * club code. Anything else keeps the pool id it had.
 */
export function nflRosterIdForPoolRow(
  sport: string | null | undefined,
  row: { player_id?: unknown; sleeper_id?: unknown } | null | undefined,
): string | null {
  if (String(sport ?? '').toUpperCase() !== 'NFL' || !row) return null
  const sleeperId = String(row.sleeper_id ?? '').trim()
  if (/^\d+$/.test(sleeperId)) return sleeperId
  const defense = /^nfl:def:([A-Za-z]{2,3})$/.exec(String(row.player_id ?? '').trim())
  return defense ? defense[1].toUpperCase() : null
}
