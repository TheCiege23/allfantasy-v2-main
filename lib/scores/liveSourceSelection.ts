/**
 * Choosing ONE source's rows out of a multi-source game table.
 *
 * `SportsGame` is unique on `[sport, externalId, source]`, so the same fixture
 * has one row per feed and an un-deduped read renders it once per feed — some
 * of those rows carrying scores and some not.
 *
 * This lived in `lib/sports-live-scores-service.ts`, which imports
 * `fetchWithChain` from `lib/workers/api-chain.ts`. When the api-chain reader
 * needed the same rule, importing it back would have closed a cycle, and
 * writing a second copy of the rule is the bug this module exists to prevent.
 * So the rule moved DOWN to a leaf both sides can import, unchanged.
 *
 * `sports-live-scores-service` re-exports `pickFreshestSourceRows`, so its
 * existing importers and tests are untouched by the move.
 */

/**
 * Which feed wins when several have rows for the same sport.
 *
 * Earlier entries win, but ONLY among sources that are actually current. A
 * preference list alone is not enough: `espn_live` still holds 8 NCAAF rows
 * from 2026-04-26 carrying 0-0, and ranking it above TheSportsDB would show a
 * scoreboard of nil-nils while the real scores sat one row over.
 *
 * 🛑 `espn` WAS MISSING FROM THIS LIST ENTIRELY, AND IT IS THE FEED THE CRON WRITES.
 *
 * `rank()` returns `LIVE_SOURCE_PREFERENCE.length` for anything unlisted, so `espn` — the source
 * `/api/cron/import-scores` writes every two minutes, and the only one that reports in-progress
 * state — sorted DEAD LAST, below `thesportsdb`. The list named `espn_live` instead, which is a
 * different source written by the /live page's own poll and therefore only fresh while a human
 * has that page open.
 *
 * ⚠ AND THE FRESHNESS BUCKET COULD NOT SAVE IT, WHICH IS WHY THE 2026-08-27 FIX DID NOT HOLD.
 * That fix made freshness outrank preference, in 5-minute buckets, on the reasoning that "live
 * scoring is a recency problem before it is a preference problem". True — but ONE cron writes
 * rolling_insights, thesportsdb and espn seconds apart, so all three land in the SAME bucket on
 * every tick, permanently. Freshness never separates them and rank alone decides, every time.
 * The bucket only helps when feeds have genuinely different update rates; it is blind to
 * co-written sources.
 *
 * Measured on production 2026-09-06:
 *
 *     rolling_insights   421 NFL rows   with scores:   0     <- rank 0, won every tie
 *     espn                64 NFL rows   with scores:  48     <- unlisted, lost every tie
 *     thesportsdb        658 NFL rows   with scores: 383
 *
 *     GB @ PIT, status final:  rolling_insights "- @ -"   ·   espn "9 @ 28"
 *
 * So the scoreboard was being served a feed carrying no scores at all, for the same reason and in
 * the same module as the incident above.
 *
 * Order is Guap's call, 2026-09-06: ESPN, then TheSportsDB, then Rolling Insights. `espn_live`
 * sits next to `espn` as the same vendor in the same shape, and `api_sports` sits last because it
 * is plan-blocked for the current season ("Free plans do not have access to this season") and
 * reliably returns nothing — see the note in the import-scores route.
 *
 * ⚠ THIS RANKS FEEDS, IT DOES NOT INSPECT THEM. A source that goes scoreless in future still wins
 * its rank while it stays fresh. The durable fix is to prefer a feed that actually carries scores
 * for games in progress, rather than to keep re-sorting a static list after each incident.
 */
const LIVE_SOURCE_PREFERENCE = ['espn', 'espn_live', 'thesportsdb', 'rolling_insights', 'api_sports'] as const

/** A feed silent this long is treated as dead, whatever its rank. */
const LIVE_SOURCE_DEAD_AFTER_MS = 6 * 60 * 60 * 1000

/**
 * Feeds updated within this window of each other are treated as equally fresh,
 * and the preference order decides between them. Wider than the 60s refresh so
 * normal jitter between two healthy feeds does not flip the slate back and
 * forth mid-game; far narrower than the 6h dead-feed cutoff, which is a
 * liveness floor rather than a "still worth preferring" test.
 */
const LIVE_SOURCE_STALENESS_BUCKET_MS = 5 * 60 * 1000

export type SourcedRow = { source: string | null; fetchedAt: Date | null }

/**
 * Pick one source's rows — never a blend.
 *
 * Mixing sources is what produces a scoreboard where the same fixture appears
 * two or three times with different scores: this table deliberately keeps one
 * row PER SOURCE per game, so an un-deduped read shows a game once per feed.
 */
export function pickFreshestSourceRows<T extends SourcedRow>(rows: T[], now = Date.now()): T[] {
  if (rows.length === 0) return rows

  const bySource = new Map<string, { rows: T[]; newest: number }>()
  for (const row of rows) {
    const key = row.source ?? ''
    const stamp = row.fetchedAt ? row.fetchedAt.getTime() : 0
    const entry = bySource.get(key)
    if (entry) {
      entry.rows.push(row)
      if (stamp > entry.newest) entry.newest = stamp
    } else {
      bySource.set(key, { rows: [row], newest: stamp })
    }
  }

  const all = [...bySource.entries()]
  // Prefer live feeds; fall back to everything only if none is current, so a
  // fully stale sport still renders something rather than an empty screen.
  const live = all.filter(([, v]) => now - v.newest <= LIVE_SOURCE_DEAD_AFTER_MS)
  const pool = live.length > 0 ? live : all

  const rank = (source: string): number => {
    const i = (LIVE_SOURCE_PREFERENCE as readonly string[]).indexOf(source)
    return i === -1 ? LIVE_SOURCE_PREFERENCE.length : i
  }

  // ⚠ FRESHNESS OUTRANKS PREFERENCE, IN BUCKETS.
  //
  // Rank alone put a feed three hours cold ahead of one two seconds old.
  // Measured mid-game on 2026-08-27: rolling_insights held the NFL slate as
  // `scheduled` with no scores from 00:30Z while espn_live had PIT 14 BUF 3 in
  // the second quarter — and rolling_insights is rank 0, so it won. Both were
  // inside the 6h dead-feed window, so that guard never fired. The scoreboard
  // showed kickoff times for a game that was on television.
  //
  // Live scoring is a recency problem before it is a preference problem. Rank
  // still decides between feeds updated at about the same time, which is what
  // the preference list is actually for; it no longer overrides a feed that has
  // simply stopped reporting.
  const bucket = (newest: number): number =>
    Math.floor(Math.max(0, now - newest) / LIVE_SOURCE_STALENESS_BUCKET_MS)

  pool.sort(
    (a, b) =>
      bucket(a[1].newest) - bucket(b[1].newest) ||
      rank(a[0]) - rank(b[0]) ||
      b[1].newest - a[1].newest,
  )

  return pool[0]![1].rows
}
