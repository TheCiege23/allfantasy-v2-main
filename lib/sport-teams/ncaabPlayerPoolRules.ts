import { isEspnNcaabHeadshot } from '@/lib/espn/ncaabRosterSnapshot'

/**
 * Which college basketball rows a player pool offers, and whose photo each one may carry.
 *
 * 🛑 THE NCAAB POOL WAS HALF FORMER PLAYERS. `SportsPlayer` holds every college player Rolling
 * Insights has ever listed — 22,029 rows, 17,167 of them `INACT` — and nothing filtered them, so a
 * draft pool sorted by relevance still carried the departed. Measured on production 2026-11-25: 643
 * of one league's 1,431 draftable players were `INACT`, among them last season's stars now in the NBA.
 *
 * `INACT` alone is not "gone": 423 `INACT` rows have played THIS season — a player the vendor marks
 * inactive while injured or suspended is still on his team. And `ACT` alone is not "current" in the
 * preseason (contracts/espn GAPS M-01). So the rule uses the evidence we hold ourselves:
 *
 *   keep        a Rolling Insights row that is not `INACT`, or that has played this season;
 *   photo_only  an `INACT` row with no game this season. Never offered — but the vendor often holds
 *               two rows for one player on one school (634 measured), and the ESPN photo may sit on
 *               the inactive one, so its photo still reaches the active row beside it;
 *   drop        any other source. Only Rolling Insights ids are scored for college basketball, and
 *               the 13 TheSportsDB rows include coaches.
 *
 * `playedThisSeason` is null when the box-score read failed: nothing is known, so no `INACT` row is
 * removed and the pool is what it was before this rule.
 */
export type NcaabPoolRowVerdict = 'keep' | 'photo_only' | 'drop'

export function ncaabPoolRowVerdict(
  row: { source?: string | null; status?: string | null; externalId?: string | null },
  playedThisSeason: ReadonlySet<string> | null,
): NcaabPoolRowVerdict {
  if (String(row.source ?? '').trim().toLowerCase() !== 'rolling_insights') return 'drop'
  if (String(row.status ?? '').trim().toUpperCase() !== 'INACT') return 'keep'
  if (playedThisSeason == null) return 'keep'
  return playedThisSeason.has(String(row.externalId ?? '').trim()) ? 'keep' : 'photo_only'
}

/**
 * A college basketball row's photo, or null. Only an ESPN headshot is tied to a player (the roster
 * sweep writes it on a school + name + jersey match); every other picture on these rows was matched
 * by name, and a name is shared across seasons and schools.
 */
export function ncaabPoolRowImage(imageUrl: string | null | undefined): string | null {
  return isEspnNcaabHeadshot(imageUrl) ? imageUrl : null
}

/**
 * How much a player has produced per game this season — points, rebounds, assists, steals and
 * blocks, unweighted. It only decides WHICH players a size-limited pool keeps, so a player nobody
 * has drafted yet is not left out for having a name late in the alphabet; a league's own scoring
 * ranks them once they are in (`lib/draft-room/ncaabDraftSeason.ts`). Zero when he has not played.
 */
export function ncaabProductionPerGame(rates: Record<string, number> | null | undefined): number {
  if (!rates) return 0
  let total = 0
  for (const key of ['points', 'total_rebounds', 'assists', 'steals', 'blocks']) {
    const value = rates[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) total += value
  }
  return total
}
