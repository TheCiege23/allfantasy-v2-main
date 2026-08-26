/**
 * How several `SportsPlayer` rows for one player are ranked against each other.
 *
 * ⚠ PURE ON PURPOSE — NO PRISMA, NO `server-only`. This lives apart from
 * `backfillCanonical.ts` so a maintenance script can reach it without importing
 * a module that instantiates a Prisma client and resolves `@/` aliases. It is
 * the same separation `ManagerTendencyBuilder` uses for the same reason.
 *
 * ⚠ AND THERE MUST ONLY BE ONE OF IT. The canonical backfill decides which row
 * a `Player` is built from; a dedupe decides which row survives. If those two
 * rankings ever disagreed, the dedupe would delete the row the canonical layer
 * had already built a player from, and the next backfill would rebuild that
 * player from a worse row without complaining.
 */

export interface SourcePlayer {
  id: string
  name: string
  sport: string
  position: string | null
  team: string | null
  externalId: string
  source: string
  sleeperId: string | null
  imageUrl: string | null
  height: string | null
  weight: string | null
  status: string | null
  fetchedAt: Date
  expiresAt: Date | null
}

/**
 * Prefer the most complete, most recently fetched source row when several
 * collapse together.
 *
 * Completeness is weighted rather than counted: a headshot is the field a card
 * looks broken without, a position decides whether the player is even eligible
 * for a slot, and a team is the weakest of the three because it changes most
 * often and is recoverable elsewhere. Recency only breaks a tie — a fresher row
 * with less in it is not the better row.
 */
export function pickBestSourceRow(rows: SourcePlayer[]): SourcePlayer {
  return [...rows].sort((a, b) => {
    const score = (r: SourcePlayer) =>
      (r.imageUrl ? 4 : 0) + (r.position ? 2 : 0) + (r.team ? 1 : 0)
    const diff = score(b) - score(a)
    return diff !== 0 ? diff : b.fetchedAt.getTime() - a.fetchedAt.getTime()
  })[0]!
}
