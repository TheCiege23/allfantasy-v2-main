/**
 * One definition of "an ACTIVE team" — Batch A.1 item 1.
 *
 * Reconciliation no longer deletes a `LeagueTeam` that vanishes from a complete authoritative
 * response; it archives the row with `isOrphan = true`. That is strictly better for the data —
 * ownership, transactions, matchups, drafts and the external identifiers every later join needs
 * all survive — but it moves a burden onto every READER: a row that used to disappear now
 * persists, so a selector that means "the teams in this league" and does not exclude orphans
 * silently starts counting archived teams as live ones.
 *
 * 🛑 `isOrphan` IS EFFECTIVELY THREE-STATE, AND THE SCHEMA DOES NOT SAY SO. It is declared
 * `Boolean @default(false)`, but rows predating the column carry NULL — see the measurement in
 * `lib/commissioner-workspace/rosterReads.ts`, which records that treating `!== false` as orphan
 * "would report every league that predates the flag as entirely unclaimed... the loudest possible
 * way to be wrong about 288 leagues". So NULL means "never decided", which is ACTIVE, not orphan.
 *
 * ⚠ AND THAT IS WHY THIS FILTERS IN APPLICATION CODE RATHER THAN IN THE QUERY. The obvious
 * Prisma spelling, `NOT: { isOrphan: true }`, compiles to SQL `NOT (isOrphan = true)`, and
 * `NOT (NULL = true)` is NULL, not true — so the row is EXCLUDED. A where-clause that looks like
 * it means "not orphaned" would quietly drop exactly the legacy rows the note above is about, and
 * Prisma's types will not let you write `isOrphan: null` for a field declared non-nullable. A
 * predicate over already-fetched rows has none of that ambiguity.
 *
 * The one direction that IS safe in a query is the positive test, `{ isOrphan: true }`, because
 * NULL simply does not match it. `ORPHAN_TEAM_WHERE` exists so that spelling is shared too.
 */

/** Prisma filter selecting ONLY archived teams. Safe in a query: NULL never matches `= true`. */
export const ORPHAN_TEAM_WHERE = { isOrphan: true } as const

/** The minimum a row needs for `isActiveTeam` to judge it. */
export interface TeamOrphanState {
  isOrphan?: boolean | null
}

/**
 * True when this team is part of the league's LIVE set.
 *
 * NULL and `false` are both active; only an explicit `true` is archived.
 */
export function isActiveTeam(team: TeamOrphanState | null | undefined): boolean {
  if (!team) return false
  return team.isOrphan !== true
}

/** Keep only the live teams. Use wherever the intent is "the teams in this league now". */
export function selectActiveTeams<T extends TeamOrphanState>(teams: readonly T[]): T[] {
  return teams.filter(isActiveTeam)
}

/** Keep only the archived teams — for a disclosure surface that reports what left. */
export function selectOrphanTeams<T extends TeamOrphanState>(teams: readonly T[]): T[] {
  return teams.filter((t) => t.isOrphan === true)
}
