import 'server-only'

import { prisma } from '@/lib/prisma'
import { valueBookFor, type ValueBook } from '@/lib/core-app/valueBook'

/**
 * Which value chart Chimmy prices THIS league on — asked of `valueBookFor`, the same function the player
 * card, waivers board, trades board, roster grade and trade engine already ask (2026-11-17).
 *
 * 🛑 CHIMMY HAD ITS OWN RULE, AND IT PRICED KEEPER LEAGUES OFF THE WRONG CHART. `deriveValueFormat` read
 * `/dynasty|keeper/i` off the canonical rules, so every keeper league got the dynasty chart. The owner's
 * rule (2026-09-28, "by keeper share, everywhere") puts a keeper league on the dynasty chart only when half
 * or more of its roster carries over — measured that day, 17 of 19 keeper leagues keep 1–3 players. So on
 * those leagues the card showed this season's value and Chimmy quoted the dynasty one. Its superflex test
 * (`detectQbFormat`) also missed ESPN `OP`, Yahoo `Q/W/R/T` and `QB:2`-style slots that the card's
 * `startsTwoQuarterbacks` reads, and it knew nothing of specialty formats on a dynasty base (zombie,
 * best ball), pirate carry-over or guillotine. `valueBook.ts` records each of those decisions; this file
 * exists so there is no second copy of them to drift.
 *
 * Null when there is no league or no row: the caller reports the gap; it never assumes a chart.
 */
export type LeagueValueFormat = Pick<ValueBook, 'format' | 'qbFormat'>

type LeagueReader = {
  league: {
    findUnique: (args: {
      where: { id: string }
      select: { settings: true; leagueType: true }
    }) => Promise<{ settings: unknown; leagueType: string | null } | null>
  }
}

export async function loadLeagueValueFormat(
  leagueId: string | null | undefined,
  db: LeagueReader = prisma as unknown as LeagueReader,
): Promise<LeagueValueFormat | null> {
  if (!leagueId) return null
  const row = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, leagueType: true } })
  if (!row) return null
  const book = valueBookFor(row.settings, row.leagueType ?? null)
  return { format: book.format, qbFormat: book.qbFormat }
}
