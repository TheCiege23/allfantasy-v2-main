# AllFantasy — repo instructions

## Sports data providers

The API contracts are committed at `contracts/`:

- `contracts/rolling-insights/`
- `contracts/thesportsdb/`

**Do not call either provider's API to determine a response shape.** Read
`ENDPOINTS.yaml` and `fixtures/` in the relevant contract directory. Unknowns are
tracked in that directory's `GAPS.md` — append to it and ask. Do not probe to
resolve them.

Probing is allowed only via the contract's own `scripts/probe.sh`, only when
adding a new endpoint/sport combination, and the captured fixture must be
committed in the same change. An uncommitted probe gets repeated.

> `fixtures/` is referenced throughout both contracts but is **not yet
> populated**. Until it is, `ENDPOINTS.yaml` is the only committed shape
> authority, and its per-sport `confidence:` field tells you how much to trust
> it — several sports are marked `low` or `none`.

### Credentials

`RSC_token` (Rolling Insights) and the TheSportsDB API key are secrets. They must
never appear in logs, error messages, client responses, or committed fixtures.
Rolling Insights passes its token as a **query parameter**, so naive URL logging
leaks a long-lived credential — redact before logging, and never log a full
request URL.

Env var names have drifted; the codebase does not agree with itself. Before
adding a provider call, grep for the name actually read on the path you are
touching rather than assuming. Observed spellings for the RI token alone:
`ROLLING_INSIGHTS_RSC_TOKEN` (most common), `RSC_TOKEN`,
`ROLLING_INSIGHTS_CLIENT_SECRET`, `ROLLING_INSIGHTS_API_KEY`,
`ROLLING_INSIGHTS_KEY`. Base URL: `ROLLING_INSIGHTS_REST_BASE_URL` (most common),
`ROLLING_INSIGHTS_REST_BASE`, `ROLLING_INSIGHTS_BASE_URL`,
`ROLLING_INSIGHTS_API_BASE`.

The contract's documented names (`RSC_TOKEN`, `ROLLING_INSIGHTS_BASE_URL`) are
**minority spellings in this repo**. Setting only those will silently no-op on
most call paths.

### DB-first boundary

The intended architecture is that application code reads from Postgres and only
ingestion/sync modules call a provider. `scripts/check-db-first-api-boundary.mjs`
enforces this.

**The monitored-host list is NOT a census of our providers — check it before you
assume a provider is watched.** `DATA_API_HOST_PATTERNS` at the top of the guard
is the only authority; a provider absent from it is invisible to the guard no
matter how heavily it is used.

Rolling Insights was added 2026-08-22 (PR #584) and described at the time as "the
last one missing". That was wrong. RI genuinely is the most exposed — it passes
`RSC_token` as a query parameter, so a direct call from a request path leaks a
credential into any URL that gets logged — but it was not the last. CollegeFootballData
(`api.collegefootballdata.com`) was never on the list at all, and it is the **sole**
NCAAF source behind the whole devy/college stack; it was added 2026-08-25.

`api-sports.io`, `api.fantasycalc.com` and `api.openweathermap.org` were added
the same day for the same reason. Two things about `api-sports.io`: it is a
**different vendor** from `api.sportsdata.io`, which was already listed — that
near-collision is how it stayed invisible — and `media.api-sports.io` is
deliberately **excluded**, because an image CDN URL consumed as an `<img src>`
is not a data-API call and matching it reported four test fixtures as violations.

**One CFBD base URL.** All six literals now come from `lib/cfbd-base-url.ts` —
a definition site holding the constant and nothing else. `CFBD_BASE_URL` was
added to `DATA_API_IDENTIFIERS` in the SAME commit, because hoisting a provider
URL into a shared constant otherwise removes the last `https://` literal from
every consumer at once and silently retires the check for all of them. The
mechanism was verified rather than assumed: a throwaway non-allowlisted file
importing the constant was flagged as expected, then deleted.

`lib/sports-data-gateway/inventory.ts` is the closest thing to a provider census,
but it is a Phase-5 audit snapshot and is itself incomplete — its
`clientLocations` for CFBD listed three files; there are six.

**The code does not comply yet, and the guard says so.** A full scan reports 85
violations across tracked source (the count drifts — re-run rather than quoting
this number). Nothing is allowlisted to hide them.

### CFBD is the worked example of what compliance looks like

CFBD is at **zero** violations, and it got there by moving surfaces rather than
by allowlisting them. The shape is worth copying:

- `lib/cfb-player-data.ts` is the **adapter** — every export is a live fetch. It
  is allowlisted, but only because its sole runtime importer is the ingestion
  module. That exemption is conditional: `grep -rn "from '@/lib/cfb-player-data'"`
  must show ingestion plus `import type` lines and nothing else.
- `lib/devy-classification.ts` is the **ingestion** layer, writing `DevyPlayer`.
- `lib/devy/devyPlayerReads.ts` is the **DB-first read** layer that request paths
  use. `/api/market-alerts` and `/api/legacy/cfb-players` go through it.
- The ingestion runs on a schedule from `/api/cron/import-players`, bounded by
  the shared run budget, in `devyPool` → `devyStats` → `devyIntel` phases.

**The scheduled writer is the part that is easy to skip and fatal to skip.**
`ingestCFBDStats` existed for months with no scheduled caller, so the DevyPlayer
stat columns were never kept current in production — which is precisely why
`/api/market-alerts` fetched CFBD live instead of reading them. Pointing a
surface at a table nothing refreshes is worse than the live call it replaced: it
fails silently and looks correct. Migrate the read and wire the writer together,
or not at all.

### Remaining debt, triaged

Twelve lines came from the three providers added on 2026-08-25. Nine are now
resolved (below); **three remain**, and none of them yields to a split — each
needs a genuine DB-first layer:

- `lib/api-sports.ts` — moving the fetch out does NOT help. The fetch module's
  importers would still include `lib/sports-router.ts`, which takes live
  `fetchAPISportsStandings` / `fetchAPISportsPlayerStatistics` on read paths that
  AI enrichment and the survivor pipeline reach. Needs a DB-first layer for
  standings and player stats.
  ⚠ Note `sports-router` imports it as `./api-sports` — a RELATIVE path a
  `from '@/lib/api-sports'` search does not find. Do not allowlist it by analogy
  to `lib/api-football.ts`; the two look alike and are not alike.
- `lib/world-cup/apiSportsWorldCup.ts` — the world-cup stack has its own sync
  services; the work is routing live surfaces through them. Reachability was
  never proven either way (20+ app routes sit above it).
- `lib/brackets/providers/index.ts` — a provider REGISTRY, not a client: the
  URLs are configuration handed to `HttpProvider`, which does the fetching. A
  split moves nothing. Needs bracket schedule/live-score caching.

**Adapters, censused 2026-08-25** — how each was settled:
  - `lib/api-football.ts` — **allowlisted.** One importer, `app/api/sports/sync`,
    POST-only behind `requireAdminOrBearer`, taking `sync*ToDb` writers only.
  - `lib/openweathermap.ts` — **resolved by the same inverted split.** The
    fetchers moved to `lib/weather/openWeatherFetch.ts` (allowlisted); the venue
    coordinate tables, `getVenueForTeam` and `isTeamDome` stayed, so
    `/api/sports/weather` and the other importers were untouched. Two callers
    remain, both provider/caching layers — and the census only found the second
    (`nflRedraftProductionProviderWiring`) because it checked **dynamic**
    imports; it reaches the fetch via `await import(...)`.
  - `lib/fantasycalc-fetch.ts` — **allowlisted, and the clearest worked example
    of earning it.** See below.

**FantasyCalc, migrated 2026-08-25.** 36 of those sites now read through
`lib/fantasycalc-db.ts`: 17 request-path routes and 19 serving `lib/*` modules.

`scripts/sync-fantasycalc-valuations.ts` is **not** scheduled — it is an npm
script only, and the one cron that mentions FantasyCalc
(`/api/cron/adp-refresh`) writes a dated value series, not the
`fantasycalc:values:*` key. **This does not block anything**, and the contrast
with `ingestCFBDStats` is the point: `getFantasyCalcValuesDbFirst` is
read-through and self-populating, so a cold cache costs one live fetch rather
than silently serving nulls. `DevyPlayer.passingYards` had no such fallback,
which is exactly why that one was fatal and this one is not. Scheduling the sync
is a quota and latency win, not a correctness prerequisite.

**Only `replay-framework/ingest/ingestSleeperTradesForLeague` still fetches
live**, and deliberately: it is ingestion by name and nature, the rule permits
ingestion to call providers, and a replay run wants one deliberate snapshot.

Five modules that *looked* like capture/history were checked individually and
migrated — `trade-learning`, `comprehensive-trade-learning`, `historical-values`,
`upstream-apis`, `tradeLearningCapture`. The prior assumption, that they stamp
point-in-time values and so must not read a cache, was **wrong for all five**:
four are reached from request paths, and the value they want is explicitly
current market. `historical-values` says so in its own comment — FantasyCalc is
the *current* coverage fallback after the Excel historical series misses. Worth
remembering as a caution: a module's name is not evidence of when it runs.

**The adapter split — copy this shape.** `lib/fantasycalc.ts` could never be
allowlisted while the fetch sat beside the pure helpers (`findPlayerByName`,
`getPickValue`, `getValueTier`, the trade-grading maths) that ~45 modules import
legitimately. The fix was to **invert** the obvious move: rather than repointing
45 importers, the FETCH moved out to `lib/fantasycalc-fetch.ts`, leaving three
runtime importers — `lib/fantasycalc-db.ts`, `scripts/sync-fantasycalc-valuations.ts`,
and `lib/replay-framework/ingest/ingestSleeperTradesForLeague.ts`. That set is
the exemption, and it came **after** the 36 call-site migrations, which is the
order that makes an allowlist true rather than asserted.

⚠ **A DB-first read makes the adapter's cache accessor lie.**
`getValuationCacheAgeMs` reads the fetch module's in-process Map. Any surface
moved to `getFantasyCalcValuesDbFirst` must switch to `getFantasyCalcCacheAgeMs`
in `lib/fantasycalc-db.ts`, or it silently reports "unknown age" for data that is
fresh. `league-rankings-v2` shipped exactly that for one commit; nothing type-checks it.

⚠ **Test mocks rot silently during a migration.** Four suites mocked
`@/lib/fantasycalc` (or the canonical facade) and stopped intercepting the moment
the module under test moved to the DB layer — so the real prisma-backed path ran
inside unit tests. When you move a module across a boundary, grep the test tree
for mocks of the old one.

⚠ **A rename sweep must exclude modules that re-export the renamed symbol.**
`lib/player-valuations/canonicalPlayerValuations.ts` is a re-export facade
(`export const fetchFantasyCalcValues = …`); a blanket rename rewrote the name
it *publishes* rather than migrating a caller, and
`lib/shared-services/waiver/WaiverContextAssembler.ts` imports the fetcher
*through* that facade. The grep census read clean on both — only the typecheck
caught them.

  **Census these with a positive control.** A `from '@/lib/x'` grep alone missed
  `lib/sports-router.ts`, which would have made `lib/api-sports.ts` look
  ingestion-only and earned it an exemption it does not deserve. Always also
  grep for `'./x'`, `'../x'` and `require(`.
- **A service, not an adapter** — `lib/trade-intel/marketValueService.ts`
  called FantasyCalc directly rather than through the adapter, so migrating the
  adapter's callers stepped straight past it. **Resolved** with its own move to
  `getFantasyCalcValuesDbFirst`.
- **Non-request paths.** Resolved individually, never in bulk:
  - `scripts/compare-player-apis.ts` — hand-run (absent from package.json and
    CI). `compare` joined the scripts verb list next to `audit`, for the reason
    already written there: a comparison tool cannot compare without calling.
  - `lib/admin-dashboard/SystemHealthResolver.ts` — marked
    `db-first-exception: live provider health probe`, which is what its sleeper,
    yahoo and espn entries already carried. FantasyCalc only lacked the marker
    because FantasyCalc was not monitored until today. Line-scoped on purpose:
    allowlisting the file would exempt any future non-probe call in it too.
  - `app/api/start-sit/weather.route.js` — **deleted, not exempted.** It was
    dead: nothing imported it, its own header declared its path as
    `weather/route.js`, and that path now holds a `route.ts` using
    `lib/weather/weatherService`. Next.js does not route a `X.route.js` sitting
    beside the directory. Five identical strays remain in `app/api/start-sit/`
    (`chimmy`, `injuries`, `leagues`, `matchups`, `roster`), each superseded by
    a live directory route; they trip no guard and were left for a deliberate
    dead-code pass.
  - `lib/weather/weatherService.ts` (geocode) — **resolved.** A geocode is
    immutable, so it is now a durable `sportsDataCache` entry with the vendor
    call isolated in `lib/weather/openWeatherGeocode.ts` (allowlisted).
    **Only successes are cached**: writing a miss would turn one transient
    outage into a year of "this address has no coordinates".
    Worth recording that this was first written as a `db-first-exception:`
    marker and corrected — a permanent read-through cache is not temporary debt
    with a migration plan, and using the marker there blunts it for everyone.

**On `db-first-exception:` for health probes.** The rule above calls the marker
temporary, and a health probe is permanent. The probe is the recognised standing
exception: checking whether a provider is up is the one job that *cannot* be done
by reading Postgres, and the convention predates this note in
`SystemHealthResolver.ts`. That is the only permanent use. Everything else the
marker touches still needs a migration plan.

Treat both contracts' "the app never calls the vendor" line as the **target**
architecture, not a description of current state.

Two consequences worth knowing before you touch provider code:

- CI runs the guard in `--changed` mode, so `main` stays green and only a PR that
  **touches** one of those files is stopped. That is the guard working, not a
  regression you introduced — check whether the violation predates your change.
- `db-first-exception:` silences a line, and is reserved for a **temporary**
  violation with a migration plan. It is not a way past a pre-existing one, and
  widening `ALLOWED_PATH_PATTERNS` is a deliberate per-file decision — the two
  entries there are audited individually on purpose.

### The 304 rule

**What a Rolling Insights `304` means is disputed between two vendor sources and
is currently UNRESOLVED** — see `304_conflict` in
`contracts/rolling-insights/ENDPOINTS.yaml`. The skill repo says it is a cache
artifact to be defeated; the newer OpenAPI spec declares a `NotModified`
component meaning "valid request, empty result set."

Do not wait for that to be settled, and do not make product behaviour depend on
it. The rule is safe under **both** readings:

1. Send no-cache headers and a fresh millisecond cache-buster on every call.
2. Retry once on a 304.
3. Detect change by hashing the payload, never by HTTP status.

If it is a cache artifact, busting defeats it. If it genuinely means empty, you
pay one extra request and no-op on an unchanged hash. Either way you are right.

What is **not** acceptable either way: returning `[]` on a 304 without a
cache-busted retry. That reports "no data" for what may be a cache hit, and it is
indistinguishable from a real empty result.

## Git

The working tree is sometimes shared with concurrent sessions; HEAD can move
underneath you mid-task. Stage explicit paths, never `git add -A`, and verify the
staged set before committing.

**This repo is public.** Secret-scan before every push.
