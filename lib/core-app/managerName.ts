import { parseFormerSleeperKey } from '@/lib/league-import/sleeper/historicalTeamIdentity'

/**
 * A stored manager or team name, or null when what is stored is a placeholder rather than a name.
 *
 * 🛑 SEVERAL IMPORTERS WRITE THE WORD "Unknown" WHERE A NAME WAS MISSING (`syncLeagueHistory`,
 * `history-aggregates`, `normalize`, and others), and the Core surfaces printed it as if it were a
 * manager: "UNKNOWN SENT" on the Trades board and "vs Unknown" on Your week (production audit,
 * 2026-09-28). A placeholder is an absent name, so readers fall through to the next field — a team
 * name, then each surface's own honest fallback ("a manager", "opponent not named").
 *
 * Pure and client-safe.
 */
const PLACEHOLDERS = new Set(['unknown', 'unknown manager', 'unknown team', 'n/a', 'na', 'null', 'undefined', '-', '—'])

export function realManagerName(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim()
  if (!v) return null
  return PLACEHOLDERS.has(v.toLowerCase()) ? null : v
}

/**
 * The one label for an opposing roster: its real team or manager name, else "Team N".
 *
 * 🛑 THREE SURFACES, THREE ANSWERS FOR THE SAME ROSTER. On the App Review account (2026-09-29) one
 * unowned Sleeper roster read "vs Roster 8" on the home, "vs Unknown" on the Matchup board and
 * "opponent not named" on Your Week. It is not rare: every unowned Sleeper roster is stored as
 * teamName "Unknown" / ownerName "Unknown" — 252 teams across 37 leagues, measured that day.
 *
 * "Team N" is the platform's own label for a roster with no manager (Sleeper shows exactly that),
 * so it names the roster without inventing a manager — the rule the surfaces' "never a made-up
 * name" comments protect. Pass the names in preference order (team first, then the person).
 */
export function rosterLabel(names: ReadonlyArray<string | null | undefined>, rosterId: string | number | null | undefined): string {
  for (const n of names) {
    const real = realManagerName(n)
    if (real) return real
  }
  const id = String(rosterId ?? '').trim()
  // 🛑 A departed Sleeper manager's games are keyed `former:sleeper:<ownerId>`, which is an internal
  // key, not a roster number: Rivalry Radar printed "Team former:sleeper:843306215671996416" (production
  // 2026-10-06). Same label Draft HQ and season history already use for these keys.
  if (parseFormerSleeperKey(id)) return 'Former manager'
  return id ? `Team ${id}` : 'Opponent'
}
