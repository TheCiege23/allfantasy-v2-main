/**
 * The id a free agent is added to a roster under, or null to keep the list's own id. Every sport.
 *
 * 🛑 THE FREE-AGENT LIST AND THE DRAFT USED TWO DIFFERENT IDS FOR THE SAME PLAYER. A drafted player
 * is stored under the id the draft pool gives him, and that is what scoring, projections, lineups
 * and the player card read. The free-agent list sent each row's internal pool id instead, so an add
 * would have put a player on a roster under an id none of those can read: no points, no projection,
 * no card. Found before any add had been made from the list in a hosted league (production,
 * 2026-11-22: every rostered id in hosted NFL and NHL leagues is a provider id, none a pool row id);
 * the card opened from the list was already failing for it.
 *
 * The rule is the draft pool's own (`lib/draft-room/getResolvedDraftPoolForLeague.ts`):
 *
 *  - NFL (`nflPoolRowIdResolver`): the row's Sleeper id; a team defense is its club code. A numeric
 *    id that is not a Sleeper id is refused there (it can collide with another man's Sleeper id), so
 *    it is refused here too and the pool id stays.
 *  - Every other sport (`externalSourceIdAsIs`): the row's external source id as it stands.
 *
 * Only where the roster's id is known for certain; anything else keeps the pool id it had.
 */
export function rosterIdForPoolRow(
  sport: string | null | undefined,
  row: { player_id?: unknown; sleeper_id?: unknown; external_source_id?: unknown } | null | undefined,
): string | null {
  if (!row) return null
  if (String(sport ?? '').toUpperCase() === 'NFL') {
    const sleeperId = String(row.sleeper_id ?? '').trim()
    if (/^\d+$/.test(sleeperId)) return sleeperId
    const defense = /^nfl:def:([A-Za-z]{2,3})$/.exec(String(row.player_id ?? '').trim())
    return defense ? defense[1].toUpperCase() : null
  }
  const external = String(row.external_source_id ?? '').trim()
  return external || null
}

/** @deprecated The rule covers every sport; use `rosterIdForPoolRow`. */
export const nflRosterIdForPoolRow = rosterIdForPoolRow
