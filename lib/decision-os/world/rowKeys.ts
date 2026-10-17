/**
 * Index cached `SportsPlayer` rows by the league id each one answers to. Pure.
 *
 * 🛑 A ROW THAT CARRIES A SLEEPER ID IS KEYED BY IT, AND ONLY BY IT (2026-10-11). Both readers used to
 * key every row by `externalId` AND `sleeperId`, first write wins. `externalId` is the writing
 * provider's own number, and the identity crosswalk stamps Rolling Insights rows with the Sleeper id
 * of the same athlete — so Rome Odunze's RI row (externalId `8394`) claimed the key `8394`, which is
 * Percy Butler's Sleeper id, and Butler was handed Odunze's status. A row with no Sleeper identity is
 * keyed by its `externalId`: that is how a non-Sleeper league's self-describing ids resolve, and the
 * port never asks `externalId` for a bare NFL number (`nonSleeperExternalIdWhere`).
 *
 * Where several rows share a key, Sleeper's own row wins (it holds the fantasy-shaped status), then
 * the caller's order — callers pass freshest first.
 */
export function indexRowsByLeagueId<R extends { externalId: string | null; sleeperId?: string | null; source?: string | null }>(
  rows: readonly R[],
): Map<string, R> {
  const out = new Map<string, R>()
  const keep = (key: string, row: R) => {
    const cur = out.get(key)
    if (!cur || (cur.source !== 'sleeper' && row.source === 'sleeper')) out.set(key, row)
  }
  for (const row of rows) {
    const ext = row.externalId ?? ''
    const sleeperKey = row.sleeperId || (ext.startsWith('sleeper:') ? ext.slice('sleeper:'.length) : null)
    if (sleeperKey) keep(sleeperKey, row)
    else if (ext) keep(ext, row)
  }
  return out
}
