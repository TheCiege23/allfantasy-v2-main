/**
 * "My leagues", collapsed to one row per real league.
 *
 * 🛑 `leagues` IS PER-USER BY DESIGN, AND EVERY CROSS-LEAGUE READER TREATS IT AS SHARED.
 * The table is unique on `(userId, platform, platformLeagueId, season)` — the `userId` is the
 * IMPORTER — so one Sleeper league imported by four people is four `leagues` rows. That part is
 * working as intended; `leagueStandingsSummary.ts` relies on it to resolve exactly one row per
 * user with `(userId, platformLeagueId, season)`.
 *
 * The bug is what happens next. Cross-league loaders find "my leagues" by asking which TEAMS the
 * reader has claimed:
 *
 *     prisma.leagueTeam.findMany({ where: { claimedByUserId: userId } })
 *
 * and a claim is written into EVERY copy, including copies owned by other importers. So the reader
 * gets one row per copy and the screen renders one card per copy.
 *
 * Measured on production 2026-09-20 for one real account: **95 league rows for 65 distinct
 * leagues — 30 phantoms.** Across all accounts: 340 reader/league pairs, 434 rows, 94 phantoms.
 * 28 platform ids carry more than one row (65 rows where 28 belong) out of 346.
 *
 * ⚠ THE TRADES BOARD HID THIS AND THAT IS WHY IT WENT UNREPORTED FOR SO LONG. Trades attach to a
 * single copy (its `leagueByPlatformId` is last-wins), so the phantoms carry no trades;
 * `byTradeUrgency` then sorts leagues-with-trades above leagues-without and `ROW_CAP` keeps ten.
 * The phantoms sank below the fold. They were never absent, only out of frame, and any surface
 * without that sort-and-cap shows them.
 *
 * 🛑 "JUST KEEP THE ROW THE READER OWNS" IS WRONG AND WOULD DELETE REAL LEAGUES. Measured the same
 * day: **17 reader/league pairs own ZERO copies** — people who claimed a team in a league somebody
 * else imported. Filtering to owned-only removes those leagues from their boards entirely. A
 * claimed team grants membership on its own (`resolveLeagueMembership`, `via: 'claim'`), so a copy
 * the reader does not own is still reachable and is a safe thing to keep.
 *
 * So: prefer the copy the reader owns, else the most recently updated, else the lowest id. Never
 * drop a league because no copy is owned.
 */

/** The fields the collapse needs. A caller's row may select far more than this. */
export type CollapsibleLeague = {
  id: string
  platformLeagueId: string | null
  /** The IMPORTER, not the reader — see the header. */
  userId?: string | null
  updatedAt?: Date | null
}

/**
 * ⚠ A BLANK PLATFORM ID MUST NOT COLLAPSE. Every one of the 383 production rows carries one today,
 * so this is insurance rather than a live case — but keying blanks together would merge unrelated
 * leagues into one card, which is a worse bug than the one this function exists to fix. A blank
 * falls back to the row's own id, which can never collide.
 */
function collapseKey(league: CollapsibleLeague): string {
  const plid = (league.platformLeagueId ?? '').trim()
  return plid === '' ? `id:${league.id}` : `plid:${plid}`
}

/** True when `candidate` should displace `incumbent` as the copy we keep. */
function displaces(candidate: CollapsibleLeague, incumbent: CollapsibleLeague, userId: string): boolean {
  const candidateOwned = candidate.userId != null && candidate.userId === userId
  const incumbentOwned = incumbent.userId != null && incumbent.userId === userId
  if (candidateOwned !== incumbentOwned) return candidateOwned

  /*
   * Freshness second, because the copies can disagree on SETTINGS — the four production copies of
   * one league carried settings blobs of 142,678 to 143,000 bytes — and the trade deadline this
   * board prints comes out of that blob. Preferring the owned copy still wins over freshness: it
   * is the row the rest of the app resolves the reader to, and every copy syncs.
   */
  const candidateAt = candidate.updatedAt?.getTime() ?? 0
  const incumbentAt = incumbent.updatedAt?.getTime() ?? 0
  if (candidateAt !== incumbentAt) return candidateAt > incumbentAt

  /* Last resort, so two renders of one portfolio cannot disagree about which copy they showed. */
  return candidate.id < incumbent.id
}

/**
 * Collapse claimed-team rows to one per real league.
 *
 * Rows whose `league` is null are dropped, which is what every caller did by hand before this
 * existed. First-seen order is preserved so a caller's own ordering survives the collapse.
 *
 * Pure, and exported for its own sake: the rule IS the product here, and it lived nowhere until
 * a real account was measured rendering 30 leagues it does not have.
 */
export function collapseClaimedLeagues<
  L extends CollapsibleLeague,
  T extends { league: L | null },
>(rows: readonly T[], userId: string): Array<T & { league: L }> {
  const kept = new Map<string, T & { league: L }>()
  const order: string[] = []

  for (const row of rows) {
    const league = row.league
    if (!league) continue
    const key = collapseKey(league)
    const incumbent = kept.get(key)
    if (!incumbent) {
      kept.set(key, row as T & { league: L })
      order.push(key)
      continue
    }
    if (displaces(league, incumbent.league, userId)) kept.set(key, row as T & { league: L })
  }

  return order.map((key) => kept.get(key)!)
}
