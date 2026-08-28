#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseChangedLineNumbers } from "./db-first-diff-lines.mjs";

const DATA_API_HOST_PATTERNS = [
  /(^|\.)api\.sleeper\.app$/i,
  // ⚠ api.sleeper.COM IS A DIFFERENT HOST FROM api.sleeper.APP ABOVE, and it was
  // unmonitored while its sibling was watched — the same near-collision that let
  // api-sports.io hide behind api.sportsdata.io. Found by the outbound-host census
  // in __tests__/db-first-host-census.test.ts, not by reading this list.
  //
  // It is the STATS host: /stats/nfl/..., /projections/nfl, and per-player weekly
  // grouping. Five files read it, and adding this reports all five because none
  // matches ALLOWED_PATH_PATTERNS — `^lib/.*(ingest|ingestion|sync)` does not match
  // "import", so the two importers fall through.
  //
  // They are NOT equally bad, and the difference is worth keeping:
  //   lib/sports-data/sleeperMarketService.ts  — the real violation. getSeasonBoard
  //       and getWeekBoard are reached from app/api/league/live-roster and
  //       app/api/players/profile, both REQUEST PATHS, so a Sleeper outage or rate
  //       limit lands on a user waiting for a page.
  //   lib/sports-os/PlayerGameLogImportService.ts — admin-only, reached from
  //       app/api/admin/sports/{game-logs,sync}. Same shape as lib/api-football.ts,
  //       which is allowlisted for exactly that reason.
  //   lib/player-game-stats/importPlayerGameStats.ts and lib/redraft/teamDefenseProvider.ts
  //       — cron-only ingestion, which the rule permits; they are reported solely
  //       because the allowlist pattern says "ingest" and these say "import".
  //   lib/live-scoring/nflLiveStatsProvider.ts — no route importer found; reached
  //       indirectly, so its exposure is unproven either way.
  //
  // All five are left REPORTED rather than allowlisted, exactly as CFBD was: an
  // allowlist entry earned before the migration is an assertion, not a fact.
  /(^|\.)api\.sleeper\.com$/i,
  /(^|\.)fantasysports\.yahooapis\.com$/i,
  /(^|\.)newsapi\.org$/i,
  /(^|\.)api\.sportsdata\.io$/i,
  /(^|\.)the-odds-api\.com$/i,
  /(^|\.)api\.espn\.com$/i,
  /(^|\.)site\.api\.espn\.com$/i,
  // TheSportsDB was missing from this list entirely, so every direct read of it
  // — schedules, teams, headshots, player search — bypassed the DB-first rule
  // without ever tripping the guard. It is now the provider behind teams, games,
  // rosters and player stats, which makes an unguarded read path a live risk:
  // a page that calls it directly gets provider latency and rate limits on the
  // request path, and goes blank when the provider blips.
  /(^|\.)thesportsdb\.com$/i,
  // Rolling Insights was the LAST monitored provider still missing, and the most exposed one:
  // per contracts/rolling-insights/INTEGRATION.md it is the scoring source, and it passes
  // `RSC_token` as a QUERY PARAMETER — so a direct call from a request path both bypasses the
  // DB-first rule and puts a long-lived credential into any URL that gets logged or surfaced in
  // an error. CLAUDE.md called this gap out explicitly.
  //
  // Covers every subdomain seen in this repo: rest.datafeeds., datafeeds., accounts., auth.,
  // api., and the bare domain.
  /(^|\.)rolling-insights\.com$/i,
  // CollegeFootballData. Rolling Insights was described as "the last provider missing" when it
  // was added in #584; that was wrong — CFBD was never on this list at all, and it is the SOLE
  // NCAAF source behind the entire devy/college stack (15 endpoints across 6 files). Nothing
  // else prices, ranks or rosters a college player, so an outage on a request path has no
  // fallback to degrade to.
  //
  // Adding it reports ONE file: lib/cfb-player-data.ts, reached from app/api/market-alerts and
  // server/api-route-modules/legacy/cfb-players — both request paths, both fetching CFBD live
  // with only a 6-hour in-process Map for cover. That is a real pre-existing violation and it is
  // left reported on purpose. The other five call sites were already covered: workers/providers/
  // and scores/gameScoreProviders.ts by existing allowlist entries, the two scripts/ by the
  // import|refresh pattern, and lib/stats/cfbdPlayerStats.ts by the entry added below.
  /(^|\.)api\.collegefootballdata\.com$/i,
  // api-sports.io. NOT the same vendor as `api.sportsdata.io` above, despite the
  // names — that near-collision is how this one stayed off the list while its
  // lookalike was monitored. Seen as `v3.football.api-sports.io` and
  // `v1.american-football.api-sports.io`.
  //
  // `media.api-sports.io` is EXCLUDED. It is the image CDN, not the data API: a
  // headshot or crest URL carries no key, returns no data to cache, and is
  // consumed as an <img src> rather than fetched. Matching the bare domain
  // reported five such lines — four of them string literals in test fixtures —
  // which is exactly the noise that buries real findings.
  /^(?!media\.)([a-z0-9-]+\.)*api-sports\.io$/i,
  // FantasyCalc — the player-value source behind trade grading, rankings and
  // the trade finder. A DB-first path already exists (`lib/fantasycalc-db.ts`,
  // fed by `scripts/sync-fantasycalc-valuations.ts`), but most callers still go
  // to the vendor directly, so this reports real debt rather than a clean slate.
  /(^|\.)api\.fantasycalc\.com$/i,
  // OpenWeatherMap. Weather rather than sport, but it is a rate-limited keyed
  // vendor on the same request paths and the rule is the same.
  /(^|\.)api\.openweathermap\.org$/i,
  /*
   * ADDED 2026-08-28 by re-deriving DATA_API_UNMONITORED in
   * __tests__/db-first-host-census.test.ts. Every one was a CONFIRMED feed sitting
   * outside this list; the impact of each was measured before adding, not assumed.
   *
   *   raw.githubusercontent.com   0 new violations. DynastyProcess values/ids and
   *                               nflverse games.csv; both call sites already sit under
   *                               allowlist patterns (dynastyProcessSync matches
   *                               `lib/.*sync`, ingest-coaches-nflverse matches the
   *                               scripts verb list). Free coverage.
   *   coaching-tree.app           0 new violations, same reason.
   *   lm-api-reads.fantasy.espn.com  2 — lib/espn-client.ts and
   *                               lib/league-import/espn/EspnLeagueFetchService.ts.
   *                               The census advertised this as an open ESPN gap for
   *                               good reason: it is neither api.espn.com nor
   *                               site.api.espn.com, so neither ESPN pattern saw it.
   *                               "league-import" does not match `ingest|ingestion|sync`.
   *   api.clearsportsapi.com      2 — provider base URLs in lib/provider-config.ts and
   *                               lib/providers/clearSportsFieldMaps.ts.
   *   bleacherreport.com          7 — all RSS feeds in one file,
   *                               lib/autocoach/status-sources/BleacherReportAdapter.ts.
   *   www.theaudiodb.com          2 — app/api/music/{artists,track-info} fetch the vendor
   *                               straight from a REQUEST PATH. A third hit, the health
   *                               probe in SystemHealthResolver, takes the standing
   *                               `db-first-exception: live provider health probe` marker
   *                               in this same change, which is why it is 2 and not 3.
   *   fantasyfootballcalculator.com  1 — lib/adp-data.ts.
   *
   * Arithmetic, stated exactly because a number in a comment is a claim: 89 baseline,
   * +14 from these patterns = 103, then -1 because the pre-existing unmarked thesportsdb
   * health probe in SystemHealthResolver took its marker in the same change. 102 total.
   *
   * Left REPORTED, not allowlisted, exactly as CFBD and api.sleeper.com were: an
   * allowlist entry earned before the migration is an assertion, not a fact.
   */
  /(^|\.)raw\.githubusercontent\.com$/i,
  /(^|\.)coaching-tree\.app$/i,
  /(^|\.)lm-api-reads\.fantasy\.espn\.com$/i,
  /(^|\.)api\.clearsportsapi\.com$/i,
  /(^|\.)bleacherreport\.com$/i,
  /(^|\.)theaudiodb\.com$/i,
  /(^|\.)fantasyfootballcalculator\.com$/i,
  /*
   * UNBLOCKED by teaching this guard to skip comments (see the scan loop). Both were
   * confirmed feeds held out only because a docblock citation would have been reported:
   *
   *   github.com           4 — nflverse release downloads in scripts/derive-team-tendencies
   *                        and derive-team-defense-tendencies. The false positive that
   *                        blocked this, playwright.config.ts linking motdotla/dotenv in a
   *                        docblock, is now correctly ignored.
   *   www.fleaflicker.com  1 — lib/league-import/fleaflicker/FleaflickerLeagueFetchService.ts.
   *                        Its sibling types.ts cites /api-docs/index.html in a docblock and
   *                        is no longer reported.
   *
   * The four github hits are the VERB-GAP class, not real exposure: they are ingestion by
   * nature, and the rule permits ingestion to call providers — the allowlist simply says
   * `ingest|import|sync|...` and these say "derive". Left REPORTED rather than adding a
   * verb, for the same reason the api.sleeper.com block above left its import-vs-ingest
   * cases reported: widening the allowlist to silence a report is an assertion about code
   * nobody has migrated.
   */
  /(^|\.)github\.com$/i,
  /(^|\.)fleaflicker\.com$/i,
  /*
   * MyFantasyLeague. Held out until its two health probes carried the standing
   * `db-first-exception: live provider health probe` marker, added in this same change —
   * their neighbours in both files (sleeper, yahoo, espn, fantasycalc) already had it and
   * MFL simply never did.
   *
   * 7 hits, 2 suppressed by those markers, leaving 5. THREE ARE REQUEST PATHS fetching
   * MFL live: app/api/mfl/leagues, app/api/mfl/import and app/api/auth/mfl. The other two
   * are lib/league-import/mfl/MflLeagueFetchService.ts, which is the verb-gap class again
   * — "league-import" does not match `ingest|ingestion|sync`.
   *
   * The three request paths are real exposure, not bookkeeping, and are left REPORTED.
   */
  /(^|\.)api\.myfantasyleague\.com$/i,
  /*
   * ⚠ FOUR CONFIRMED FEEDS DELIBERATELY NOT ADDED, each measured. Three are blocked by
   * the same limitation and it is worth stating plainly: THIS GUARD DOES NOT SKIP
   * COMMENTS. The census in __tests__/db-first-host-census.test.ts does. So a
   * documentation URL in a docblock is invisible to one tool and a violation in the
   * other.
   *
   *   github.com          dual-use. nflverse release downloads ARE a feed, but
   *                       playwright.config.ts:5 links to github.com/motdotla/dotenv in a
   *                       docblock. Host matching cannot separate a release download
   *                       from a doc link.
   *   www.fleaflicker.com one real API base, and types.ts:3 citing
   *                       /api-docs/index.html in a docblock.
   *   www.fantrax.com     the FXEA base is a feed, but /fantasy/league/<id>/home is a
   *                       user-facing deep link, and one hit is a test fixture.
   *   api.myfantasyleague.com  7, two of them health probes in api-health-monitor and
   *                       SystemHealthResolver that would each need a marker first.
   *
   * These stay in DATA_API_UNMONITORED with the same reasons. Adding them today would
   * import exactly the noise that got media.api-sports.io excluded above.
   */
];

/**
 * Exported constants that RESOLVE to a monitored host, treated exactly like a URL literal.
 *
 * WHY THIS EXISTS. This guard finds direct provider calls by scanning for `https://` literals, so
 * the moment a base URL is hoisted into a shared constant every consumer becomes invisible to it.
 * That is not hypothetical: consolidating ESPN onto one constant removed the literal from 15 files
 * in a single commit, and without this rule all 15 would have gone quiet while still calling ESPN
 * exactly as before. DRY at the call site must not cost coverage.
 *
 * Matching an identifier is weaker than matching a URL — a file could alias or re-export it — but
 * it restores the common case, and the definition sites below are few enough to review by hand.
 */
const DATA_API_IDENTIFIERS = [
  'ESPN_SITE_API_BASE',
  'THE_SPORTS_DB_V1_JSON_BASE',
  'THE_SPORTS_DB_V2_JSON_BASE',
  // The six hardcoded CFBD literals now all resolve to `CFBD_BASE_URL`, exported
  // by `lib/cfbd-fetch.ts`. Without this entry that consolidation would have
  // removed the last `https://` literal from all six files at once and retired
  // the check for every one of them — the exact failure this list exists to
  // prevent, described in the block comment above.
  'CFBD_BASE_URL',
];

/**
 * Files that NAME a provider host by definition rather than calling one.
 *
 * Two kinds, and both have to be here or the rule eats its own tail:
 *   - URL builders, whose only job is to build provider URL strings — no fetch, no credentials in
 *     flight. They must hold the literal somewhere, so flagging the definition site says nothing;
 *     what matters is who CONSUMES it, and DATA_API_IDENTIFIERS keeps those consumers visible.
 *   - This guard itself, which lists every monitored host and identifier as data. Without the
 *     entry it reports three violations against its own DATA_API_IDENTIFIERS array — which it did,
 *     the first time this rule ran.
 *
 * Scoped to explicit filenames rather than a `lib/providers/*` glob, so a real fetching client
 * dropped into that directory is still caught.
 */
const HOST_DEFINITION_FILES = [
  /^lib\/providers\/espnUrls\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^lib\/providers\/theSportsDbUrls\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^scripts\/check-db-first-api-boundary\.mjs$/i,
];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const ALLOWED_PATH_PATTERNS = [
  /*
   * `audit` joins this list because an audit script's whole purpose is comparing what a provider
   * says against what we stored — it cannot do that without calling the provider, and a script is
   * never a request path. scripts/audit-playoff-provider-data.ts documents itself as read-only,
   * writes nothing, and is invoked by hand (absent from package.json and CI).
   */
  /*
   * `compare` joins for the same reason as `audit`, one line down: a comparison
   * tool exists to hold what a provider says against what we stored, which it
   * cannot do without calling the provider. scripts/compare-player-apis.ts is
   * hand-run — absent from package.json and from CI — and a script is never a
   * request path.
   */
  /^scripts\/.*(audit|compare|ingest|ingestion|sync|backfill|import|migrate|worker|seed|hydrate|refresh)/i,
  /^lib\/.*(ingest|ingestion|sync)/i,
  /^app\/api\/sports\/news\/sync-helper\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^app\/api\/cron\//i,
  /*
   * Two sync modules the `lib/.*(ingest|sync)` pattern above misses purely
   * because of how they are NAMED, not because of what they do. Listed by exact
   * path rather than by widening that pattern, so this stays an allowlist of two
   * audited files instead of a hole any future `lib/scores/*` file falls through.
   *
   * `sports-live-scores-service.ts` DEFINES `syncLiveScoresToDb` and is the
   * db-first service itself — the module every other surface is supposed to go
   * through. Forbidding it from calling a provider would leave nothing able to
   * populate the cache the rule insists everyone reads.
   *
   * `scores/gameScoreProviders.ts` is provider fetchers only, consumed by
   * `/api/cron/import-scores` (already allowed above) and `lib/api-sports.ts`.
   * It has no request-path caller.
   *
   * ⚠ THIS IS NOT A LICENCE FOR PAGES. Both files were already flagged the moment
   * TheSportsDB joined the host list on 2026-08-16; they had simply not been
   * touched since, because the guard only scans CHANGED files. Anything on a
   * request path must still go through `getLiveScoresForSport`.
   */
  /^lib\/sports-live-scores-service\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^lib\/scores\/gameScoreProviders\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * Third file in the same category as the two above, and added for the same reason: it IS the
   * ingestion module, and the `lib/.*(ingest|sync)` pattern misses it only because the directory
   * is `stats/` and the file is named after the provider rather than the verb.
   *
   * Checked by CALLERS, not by name, per the warning above. `lib/stats/cfbdPlayerStats.ts`
   * exports `syncCfbdPlayerStatsToDb` and is imported from exactly two places in tracked source:
   * `app/api/cron/import-stat-lines/route.ts` (a cron, itself already allowed) and
   * `__tests__/cfbd-idp-scoring.test.ts`. No request path reaches it.
   *
   * ⚠ Not a blanket exemption for `lib/stats/`. Listed by exact filename so a new module dropped
   * beside it is still caught.
   */
  /^lib\/stats\/cfbdPlayerStats\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The CollegeFootballData adapter. Every export is a live CFBD fetch and
   * nothing else — same profile as lib/workers/providers/, listed by filename
   * because of where it happens to sit.
   *
   * EARNED, NOT ASSUMED. When CFBD joined the host list this file was a real
   * violation: `/api/market-alerts` and `/api/legacy/cfb-players` imported it on
   * the request path. Both now read Postgres through `lib/devy/devyPlayerReads.ts`,
   * and the only remaining runtime importer is `lib/devy-classification.ts` — the
   * ingestion module, which is what an adapter is for. The two route files keep a
   * TYPE-only import, which is erased at compile and carries no fetch.
   *
   * ⚠ RE-CHECK BEFORE TRUSTING THIS. The exemption is valid only while no request
   * path imports it for a value. `grep -rn "from '@/lib/cfb-player-data'"` should
   * show ingestion plus `import type` lines and nothing else.
   */
  /^lib\/cfb-player-data\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * `lib/espn/espnAthleteFetch.ts` — the ESPN core athlete list, and the same
   * adapter/ingestion split CFBD is the worked example of. Every export is a live
   * fetch or a pure helper for one; the writing lives in
   * `lib/espn/ingestEspnAthleteIdentities.ts`, which the `lib/.*(ingest|sync)`
   * rule above already covers.
   *
   * ⚠ NOTE THE HOST WAS ALREADY WATCHED, which is why this needed an entry at all:
   * `sports.core.api.espn.com` ends in `api.espn.com`, so the existing pattern
   * matches it and no host list needed widening. Adding it reported exactly ONE
   * file — this adapter — and nothing pre-existing.
   *
   * ⚠ RE-CHECK BEFORE TRUSTING THIS. Valid only while the ingestion module is the
   * sole runtime importer. Censused on 2026-08-27 across all four forms
   * (`from '@/lib/espn/espnAthleteFetch'`, relative, `require(`, `await import(`):
   * the ingestion module and its test, nothing else. A request path importing it
   * for a value retires the exemption.
   */
  /^lib\/espn\/espnAthleteFetch\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * `lib/cfbd-fetch.ts` — the single CFBD request path, and where `CFBD_BASE_URL`
   * is defined. It is an ADAPTER rather than a pure definition site: `cfbdGet`
   * performs the request, so it is allowlisted here with the other clients
   * instead of in HOST_DEFINITION_FILES.
   *
   * Every importer is itself allowlisted — cfb-player-data, cfbdPlayerStats,
   * scores/gameScoreProviders, workers/providers/cfbd, and the two ncaaf scripts.
   *
   * Its `CfbdResult` return type is the pattern the remaining raw fetchers in
   * lib/cfb-player-data.ts should migrate to: it makes a caller state what it
   * does when the answer is "we could not ask", rather than defaulting to `[]`.
   */
  /^lib\/cfbd-fetch\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The API-Football adapter. Earned the same way CFBD did, and checked the same
   * way — by its callers.
   *
   * It has exactly ONE importer in tracked source: `app/api/sports/sync/route.ts`,
   * which is POST-only, gated behind `requireAdminOrBearer`, and imports nothing
   * from here but `sync*ToDb` writers plus the two diagnostics helpers. That is an
   * ingestion trigger that happens to be reachable over HTTP, not a read path.
   *
   * ⚠ Its sibling `lib/api-sports.ts` is NOT here and must not be added by
   * analogy — the two look alike and are not alike. `lib/sports-router.ts`
   * imports it as `./api-sports` (a RELATIVE path, invisible to a
   * `from '@/lib/api-sports'` search) and pulls live `fetchAPISportsStandings` /
   * `fetchAPISportsPlayerStatistics`, which AI enrichment and the survivor
   * pipeline reach. That is a genuine read path.
   */
  /^lib\/api-football\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The FantasyCalc adapter, and the clearest worked example of EARNING an
   * exemption rather than asserting one.
   *
   * `lib/fantasycalc.ts` could never be allowlisted: the fetch sat beside the
   * pure helpers (findPlayerByName, getPickValue, getValueTier, the trade
   * grading maths) that ~45 modules import legitimately. So the fetch moved out
   * to this file instead of moving 45 importers — leaving exactly three runtime
   * importers, all ingestion-shaped:
   *   - lib/fantasycalc-db.ts        the DB-first layer every request path uses
   *   - scripts/sync-fantasycalc-valuations.ts
   *   - lib/replay-framework/ingest/ingestSleeperTradesForLeague.ts
   *
   * That set is the exemption. 36 request-path call sites were migrated to
   * lib/fantasycalc-db.ts first; the allowlist came last, which is the order
   * that makes it true.
   *
   * ⚠ RE-CHECK BY CALLERS, AND WITH A POSITIVE CONTROL. `from '@/lib/x'` alone
   * is not a census — a relative `./fantasycalc-fetch` import would not appear.
   */
  /^lib\/fantasycalc-fetch\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The OpenWeatherMap geocoding call, isolated behind a durable cache.
   *
   * Its sole importer is `geocodeOpenWeather` in lib/weather/weatherService.ts,
   * which reads `sportsDataCache` first and writes the result back — the same
   * DB-first-reader-over-allowlisted-fetcher shape as fantasycalc-fetch above.
   *
   * A geocode is immutable (an address does not move), so after the first
   * lookup this vendor call never runs again for that address. Only SUCCESSES
   * are cached: writing a miss would turn one transient outage into a year of
   * "this address has no coordinates".
   *
   * Deliberately NOT a `db-first-exception:` marker. That is for temporary debt
   * with a migration plan, plus the standing health-probe case; a permanent
   * read-through cache is neither, and using the marker here would blunt it.
   */
  /^lib\/weather\/openWeatherGeocode\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The OpenWeatherMap data calls, split out of `lib/openweathermap.ts` for the
   * same reason the FantasyCalc fetch was split out of its adapter: the module
   * also holds the venue coordinate tables, `getVenueForTeam` and `isTeamDome`,
   * which request paths such as `/api/sports/weather` import legitimately and
   * which touch no network.
   *
   * Moving the FETCH rather than those importers leaves two callers, both
   * provider/caching layers rather than routes:
   *   - lib/weather/weatherService.ts   the weatherCache-backed reader
   *   - lib/nfl-provider/nflRedraftProductionProviderWiring.ts
   *
   * ⚠ The census that found those two only worked because it also checked
   * DYNAMIC imports — the provider orchestrator reaches it via
   * `await import(...)`, which a plain `from '...'` grep does not see.
   */
  /^lib\/weather\/openWeatherFetch\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The api-sports.io adapter. Allowlisted on a FULL caller census — every
   * import form, aliased, relative and dynamic:
   *   crons            app/api/cron/import-{schedules,scores,standings}
   *   admin ingestion  app/api/sports/sync, legacy/identity-sync (both POST-gated)
   *   ingestion        lib/ncaaf-provider/legacyApiSportsIngestion.ts (dynamic)
   *   orchestrator     lib/nfl-provider/nflRedraftProductionProviderWiring.ts (dynamic)
   *   worker provider  lib/workers/providers/api-sports.ts
   *   script           scripts/audit-api-sports-player-stats.ts
   *   DB-FIRST ROUTER  lib/sports-router.ts
   *
   * That last one is why this took a second look. `lib/sports-router.ts` was
   * cited as the reason api-sports could never be exempted — it imports the
   * adapter RELATIVELY (`./api-sports`) and takes live standings and player
   * stats. But `getSportsData` is itself DB-first: in-memory cache, then
   * `sportsDataCache`, then `tryNFLFromDb`, and only then the provider chain,
   * writing what it fetches back. It is the same read-through shape as
   * `getFantasyCalcValuesDbFirst`, so the provider call is the cache MISS path,
   * not a request-path read.
   *
   * ⚠ Re-check with dynamic imports included. Four of the callers above are
   * `await import(...)` and appear in no `from '...'` grep.
   */
  /^lib\/api-sports\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The World Cup api-sports client. Nothing that reads reaches its fetch:
   *   sync         lib/world-cup/worldCupSyncService.ts, worldCupLiveScoreSyncService
   *   diagnostics  lib/world-cup/worldCupDiagnosticsService.ts
   *   probes       app/api/admin/ai/provider-health, AdminProviderHealthService
   *   admin sync   app/api/admin/world-cup/scores/sync-live
   *
   * The two surfaces that looked like read paths are not: `/api/sports/injuries`
   * reads rows written by `worldCupDataSyncService` (its own comment says so),
   * and the world-cup catch-all imports only `WorldCupProviderConfigError`, an
   * error class. `worldCupDataProvider.ts` is a provider INTERFACE with zero
   * prisma — it is not a DB-first layer, so the chain had to be walked to its
   * ends rather than stopped there.
   */
  /^lib\/world-cup\/apiSportsWorldCup\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The bracket provider REGISTRY — configuration, not a client. It contains no
   * `fetch`; it builds `HttpProvider` configs, and that class does the calling
   * from `baseUrl + endpoint`, so the actual request has no URL literal at all.
   *
   * Three importers: two POST ingestion workers (`bracket/workers/auto-import`,
   * `bracket/workers/live-ingest`, both writing through prisma) and
   * `/api/bracket/providers`, which returns capabilities and a score — a
   * capability probe, the same standing exception as the health probes in
   * SystemHealthResolver.
   *
   * ⚠ KNOWN BLIND SPOT, recorded rather than hidden: because HttpProvider is
   * config-driven, the guard cannot see bracket provider calls wherever they
   * originate. This registry is the one place a human can read which hosts the
   * bracket stack talks to. Do not add new provider hosts anywhere else.
   */
  /^lib\/brackets\/providers\/index\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The provider ADAPTER layer — modules that exist to speak one vendor's API and nothing else.
   * Forbidding the provider layer from calling a provider is incoherent; what the rule protects is
   * everything ABOVE it.
   *
   * Same profile as `scores/gameScoreProviders.ts` two lines up, and checked the same way — by its
   * callers, not by its name. `lib/workers/providers/espn.ts` is reached from exactly two app
   * files, `app/api/cron/import-projections` and `app/api/health/data-providers`: a cron and a
   * health probe. No request path.
   *
   * ⚠ RE-CHECK THE CALLERS BEFORE ADDING A FILE HERE. This is a directory pattern rather than a
   * filename, so a new module dropped into lib/workers/providers/ inherits the exemption. That is
   * intended for adapters and wrong for anything a page can reach.
   */
  /^lib\/workers\/providers\//i,
];

function parseArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function toPosixPath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}

function getChangedFiles(base, head) {
  const range = `${base}..${head}`;
  const command = `git diff --name-only --diff-filter=ACMRTUXB ${range}`;
  const output = execSync(command, { encoding: "utf8" }).trim();
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
}

function getAllSourceFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  const EXCLUDED_DIRS = new Set([
    '.git',
    /*
     * ⚠ `.claude/worktrees/` HOLDS FULL COPIES OF THIS REPO — one per concurrent
     * session — so every provider URL in the real source is duplicated once per
     * worktree. Measured 2026-08-27: a full scan reported 4,409 violations, of
     * which 4,320 (98%) came from `.claude/worktrees/` and 89 from real source.
     *
     * This is the same failure the `.next-dev-3101` note below describes, and
     * the same fix. It is worse in one respect: a build directory is obviously
     * generated, whereas a worktree path looks exactly like real source, so the
     * duplicates read as genuine findings and someone triaging them wastes the
     * effort on another session's checkout of code they may not even own.
     */
    '.claude',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'playwright-report',
    'test-results',
  ]);

  /**
   * Any Next build output, matched by PREFIX rather than by name.
   *
   * `.next`, `.next-dev-local` and `.next-dev-local-uifix` were listed literally, which missed
   * `.next-dev-3101` — at the time a build directory COMMITTED to this repo. (It no longer is:
   * `.next-dev-3101` and `.next-dev-local-smoke` were untracked on 2026-08-27, 724 files and
   * ~379MB of dev-server output that `.gitignore` already covered.) Its compiled bundles inline
   * every provider URL from the source they were built from, so the weekly full scan was
   * reporting hundreds of duplicate violations from build artefacts and burying the real ones.
   *
   * ⚠ Keep the prefix test anyway. The dirs are gone from the repo, not from anyone's working
   * tree — every dev still has a `.next*` locally, and a full scan walks the filesystem, not the
   * index. It also covers whatever the next `.next-*` variant is called.
   *
   * Excluding build output loses nothing: the source it was compiled from is scanned directly,
   * and a bundle is never itself a caller anyone can fix.
   */
  const isBuildOutputDir = (name) => name.startsWith('.next');

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name) || isBuildOutputDir(entry.name)) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.relative(rootDir, fullPath));
      }
    }
  }

  return files;
}

function isMonitoredHost(hostname) {
  return DATA_API_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isAllowedCaller(filePath) {
  const normalized = toPosixPath(filePath);
  return ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isHostDefinitionFile(filePath) {
  const normalized = toPosixPath(filePath);
  return HOST_DEFINITION_FILES.some((pattern) => pattern.test(normalized));
}

/**
 * Line numbers touched per file, parsed from `git diff -U0`.
 *
 * WHY CHANGED-MODE IS LINE-SCOPED. This guard's job is "do not ADD a violation". Reporting a
 * whole file meant editing one unrelated line in `lib/sports-router.ts` inherited its four
 * pre-existing TheSportsDB calls, and the only ways out were to fix architecture you did not come
 * to fix, or to paste `db-first-exception` onto lines you did not write. The second is what
 * actually happens, and it hollows out the marker for everyone: it is reserved for a TEMPORARY
 * violation with a migration plan, and once it means "the guard was in my way" it means nothing.
 *
 * Measured on the ESPN host swap: 10 whole-file violations, ZERO of them introduced by the change.
 *
 * The full scan (no `--changed`) is deliberately NOT line-scoped — the weekly audit exists to
 * report the entire debt, and that number should stay honest.
 */
function getChangedLineNumbers(base, head) {
  return parseChangedLineNumbers(
    execSync(`git diff -U0 --diff-filter=ACMRTUXB ${base}..${head}`, { encoding: "utf8" }),
  );
}

function collectViolations(rootDir, filesToScan, changedLines = null) {
  const violations = [];

  for (const relativePath of filesToScan) {
    const normalizedPath = toPosixPath(relativePath);
    const absolutePath = path.join(rootDir, relativePath);
    // null => full scan, report every line. A Set => only lines this change touched.
    const touched = changedLines ? changedLines.get(normalizedPath) ?? new Set() : null;

    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      // Line-scoped in changed mode: a violation on a line this change did not touch is
      // pre-existing debt, not something this PR added. See getChangedLineNumbers.
      if (touched && !touched.has(i + 1)) {
        continue;
      }

      if (line.includes("db-first-exception")) {
        continue;
      }

      /*
       * A URL IN A COMMENT IS DOCUMENTATION, NOT A CALL. Without this, citing a
       * vendor's API docs in a docblock is a CI-blocking violation, which pushed real
       * feeds out of DATA_API_HOST_PATTERNS to avoid the noise: github.com could not be
       * added because playwright.config.ts links github.com/motdotla/dotenv, and
       * www.fleaflicker.com because its types.ts cites /api-docs/index.html.
       *
       * ⚠ DO NOT "IMPROVE" THIS BY STRIPPING `//` FROM ANYWHERE IN THE LINE. Every URL
       * this guard exists to find contains `//` — `https://api.sleeper.app` truncates to
       * `https:` and the guard silently stops finding anything. The check is anchored to
       * the START of the trimmed line for exactly that reason.
       *
       * Deliberately the same line-level heuristic as __tests__/db-first-host-census.test.ts,
       * so the tool that CLASSIFIES and the tool that ENFORCES agree on what counts as a
       * reference. They disagreed until now.
       *
       * It is conservative on purpose. A URL on a bare line inside a block comment —
       * one starting with neither `*` nor `/*` — is still reported. That is the safe
       * direction for a guard: over-reporting is noise, under-reporting is a missed
       * credential leak on a request path.
       */
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
      }

      const matches = line.matchAll(/https?:\/\/[^\s"'`\\)\]}]+/gi);
      for (const match of matches) {
        const rawUrl = match[0];
        let hostname;

        try {
          hostname = new URL(rawUrl).hostname;
        } catch {
          continue;
        }

        if (!isMonitoredHost(hostname)) {
          continue;
        }

        if (isAllowedCaller(normalizedPath) || isHostDefinitionFile(normalizedPath)) {
          continue;
        }

        violations.push({
          file: normalizedPath,
          line: i + 1,
          url: rawUrl,
        });
      }

      // A constant that resolves to a monitored host counts as the URL it stands for — otherwise
      // hoisting the literal into a shared module silently retires this check for every consumer.
      // Skipped in the builder modules themselves, where the constant is DEFINED rather than used.
      // An IMPORT is not a call. Flagging the import line as well as the use double-reports every
      // consumer and, worse, reports a line that no `db-first-exception` would ever sensibly sit
      // on. What matters is the line that builds the URL.
      const isImportLine = /^\s*(import\s|export\s+\{|\}?\s*from\s)/.test(line);

      if (!isImportLine && !isAllowedCaller(normalizedPath) && !isHostDefinitionFile(normalizedPath)) {
        for (const identifier of DATA_API_IDENTIFIERS) {
          // Word-bounded so a longer name that merely contains this one does not match.
          if (!new RegExp(`\\b${identifier}\\b`).test(line)) continue;
          violations.push({
            file: normalizedPath,
            line: i + 1,
            url: `${identifier} (resolves to a monitored provider host)`,
          });
        }
      }
    }
  }

  return violations;
}

function main() {
  const rootDir = process.cwd();
  const changedOnly = hasFlag("--changed");
  const base = parseArg("--base");
  const head = parseArg("--head");

  let filesToScan = [];

  let changedLines = null;
  if (changedOnly && base && head) {
    filesToScan = getChangedFiles(base, head);
    changedLines = getChangedLineNumbers(base, head);
  } else {
    filesToScan = getAllSourceFiles(rootDir);
  }

  const violations = collectViolations(rootDir, filesToScan, changedLines);

  if (violations.length === 0) {
    console.log("DB-first boundary check passed.");
    process.exit(0);
  }

  console.error("DB-first boundary violation(s) detected:");
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} -> ${item.url}`);
  }
  console.error(
    "Direct monitored data API calls are only allowed in ingestion/sync modules. Add 'db-first-exception: reason' only for temporary exceptions with a migration plan."
  );
  process.exit(1);
}

/**
 * Only run when executed directly.
 *
 * Without this, importing the module to unit-test parseChangedLineNumbers starts a FULL-TREE scan
 * — the slow path, because an import passes no `--changed` flag — and then calls process.exit on
 * the test runner. Found by doing exactly that.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
