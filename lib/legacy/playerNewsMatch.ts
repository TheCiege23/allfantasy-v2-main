/**
 * Which `SportsNews` rows belong to ONE player, for the legacy player modal.
 *
 * 🛑 NEVER MATCH ON A LAST-NAME SUBSTRING OF THE TITLE. The legacy profile route used to take any
 * row whose title contained `player.last_name`, in any sport. Measured on production 2026-10-11
 * for WR DeVonta Smith (PHI): four of the five items shown were other Smiths — NCAAF Jeremiah,
 * Gunnar and Charlie Smith, and a Stephen A. Smith opinion piece filed under CAR.
 *
 * A row belongs to the player only when:
 *  1. its sport is the player's sport (the caller filters this in the query), AND
 *  2. one of the row's PLAYER fields (`playerName` or an entry of `playerNames`) is the player's
 *     name under `normalizeMatchName`, AND
 *  3. when both the row and the player state a team, the player's team is one of the row's teams.
 *
 * ⚠ RULE 3 USES `team` AND `teams` TOGETHER, NOT `team` ALONE. Measured on the same rows:
 * "Eagles stars Saquon Barkley and DeVonta Smith ruled out of London game against Jaguars" carries
 * `team: "JAX"` and `teams: ["JAX", "PHI"]` — the opponent in the scalar field. Requiring
 * `team === PHI` would drop a correct story; the union keeps it and still excludes a namesake whose
 * row names only other teams.
 */
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export interface PlayerNewsRowFields {
  playerName?: string | null
  playerNames?: readonly string[] | null
  team?: string | null
  teams?: readonly string[] | null
}

export function newsRowMatchesPlayer(
  row: PlayerNewsRowFields,
  player: { name: string; team?: string | null },
): boolean {
  const key = normalizeMatchName(player.name)
  if (!key) return false

  const rowNames = [row.playerName, ...(row.playerNames ?? [])]
  if (!rowNames.some((n) => normalizeMatchName(n) === key)) return false

  const playerTeam = normalizeTeamAbbrev(player.team)
  if (!playerTeam) return true
  const rowTeams = [row.team, ...(row.teams ?? [])]
    .map((t) => normalizeTeamAbbrev(t))
    .filter((t): t is string => Boolean(t))
  // A row that names no team makes no team claim; the name match stands on its own.
  if (rowTeams.length === 0) return true
  return rowTeams.includes(playerTeam)
}

/** Spellings to pre-filter the query with. The JS check above is the authority. */
export function playerNameVariants(player: { full_name?: string | null; first_name?: string | null; last_name?: string | null }): string[] {
  const out = new Set<string>()
  const full = String(player.full_name ?? '').trim()
  if (full) out.add(full)
  const joined = `${String(player.first_name ?? '').trim()} ${String(player.last_name ?? '').trim()}`.trim()
  if (joined) out.add(joined)
  return Array.from(out)
}
