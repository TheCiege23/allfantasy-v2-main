import 'server-only'

import { prisma } from '@/lib/prisma'
import { sleeperIdWhere } from './externalIdNamespace'

/**
 * Resolve Sleeper roster player ids to names, positions and teams.
 *
 * 🛑 THIS EXISTS BECAUSE THE RULE WAS WRITTEN TWICE AND FIXED ONCE. Both
 * `materializeRedraftRosterPlayers` and `/api/leagues/[id]/trades/rosters` turned a
 * `Roster.playerData` id list into player metadata, both did it through
 * `getNormalizedPlayerData({ surface: 'roster', … })`, and both fell back to `name: id` when that
 * returned nothing. It returns nothing: measured 2026-09-04 on a real league, ZERO rows for every
 * call shape tried — with `userId`, without it, and without `leagueId`.
 *
 * The materializer's copy wrote 58,596 rows into `RedraftRosterPlayer` with the id as the player's
 * NAME, and because values are resolved BY NAME nothing on those rosters could be priced. Repairing
 * that table did not fix the trade picker, because the picker is fed by the ROUTE's copy. One rule,
 * two implementations, one of them repaired — which is the bug this module deletes.
 *
 * ⚠ NEVER LOOK A SLEEPER ID UP AGAINST `externalId`. `./externalIdNamespace` records that three
 * sources write bare numerics into that column, that 42,032 numeric ids exist in both the Sleeper
 * space and a provider space, and that 42,031 of those are A DIFFERENT PERSON. Measured on one
 * league's own 241 ids:
 *
 *     sleeperIdWhere    241/241 matched   (100%)
 *     bare externalId   121 matched, 0 of 121 the same human
 *                       Justin Herbert -> "Damone Clark", Geno Smith -> an NBA player
 */
export type ResolvedSleeperPlayer = {
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
  sport: string
  source: string
  /** `SportsPlayer.imageUrl`. The picker renders a headshot slot from it. */
  imageUrl: string | null
}

/*
 * ⚠ ONE SLEEPER ID MATCHES SEVERAL ROWS — one per source. They are the same person here (unlike an
 * `externalId` collision) but they disagree about SHAPE, and shape is what the UI renders:
 *
 *     sleeper           "Aaron Rodgers"    QB              PIT
 *     rolling_insights  "Austin Ekeler"    RB              Washington Commanders
 *     thesportsdb       "Brian Robinson"   Running Back    Atlanta Falcons
 *
 * Measured coverage and shape on that league:
 *
 *     sleeper           100.0%   team is an abbreviation in 232/241
 *     rolling_insights   72.2%   0/174
 *     thesportsdb        63.9%   7/154
 *
 * A team LOGO is keyed by abbreviation and a position chip is two characters wide, so `sleeper`
 * wins and `thesportsdb` is last. Lower rank wins. This order is the measurement, not a preference.
 */
const SOURCE_RANK: Record<string, number> = {
  sleeper: 0,
  rolling_insights: 1,
  cfbd: 2,
  api_football: 3,
  thesportsdb: 4,
}

export function sleeperSourceRank(source: string | null | undefined): number {
  return SOURCE_RANK[String(source ?? '').trim().toLowerCase()] ?? 9
}

/**
 * One query for a whole league's ids. Returns a map keyed by Sleeper id; ids that resolve to
 * nothing are simply absent, so every caller keeps deciding for itself what an unknown player
 * means — this module does not invent a placeholder name.
 */
export async function resolveSleeperRosterPlayers(
  sleeperIds: readonly string[],
  sport: string,
): Promise<Map<string, ResolvedSleeperPlayer>> {
  const out = new Map<string, ResolvedSleeperPlayer>()
  const ids = [...new Set(sleeperIds.map((i) => String(i ?? '').trim()).filter(Boolean))]
  if (ids.length === 0) return out

  const rows = await prisma.sportsPlayer
    .findMany({
      where: sleeperIdWhere(ids, sport),
      select: {
        sleeperId: true, name: true, position: true, team: true,
        sport: true, source: true, imageUrl: true,
      },
    })
    .catch(() => [] as ResolvedSleeperPlayer[])

  for (const row of rows) {
    const key = String(row.sleeperId ?? '')
    if (!key) continue
    const held = out.get(key)
    if (held && sleeperSourceRank(held.source) <= sleeperSourceRank(row.source)) continue
    out.set(key, row)
  }
  return out
}
