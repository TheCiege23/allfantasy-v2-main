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
 * ⚠ THE COLUMN IS `NOT NULL`, AND A PREVIOUS VERSION OF THIS COMMENT SAID OTHERWISE.
 *
 * It claimed `isOrphan` was "effectively three-state" because "production carries NULLs — 288
 * leagues". That was WRONG on both halves, and is corrected here rather than quietly deleted:
 *
 *   - `prisma/migrations/20260407024117_init/migration.sql` creates it as
 *     `"isOrphan" BOOLEAN NOT NULL DEFAULT false`, and it appears in NO other migration — never
 *     altered, never made nullable. The committed schema and the Prisma declaration agree.
 *   - The figure came from `lib/commissioner-workspace/rosterReads.ts`, whose comment asserts the
 *     three-state reading and says a wrong count would be "the loudest possible way to be wrong
 *     about 288 leagues". 288 is this repo's widely-cited count of COMMISSIONED LEAGUES ON
 *     PRODUCTION — the size of the blast radius, not a count of NULL rows. Reading it as a NULL
 *     measurement was an attribution error, and no production data was accessed at any point.
 *
 * 🛑 THE `!== true` PREDICATE STAYS ANYWAY, FOR REASONS THAT DO NOT DEPEND ON THAT CLAIM.
 * `TeamOrphanState` accepts `boolean | null | undefined` because callers legitimately produce
 * those: a Prisma `select` that omits the column yields `undefined`, a `$queryRaw` row is typed by
 * hand, a mapper may build a partial object carrying neither. `!== true` answers all of them the
 * same safe way — absent evidence of archival means ACTIVE, which is the direction that shows a
 * live team rather than hiding one.
 *
 * ⚠ AND IT STILL MUST NOT BECOME A PRISMA `where`. `NOT: { isOrphan: true }` compiles to
 * `NOT (isOrphan = true)`; on a NOT NULL column that is fine today, but the predicate form is what
 * keeps the helper correct for hand-typed raw rows and partial selects too, where the value
 * genuinely can be absent. Filtering fetched rows has no such ambiguity.
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
