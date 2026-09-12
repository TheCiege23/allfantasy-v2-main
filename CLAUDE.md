# AllFantasy — repo instructions

## Sports data providers

The API contracts are committed at `contracts/`:

- `contracts/rolling-insights/`
- `contracts/thesportsdb/`
- `contracts/api-sports/`
- `contracts/fleaflicker/`

**Do not call any of these providers' APIs to determine a response shape.** Read
`ENDPOINTS.yaml` and `fixtures/` in the relevant contract directory. Unknowns are
tracked in that directory's `GAPS.md` — append to it and ask. Do not probe to
resolve them.

Probing is allowed only via the contract's own `scripts/probe.sh`, only when
adding a new endpoint/sport combination, and the captured fixture must be
committed in the same change. An uncommitted probe gets repeated.

> ⚠ **`fixtures/` IS POPULATED NOW — 22 captures across 4 contracts — BUT VERY
> UNEVENLY, AND THE UNEVENNESS IS THE POINT.** This note used to say "not yet
> populated", which told every session that `ENDPOINTS.yaml` was the only shape
> authority. That is no longer true, and reading it as still true means ignoring
> 22 real captures.
>
> Measured on `origin/main` 2026-09-11:
>
> | contract | fixtures | what they cover |
> |---|---:|---|
> | `thesportsdb` | 15 | broad — leagues, events past/next, lineups, player + player stats, timeline, team search, across NFL and NCAAF (plus a `_manifest.json`) |
> | `fleaflicker` | 3 | standings, rosters, scoreboard — NFL only |
> | `rolling-insights` | 3 | **`live.*` ONLY** — MLB, NBA, NHL |
> | `api-sports` | 1 | odds/bets |
>
> ⚠ **SO THE OLD ADVICE STILL HOLDS FOR ROLLING INSIGHTS, WHICH IS THE PROVIDER
> IT MATTERS MOST FOR.** Its three fixtures are all the `live` endpoint. For
> `schedule-season`, `team-info`, `player-info`, stats, injuries and depth charts
> there is still no capture, so `ENDPOINTS.yaml` remains the only committed shape
> authority there — and its per-sport `confidence:` field tells you how much to
> trust it, with several sports marked `low` or `none`.
>
> Check before assuming either way; `find contracts -path '*fixtures*' -type f`
> is the whole check, and it is cheaper than being wrong in either direction.

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

🛑 **THERE ARE TWO ROLLING INSIGHTS ACCOUNTS AND THEIR SPORTS DO NOT OVERLAP.**
`ROLLING_INSIGHTS_RSC_TOKEN` and `ROLLING_INSIGHTS_RSC_TOKEN2` (also
`..._CLIENT_ID2` / `..._CLIENT_SECRET2`) are **different subscriptions**, and the
list above is spellings of the FIRST one — not the whole credential set.

| | `RSC_TOKEN` | `RSC_TOKEN2` |
|---|---|---|
| NFL | ✅ | ❌ |
| MLB · NBA · NHL · NCAABB · **NCAAFB** · SOCCER | ❌ | ✅ |

**A single-credential call cannot answer "do we have this sport".** Take the
first token present and every sport on the other account looks unavailable —
`lib/workers/providers/rollingInsightsRest.ts` has `riCredentialsFor` for exactly
this reason, and any new call path or ad-hoc probe must iterate credentials the
same way.

This has now caused the same wrong conclusion twice: `GAPS.md` `N-02` records a
reader that took the first token and left six sports 304'ing forever while
reporting itself healthy, and on 2026-08-28 a probe using only the first token
concluded "RI has no college football" — it does, on `TOKEN2`. Both were
confident, both were wrong, and `GAPS.md` had already named the trap.

Two related vendor behaviours, both in `contracts/rolling-insights/GAPS.md`:
`/live/{date}` is keyed on the **US Eastern** date (a UTC date 404s through NFL
primetime), and `/live` on a **past** date is the cheapest unambiguous
entitlement probe — an unentitled sport returns `404 "You are not signed up for
the sport you are requesting"` where `team-info` returns an ambiguous `304`.

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

**The code does not comply yet, and the guard says so.** Measured 2026-09-12 in a
detached worktree at `26d9e75bd`: **109** violations across tracked source, and
**28** for the sibling `check-decision-engine-boundary.mjs`. The count drifts with
every commit — re-run rather than quoting these. Nothing is allowlisted to hide them.

🛑 **AND MEASURE IT IN A DETACHED WORKTREE AT A COMMIT, NEVER IN THE SHARED F:
CHECKOUT, WHICH IS NOT `main` AND IS NOT ANY COMMIT ANYONE WILL BUILD.** Measured
the same day: `F:\allfantasy-v2-main`'s own HEAD was `69c35ace2` — **283 commits
behind `origin/main` AND 128 commits ahead of it**. Divergent, not merely stale, and
nothing about the checkout announces that.

The cost is not abstract. Scanning it produced **111** and **27** rather than 109 and
28, and the discrepancy was confidently explained as `9bc2dfd75` having added two
monitored hosts. That explanation was wrong. The two extra findings were
`lib/geo/detectUserState.ts` on a tree where that commit's inverted split has not
happened — on `origin/main` the fetches live in the allowlisted
`lib/geo/geoIpFetch.ts` and contribute ZERO. The wrong figure was reported twice and
reached a landed commit message.

⚠ **A PLAUSIBLE CAUSAL STORY IS WHAT MADE IT STICK.** "Two hosts were added, so the
count went up by two" is arithmetic that fits, so nobody looks further — the same
shape this file records for the `exclude`-inheritance diagnosis: a wrong mechanism
with a right-looking number attached. The check that settles it is one command:

```bash
git -C <checkout> rev-list --count HEAD..origin/main   # behind
git -C <checkout> rev-list --count origin/main..HEAD   # ahead — the one people skip
```

⚠ **AND AN A/B ACROSS TWO GUARD VERSIONS ON ONE TREE IS STILL VALID THERE**, which is
why this is easy to miss: the 333 → 111 set-diff that justified the ignore fix was run
on that divergent tree and its conclusion holds exactly (222 ignored-copy lines removed,
0 added), because both sides saw the same files. A DELTA survives a wrong tree. A TOTAL
does not.

#### Triaged 2026-09-12: 109 findings are SIX actionable violations, and three you must not touch

**109 findings is not 109 violations.** They are 69 distinct files: 60 lines in `lib`,
20 in `scripts`, 19 in `__tests__`, 6 in `app`, 3 in `server`, 1 in `contracts`. The
`app/` and `server/` ones are the highest-signal subset because a `route.ts` is a request
path BY DEFINITION — no caller census needed to establish exposure.

🛑 **THREE OF THOSE EIGHT ARE THE ACCEPTED READ-THROUGH CACHE. Do not "fix" them** — the
provider call is the cache-MISS path, exactly as this file already sanctions for
`getSportsData` and `getFantasyCalcValuesDbFirst`:

| file | shape |
|---|---|
| `app/api/players/profile/route.ts:42` | `sportsDataCache` read → fetch on miss → `upsert` |
| `server/api-route-modules/legacy/player-game-logs/route.ts:111` | explicit cache-hit return, then `// Cache miss: fetch from Sleeper` |
| ` …/player-game-logs/route.ts:124` | the schedule fetch, inside that same miss branch |

**The six that are genuinely naked live vendor calls on a request path:**

| file | vendor |
|---|---|
| `app/api/league/live-roster/route.ts:22` | `api.sleeper.app` |
| `app/api/mfl/import/route.ts:46` | `api.myfantasyleague.com` |
| `app/api/mfl/leagues/route.ts:39` | `api.myfantasyleague.com` |
| `app/api/music/artists/route.ts:93` | `theaudiodb.com` |
| `app/api/music/track-info/route.ts:66` | `theaudiodb.com` |
| `server/api-route-modules/legacy/trade/analyze/route.ts:434` | `thesportsdb.com` |

⚠ **THE TWO MFL ONES ALSO PUT A CREDENTIAL ON THE WIRE FROM A REQUEST PATH**, sending
`Cookie: MFL_USER_ID=${connection.mflCookie}`. That is the `RSC_token`-in-a-query-parameter
shape reached a different way — and note the `db-first-auth-exchange:` marker correctly
covers only `app/api/auth/mfl/route.ts`'s `/login`. These are DATA calls; the marker does
not reach them and must not be pasted onto them.

🛑 **AND THE SHORTCUT THAT PRODUCED A WRONG ANSWER — it misclassified 2 of the 8.** Grepping
the lines around each finding for cache signals (`prisma.`, `findUnique`, `sportsDataCache`,
`cached`) reported both MFL routes as cache-guarded. They are not. The prisma call it
matched is `getMFLConnection()` — a CREDENTIAL lookup — and the fetch that follows is
unguarded. *"Is there a prisma call nearby"* is not *"is this fetch cache-guarded"*, and the
proximity grep cannot tell a cache read from a credential read. The classification above
comes from reading all eight; two of them contradict the heuristic that found them.

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

All twelve lines from the three providers added on 2026-08-25 are now resolved.

**The last three were resolved by CENSUS, not by new code — and this file
previously said the opposite.** It asserted that `api-sports`,
`apiSportsWorldCup` and `brackets/providers` each needed a real DB-first layer
and that "none yields to a split". That was wrong, and wrong in an instructive
way: the claim rested on tracing one or two importers and inferring the rest.

What the full census actually found:

- `lib/api-sports.ts` — the stated blocker was `lib/sports-router.ts` taking
  live standings and player stats. But `getSportsData` is itself DB-first:
  in-memory cache → `sportsDataCache` → `tryNFLFromDb` → provider chain, writing
  back what it fetches. The provider call is the cache-MISS path, exactly like
  `getFantasyCalcValuesDbFirst`. Every other importer is a cron, an admin-gated
  POST, a worker, a script, or the provider orchestrator.
- `lib/world-cup/apiSportsWorldCup.ts` — every consumer is a sync service,
  diagnostics, or a provider-health probe. The two surfaces that LOOKED like
  read paths are not: `/api/sports/injuries` reads rows written by
  `worldCupDataSyncService`, and the world-cup catch-all imports only an error
  class. Note `worldCupDataProvider.ts` is a provider INTERFACE with zero
  prisma — it is not a DB-first layer, so the chain has to be walked past it.
- `lib/brackets/providers/index.ts` — configuration, not a client: no `fetch`
  anywhere in it. Two POST ingestion workers and one capability probe.

⚠ **A known blind spot, recorded rather than papered over.** `HttpProvider` in
`lib/brackets/providers/` builds its URL from `baseUrl + endpoint` passed as
config, so bracket provider calls carry no `https://` literal and the guard
cannot see them at all. The registry is the one place a human can read which
hosts the bracket stack talks to. Do not introduce provider hosts elsewhere in
that stack.

**The lesson worth keeping:** four separate times this session, a caller census
that used only `from '@/lib/x'` gave the wrong answer — missing relative imports
(`./api-sports`), dynamic imports (`await import(...)`), re-export facades, and
test mocks. Always check all four forms before concluding anything about who
reaches a module.

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
`SystemHealthResolver.ts`. That is the only permanent use **of this marker**.
Everything else `db-first-exception:` touches still needs a migration plan.

**`db-first-auth-exchange:` is a SECOND permanent exception, and a SEPARATE marker
on purpose.** An authentication call trades credentials for a session — Postgres
cannot answer it by definition, so it is not debt and has no migration plan.
Overloading `db-first-exception:` for it would blunt that marker for everyone,
which is the mistake already made and corrected on the weather geocode above.

It is **self-limiting**: the guard honours it only when the line also names an auth
path segment (`/login`, `/oauth`, `/token`, `/authorize`, `/signin`), so pasting it
onto a stats or league URL still reports the line. Extending `AUTH_ENDPOINT_PATH`
is a deliberate, visible edit.

The one use today is `app/api/auth/mfl/route.ts`, which POSTs a username and
password to MyFantasyLeague's `/login` and stores the returned cookie. ⚠ The
segment test runs against the **whole line**, not the parsed URL path, because the
guard's URL matcher stops at `}` — a template URL like `.../${apiYear}/login` is
captured as `.../${apiYear` and its pathname never contains `/login`.

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

### 🛑 READ `enforce_admins` BEFORE CHOOSING A LANDING ROUTE — IT MOVED THREE TIMES IN ONE NIGHT

```bash
gh api repos/TheCiege23/allfantasy-v2-main/branches/main/protection --jq '.enforce_admins.enabled'
```

| reading | how work lands |
|---|---|
| `false` | direct push — the cherry-pick convention below, verbatim |
| `true` | **PR only.** A direct push is refused by GitHub, and only AFTER the queue wait |

🛑 **DO NOT MEMORISE A DIRECTION, AND DO NOT TRUST THIS PARAGRAPH'S.** On 2026-09-11 the
flag went ON ~17:23, OFF ~2h later, and ON again before 04:00Z — every move at the user's
instruction, every one settled rather than contested. This is a SETTING TO READ, not a
decision to remember.

⚠ **THE COST OF TREATING IT AS A DECISION IS MEASURED, AND THIS SECTION PAID IT.** Two
sessions amended memory files during the first window; one was false fifteen minutes
later. The version of this very section that opened *"DIRECT PUSHES TO `main` WORK — this
is a RECORD, not a rule"* was landed at 23:24 and was wrong by 03:55. It was written
BECAUSE the previous version had gone stale, by a session that had spent the evening
arguing that a confident permanent paragraph is the failure this file exists to prevent.
Stating a setting as a fact is what fails, not the particular direction chosen.

⚠ **AND EVERY PEER REPORT OF THE FLAG WAS ACCURATE WHEN SENT AND STALE WHEN READ.** Three
transitions, three correct messages, three sessions acting on a value that had already
moved. Re-read the endpoint yourself before acting; it costs one command. Both endpoints
agree, so either is fine — `/protection` and `/protection/enforce_admins`.

🛑 **UNDER `true`, A RED REQUIRED CHECK ON `main`'s HEAD BLOCKS EVERYONE, NOT ITS AUTHOR.**
With `strict: true` a PR must be up to date with `main`, so whatever is red at the tip is
red for every open PR. Under `false` that same breakage is invisible, because the admin
bypass absorbs it — which is exactly how `Unit tests (3/4)` stayed broken for hours.

The rest of this section is kept because that first window measured things that are true
whichever way the flag reads, and because the episode is the most compact example of this
file's own thesis.

**What the flip revealed, and these outlive it:**

- **The 14 required contexts have always been bypassed.** Every push prints
  `Bypassed rule violations for refs/heads/main: 14 of 14 required status checks are
  expected`, and that line is LITERAL — the contract exists and enforces nothing, because
  `enforce_admins: false` exempts the owner account and every push is that account. It is
  one boolean, not a consequence of the cherry-pick convention.
- **Removing the bypass surfaced a genuinely red required check that had been invisible.**
  `Unit tests (3/4)` was failing on `main` and nothing said so, because nothing was
  evaluating it against a landing. The gate did not create the failure; it revealed one.
- **`enforce_admins` blocks BYPASS, not merge.** A peer read
  `required_approving_review_count: 1` off
  `/branches/main/protection/required_pull_request_reviews` and concluded no path to `main`
  existed. That sub-endpoint returns what the setting WOULD be rather than 404ing when it
  is unset — the canonical object does not have the key, `rulesets` is 0, and live PRs
  report `reviewDecision` EMPTY. No review is required.
- **`required ∩ failing` is the only view that answers "can this land".** A raw
  `/commits/<sha>/check-runs` list showed six failures; two were `Playwright (mobile-smoke)`
  and `Playwright (core 2/3)`, which are NOT required and block nobody. Keep the LATEST run
  per name and intersect with the 14. ⚠ Count with `jq length`, not `grep -c` — grep
  returning 0 exits 1 and reads exactly like a failed command.
- 🛑 **AND "KEEP THE LATEST RUN PER NAME" IS THE WRONG RULE FOR "DID THIS TEST PASS".** The
  two questions diverge the moment a re-run is in flight: the latest run is `in_progress`,
  so the rule discards a COMPLETED verdict from the previous generation and reports the
  shard as pending. Measured 2026-09-11 on one commit carrying **nine** generations of the
  same four shards — `1/4` failed at 01:32 and passed on all seven later runs, which is
  the contended-box false red this file already records. Latest-per-name answers "can this
  land right now" and nothing else. To ask whether a suite is broken, list every run with
  `started_at` and read the completed ones:

  ```bash
  gh api "repos/<owner>/<repo>/commits/<sha>/check-runs?per_page=100" \
    --jq '.check_runs[] | "\(.started_at)  \(.name)  \(.status)  \(.conclusion // "-")"' | sort
  ```

  🛑 **USE `gh --jq`, NOT A PIPE TO `jq` — STANDALONE `jq` IS NOT INSTALLED IN THIS REPO'S
  GIT BASH.** `command -v jq` exits 1, so a piped `| jq …` dies with `command not found`
  (127) and the pipeline's status is the LAST command's, which is what this chapter is
  about. `gh` carries its own jq and `--jq` works. ⚠ The `jq length` advice in the bullet
  above means `gh … --jq 'length'` for the same reason. Found by writing the piped form
  into this very section and having it fail on the first run.

  ⚠ A single snapshot cannot tell a slow shard from a failing one either — two of my
  `IN_PROGRESS` readings completed green within seconds of being reported as blocking, and
  a third completed `failure` about sixty seconds after I recorded it as pending.

  🛑 **AND IT ERASES A FAILURE JUST AS READILY AS A PASS — THIS IS THE HALF THAT HIDES
  FLAKES.** A shard that fails and is re-run green leaves only the green in a
  latest-per-name view, so "was this ever red" becomes unanswerable by the same query that
  correctly says "it is green now". Measured the same night: `Unit tests (4/4)` failed at
  21:17 and succeeded at 21:26 with nobody having changed anything, and six red runs of
  `Unit tests (3/4)` that predated the `enforce_admins` flip were recoverable ONLY because
  the session asking enumerated every run rather than taking the latest. It was asking a
  historical question and happened to reach for a historical instrument; latest-per-name
  would have deleted the evidence the claim rested on.

  ⚠ **A required check can also be red on a PR and green on `main` for a DOC-ONLY diff.**
  `Playwright (retention-engagement)` did exactly that here — a branch differing from
  `main` by markdown prose cannot affect an E2E run. Under `enforce_admins: true` it still
  blocks, so budget a re-run rather than hunting a break you did not cause.
- ⚠ **Under `strict: true`, PENDING blocks exactly as FAILING does.** "0 required in a
  failed state" is not "can land".

🛑 **AND THE EXPENSIVE PART, WHICH IS NOT ABOUT BRANCH PROTECTION.** The flip reverses the
2026-08-27 decision *"commit straight to prod everytime, do not do preview"* — the reason
this entire chapter exists. A peer raised that contradiction before the session doing it
did; it had stated the consequence ("ends direct pushes") without connecting it to the
recorded decision it overturned. The user was then shown it explicitly and confirmed. **A
decision reversed knowingly is a different act from the same reversal made silently**, and
the only thing separating them was one peer reading the memory file.

⚠ **THE SEQUENCING FAILED AND THE REASON GENERALISES.** The plan was "flip once the queue
drains". That state never arrived: 14 → 10 tickets in 35 minutes while `origin/main` did not
move once, because the line refilled as fast as it emptied. ~10 tickets were live at the
flip and `main` froze for ~100 minutes with nine sessions queued behind a push that could
not succeed. **Do not gate an irreversible-feeling change on a quiet moment in a system
that has no quiet moments** — pick a condition you can observe reaching, or accept the cost
deliberately.

⚠ **AND THE ANNOUNCEMENT WAS BLOCKED, WHICH IS WHY IT COST SO MUCH.** The session flipping
it tried to warn the room first and the send was refused by a permission classifier. It
proceeded and reported the gap rather than skipping it quietly — but eight sessions learned
about the change one refused push at a time until a peer broadcast it. A blocked
announcement that gets reported is a delay; one that gets dropped is the mystery everyone
else pays for.

🛑 **IF IT IS EVER TURNED ON AGAIN, THIS IS WHAT BREAKS FIRST.** `push-queue.mjs` engages
only for a remote ref of `refs/heads/main` (cmdCheck ~line 1022) and its default refspec is
`<sha>:refs/heads/main` (cmdPush ~line 1539). So a direct push still takes a ticket, waits
its turn, pays the ~25s secret scan and a cold typecheck — **and is only then refused by
GitHub.** Every message it prints on the way says *rebuild onto current main*; none says
*open a PR*. A session can burn 40+ minutes being told by our own tooling that it is nearly
there.

✅ **THAT TEXT IS FIXED AND LANDED — `1d22e2f3b`, refined by `c0c0040d7`.** It happened the
other way round from the advice above: the flag went on first, the refusal was met, and the
fix was written from the real `GH006` rejection rather than from a guess about it. `cmdPush`
now pipes git's stderr (still echoing it verbatim), classifies a branch-protection refusal by
git's own words, prints PR instructions instead of "rebuild onto current main", and RECORDS it
so the next session is refused at TICKET time rather than after its own full wait.

🛑 **AND THE FIRST VERSION OF THAT RECORD DEADLOCKED THE ROOM, WHICH IS THE LESSON WORTH MORE
THAN THE FEATURE.** The marker was cleared only by a successful direct push — and the marker
is what prevents the push. Protection was reverted ~25 min after being enabled and the marker
then refused every session for a FALSE reason, with a 12h expiry and an env var nobody knew
about as the only escape. It had to be deleted by hand. It now re-probes: a marker older than
`AF_PUSH_QUEUE_PROTECTION_REPROBE_MS` (default 10 min) lets ONE push through to re-test,
stamping `lastProbeAt` first so nine sessions do not all probe at once. **A guard whose stale
state blocks work is worse than the waste it prevents, and "clears on success" is not
self-healing when the block is what stops success.**

#### How to actually land a PR here, measured 2026-09-12

**`gh pr merge <n> --rebase --auto` is the mechanism. An external rebase loop is not.**

⚠ **`--admin` IS REFUSED WHILE `enforce_admins` IS TRUE**, which is that setting working rather
than a tooling problem. The refusal is specific and useful:

```
GraphQL: Required status check "Unit tests (4/4)" is queued. (mergePullRequest)
```

🛑 **AND UNDER `strict: true` AN EXTERNAL LOOP CANNOT WIN, BY CONSTRUCTION.** `strict` means the
branch must be up to date AT MERGE TIME. Every rebase resets all 14 checks; the full set takes
~15 min; `main` moves every 5–10 min with nine sessions pushing. Measured on one doc-only,
one-file PR: it reached **13 of 14 green three separate times** and was knocked back to 0/14
each time, **three full CI runs burned**, with zero failures throughout. Auto-merge ends it
because GitHub sequences the update and the merge internally instead of racing an outside
observer. Stop your own loop before arming it, or you and GitHub reset each other's CI.

⚠ **VERIFY IT ARMED FROM THE API — `gh pr merge --auto` PRINTS NOTHING ON SUCCESS**, and silence
is not confirmation:

```bash
gh pr view <n> --json autoMergeRequest \
  --jq 'if .autoMergeRequest == null then "NOT ARMED" else .autoMergeRequest.mergeMethod end'
```

⚠ **`strict` MOVED TOO — it was `true` for roughly two hours tonight and is `false` now.** The
section title above says read `enforce_admins`; read `required_status_checks.strict` in the same
breath, because it decides whether being BEHIND blocks you and nothing announces a change.

**`mergeStateStatus` vocabulary, because two of these read as failure and are not:**

| value | means |
|---|---|
| `BLOCKED` | a required check is not satisfied yet |
| `BEHIND` | only that the branch is not up to date — `strict: true` only |
| `UNSTABLE` | **mergeable**; the only red checks are NOT required |
| `CLEAN` | nothing outstanding |

A PR sitting at `UNSTABLE` with `Playwright (mobile-smoke)` red is waiting for nothing.

### 🛑 CHERRY-PICK ONTO `main`. DO NOT MERGE IN THE SHARED TREE.

User's decision, 2026-08-29, after six sessions spent a day working two
incompatible ways. Landing work goes:

```
git worktree add --detach <tmp> origin/main
git cherry-pick <your commit>
git push origin HEAD:main
```

**Why, and it is not about tidy history.** A merge performed *in the shared
checkout* can clobber peers' UNCOMMITTED edits — measured overlap that day on
`app/import/page.tsx` and `ImportV4.tsx`, both of which had been dirty in the
tree since morning. Protecting work that is not yet committed beats a clean
graph. Cherry-picking touches nothing anyone else is holding.

**The cost is accepted, not a defect.** `shared/f-working-tree` accumulates
commits whose content is already upstream, so a later merge of that branch
trips over every one of them. That is expected. It is why the branch is a
staging area and not something to merge wholesale.

⚠ **A CONFLICT IS SAFE ONLY WHEN `git patch-id --stable` MATCHES.**

```
git show <mainSha>   --format="" --patch | git patch-id --stable
git show <branchSha> --format="" --patch | git patch-id --stable
```

Equal ids mean one change under two SHAs — resolve to either side. This
happened three times in one day and each looked alarming until measured.

🛑 **AND THE INVERSE IS THE TRAP THIS CONVENTION CREATES.** Duplicates become
common enough that "conflict → probably a duplicate → take either side" turns
into a habit, and it is wrong. On that same day two of five conflicts were
genuinely divergent rewrites, and the branch did **not** contain main's
`ace7eb5b3`; an auto-resolve loop had already taken the branch for all five
paths. Resolving on the pattern rather than the evidence would have deleted a
deployed fix with no conflict marker and no failing test.

**The rule, in order:**

1. `git patch-id --stable` both sides. Equal → resolve to either side.
2. Not equal → the two sides are independent changes and **neither is a
   superset**. Read `git diff <main>:<path> HEAD:<path>` in full and check
   `git merge-base --is-ancestor <theirCommit> HEAD`.
3. Both sides real work → **stop and find the author.** Not a merge-strategy
   question.
4. **Never auto-resolve a whole conflict set to one side.** That is how step 3
   gets skipped.

🛑 **AND NEITHER TEST SURVIVES ALONE WHEN A HANDOVER ARRIVES ALREADY PICKED.** The
rules above are for a conflict. This is the same trap reached from the other
direction, and it cost nothing only because it was measured: on 2026-08-31 a
session handed the pusher a four-commit tip, re-picked after their first handover
looked unlanded. `git merge-base --is-ancestor` said **NOT ON MAIN about all
four** — correctly, because a cherry-pick renames every commit it touches. Three
of the four were already shipped minutes earlier under different SHAs. One was
genuinely new.

Two plausible habits both fail on that input:

- trust ancestry → **re-land three commits that are already in production**
- "renamed, so probably a duplicate" → **drop the one piece of real work**

The only thing that separates them is a per-commit `patch-id` comparison against
the *range*, not against the tip:

```bash
git log <base>..origin/main --format=%H | while read c; do
  git show "$c" --format='' --patch | git patch-id --stable | cut -d' ' -f1
done | sort -u > /tmp/mainpids
git show <theirCommit> --format='' --patch | git patch-id --stable | cut -d' ' -f1
```

⚠ **WHERE BOTH SHAs ARE IN THE OBJECT STORE, THE TREE HASH IS STRONGER STILL** and
is what settled it: `git rev-parse <a>^{tree}` == `git rev-parse <b>^{tree}` says
the two commits carry identical CONTENT, not merely an identical diff. The author
supplied that themselves and it agreed with the patch-ids.

⚠ **AND THE HANDOVER THAT LOOKS WRONG IS USUALLY JUST STALE.** Three handovers
went stale between measuring and arriving that day, on a `main` that moved seven
times. Every one stayed safe for one reason: **the author sent the base sha they
built on.** Send it even when you have verified a fast-forward — your `rc=0` is
true when you run it and can be false by the time it is read.

⚠ **`git commit -- <paths>` SCOPES TO PATHS, NOT TO YOUR HUNKS INSIDE THEM.** A
peer's uncommitted edits in a file you commit ride along with no conflict and no
marker — the mirror image of the trap above. So `git diff` read in full is the
check in BOTH directions: what you might drop on a merge, and what you might
sweep on a commit. It also only accepts already-TRACKED paths, and staging and
committing in separate turns is how work gets swept into a peer's commit — do
both in one command.

⚠ Verify a push by SHA (`git ls-remote origin refs/heads/main`), never by
grepping push output: a rejected push prints `-> main` too, and a pipe (`| tail`)
reports the PIPE's exit code, so `$?` reads 0 over a failed push.

#### The collision you cause BEFORE there is a conflict

Every rule above starts at a conflict, a handover, or a resolve. This one starts
earlier and produces **no conflict at all**: you build a fix on a base that
predates someone else's fix to the same lines, and it lands as a clean
fast-forward. Git has nothing to object to. Your bytes replace theirs.

Measured 2026-09-05. A test assertion had rotted on a copy relabel and two
sessions repaired it independently. Theirs landed as `9c51a1e0e`. The second was
built from a branch whose parent predated it and landed as `2511dd801` — one
file, 15 insertions / 2 deletions, `merge-base --is-ancestor` rc=0, no conflict,
no failing test, nothing red anywhere. Nothing was lost only because the second
version happened to **subsume** the first. That was luck, not a check.

**The check belongs BEFORE you build, not at handover:**

```bash
blob() { git ls-tree "$1" -- "$2" | awk '{print $3}'; }   # empty ONLY when genuinely absent
blob <yourBase>  <path>    # the file you started from
blob origin/main <path>    # the file that is there now
```

Different blobs mean someone has changed your file since your base — read
`git log <yourBase>..origin/main -- <path>` before writing anything. **A
fast-forward is not evidence that nobody else worked on the file.** It is
evidence only that git could apply your bytes without having to ask a question.

🛑 **THIS CHECK WAS WRITTEN AS `git rev-parse <ref>:<path>` AND THAT FORM IS
BROKEN IN BOTH DIRECTIONS ON THIS BOX. Do not restore it.** Measured 2026-09-06:

- **`git rev-parse <ref>:<path>` PRINTS ITS ARGUMENT BACK** when the path is
  absent at that ref, exiting 128 but writing to stdout. For a file your commit
  **ADDS**, the path is absent at both refs, so *both* sides echo — and each echo
  carries its own ref name, so the two strings are never equal. The check reports
  a supersede on **every newly-added file**, which is most of a feature commit.
  It fired on four files of one Player Finder commit; all four were absent from
  `main` and nothing had superseded anything.
- **`git rev-parse --verify -q` IS NOT THE FIX, AND IS WORSE.** It returns
  **empty for a PRESENT leading-dot path** — the MSYS mangling this file already
  records for `git show ref:path`. That maps a dotfile present on both sides onto
  the benign row, so a real supersede under `.github/`, `.claude/` or `.husky/`
  is **silently swallowed**. A false negative, where the bare form only ever gave
  a false positive:

  ```
  git rev-parse --verify -q "origin/main:.github/workflows/playwright.yml"  ->  ''
  git ls-tree origin/main -- .github/workflows/playwright.yml
      100644 blob f3489f23f5d544df222c3f480cbfc3f7952f4cd8  .github/workflows/playwright.yml
  ```

⚠ **AND THE CONTROL MUST INCLUDE A PRESENT DOT-PATH, OR IT GOES GREEN ON A HELPER
THAT CANNOT SEE A SINGLE DOTFILE IN THE REPO.** That is exactly how `--verify -q`
passed review: its control tested a plain path, because it was written to prove
the *echo* bug was gone. Four cases, every time:

```bash
blob origin/main .github/workflows/playwright.yml   # present dot-path -> blob
blob origin/main .github/workflows/not-real.yml     # absent  dot-path -> empty
blob origin/main lib/scores/gameScoreProviders.ts   # present plain    -> blob
blob origin/main lib/not-real.ts                    # absent  plain    -> empty
```

Only two of the four outcomes are findings: `empty | blob` is a real supersede
(you add a file that is already on main), and `blob | empty` is a deletion
upstream. `empty | empty` means your commit adds it and main does not have it.

🛑 **THE DURABLE LESSON, WHICH IS NOT ABOUT GIT: A REPAIR FOR ONE FAILURE MODE CAN
INSTALL A WORSE ONE, AND THE CONTROL WRITTEN FOR THE OLD BUG IS STRUCTURALLY BLIND
TO THE NEW ONE.** Re-derive the control from the new implementation's failure
modes; do not inherit it. This is a different shape from a check that cannot fail —
here the control is real, correctly aimed, and pointed at the wrong bug.

⚠ And when you retract a recommendation, `grep` the whole document for the
retracted form rather than fixing the places you remember writing it. The note
recording this incident went through three correction passes with the retracted
advice still standing in its "what to go and do" line.

🛑 **AND THE TREE-HASH SHORTCUT IS A CONFIDENT FALSE NEGATIVE ACROSS A
CHERRY-PICK. THIS FILE ASSERTS IT TWICE AND BOTH NEED THIS QUALIFIER** — once
above ("WHERE BOTH SHAs ARE IN THE OBJECT STORE, THE TREE HASH IS STRONGER
STILL") and once in the push-queue section ("the tree hash is stronger still").
Both are true only when the two commits **share a base**. Measured on the pair
above, which did not:

```
patch-id  3c20f34a2 == 2511dd801    b4637a54005e2aa08390fc029a3940916e336f22
blob      the file, both sides      6db37dc5740d6a004423978dc219c9e2e3aec81b
tree      3c20f34a2^{tree}          f1512696835ca256f7952a8fc2d68b789e0e2e65
          2511dd801^{tree}          2168b32e1bc716c9123471caa90b85498de1ca06  DIFFER
```

Same change, same file content, different trees — one sits on `1df7621f4`, the
other on thirteen further commits. A tree hash answers "is the entire repository
identical", which is never the question during a landing. **Across a pick, use
patch-id and the per-file blob.**

⚠ **THE GATE IS NOT A BACKSTOP FOR THIS.** On this occasion the pusher picked
the superseding commit itself, then told the author the work was unlanded and
parked pending the user's decision — in a message whose own header read
`origin/main 2511dd801`, the landed SHA of the commit it was calling unlanded.
It was testing ancestry against a tip that its own cherry-pick had renamed, and
it repeated "parked" in four further messages before a peer caught it by
patch-id. All of that in the same message where it correctly told the author to
use patch-id against the range rather than ancestry — it had the right rule and
did not apply it to its own bookkeeping.

**The lesson worth keeping:** a supersede trips nothing. Not a conflict marker,
not a test, not a typecheck, not the gate. The author is the only party
positioned to notice, and only if they look before building. Having superseded
landed work, say so to its author and let the user rule — here the ruling was
that it stands, but that was a decision, not a default.

#### 🛑 PATCH-ID INEQUALITY IS NOT EVIDENCE THAT WORK IS UNLANDED

Everything above mandates `patch-id` over ancestry, and that is right **for the
question it asks there**: *is MY unmodified commit inside THIS range I just built.*
That is an identity check about a commit that has not changed between the two
points being compared, and patch-id answers it exactly. Keep using it there.

🛑 **IT DOES NOT ANSWER "HAS THIS WORK REACHED `main` IN ANY FORM", AND UNDER THIS
REPO'S CONVENTION IT FAILS IN THE MOST EXPENSIVE DIRECTION.** Evolving a commit
changes its patch-id. A cherry-pick-and-improve convention therefore *guarantees*
the test reports **absent** precisely for the commits whose work was IMPROVED on
the way in — it is least reliable exactly where the stakes are highest.

Measured 2026-09-11. Two sessions independently censused local `main` (119 ahead,
261 behind, diverged 2026-09-06) against `origin/main` by patch-id and reported
**15** and **16** genuinely-unlanded commits. Every commit then went through a
decisive test and the real number was **3**:

```
 8  superseded         (6 by subject match, 2 by content superset)
 1  already in flight  (equal patch-id under another sha)
 1  folded by author
 1  landed meanwhile
 1  unclear
 3  genuinely unlanded and unowned
```

⚠ **TWO INDEPENDENT RUNS OF THE SAME METHOD PRODUCED THE SAME ~5x INFLATION.** That
is what makes this a property of the method rather than of either session's care,
and it is the strongest form the evidence takes.

**The commit that shows the cost.** `cabc72677` was on both "unlanded" lists. Main's
`scripts/pre-push-smoke.mjs` is **+308/−27** against it and carries `AF_SMOKE_COLD`
four times, which that commit does not contain at all — the change that takes a
push's smoke check from a 20-minute budget to ~83 seconds. Landing it as "unlanded
backlog" would have reverted a live performance fix: no conflict, no failing test,
nothing red anywhere. Same silent shape as the supersede above, reached from the
opposite side.

**The decisive tests, cheapest first:**

1. **Attempt the pick.** `The previous cherry-pick is now empty` is unambiguous
   where patch-id is silent.
2. **Read the per-file diff DIRECTION** — `git diff <local>:<path>
   origin/main:<path> --shortstat`, plus a marker grep for something the newer
   version introduced. Main having MORE is the tell, and no empty-pick signal ever
   fires for it.
3. Only after both may "absent" be read as absent.

⚠ **AND DO NOT TREAT A STALE LOCAL BRANCH AS A BACKLOG.** Local `main` in this
checkout mixes already-landed debris with a handful of genuinely unlanded commits,
and nothing separates them without a per-commit test. Neither resetting it (drops
real work) nor building on it (a five-day-stale tree) is safe. Build from
`origin/main` in a detached worktree — already the landing convention, and the
finding is that it has to be the STARTING convention too.

### ⚠ A CHECK THAT CANNOT FAIL READS AS A PASS

Three sessions hit this in one day, each in a different tool, each believing
they had verified something. The common cause: **a pipeline's exit status is the
LAST command's**, so the thing being tested never decides the result. Use
`${PIPESTATUS[0]}`, or do not pipe the command whose status you are reading.

🛑 **AND `${PIPESTATUS[0]}` SILENTLY BECOMES PART OF THE BUG INSIDE `$( )`.** The
remedy above is correct for a bare pipeline and WRONG the moment you capture the
output, which is the form anyone writing a probe reaches for. A command
substitution runs its pipeline in a SUBSHELL, so `PIPESTATUS` describes the
CURRENT shell's last pipeline — which is the ASSIGNMENT, and an assignment
succeeds. The failure you were guarding against is erased.
Measured 2026-09-11 against a `git show` that exits 128:

```bash
git show "$REF:$P" 2>/dev/null | wc -c >/dev/null; echo "${PIPESTATUS[0]}"   # 128  correct
out=$(git show "$REF:$P" 2>/dev/null | wc -c); rc=${PIPESTATUS[0]}           # rc=0  ERASED
```

Both lines follow the rule above to the letter. One of them reports a clean pass
over a fatal error — and it is the one that keeps the output, so it is the one
that gets written.

⚠ **IT COST TWO SESSIONS IN ONE EVENING AND THE SECOND WAS INVESTIGATING THE
FIRST.** A probe written to diagnose a PIPESTATUS bug used this form and
manufactured `exit=0` on every row; the finding it produced was withdrawn. The
rule had been read, quoted between sessions, and applied wrongly inside the hour.

Any of these works, and each was controlled in both directions — non-zero on the
failing command, zero on a succeeding one. The first keeps the substitution; the
other two give it up, and the third stops trying to do two jobs with one syntax:

```bash
out=$(set -o pipefail; git show "$REF:$P" 2>/dev/null | wc -c); rc=$?   # rc=128 / rc=0
raw=$(git show "$REF:$P" 2>/dev/null); rc=$?                            # do not pipe at all
git show "$REF:$P" >/tmp/out 2>/tmp/err; rc=$?                          # output and status apart
```

⚠ The second form loses a trailing newline to the substitution (28943 vs 28944
bytes on the same file), so do not byte-compare across the two.

**And do not trust a zero on either side of it.** `bytes=0` is not evidence of
failure unless you know the true size — an empty file and a broken read are
indistinguishable by count. `git ls-tree -l <ref> -- <path>` says what the size
should be. A peer nearly filed a spurious "second silent failure mode" that was a
genuinely 0-byte `.gitkeep`.

🛑 **AND THAT LANDS ON THE FOUR-CASE CONTROL BELOW: ITS *PRESENT* CASES MUST BE
NON-EMPTY, VERIFIED BY `git ls-tree -l`.** A control whose present rows are
`.gitkeep` blobs reports `__ABSENT__`-vs-empty as a clean pass and goes green
against a completely broken helper — a control that cannot fail, inside the
control written to stop checks that cannot fail. Pick present rows with real
bytes in them and say what the byte count should be.

- `git push … | tail` printed a success line over a rejection. **Verify a push
  by comparing SHAs, never by reading its output or its exit status through a
  pipe** — a rejected push prints `-> main` too, so grepping the text for
  success fails the same way `$?` does. `git ls-remote origin refs/heads/main`
  against the SHA you pushed is the only check that holds.
- `ls <dir> | head && echo "HAS"` always takes the HAS branch, because `head`
  exits 0 whether or not `ls` found anything. That reported a `node_modules`
  junction in a worktree which had none, and nearly triggered a destructive
  cleanup. For a junction, ask the filesystem: PowerShell
  `(Get-Item <path> -Force).LinkType` is null when there is no link.
- `npx tsc --noEmit` OOMs at the default heap on this repo, prints a V8 crash
  dump instead of diagnostics, and `grep -c "error TS"` then returns 0 — which
  reads exactly like a clean typecheck. Use the repo's own setting rather than a
  remembered number: `npm run typecheck` is
  `node --max-old-space-size=8192 …/tsc.js --noEmit`, so
  `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` is the equivalent
  when a script path will not resolve (a worktree with no local `node_modules`).
  ⚠ This repo carries a standing error baseline, so a **non-zero exit is
  normal** — the tell for the OOM is a crash dump and no `error TS` lines at
  all, not the exit code.
- 🛑 **AND "NO CRASH DUMP" NO LONGER CLEARS AN EMPTY TSC RUN.** On 2026-08-31 a
  detached worktree's `node_modules` junction **silently failed to create**, so
  `node ./node_modules/typescript/lib/tsc.js` never started tsc at all. Exit 1,
  **zero `error TS` lines, and no crash dump** — the precise profile the rule
  above says to treat as "OOM or clean". The tell was `Cannot find module` in the
  first few lines of output. **Check for it as its own control**, not as a
  footnote to the crash dump, and note this is the third distinct way to get an
  empty tsc run (OOM, process-never-started, and the not-yet-written case under
  the missing-`pgrep` entry below). All three look identical if you only count
  `error TS` lines. Verify the junction with `(Get-Item <path> -Force).LinkType`
  **before** trusting any number the run produces — `mklink` printing a success
  line is not evidence, as the entry above already records.
- 🛑 **AND A FOURTH WAY, WHICH EXITS 0 AND IS THE ONLY ONE NO TELL ABOVE CATCHES.**
  `extends` inherits `exclude`, and the inherited `exclude` silently drops matching
  entries from your `include`. This repo excludes `scripts`, `__tests__`, `e2e` and
  `tests`, so a throwaway config that extends `tsconfig.json` to typecheck one
  script compiles **nothing**. Whether that is loud or silent turns on entries that
  look irrelevant — measured 2026-08-31 against the same planted
  `const n: number = "not a number"`:

  ```
  include: ["scripts/probe.ts"]                        exit 2, TS18003 — LOUD
  include: [ …same, "next-env.d.ts", "types/**/*.d.ts" ] exit 0, 0 errors, 0 BYTES
  ```

  If EVERY entry is dropped you get `TS18003 "No inputs were found in config file"`,
  which names the include and exclude paths that produced the emptiness — exit 2,
  and it matches `grep "error TS"`, so every tell above catches it. If ANY entry
  survives, even a `.d.ts` that cannot contain an error, tsc succeeds on the
  survivors and reports clean. The silent run compiled **506 files** and did real
  work; the file under test was simply absent from the set.

  🛑 **THE BOILERPLATE IS WHAT MAKES IT LIE.** Adding `next-env.d.ts` and
  `types/**/*.d.ts` for completeness is what a careful person does, and it is
  exactly what suppresses TypeScript's own warning. **The more thorough config is
  the one that lies.** Exit code, error count, crash dump and `Cannot find module`
  all read clean. The only check that works is confirming the file under test is in
  the compile set: `--listFiles | grep <yourfile>`.

  ⚠ **AND NOTE WHAT THIS DOES TO THE POSITIVE-CONTROL RULE THAT CLOSES THIS LIST.**
  Inject-a-known-error
  DID fire — it reported the run as blind. It did not say why; the first mechanism
  offered was wrong (the inherited `exclude` alone, which is the LOUD case); and a
  wrong explanation with a working fix attached is what nearly shipped. **A positive
  control tells you a check is broken. It does not diagnose it, and it does not
  license the first mechanism you think of.** Found by one session, reproduced
  independently by another, and the first causal story died on that second run.

- 🛑 **AND A FIFTH WAY: CONCURRENT `tsc` RUNS KILL EACH OTHER, AND THE CORPSE READS
  AS A PASS.** Nothing about your command is wrong — the machine simply runs out of
  memory and something dies. Measured 2026-09-02, when **five** `tsc.js` processes
  were live at once (`--max-old-space-size=8192` each, ~11.8 GB combined at one
  reading, 0.4 GB free at another). Seven runs were lost across four sessions in one
  evening. Two of mine:

  ```
  tc.txt   120 bytes   sentinel DONE=4   0 `error TS` lines   no crash dump   no "Cannot find module"
  tc2.txt  113 bytes   NO sentinel                            killed mid-run
  ```

  ⚠ **IT DEFEATS EVERY TELL ABOVE.** Not the OOM crash dump (there is none — the
  V8 dump belongs to the process that *exhausts its own heap*, not to one killed
  under system pressure). Not `Cannot find module`. Not `TS18003`. And the sentinel
  is **present**, so "missing sentinel means still running" passes it through — but
  it reads `4`, and **a status that is neither 0 nor 1 is not a verdict**, the same
  rule this file already applies to `timeout`'s 124 and a missing `pgrep`'s 127.

  **The only signal left is the baseline.** This repo carries ~145 errors, so a run
  reporting **zero** is not a clean typecheck, it is a run that measured nothing.
  *Cleaner than the baseline is the tell* — which is why the baseline has to be a
  number you actually hold, not a number you hope for.

  **Two habits, and the second is the cheap one:**

  1. **Check the machine before starting a full run.** `Get-CimInstance Win32_Process
     -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*tsc.js*' }`
     lists them with working-set sizes. If others are running, wait or say so — with
     ~9 sessions sharing one box, "I will just start mine" is what produced the five.
  2. **Prefer a per-file scoped check with a same-artifact baseline.** Compile
     `origin/main`'s version of the file under the identical standalone config, then
     yours, and compare the two counts. It takes under a minute, cannot be starved by
     a peer, and answers the question a repo total does not: *did I change this?*
     ⚠ It does NOT replace a repo total — a type widening surfaces in a **consumer's**
     file, never in yours — so say which one you ran and hand the cross-file question
     to whoever runs the batch smoke.

🛑 **AND THE LANDING LANE HAS ITS OWN, CREATED BY THIS REPO'S OWN CHERRY-PICK
CONVENTION.** A lane that guards on
`git merge-base --is-ancestor origin/main "$TIP"` — meaning "my tip sits on
current main" — is satisfied when `TIP == MAIN`. That is precisely the state a
**failed cherry-pick** leaves, because the abort drops the worktree back to the
`origin/main` it was detached at. The guard then reads as current, skips the
re-pick, pushes `main:main` ("already origin/main. Nothing to push."), compares
`remote == tip` and prints **`RESULT=LANDED`** — the same line it prints on a real
landing. Measured 2026-09-08; the conclusion happened to be true because an earlier
lane had already pushed the commits, so nothing contradicted the wrong signal.

⚠ **AND THE ASSERTION WRITTEN TO CATCH IT LIVED INSIDE THE BRANCH THAT GOT
SKIPPED.** The lane already had `rev-list --count MAIN..TIP != N → refuse`, which is
the right check — sitting inside the re-pick block, which is the thing the bad guard
skipped. A guard and its assertion on the same code path protect nothing.

**Assert CONTAINMENT, never descent, and assert it on every path:**

```bash
for c in $COMMITS; do
  pid=$(git show "$c" --format='' --patch | git patch-id --stable | cut -d' ' -f1)
  git log "$MAIN".."$TIP" --format=%H | while read m; do
    git show "$m" --format='' --patch | git patch-id --stable | cut -d' ' -f1
  done | grep -qx "$pid" || { echo "REFUSING: $c not in tip"; exit 1; }
done
```

Patch-id, not sha — a pick renames every commit, which is why ancestry answers "no"
about work sitting right there in the range. ⚠ And a pick that fails because the
commit is **already upstream** exits non-zero with `The previous cherry-pick is now
empty`, which a bare `||` cannot tell from a real conflict: treat "pick failed" as
"re-verify what is on main", never as "retry".

🛑 **THE RULE THAT CATCHES ALL THREE: MAKE EVERY CHECK REPRODUCE A KNOWN
POSITIVE BEFORE YOU TRUST ITS NEGATIVE.** Inject the failure you are looking for
and confirm the check reports it. A green check that has never once gone red is
not evidence, and on a long session it is the most expensive kind of comfort.

⚠ **AND CSS HAS ITS OWN MEMBER OF THIS FAMILY, WHICH NO CHECK IN THIS REPO
WATCHES.** Inserting a new `@media` block in the middle of an existing one closes
the outer query early, and every rule below the insertion point silently moves
into the new, narrower query. On 2026-08-30 a `@media (max-width: 560px)` block
added inside `@media (max-width: 780px)` in `af-matchup.css` carried four rules
out of the 780px band with it — including `.af-mu-centre { order: 3 }`, which is
what pushes the win-probability card below both team rows on a phone. Those rules
stopped applying between 561px and 780px.

**Brace balance stayed 0, nothing threw, no test failed, and a CSS lint cannot
see it** — the file is valid CSS either way, it just means something else. This
is the check-that-cannot-fail in a language nobody has been watching, and the
tell is the same as everywhere else: read the EFFECT, not the syntax.
`getComputedStyle(el).<prop>` at a width inside each band, before and after.
Braces balancing is not evidence that a rule is still in the query you put it in.

⚠ **THE SAME READ-THE-EFFECT RULE RETIRES CSS ASSUMPTIONS, WHICH ARE CHEAPER TO
MEASURE THAN TO ARGUE ABOUT.** A tile-row fix was rejected here on the reasoning
that letting flex children grow would stretch a right-aligned cluster across the
whole header on desktop. Measured: the container carries `margin-left: auto` and
shrink-wraps, so at 1280px the geometry is byte-identical with and without the
rule, and the growth only fires on a row a tile has WRAPPED onto — which was the
entire point of the fix. The rejection cost more than the probe would have.

⚠ **A FILTERED CHECK IS NOT A SCOPED CHECK.** `tsc … | grep <my files>` looks
like deliberate narrowing — more careful than an unscoped run — and so it earns
*more* trust while being strictly less trustworthy. Filtering a check's output
discards the status of the thing you are testing; it does not scope it. Two
sessions shipped assurances that way in one day, one of them over a `tsc` that
had OOMed and emitted nothing at all, so the grep matched nothing for the worst
possible reason. If you want a scoped typecheck, scope the *inputs* and read the
unpiped exit status.

⚠ **AND THE SAME TRAP SURVIVES SCOPING THE INPUTS — IT JUST MOVES TO HOW YOU
READ THE OUTPUT.** The rule above is about the pipe. On 2026-08-30 a session
followed it exactly: unpiped `tsc`, full output captured to a file, exit status
read, sentinel confirmed. Then it grepped that FILE for its own five committed
paths, matched nothing, and attested "148 errors, zero in my files".

That was true. The error was in the same file, a few lines further down:

```
components/live/LiveScoresClient.tsx(105,27): error TS2322:
Type 'string | null' is not assignable to type 'string'.
```

The commit had widened `LivePageData.fetchedAt` to `string | null`. **A type
widening surfaces in a CONSUMER's file, never in yours** — the author's own
handover note said so in those words, and the check still could not see it,
because "my paths" is the wrong unit for a change whose whole risk is
cross-file. Filtering to them discards exactly the evidence the change needs.

🛑 **SO READ THE TOTAL AGAINST A KNOWN BASELINE FIRST, AND NARROW SECOND.** A
count you cannot explain is a finding even when nothing matches your paths. The
pusher's cross-cutting smoke caught this one; so did a ratchet run reporting
*147 against 154, two files gained*, which is the correct shape — a delta and
the files that moved, not a filter. Narrowing to your own paths is the last step
of reading a check, never the first, and never the only one.

⚠ Note what this costs to get right: the baseline must come from the same kind
of artifact. This repo's count drifts with every session's commits, so "the
baseline" means *a detached worktree run at the commit's parent*, not a number
remembered from an hour ago in a dirty checkout. If you have no trustworthy
baseline, say the total and say you have nothing to compare it to — that is
information. "Zero in my files" without a total is not.

#### The wider shape: a failure that returns a plausible VALUE

The three above are all exit-status bugs. On 2026-08-30 four more landed in one
evening, none of them about `$?`, and the guards that failed had been written
*that same evening specifically to prevent this*. The common shape is worse than
a check that cannot fail: **the check fails and hands back a value that looks
like an answer.**

- `timeout 60 git merge-base --is-ancestor <sha> origin/main` — the tree was
  contended, git hung, `timeout` returned **124**, and the `if` read non-zero as
  "not an ancestor". It reported a deployed commit as missing from `main`.
  Inspect the code: `0` yes, `1` no, **anything else is not a verdict**. `143`
  (SIGTERM from a harness timeout) fails the same way.
- `git log -S … ` killed mid-run had already printed part of its output. A
  truncated list is indistinguishable from a complete one, and the newest entry
  looked like a confident answer. Confirm a pickaxe hit directly —
  `git show <sha>^:<path>` and `<sha>:<path>` must differ — before believing it.
- A "did the branch move" guard compared `git rev-parse` (40 chars) against a
  9-char abbreviation and reported a move that had not happened.
- The repair for that one then compared a **fresh read of the moving ref against
  itself**, so it passed while the branch genuinely was moving. ⚠ A staleness
  guard must compare against the value you actually built with, captured once —
  never a re-read of the thing you are trying to detect movement in.
- **A fifth, later the same day, and the cheapest of the lot to avoid.** A wait
  loop guarded on `! pgrep -f "tsc.js"` to decide whether `npm run typecheck`
  had finished. 🛑 **`pgrep` IS NOT INSTALLED IN THIS REPO'S GIT BASH.**
  `command not found` exits **127**, `! 127` is true, so the "the process is
  gone" branch fired on the first iteration — before the loop ever reached its
  `sleep` — so it announced the run settled while `tsc` had ~10 minutes to go. Same
  family as the `timeout` 124 above: **a status that is neither 0 nor 1 is not a
  verdict**, and here it came from the tool being absent rather than failing.
  Reading the redirect file then found the npm banner and nothing else: **zero
  `error TS` lines and no crash dump — precisely the profile the OOM rule above
  says to trust.** ⚠ So that tell cannot separate "finished clean" from "has not
  written yet". On a repo carrying a **157-error baseline**, a typecheck
  reporting *cleaner than the baseline* is itself the tell. Never ask the OS
  whether a process is alive — make the command say so, append a sentinel
  (`…; echo "DONE=$?"`), and treat a missing sentinel as *still running*, never
  as a result.

🛑 **THE COST WAS NEARLY 400 LINES.** That staleness guard let a branch tip move
unseen, and the reconciliation was about to substitute `main`'s tree for the
third time — a move that had been *correct twice*. The third time the branch
held `__tests__/values/idpCeilingBand.test.ts` (147 lines) and
`scripts/probe-idp-ceiling-sensitivity.ts` (246), neither on `main`. No conflict
marker, no failing test. It was caught by one command:

```
git diff --name-status <local> <candidate> | grep '^D'   # must be empty
```

**Run that before ANY tree substitution**, and note the trap is the same one the
conflict rules already name, reached from the opposite side: not a habit of
taking one side, but a habit of **reusing a resolution that worked before**.
Twice correct is not evidence about the third time.

🛑 **AND THE SAME TRAP REACHED THROUGH A CHERRY-PICK, WHERE THE RESOLUTION IS
RIGHT FIVE TIMES AND THEN SILENTLY INVERTS THE SIXTH COMMIT.**

`docs/decision-os/OS_INVENTORY_AND_ROADMAP.md` conflicts on nearly every pick,
because nearly every commit APPENDS a section. "Strip the markers, keep both
sides" is the correct resolution for those, and it is correct often enough to
become a reflex worth scripting.

It is wrong the moment one side REMOVES a line. Keeping both sides of a deletion
conflict means the removal does not happen. Measured 2026-09-03, applying a
resolver that had just been correct five times to a sixth commit that deleted a
duplicate ledger row:

```
the original commit    1 file changed, 1 deletion(-)
the picked result      1 file changed, 1 insertion(+)      <- inverted
```

A commit whose message says it removes a duplicate, that ADDS a line instead,
leaving the duplicate it named still in the file.

⚠ **AND THE `grep '^D'` GUARD ABOVE PASSES IT.** That check — and
`--diff-filter=D` — counts deleted **FILES**, so a botched LINE-level deletion
reads as zero deletions and goes green. It was caught by reading the post-pick
`--stat`, not by any guard.

**Do NOT widen the file-level guard to cover this.** It answers the one question
it exists for — did this batch delete a FILE, the thing that silently drops a
peer's work — and making it a line-level integrity check makes it noisier at the
job it does well. A DELETION commit needs its own assertion instead, and only
deletion commits do:

```
git show <sha> --stat        # must still say deletion(-) AFTER the pick
```

🛑 **THE CHEAPEST FIX IS TO REMOVE THE DECISION, NOT TO REMEMBER THE EXCEPTION.**
A deletion authored against different line numbering conflicts again on the next
attempt, and correctness then rests on remembering not to run the resolver —
the same memory that just failed immediately after five correct applications.
**Rebuild the deletion commit against the already-landed tree so it applies
clean**, and there is no conflict to resolve at all.

The durable half is not about this file or this resolver: **reusing a resolution
without checking the new case is the same KIND.** Append-only and deletion are
not the same kind, and nothing in the process asks which one you have.

#### An escaping layer eats a backslash and the regex still runs

🛑 **`\s+` INSIDE A SQL REGEX BECOMES `s+` IF ANY LAYER BETWEEN YOU AND POSTGRES
EATS THE BACKSLASH — AND `s+` IS A VALID REGEX MATCHING THE LETTER `s`.** Nothing
throws, no query fails, and the number that comes back is entirely plausible.

Measured on 2026-08-31, comparing normalized player names between `SportsPlayer`
and `PlayerIdentityMap`. `regexp_replace(name, 's+', ' ', 'g')` stripped every
`s` out of every name, compared the wreckage against the registry, and reported:

```
candidate pool   48,074   really 38,976
roster estimate  "+7"     really +17
```

Both wrong in the safe-looking direction, and both survived being re-read twice.
The layers that can eat it are ordinary: a bash heredoc with an unquoted
delimiter, a nested template literal, a `.replace()` chain, a shell `-e` string.

**Two rules, and the second is the durable one:**

1. Make the query print the SQL it actually sends and byte-compare against the
   string you think you wrote. That is what settled the 9,098-row disagreement
   above; re-reading the source did not, twice.
2. **Prefer `[[:space:]]+` over `\s+` in any SQL that passes through a layer.**
   The POSIX class needs no escaping and cannot fail this way. Verify a swap is
   behaviour-preserving by confirming every headline figure is byte-identical
   before and after — an "equivalent" regex that moves a number was not
   equivalent.

⚠ **AND DO NOT REIMPLEMENT A NORMALIZER IN SQL AT ALL WHEN ONE EXISTS IN JS.**
The same day, a SQL copy of `normalizePlayerName` was compared against the real
one on 500 rows and disagreed on **36 (7.2%)** — generational suffixes and
apostrophes (`Danny Lockhart Jr.`, `Patrick O'Brien`). Writing rows keyed by the
SQL copy would have produced ~42,000 rows the resolver can never look up: they
exist, they count as inserted, and no read finds them. Two implementations of one
rule is the bug. Deleting one is the fix; a better SQL regex is not.

#### A NUL byte in source, and a diff that cannot fail

🛑 **AN UNQUOTED BASH HEREDOC (`<<PY`, not `<<'PY'`) EXPANDS BACKTICKS AND `$` IN
THE BODY.** Feeding one a script containing a JS template literal wrote a **NUL
byte** into a TypeScript source file on 2026-08-31, where a space belonged:

```
const key = `${normalized}\x00${team}`
```

**All 16 tests still passed**, because a NUL is as good a key separator as a
space. `grep -n` printed `Binary file … matches` rather than the line, which is
the only visible tell, and it is easy to read as noise. It was caught by
inspecting bytes (`python … repr(s[i:i+50])`), not by any check in the repo.
Quote the delimiter, or write the file with the editor rather than through a
shell.

⚠ **AND THE CHECK THAT SHOULD HAVE CAUGHT IT COULD NOT: `git diff` ON AN
UNTRACKED FILE PRINTS NOTHING, WHATEVER THE CONTENT.** A mutation-testing loop
"restored" its file and confirmed it with `git diff --stat -- <path>` reading
empty. The file was new, so git had never seen it and the command was empty by
construction — a check that cannot fail, in the exact form this whole section is
about. **Restore-verify with `diff -q <backup> <file>`**, or `git show
<sha>:<path>` once committed, and scan the committed blob for NULs
(`git show <sha>:<path> | tr -dc '\000' | wc -c`) when a shell wrote it.

⚠ A mutation control has the same requirement in a second place, learned the same
day on CRLF files: **prove the mutation APPLIED before believing a green run.**
Three controls "passed" because a `perl -0pi` pattern matching `\n` silently
matched nothing in CRLF sources. A no-op mutation is indistinguishable from a
test that cannot fail. Assert the file changed (`diff -q`, expecting failure)
between mutating and running.

#### The third shape: a check that PASSES, on something you did not ship

The two above are a check that cannot fail and a check that fails while handing
back a plausible value. This one is neither: it runs, it is honest, it goes
green — **against a different artifact from the one you committed.**

🛑 **A PATH-SCOPED COMMIT OUT OF A DIRTY SHARED TREE CREATES A TREE NOBODY HAS
BUILT.** `git commit -- <paths>` takes a SUBSET of the working tree. The result
is a new artifact that has never existed on disk, so every check you ran before
committing describes the tree you still have, not the one you just wrote. On
2026-08-30 that shipped an attestation of "147 errors, zero in my files" for a
commit that does not compile.

The mechanics, because the file was shared in the ordinary way this repo now
works: two sessions had uncommitted work in `lib/core-app/myTeam.ts`. We agreed
one of us would take the whole file — correctly, per the sweep rule above. But
the peer's change spanned TWO files, and only one of them was mine to commit. So
the commit took their call site (`userId,` passed into `getNextMatchup`) and left
their signature behind in the uncommitted `nextMatchup.ts`. Measured afterwards
by typechecking each committed tree:

```
67c237ff4   156 error TS lines, incl. lib/core-app/myTeam.ts(1329,9) TS2353
            'userId' does not exist in type '{ leagueId: string; ... }'
75591e6bb   155 — the standing baseline — and zero in core-app
```

⚠ **THIS IS THE SWEEP RULE'S THIRD FACE, AND THE ONLY ONE THAT IS SILENT ON BOTH
SIDES.** Committing a path can sweep a peer's hunks IN; reading a diff in full
catches that. Resolving a conflict can drop a peer's work OUT; `patch-id` catches
that. Splitting a peer's change across the commit boundary produces **no conflict,
no marker, and a green local check** — and the author is the last person who can
see it, because their own tree is the one that still works.

**The check, and it is cheap — about four minutes:**

```
git worktree add --detach <tmp> <sha>
# node_modules must be a junction, or every import fails and the run is noise.
# Verify it IS one: PowerShell (Get-Item <tmp>/node_modules -Force).LinkType
cd <tmp>
# Read the UNPIPED exit status; `| grep <my files>` is the filtered-check trap above.
NODE_OPTIONS=--max-old-space-size=8192 node ./node_modules/typescript/lib/tsc.js --noEmit
```

🛑 **REMOVE THE JUNCTION WITH `cmd /c rmdir <link>` BEFORE `git worktree
remove`.** `rmdir` unlinks the junction and never recurses into its target;
`Remove-Item -Recurse` can delete THROUGH it and take the real `node_modules`
with it. Count the target's entries before and after and confirm the number is
unchanged — the same "prove the negative" rule the junction detection above
already carries.

⚠ **AND THE MILD VERSION IS THE COMMON ONE — IT MOVES THE BASELINE.** The
follow-up commit that repaired the break above carried "148 errors" in its own
message; its committed tree measures **155**. Both readings were honest. The
author's tree happened to hold two other sessions' uncommitted work — one
breakage, one fix — so the number describes a tree nobody will build. Nothing
was hidden and nothing broke, which is precisely why this version survives:
**a wrong baseline is what every later "no new errors" claim is measured
against.** On a repo whose baseline drifts anyway, a figure taken from a shared
dirty tree is not a baseline at all.

🛑 **AND THE INDEX IS SHARED TOO, WHICH IS THE FASTEST WAY TO HIT ALL OF THIS AT
ONCE.** The commit that added this section swept three of a peer's waiver files
and contained none of its own: between `git add -- CLAUDE.md` and the commit, a
peer restaged, and a BARE `git commit` takes whatever is in the index. The
existing rule — *verify the staged set before committing* — was followed to the
letter and could not help, because the verification was chained to the commit
with `&&`:

```
git add -- <paths> && git status --porcelain | grep '^[MARD]' && git commit -m …
```

That prints the staged set and then commits regardless. **It is a check that
cannot fail, in the exact form this section is about**, and it is easy to write
because it looks careful. Two fixes, and use both: read the staged set in a
SEPARATE call before deciding, and commit with `git commit -- <paths>`, which
takes the working-tree version of those paths and leaves every other index entry
alone. A path-scoped commit could not have taken the peer's files at all.

Recovery, if it happens anyway: `git reset --soft HEAD~1` restores the index
exactly, then prove it — `git diff --cached | git patch-id --stable` against the
same id from the bad commit, and the two patches byte-compared. Nothing is lost
and the proof takes one command.

**When it is required, stated narrowly so it does not become ceremony:** only
when the commit's file set differs from the working tree's — a path-scoped commit
out of a dirty tree, or a cherry-pick onto a base you have not built.

⚠ **BUT "A CLEAN TREE COMMITTED WHOLE IS SAFE" IS AN ASSUMPTION, NOT A FACT, IN A
SHARED CHECKOUT.** This paragraph first ended "a clean tree committed whole needs
none of this; the tree you checked IS the tree you wrote" — and the index
incident above had already disproved it before the ink was dry. There the file
was clean, the file set WAS the change, and the committed artifact still differed
from the checked one, because a peer moved the INDEX in between. The same day
`lib/core-app/myTeam.ts` changed under a session mid-edit, and
`lib/core-app/matchup.ts` went from syntactically broken to compiling inside one
window.

So the gap is not only the commit's file set. It is the TIME between the check
and the commit, and in this checkout that window is contended: HEAD, the index
and the working tree have each moved under a session inside a single command.
Before committing, confirm the paths are unchanged since you checked them —
`git status --porcelain -- <paths>` and `git diff --cached --name-only`, each
read in its OWN call. Chaining either to the commit with `&&` reproduces the
failure this whole section is about.

⚠ **AND `next dev` REWRITES `tsconfig.json`, SO THE CONFIG YOUR TYPECHECK READS
IS NOT THE ONE CI READS.** Next.js appends `<distDir>/types/**/*.ts` to `include`
on startup and says so in one line it scrolls past. Every session here runs its
own dist dir (`AF_NEXT_DIST_DIR`, see `.claude/launch.json`), so the shared
checkout's `tsconfig.json` accumulates one `include` entry per session and is
dirty more or less permanently — `.next-dev-my-team` and `.next-dev-matchup` were
both added on 2026-08-30 by sessions that never touched the file by hand.

The entries are additive, so they can only ADD diagnostics, never hide one — but
"my number is at worst too high" is not what an attestation claims, and two
sessions withdrew green runs that day once they checked what config those runs
had actually used. **A typecheck run in the shared checkout is not a measurement
of any commit.** The detached-worktree form above is immune by construction: it
carries the COMMITTED `tsconfig.json`.

⚠ Do not "fix" it by reverting `tsconfig.json` wholesale — the other entries
belong to sessions that are still running, and removing one breaks a peer's
typecheck rather than yours. Leave the file; check somewhere else.

#### A test double that stopped doubling anything

Three of the five test failures repaired on 2026-09-03 were ONE bug: a module
changed dependency and its mock did not. It has two faces, and the second is why
this sits here rather than only in the migration note far above.

**LOUD.** The mock lacks an export the module now calls and the suite dies —
`No "getTwilioRuntimeStatus" export is defined on the "@/lib/twilio-client" mock`,
or `Cannot read properties of undefined (reading 'findMany')` where a `vi.mock` of
`@/lib/prisma` lists four delegates and the module reads six. Irritating, but it
tells you.

🛑 **SILENT, AND THIS IS THE ONE THAT COSTS.** The assertion still passes —
against nothing. `__tests__/world-cup-ai` mocked `@/lib/openai-client` and spied
on it, while `1b9fcfe36` had routed the service through `lib/ai/providerRouter`.
Its "does not call OpenAI when bracketBrainAiEntitled is false" test was GREEN,
and would have stayed green with the entitlement gate DELETED, because it watched
a function the service never calls under any conditions. A guard that cannot fail
is worse than no guard: it gets cited as coverage.

⚠ **AND NOTHING IN THIS REPO WOULD HAVE CAUGHT EITHER FORM ON ITS OWN.**
`tsconfig.json` excludes every test and spec pattern repo-wide — `__tests__`,
`tests`, `**/*.test.ts(x)`, `**/*.spec.ts(x)` — so NO test file is typechecked by
any run here (`tsc --listFilesOnly` reports zero of them among 12,548 files), and
`next.config.js` sets `typescript.ignoreBuildErrors: true`, so a green build is
not a typecheck either. A mock can contradict its module's real contract
indefinitely and nothing goes red until a human runs the suite and reads it.

**So when a module changes dependency, two steps, not one:**

1. Grep the test tree for mocks of the OLD dependency. The fantasycalc note above
   says this for one migration; it generalises to every one.
2. For each assertion that still PASSES, ask whether it can fail — then make it.
   Breaking the thing it guards is usually one line: forcing
   `bracketBrainAiEntitled = true` turned that green entitlement test red
   immediately. An assertion you have never seen fail is not yet evidence.

⚠ **AND A MODULE'S TEST PASSING IN YOUR BRANCH SAYS NOTHING ABOUT `main` WHEN THE
SOURCE DIFFERS.** Two of the three looked fine in the session branch and failed on
`main`, because the branch still carried the pre-migration module — so the stale
mock still matched. Compare the blob of BOTH the test and the module across
branches before concluding anything; the branch that is wrong is usually the one
where everything is green.

#### A search hit is not attribution

The shapes above are a check that cannot fail, one that fails and hands back a
plausible value, and one that passes against an artifact you did not ship. Here
is a fourth: **the search ran, the hit was real, the text was genuinely there —
and it did not mean what it was read to mean.**

Measured 2026-09-05, and it nearly put a false statement about a named peer into
this file permanently. A full-text search across session transcripts was used to
work out who had authored `9c51a1e0e`. It returned that commit's `git commit`
output sitting inside the pusher's transcript, and that was read as *the pusher
created it*. Every mechanical part of the search was correct. The inference was
not: **a session transcript records what a session SAW as readily as what it
DID** — a `git log`, a `git show`, a pasted message from somebody else. The same
holds for any corpus where "X appears in Y's output" gets silently promoted to
"Y produced X": build logs, CI output, scrollback.

**Authorship and timing have an authoritative source, and it costs one command:**

```bash
git log -1 --format='%an %ad %cn %cd' --date=iso <sha>
```

That settled it: `9c51a1e0e` was committed **2026-09-03 17:52**, two days before
the session it was being attributed to existed.

⚠ **AND THE DISCONFIRMING FACT WAS INSIDE THE SNIPPET ALREADY BEING QUOTED.** The
search result read `… [detached HEAD 9c51a1e0e] test(executive-viz): update stale
label assertion to Activity Date: Thu Sep 3 …`. **`Date: Thu Sep 3` was right
there**, in the very evidence being relied on, and was read straight past because
the rest of the line agreed with what was already believed. When a snippet
carries a date, a SHA or a path, read the parts that could refute you BEFORE the
parts that confirm you — the cheapest disconfirming evidence you will ever get is
the evidence already in your hand.

🛑 **AND IT WAS CAUGHT BY THE SESSION IT ACCUSED, NOT BY ITS AUTHOR.** That is the
governing fact for this whole shape. An attribution error is close to invisible
from the outside and obvious from the inside, so **name the party you are
describing when you write it down, and give them the chance to answer before it
lands.** Had that claim been phrased impersonally it would have shipped, and the
strongest sentence in a permanent incident record would have been its only false
one.

#### The fifth shape: a NEGATIVE, measured after your own write, with no control

The shapes above are a check that cannot fail, one that fails and hands back a
plausible value, one that passes against an artifact you did not ship, and a
search hit read as attribution. This is the one that produces a **confident
absence** — and absence is the hardest reading to doubt, because there is nothing
there to look wrong.

🛑 **THE RULE: AN ABSENCE YOU MEASURED *AFTER* MODIFYING THE THING IS NOT EVIDENCE
ABOUT WHAT WAS THERE BEFORE.** You need the same predicate, on the same object,
read BEFORE the write. A count is not that predicate. Neither is a sibling's
timestamp.

Measured 2026-09-11, on `node_modules/.prisma/client` in the shared checkout. A
session ran an approved `npm rebuild`, then found `index.d.ts` missing and five
zero-byte files dated three days earlier, and concluded the client had been broken
for three days — heading for the standing claim that *every* typecheck in this
checkout for three days had measured an inflated tree.

Three things were wrong with it, and each is reusable:

- **The before-measurement was a COUNT (14 files); the after-measurement was
  FILENAMES.** Different predicates. A count of 14 is exactly what
  one-file-removed-one-added looks like, which is what had happened.
- **`index.d.ts` was a SIXTH file, outside the five that were timestamped.** "Those
  five are dated 09-08" supports nothing whatever about a file that is not among
  them. A control on neighbours is not a control on the subject.
- **The refuting line was inside the evidence being quoted.** The same session's own
  timestamp table listed six files rewritten by its own run minutes earlier. The
  five that agreed were read; the line that disagreed was read past — the same
  failure the attribution shape above records, in a different instrument.

**What settled it was BEHAVIOURAL, and that is the general lesson.** A peer had run
the ratchet on one commit through two different `node_modules` junctions:

```
junctioned to the stale client    147 errors, freezeStore.ts +4 (TS2339 leagueMaxPfFreeze)
junctioned to the other client    143 errors, baseline 143, clean
```

A missing `index.d.ts` **inflates** an error count; it cannot clear one. So the
client was demonstrably functional at the time of that run, and no file listing was
needed to establish it. A second session reached the same conclusion independently
from a `tsc --listFiles` naming the file. **Two positive measurements, different
instruments, beat one negative taken after a write.**

⚠ **AND THE WITHDRAWN CLAIM WAS THE EXPENSIVE PART, NOT THE MISDATING.** "Every
typecheck here for three days was inflated" would have told every session to
distrust three days of real measurements, including four landed attestations and an
open PR. A wrong negative about shared state does not merely mislead one person —
it retroactively invalidates everyone else's correct work. Say what you measured,
when, and with which instrument, and let a positive measurement outrank an absence.

🛑 **AND THE CLAIM WAS WRONG ABOUT THE SYMPTOM'S VISIBILITY TOO, WHICH IS THE HALF
THAT MADE IT WORTH BROADCASTING.** It said a dead client *quietly* inflates every
typecheck. It does not: **702 tracked files reference `@prisma/client`**, so a dead
client is LOUD — anyone who ran a typecheck in that window would have known at once.
So the story was wrong in two opposite directions, about WHEN and about whether it
would have been NOTICED, and the second is the dangerous one. *"Silently wrong for
three days"* is what turns a small error into an urgent broadcast; *"loudly wrong
for two hours"* is a note to one person. **Before you escalate an incident, check
your claim about why nobody spotted it — that claim is doing most of the work.**

⚠ **THE ACTIONABLE LINE: THE REPAIR HAD ALREADY BEEN WRITTEN DOWN, WITH ITS REASON
ATTACHED.** The correct instrument was `npm rebuild --ignore-scripts`, and that
exact form sat in this project's memory under
`npm-ci-postinstall-leaves-no-prisma-client`, commented *"restores `.bin` WITHOUT
re-entering the postinstall path that just failed"*. The bare form was run instead,
and re-entering that postinstall is what destroyed a healthy client on a tree that
only needed its `.bin` back.

**This is the file's own standing rule — before writing a new check, grep for the
one that exists — applied to a REPAIR rather than a check.** Re-deriving an
instrument re-derives its failure mode, and a repair has the worse blast radius of
the two because it writes.

⚠ **AND A COUNT PUBLISHED WITHOUT ITS PREDICATE IS NOT A MEASUREMENT** — which is
this same shape in miniature, and it happened while writing this section. Two
sessions reported the regenerated client as `47` and `945` matches of the same
identifier and it read as a contradiction. It was neither method nor error. It was
CASE:

```
grep -c   leagueMaxPfFreeze     47   lines   (the delegate, lowercase l)
grep -c   LeagueMaxPfFreeze    906   lines   (the model type, capital L)
grep -ic  leaguemaxpffreeze    945   lines   (either)
grep -o … | wc -l               76   total occurrences, not lines
```

🛑 **`Select-String` IS CASE-INSENSITIVE BY DEFAULT AND `grep` IS NOT.** Neither
session set that; it is a default, which is why neither suspected the predicate. The
useful figure was the one that could be compared to something — 47 matched the
pre-loss reading exactly, establishing the regenerated client as equivalent to the
one destroyed. **Name what a number counts, or it cannot be compared with anyone
else's.**

### 🛑 ONE SESSION BATCHES AND PUSHES TO `main`

> ⚠ **SUPERSEDED AS THE DEFAULT 2026-09-08 — read "Queue-order self-push" below
> before acting on this section.** Everything measured here is still true, and is
> still why the queue, the base-staleness check and the build guard exist. What
> changed is the CONCLUSION drawn from it. Keep reading for the mechanism; the
> standing instruction is the later section.

User's decision, 2026-08-29, and the larger half of the build bill. The
cherry-pick rule above settles HOW work lands; this settles WHEN.

The pre-push hook states the cost from real data: **165 of 326 production builds
in one 4.7-day window were superseded before they finished. Both billed, one
served.** Six sessions each pushing as they finish reproduces that indefinitely —
three builds went out inside a few minutes the day this was written.

So: **commit freely, push rarely, and let ONE session do it.** Everyone else
lands work on `shared/f-working-tree` and tells the pusher. The pusher batches
and cherry-picks the batch onto `main`.

⚠ **THE PUSHER IS A ROLE, NOT A SESSION — SESSIONS END.** Whoever holds it must
announce it to the others (`ListAgents` + `SendMessage`), and hand it over
explicitly when finishing. A designated pusher who vanishes silently blocks
everyone, which is worse than the duplicate builds this replaces.

⚠ **AND WAITING IS THE INTENDED RESPONSE TO THE HOOK.** If it refuses because a
build is running, wait and retry. `AF_ALLOW_CONCURRENT_PUSH=1` exists for a
genuine emergency and using it routinely turns the guard back into decoration.

#### The push queue: "wait and retry" now means a place in line

Added 2026-08-30. `scripts/push-queue.mjs`, run from the pre-push hook ahead of
the build guard.

**The gap it closes.** "Retry in ~N min" tells every blocked session the same
thing, so they all retry at once and the winner is whoever's poll landed
luckiest. A session that has waited twenty minutes loses to one that arrived
thirty seconds ago, and it can lose repeatedly. The build guard was never wrong
about *whether* anyone may push; it simply had no opinion about *whose turn* it
is, and with ~9 concurrent sessions that is a starvation problem.

🛑 **THIS TABLE SAID "TWO GUARDS" UNTIL 2026-09-11 AND THERE ARE FOUR.** The two
missing ones both RAN on every push that read this — they were simply undocumented
here, because the section describing the fourth was committed and never landed (see
the pre-push-smoke section below). Read off an actual push, not inferred:

| | question | script | measured cost |
|---|---|---|---|
| 1 | does this push carry a **secret**? | `scripts/secret-scan.mjs` | **23–30s** |
| 2 | is it your **turn**? | `scripts/push-queue.mjs check` | local, instant |
| 3 | may **anyone** push right now? | `scripts/check-inflight-prod-build.mjs` | one API call |
| 4 | does the pushed SHA **typecheck**? | `scripts/pre-push-smoke.mjs` | 31s warm / 329s cold |

Order read off `.githooks/pre-push` itself (the secret scan at its line 103, then
the three `run_guard` calls), not inferred from output.

⚠ **IT IS NOT CHEAPEST-FIRST, AND THE FIRST GUARD IS NOT FREE.** The secret scan
was assumed to cost about a second; timed three times on 2026-09-11 it is 29.9s,
23.7s and 22.9s. It runs BEFORE the instant local turn check, so **every refused
push pays ~25 seconds before being told it is not its turn or that its base is
stale** — three times in a row, in the landing this was measured during. That is
not an argument for reordering it (a secret must never leave the machine, and the
scan is the one guard whose failure is unrecoverable), but budget for it: a
retry loop polling the queue through `git push` is not the cheap operation it
looks like.

⚠ **THREE OF THE FOUR REFUSE WITHOUT FAILING, AND THAT IS NOT THE SAME AS PASSING.**
Guard 2 refuses a STALE BASE ("3 commit(s) landed since") and keeps your ticket;
guard 3 refuses while a production build is in flight and keeps your ticket. Both
are the guard working. Neither is a reason to reach for an override — and the
difference matters, because a stale base means **rebuild**, while an in-flight
build means **wait and retry**. Retrying a stale base forever is a loop that
cannot succeed.

⚠ **AND THE STALE-BASE MESSAGE HANDS YOU A RECIPE THAT IS WRONG FOR A MULTI-COMMIT
TIP.** It prints `git cherry-pick <tip>`, which picks ONE commit. If your tip is
two or three commits, that lands only the LAST one — no conflict, no failing test,
and the rest silently absent. Use the range, `git cherry-pick <base>..<tip>`, then
assert EVERY patch-id is in `origin/main..<newTip>`. Measured 2026-09-11 on a
two-commit tip; a peer confirmed independently they would have dropped two of three.

**Use the wrapper; it is one command and it does the whole convention:**

```
npm run push:main                # take a ticket, wait your turn, push, release
npm run push:status              # see the line
npm run push:wait                # block until it is your turn
```

Nothing forces you to. A session that has never heard of any of this still gets
a ticket automatically on its first `git push`, at the BACK, and is told where it
stands — the same "needs no agreement" property the build guard was written for.

⚠ **THE TICKET IS KEYED ON THE SHA YOU INTEND TO PUSH, not on a session id.**
There is no usable session identity here: ~9 sessions share one checkout and
shell state does not survive between commands. The consequence to know is that
**amending after taking a ticket sends you to the back**, because the sha
changed. `npm run push:rebind -- --to=<newSha>` moves your existing ticket and
keeps your place. `npm run push:main` avoids the situation entirely.

**It fails open, like the build guard, and for the same reason.** An unreadable
queue directory, a corrupt ticket, a git that will not run — all exit 0 with a
warning. The only refusal is a positive, parsed confirmation that a live ticket
with a lower sequence number is ahead of yours.

**And it cannot deadlock on a session that vanishes.** A ticket expires 15 min
after its last heartbeat; one already waved through is released when its sha
becomes `origin/main` (verified by `ls-remote`, per the rule above — never by
reading push output) or after a 10-min grace. Every automatic release is written
to `<git-common-dir>/af-push-queue/journal.jsonl`, so a ticket never disappears
silently.

The queue lives in the **git common dir**, so all worktrees share one line.
Emergency override: `AF_SKIP_PUSH_QUEUE=1 git push …` — separate from
`AF_ALLOW_CONCURRENT_PUSH`, because they excuse different things.

⚠ **Two ways a SHA-keyed ticket gets orphaned, and only one is your own doing.**
Amending is the obvious one. The other is that **this checkout rewrites history
under running sessions** — a peer's rebase renamed a live commit on 2026-08-30
(`5bc9cef07` → `4a84bc557`, and again `cc8593229` → `e0e444030`, both caught only
because the patch-ids matched), and a ticket keyed on the old name loses its
place through no action of its owner. So `check` now looks for a live ticket from
your worktree that is **the same work under another name** and carries it
forward automatically.

🛑 **AND AN ANCESTOR TEST IS NOT THAT CHECK — THIS WAS SHIPPED WRONG ONCE AND
CORRECTED WITHIN THE HOUR.** The first version matched on ancestry alone and was
described here as covering the rebase case. It does not. **A rebase produces a
SIBLING, not a descendant**: same patch, different parent, common ancestor behind
both. Measured on the pair that actually happened:

```
git merge-base --is-ancestor cc8593229 e0e444030   → rc=1   (not an ancestor)
git merge-base --is-ancestor e0e444030 cc8593229   → rc=1   (not one either)
git show <each> --format="" --patch | git patch-id --stable
                                    → d0d63cd16… for BOTH
```

So the ancestor test answers "no" in both directions for the exact case the
rebind exists to catch — it works for an amend, which is where it was tested.
`sameWork` now tries **patch-id first** (catches a RENAME) and ancestry second
(catches an AMEND or an extension). Neither subsumes the other. ⚠ `null` never
matches `null`: two commits whose patch-id could not be computed are not thereby
the same commit, and treating them as equal hands one session's place to another.

The `isAncestor` helper is three-valued on purpose: `merge-base --is-ancestor`
exits 0 for yes and 1 for no, and **anything else is not a verdict** — this repo
has already read a `timeout`'s 124 and a missing `pgrep`'s 127 as answers. A
`null` means "do not act", never "no".

⚠ **The regression test uses those two real SHAs as a positive control**, and
asserts BOTH that the ancestor check is blind to them and that the ticket moves
anyway — plus, on the descendant case, that the reason journaled is the ANCESTRY
one. Pinning which signal fired is what stops the other branch becoming dead code
under a green suite: a test asserting only "the rebind happened" would pass with
the ancestor half deleted and patch-id quietly doing all the work. A rebind that
silently declines is indistinguishable from having no rebind at all.

⚠ **AND DO NOT GENERALISE `sameWork` TO A MERGE DECISION.** Patch-id equality
means "the same change", not "safe to treat as interchangeable". Here that
distinction does not bite — the question is only "is this my own work under a new
name", which is exactly what patch-id answers. It bites the moment the same
helper is used to resolve a conflict: the rules above already record a day when
two of five conflicts were genuinely divergent rewrites and an auto-resolve loop
took one side for all five, nearly deleting a deployed fix. Same test, different
question, different stakes.

Where **both** SHAs are in hand, the tree hash is stronger still —
`git rev-parse <a>^{tree}` == `git rev-parse <b>^{tree}` says the two commits
carry identical content, not merely an identical diff.

#### `push:main` pushes the SHA, never `HEAD`

🛑 **WAITING YOUR TURN TAKES MINUTES, AND `HEAD` MOVES UNDER YOU IN THIS
CHECKOUT.** On 2026-08-30 a session re-read local `HEAD` at push time instead of
using the SHA it had verified minutes earlier, and pushed **three other sessions'
commits** by accident. A token gate stops the wrong SESSION pushing; it does
nothing about the right session pushing the wrong RANGE.

So `push:main` captures the sha once, pushes `<sha>:refs/heads/main` rather than
`HEAD:main`, and **re-reads `HEAD` after the wait and refuses if it moved** —
comparing against the value captured ONCE beforehand, never a fresh read against
another fresh read, which is the staleness guard that passes while the branch
genuinely moves. Verified end to end: with `HEAD` moved mid-wait the push is
refused and `origin/main` still holds the intended commit.

That inheritance also closes the honest half of a hole worth naming: without it,
one session can hold **two live tickets under two SHAs and take two turns**,
which is the exact unfairness the queue exists to remove. The dishonest half is
not solvable without session identity, which does not exist here — but every
rebind and release is journaled, so it is detectable after the fact.

#### 🛑 `push:main` CAN EXIT 0 HAVING PUSHED NOTHING

And the trigger is **another session's corrupt ticket**, so any session can hit it
through no fault of its own. Measured 2026-09-11, and this is the ENTIRE log:

```
push-queue: #000417 — position 5 of 6, waiting…
  ⚠ push-queue: ticket 000416.json is unreadable — failing open, the push is allowed.
DONE=0
```

No secret-scan, no `pre-push-smoke`, no push attempt. The wrapper took the fail-open
path on a PEER's unreadable ticket and returned success without pushing. Confirmed
three ways: the file was absent from `origin/main`, `merge-base --is-ancestor`
returned 1, and the ticket was still `state: waiting` — never `pushing`, never
released. Nothing in the output or the exit status said so.

**The tell is the absence of BOTH the secret-scan block AND the `pre-push-smoke`
line.** ⚠ Absence of smoke ALONE is not it — a build-inflight refusal prints the
full secret-scan and then stops before smoke, and that is a healthy refusal. A rule
written on smoke alone misreads the good case as the bad one.

⚠ **THE CALLER-SIDE HALF COMPOSES WITH IT INTO A SILENT SUCCESS WITH NO TELL AT
ALL.** `cmd; echo "DONE=$?"` reports the ECHO's status, not the command's — so a
wrapper that exits non-zero still logs `DONE=0`, and a harness watching the shell
reports "completed (exit code 0)". Write `cmd; rc=$?; echo "SENTINEL=$rc"; exit $rc`.
Five push runs in one session carried the broken form and stayed honest only because
`ls-remote` was read every time; the sentinel itself was never evidence.

**So verify a push by SHA, always**: `git ls-remote origin refs/heads/main` against
the sha you pushed. The queue script is honest — it prints `⚠ push did NOT land —
origin/main is X, not Y` and keeps your ticket. It is the exit status that lies.

⚠ The fix for this landed later than the bug and **the shared F: tree is not
`main`** — a session that greps the working tree will find the repair present and
conclude the hazard is closed while `origin/main` still carries the broken wrapper.
Check `git show origin/main:scripts/push-queue.mjs`, not the checkout.

#### 🛑 `push` TAKES NO FLAGS, AND PASSING ONE SILENTLY DISABLES TWO GUARDS

In `cmdPush`:

```js
const passthrough = argv.length ? argv : ['origin', `${ctx.sha}:refs/heads/main`]
if (!argv.length && nowHead && nowHead !== ctx.sha) {   // HEAD-moved guard
if (!argv.length) {                                     // stale-base guard
```

Any argv is forwarded **verbatim to `git push`** — so `push --sha=<sha>` exits 129 —
AND switches off both checks. The stale-base guard is the one that reports *"you
queued X, origin/main is Y, N commits landed since"* and refuses **before contacting
the remote**, which is what turns a non-fast-forward rejection into a kept ticket and
a clean re-pick. A typo'd flag removes it with no warning.

**Bare `push`, with `HEAD` already at the commit you mean, is the only correct
invocation.** ⚠ Two relatives in the same script: `drop` takes its argument
positionally and exits 0 when it matches nothing, and `rebind --from` matches on the
FULL 40 characters — an abbreviation prints "no ticket … nothing to release", which
reads exactly like success. Read the ticket file back after a rebind rather than its
success line.

#### The pusher gate — one session pushes, and it is enforced

User's decision, 2026-08-30: **every push to `main` is confirmed by the
designated pusher.** The queue orders pushes; it does not batch them, and ten
ordered pushes cost exactly what ten unordered ones do. Batching is where the
money is, and until now batching was the one part nothing enforced.

```
npm run push:pusher -- --claim "<session-name>" --ref "<session-name>"
npm run push:pusher                 # who holds it
npm run push:pusher -- --release    # hand it back
```

A claim writes `pusher.json` into the queue directory and prints a token. The
hook then refuses any push to `main` whose `AF_PUSH_TOKEN` does not match, and
the refusal names the holder, tells you to hand over your SHA **with an
attestation**, and reminds you that a migration is not pushable on your say-so.
The gate runs **before** a ticket is taken — a session that is not pushing today
should not be holding a place in the line either.

⚠ **IT IS A STOP SIGN, NOT A LOCK, AND THAT IS NOT A DEFECT TO BE FIXED.** Every
session runs as the same user on the same filesystem, so the token is readable by
anyone who goes looking. A session that reads it to get past the gate has
deliberately overridden it, which is what the documented override is for. What
the gate buys is that **you cannot push past the pusher by accident** — which is
the entire failure it exists to stop. No `pusher.json`, or an unreadable one,
means no gate at all.

⚠ **THE ROLE IS A ROLE, NOT A SESSION — SESSIONS END.** A pusher who vanishes
silently blocks everyone, which is worse than the duplicate builds the role
prevents. Announce a claim (`ListAgents` + `SendMessage`) and `--release` before
finishing.

⚠ **THE LOCK FREES ITSELF ON EVERY SESSION RENAME, AND THAT IS A HOLE NOT A
GLITCH.** `pusher.json` records a session NAME, and names are reassigned here. On
2026-08-31 one session held the role under four successive names
(`76 → d5 → 97 → 6f → 9e`) and the role went **vacant on every rotation** — three
different sessions independently found `push:pusher` reporting "no designated
pusher" while that session was mid-batch under its new name.

Nothing broke, and only because all three did the right thing: they REPORTED the
vacancy instead of claiming it. That is discipline covering a structural gap, and
discipline is what this file exists to stop relying on.

**So, until it is keyed to something that survives a rename:** if `push:pusher`
says vacant, ASK before claiming. Someone is probably mid-batch. And a pusher
whose name has rotated must re-claim — the role does not follow you.

#### What the pusher checks, and what authors owe

⚠ **BATCHING CHANGED WHAT A RED BUILD MEANS.** One SHA per session meant a
failure named its author. A batch of six commits from four sessions that fails
names nobody, and the person bisecting is the pusher — who wrote none of it and
cannot tell an expected failure from a new one. User's decision on how that is
covered:

**Authors attest.** When handing work to the pusher, state what you ran and what
it said — suite names and counts, not "tests pass". An author who cannot say
which checks they ran is asking the pusher to guess.

⚠ **AND ATTEST TO THE COMMIT, NOT TO YOUR WORKING TREE.** If the commit's file
set differs from the tree you checked — the path-scoped case above — the numbers
you hand over describe something nobody will build. Check the SHA out detached
and re-run. This has already put a non-compiling commit into a batch with a
clean attestation on it.

⚠ **AND GIVE THE TOTAL, NOT ONLY "NONE IN MY FILES".** Those are different
claims and only one of them is checkable by the person receiving it. A pusher
comparing your total against the tip they are assembling can see a gainer you
cannot; a pusher given only your paths has been handed the one view guaranteed
to miss a cross-file break. The same batch that produced this note had a commit
attested "zero in my five files" whose tree did not compile — see the
read-the-total rule above.

⚠ **AN AUTHOR'S "THE BATCH" AND A PUSHER'S "THE BATCH" DIVERGE BY CONSTRUCTION.**
An author reads it off local `main`. The pusher pushes a **cherry-picked tip
built onto `origin/main`**, per the landing rule above — a different artifact the
moment anything is picked, and the convention guarantees picking. Reviewing the
wrong one produces objections that are all true and none relevant.

Measured on 2026-08-30, an author reported three blockers from local `main`: a
non-fast-forward, a migration in the range, and sixteen commits of which thirteen
were unattested. Every one was true of local `main`. The tip actually being
pushed was **six commits, no `prisma/` file, zero `cfbdId` occurrences, and
`merge-base --is-ancestor` rc=0** — none of the three applied. The author had
used the same detached-worktree cherry-pick when holding the role hours earlier
and still read the branch.

**So ask the pusher what is in the range, then check that range** — never `main`:

```
git log --oneline origin/main..<tip>
git diff --name-only origin/main..<tip> | grep -iE "prisma|\.sql$"
git merge-base --is-ancestor origin/main <tip>     # 0, or it will bounce
```

⚠ And confirm your own commits are in it **by patch-id, not by subject line or
ancestry** — a cherry-pick renames them, so ancestry answers "no" about work that
is sitting right there in the range.

**The pusher runs a fast smoke over the batch**, not a full re-verification: a
scoped typecheck and the test files touched across the union of the batch. That
catches the thing attestation structurally cannot — one session's change
breaking another's, which neither author would ever have run.

**Neither is a full CI run.** If it goes red on main anyway, that is the
accepted cost of fewer builds, and the pusher bisects with the authors rather
than alone.

⚠ **A MIGRATION IS NOT PUSHABLE WORK.** Code that ships ahead of its migration
does NOT no-op — a generated client that knows about columns production lacks
raises P2022, and a missing table raises P2021. Landing the code is a deploy;
applying the schema change is a separate decision that belongs to the user. The
pusher does neither on the author's say-so.

## A failure path that publishes a secret

The section above is about checks that go green while measuring nothing. This is
the inverse and it is worse, because the thing that leaks is the thing a careful
person does next: **the success path is silent, and the ERROR path prints the
credential.** The more diligently someone reports a build failure, the more
completely they expose themselves.

🛑 **A FAILED ANDROID SIGNING STEP ECHOES THE KEYSTORE PASSWORD IN PLAINTEXT.**
`bubblewrap` shells out to `apksigner`, and on failure it prints the command line
it tried — which contains `--ks-pass pass:"<the real password>"`. Observed
2026-09-01: a user pasted a build error into a chat to ask what was wrong, and
their signing password came with it. It was harmless *only* because the keystore
did not exist yet, so the password protected nothing and a fresh one was
generated. Had the build been failing for any other reason, that paste would have
published the upload key's password.

**Scrub build output before pasting it anywhere** — an issue, a log aggregator, a
chat, a commit message. And note the general shape, because the tool is
incidental: any wrapper that builds a command string containing a secret and
echoes it on error has this defect, and you will not see it in the happy path.

⚠ **THE NEAREST RELATIVE ALREADY IN THIS FILE IS THE `RSC_token` QUERY PARAMETER**
(see *Credentials* above). Rolling Insights passes a long-lived credential as a
URL parameter, so ordinary request logging leaks it. Both are secrets escaping
through *careful, conventional* practice rather than through carelessness, which
is exactly why neither is caught by "do not log secrets" as a rule — nobody
thinks they are logging a secret. They think they are logging a URL, or an error.

⚠ **AND THE MITIGATION IS NOT "BE CAREFUL", IT IS TO KEEP THE SECRET OUT OF THE
ARGUMENT.** Where a tool offers it, pass credentials by file or environment
rather than on a command line — an argv is visible to `ps`, to crash handlers,
and to every error printer that decides to be helpful.

Two related corrections from the same session, both measured, both worth keeping
because the wrong version was the confident one:

- `bubblewrap build` does **not** create the keystore, despite the runbook having
  said so. It prompts for the password, builds the unsigned APK, then dies at the
  signing step with `FileNotFoundException`. Create it with `keytool` first.
- **Losing an upload keystore is RECOVERABLE**, not fatal. Under Play App Signing
  Google holds the app signing key; a lost upload key is reset through the Play
  Console. The opposite was asserted first and had to be walked back. Back it up
  regardless — a reset is a support round-trip mid-release.

Neither belongs in a signing runbook as folklore; both are in
`docs/play-store/RUNBOOK.md` with the measurement attached.

#### 2026-09-08: queue-order self-push is the default; batch YOUR OWN work

Guap's call, delegated to a session and decided from measurement rather than from
the earlier cost argument. It replaces the 2026-08-29 default above.

🛑 **THIS FILE SAID BOTH THINGS AT ONCE FOR TWO DAYS, AND THAT IS WHAT BROKE THE
LANE.** A section retiring the batching default was committed 2026-09-06 in
`cabc72677` and **never reached `origin/main`** — while a comment that DID land,
in `scripts/pre-push-smoke.mjs`, asserted the opposite: that the role and the
batching rule stand. So a session reading this checkout self-pushed, and a
session reading `origin/main` was told one session batches. Six to nine sessions
queued independently under a default that had never actually landed. Whatever
else changes here, do not leave those two disagreeing again — and note the tell
was cheap: `git grep <ref>` on the section title, not a read of the working tree.

🛑 **AND THIS NOTE WAS ITSELF INCOMPLETE FOR FIVE DAYS, WHICH IS THE DURABLE
LESSON: NAME THE COMMIT'S WHOLE FILE SET, NOT THE SECTION YOU NOTICED.**
`cabc72677` touched THREE files. Its `scripts/pre-push-smoke.mjs` and
`.githooks/pre-push` landed; its CLAUDE.md third did not — and that third
contained the batching section this note is about **and** the only documentation
of the smoke guard. Because the note named one section, the rest stayed lost, and
the guard table ABOVE went on saying "two guards" while four ran until
2026-09-11, and the smoke guard itself was documented for the first time below.
A partially-landed commit does not announce which parts are missing;
`git show <sha> --stat` does.

**The rule:**

1. **Push your own commits, in queue order.** `npm run push:main` — take a
   ticket, wait your turn, push. No role, no permission, nobody to hand over to.
2. **Batch your OWN work.** Several commits ready? Land them as ONE tip rather
   than one push at a time. This needs no coordination from anybody else, and it
   is where the remaining build spend actually is.
3. **The pusher role stays, as an opt-in tool.** Claim it deliberately for a
   large or risky multi-commit landing, a migration, or a rescue — announcing and
   releasing it exactly as described above. It is no longer a queue everyone is
   expected to wait behind.

**Why not the batching default.** Its failure mode is a LANDING failure, which is
the thing being optimised for: the lock reads vacant on every session rename
(four times in one day, recorded above), and a pusher who vanishes blocks
everyone. Measured 2026-09-08 against the live Railway project — commits reach
Railway fine (`a60907432` deployed SUCCESS at 13:02), the duplicate-deploy rate
is **3 of 46 sha/service pairs (6.5%)**, and all six FAILED deploys in a
50-deployment sample fall in one contiguous 70-minute band on 09-07: the
client/server barrel break, since fixed. None of that is a batching problem.

⚠ **BUT THE CADENCE IS HIGHER THAN THE RETIRED SECTION ASSUMED — 55 deploys/day
across services over a 21.9h window, against the ~27/day it quoted.** That is why
rule 2 is a rule and not a suggestion.

🛑 **AND DO NOT QUOTE A BUILD-MINUTES NUMBER FROM `list-deployments`. IT CANNOT
MEASURE ONE.** 42 of that sample's 50 rows carry status `REMOVED`, whose
`updatedAt` is when the deployment was REPLACED, not when its build ended.
Differencing those two fields measures a deployment's LIFETIME and yields a
tidy-looking median and a "builds run 100% of the window" figure, both meaningless
— caught here only because the status column was read after the arithmetic. The
`REMOVED` share is the tell, and any cost argument resting on those numbers is
resting on nothing.

#### `scripts/pre-push-smoke.mjs` — the fourth guard, documented here for the first time

🛑 **THIS SECTION WAS WRITTEN ON 2026-09-06 IN `cabc72677` AND NEVER REACHED
`origin/main`.** The commit's other two files did — `scripts/pre-push-smoke.mjs`
(715 lines) and the `.githooks/pre-push` wiring are both live and have been
running on every push since. Only the CLAUDE.md third of it was lost. So for five
days the guard table above said "two guards" while four ran, and the one doing the
most work was the one nobody had documented. Verified 2026-09-11:
`git merge-base --is-ancestor cabc72677 origin/main` → rc=1, and
`git show origin/main:scripts/pre-push-smoke.mjs` → 715 lines.

⚠ **THAT IS THE SAME FAILURE THE SELF-PUSH SECTION ABOVE ALREADY RECORDS, FROM THE
SAME COMMIT** — a section committed, never landed, and a shipped comment asserting
the opposite. It is written twice because it was found twice, independently, five
days apart, and the second finder had read the first note without connecting it.
**The tell is cheap and nobody ran it:** `git grep <pattern> origin/main` on a
section you believe you landed. Reading your own working tree proves nothing about
what shipped.

**What it does.** For a push whose remote ref is `refs/heads/main`, it builds the
exact SHA being pushed in an isolated detached worktree — never the pushing
session's own checkout, which can hold a peer's uncommitted edits — and runs
`scripts/ts-error-ratchet.mjs` against it. A regression (any file gaining errors,
or a new file appearing with errors, against that SHA's own committed
`ts-error-baseline.json`) blocks the push. Everything else — worktree creation
failed, tsc did not run, the ratchet itself threw — fails **OPEN** with a loud
warning. A correctness gate that can strand a deploy is worse than the bug it
might have caught.

🛑 **IT IS WARM BY DEFAULT SINCE `c878407f0`, AND ANY "~17 MINUTES, EVERY RUN IS A
COLD COMPILE" FIGURE YOU HAVE IN MIND IS RETIRED.** The original cleared every
`*.tsbuildinfo` before each run, on the unmeasured claim that a reused worktree
lies when tsc's incremental cache survives a checkout swap. Measured, same SHA,
same machine:

```
cold (cache deleted)                       143 vs baseline 143, clean    329s
warm (cache carried from a DIFFERENT sha)  143 vs baseline 143, clean     31s
```

Identical verdict, 10.6x faster — and the warm run was made to go RED twice before
being believed: an injected error in a changed file (144, named it, 35s), and a
`leagueId: string → number` break whose consumers were **left completely
untouched** (151, four files). That second one is the cross-file type widening this
document says a scoped check cannot see, and the warm cache saw it, because tsc
invalidates on the dependency graph rather than on file identity. The clear is now
opt-in via `AF_SMOKE_COLD=1`, kept because two break shapes are not all of them: if
a smoke result ever looks wrong, re-run cold before believing it, and a cold/warm
disagreement is a finding to write down rather than a flake.

Observed in the wild 2026-09-11: **`no TypeScript regressions (83s)`** on a
two-commit push, against a cache eight minutes old. Budget seconds, not minutes.

⚠ **THE WARM CACHE LIVES IN SYSTEM TEMP, NOT BESIDE THE REPO, AND THAT IS NOT A
CHOICE.** The smoke cannot put its worktree in the git common dir because that dir
is on `F:`, which is exFAT and cannot host the link, so it falls back to
`C:\Users\Guap_\AppData\Local\Temp\af-smoke-worktree` — saying so in one line it
scrolls past. Every session shares that one ~15 MB `tsconfig.tsbuildinfo`. So
anything that cleans system temp resets EVERY session's smoke to a 329s cold run at
once, and the first person to notice will see one slow push rather than a shared
cause.

⚠ **IT SKIPS ITSELF WHEN 2+ OTHER `tsc` PROCESSES ARE RUNNING**, which on this box
is common — deliberately, per this document's own "concurrent tsc kill each other"
entry. So it is a floor, not a wall, and a push that sailed through may simply not
have been checked. ⚠ **And do not attribute a `tsc` process to your own run by
counting them.** Every session's `node scripts/push-queue.mjs push` has an
identical command line and a bare `tsc` carries no owner; a count is not an
attribution. That error was made and corrected on 2026-09-11 — "the one tsc on the
box is mine, so it did NOT skip" was asserted as measurement while the run
finished in 83s, which a cold compile cannot do.

⚠ Exit code 1 from `ts-error-ratchet.mjs` is ambiguous — it fires both for a real
regression and for an uncaught throw from a failed tsc launch — so the wrapper
classifies by the ratchet's own wording ("gained TypeScript errors") rather than by
the exit code. It does NOT run vitest by default (`AF_SMOKE_RUN_TESTS=1` turns it
on). Emergency escape hatch, for a genuine emergency only:
`AF_SKIP_SMOKE_CHECK=1 git push …`

## Deploys cost money, and pushes are the meter

🛑 **A PUSH TO `main` IS A DEPLOY. A COMMIT IS NOT.** Commit as often as you like;
push at the end of a work unit.

This is not style. The Vercel invoice paid 2026-08-27 was **$101.40, of which
$100.90 was one line: Build CPU Minutes (34,338)**. Deployment storage and
transfer were $0.50 combined. Builds are the entire bill, and `main` was taking
**~71 production builds a day** because several sessions read "commit straight to
main" as "push each change as it lands". That instruction is silent on push
cadence; this section is the missing half.

⚠ **Count deployments, not commits.** Estimating push volume from git timestamps
undercounts by ~45% (it read as ~39/day against a true ~71). Use
`vercel ls --environment production --limit 100 --json` — `buildingAt`/`ready`
give real build duration, and the CLI is installed and authenticated.

🛑 **A PUSH IS NOT THE ONLY THING THAT STARTS A BUILD. WRITING A RAILWAY
VARIABLE IS A DEPLOY.** Every `set-variables` call — through the Railway MCP,
through Railway's own agent, or by hand in the dashboard — redeploys the service.
Nothing warns you, and the deployment's `reason` still reads `deploy`, so it is
indistinguishable from a push in the deployment list.

This is where "builds nobody pushed for" come from, and it is not a defect to
hunt. Measured 2026-09-07 while chasing exactly that: `DRAFT_TICK_CRON_ENABLED`
was set and re-set **across four deploys** — roughly 36 minutes of build compute —
by two independent write paths, on a flag that was being set on the wrong service
the whole time. See `970f6bf5e`'s message for the account.

⚠ **AND IT COMPOSES BADLY WITH A FLAG HUNT**, which is precisely the situation
that tempts repeated writes: set, redeploy, wait ~9 min, observe, disbelieve, set
again. Read the variable back and confirm the SERVICE first
(`get-service-config`), because `allfantasy-v2-main` and `allfantasy-v2-worker`
are different services from the same repo and branch — the crons hit the worker.

⚠ **THE TWO SERVICES DEPLOY FROM DIFFERENT BRANCHES, SO COUNT BOTH — BUT NOT AS A
PAIR.** `list-deployments` filtered to one `serviceId` shows part of the spend.
`allfantasy-v2-main` tracks `main`, so a push builds it. `allfantasy-v2-worker`
tracks `worker-release` and builds roughly once a day; see the section below.

🛑 **THIS BULLET READ "BOTH SERVICES DEPLOY FROM `main`, SO ONE PUSH IS TWO BUILDS"
AND WAS TRUE WHEN IT WAS WRITTEN.** The worker was repointed at `worker-release`
around 16:00Z on 2026-09-07 — the same day — which is the second half of the change
`.github/workflows/worker-release.yml` describes in its own header. Verified from
`get-service-config` on both services rather than inferred. Left here as a worked
example of the thing this file keeps warning about: an infrastructure fact goes stale
in hours, and the deployment list looks identical either way.

### The crons run on a SECOND service, on a DIFFERENT branch

Two Railway services build from this repo, and confusing them wastes a day:

| service | serves | deploys from |
|---|---|---|
| `allfantasy-v2-main` | `allfantasy.ai` — every user request | `main` |
| `allfantasy-v2-worker` | the cron executor | **`worker-release`** |

🛑 **`vars.APP_URL` POINTS AT THE WORKER, SO ALL 42 CRONS ARE REQUESTS TO IT — NEVER TO
`allfantasy-v2-main`.** It is printed in any `cron-slow-tier` run's env block. The
consequence is the navigational one: **the web service's logs, metrics and deployed SHA
can never explain a cron.** A peer lost most of a day building an instrument, merging it,
verifying it deployed, and reading the wrong service's logs for it.

**And the worker's branch moves once a day, on purpose.**
`.github/workflows/worker-release.yml` fast-forwards it at `20 21 * * *`, never forces,
and treats a non-fast-forward as a finding. Read its header before changing the cadence —
it records the measurement that set it (24 worker deploys in one day, each container swap
killing in-flight 90–300 s cron requests; 8 hours without a deployment produced 0 server
errors against 17 hours with one producing all 95).

**So a cron fix landing on `main` is not live yet, and the check is one command:**

```bash
git ls-remote origin refs/heads/worker-release   # what the crons are actually running
```

⚠ Expect it to be behind `main` by up to a day. That is the design. If a cron fix is
urgent, dispatch the workflow by hand rather than repointing the service. There is also
`/api/af-debug/sha` on either service, which answers `{branch, sha}` for the container
actually serving you.

### 🛑 `export const maxDuration = 300` DOES NOTHING ON RAILWAY

It is a Vercel directive and nothing enforces it here. Measured 2026-09-07 on
`/api/cron/decision-os-activity-ingest`, whose own internal budgets are 180 s ingest plus
60 s relay — these durations are from `sync_job_runs` rows the handler wrote itself, with
real counters and warnings, so they are completions rather than reaped rows:

```
started 14:27:33  completed 14:55:40  1687 s   failed   626 rows written
started 14:34:11  completed 14:55:18  1268 s   partial  140 rows written
```

⚠ A phase budget bounds ADMISSION to that phase, not the phase's in-flight unit, and
`withDeadline` races a promise — it does not abort the fetch underneath. So a handler can
respect every budget it declares and still run several times past its intended ceiling.

⚠ And a `499`/`502` does not tell you which failure you have. THREE different things
produce one, and they need different fixes: a container swap killing an in-flight request
(see `worker-release.yml`), a handler genuinely exceeding the 300 s client cut (measured
on `/api/cron/import-players` at 300,143 ms with NO deployment in flight), and a
`cron-dispatch.mjs` retry leaving two copies of one job competing.

### Crons queue behind each other on the worker, and the mechanism is NOT settled

`start:railway` resolves to `scripts/railway-next-start.cjs`, which spawns `next start`:
a single Node process, a single JavaScript thread, nothing clustering. Railway allocates
24 vCPU; JavaScript can use about one of them.

**The observation**, measured across 48 h of `sync_job_runs` on 2026-09-07: **48 runs of a
sub-second cron took 65–350 s**, one such stall every 30–90 minutes. Not one bad job — it
happens with a single long job running AND with eleven short ones and none long.

**Ruled out, so nobody re-chases them:**

- *Postgres capacity.* 13 connections of 901, 1 active, no lock waits.
- *Memory.* 5.9 GB peak of 24.
- *The Prisma pool.* `connection_limit=5` in `lib/prisma.ts` looks like the culprit and is
  not: `applyNonProdConnectionGuardrails` returns early when `NODE_ENV === "production"`,
  so it never applies on the worker.

**Evidence that the thread is LOADED rather than CPU-pegged**, gathered by a peer without
any deploy: the worker logged `ensureDraftPoolReady cold build done { ms: 522060 }`
several times concurrently, and what those 522 s go on is visible in the same logs —
failing provider I/O being retried (`[ClearSports] … 500 fetch failed`,
`[rolling-insights] HTTP 404`, `[API-Sports] Free plans do not have access to this
season`). CPU peaked at 1.51 of 24 vCPU throughout.

🛑 **SO DO NOT "FIX" A HANDLER ON THE ASSUMPTION IT IS THE BLOCKER.** No job is present in
every stall, and the binding constraint — one JS thread, request concurrency, or simply
handlers held open by provider calls that will never succeed — is not established.
Event-loop lag per request is the measurement that would settle it, and it needs a deploy.

`sfo` was raised from 1 replica to 2 on 2026-09-07. That doubles capacity under every
reading above, which is why it was worth doing, but it is a mitigation and not a proven
fix. Three reasons replicas are safe here, worth re-checking before changing the count
again: `instrumentation.ts` deliberately starts no in-process workers, so nothing
duplicates; AI daily caps are DB-backed on `apiRateLimitRecord`, so they hold across
processes; and the in-memory limiter in `lib/domain/rateLimit.ts` guards user-facing
routes on the WEB service, not the worker's cron endpoints.

⚠ **AND REPLICAS BREAK LOG-BASED DEBUGGING IN ONE SPECIFIC WAY.** A single cron request
lands on one replica, so an ABSENT log line no longer means the code did not run. Any
argument of the form "numReplicas is 1, therefore that traffic and this cron shared a
container" is now dead, and at least one landed commit message still makes it.

**How to measure the stalls again, because "the crons feel slow" is not evidence.** Pick a
canary — a job whose normal duration is under a second (`cron-waivers`,
`cron-redraft-score-sync`, `cron-notification-outbox-relay`) — and find every run where it
exceeded 15 s, then count what else was running at each of those instants. Check the
`status` column while you are there: every one of the 48 was `success` and untouched by
the reaper, which is what separates this from the deploy-swap failures above.

### What is enforced for you, and what is not

- **`vercel.json` gates builds to `main` only.** `ignoreCommand` skips every
  other ref, so feature branches cost seconds instead of ~4.6 minutes. This is
  server-side and needs no cooperation.
  🛑 **Never commit a working-tree `vercel.json`.** Most checkouts here predate
  the gate and still hold `{}`; committing one silently reverts it and restores
  ~$26/mo, with nothing failing or warning. Rebuild from
  `git show origin/main:vercel.json` and re-apply your edit.
- **A pre-push hook refuses a push to `main` while a production build is running**
  (`.githooks/pre-push`, installed by `npm run hooks:install`). It fails open on
  every error, and only ever inspects pushes whose *remote* ref is
  `refs/heads/main`. **Waiting is the intended response.** Reaching straight for
  `AF_ALLOW_CONCURRENT_PUSH=1` / `AF_SKIP_PREPUSH_HOOK=1` turns the guard back
  into decoration by hand — they exist for a genuine emergency.
  ⚠ The hook lives in `.git/hooks`, which is **not** version-controlled. A fresh
  clone has no hook until `npm run hooks:install` is run. Existing worktrees are
  already covered, because `core.hooksPath` is one absolute shared directory.
- **Batching itself is NOT enforced, and cannot be.** The hook delays a push, it
  does not cancel a build; two overlapping builds are both billed whether they
  run concurrently or serially. Measured, blocking would merge only **3%** of
  pushes into an existing build, because the overlap is cross-session. The money
  therefore depends on you actually batching, not on the guard catching you.

## Exploratory agent testing (`agent-tester/`)

`agent-tester/` is archetype-driven exploratory Playwright testing. It
complements `e2e/` and does not replace it: `e2e/` asks "does the flow I wrote
down still work?", the agent tester asks "can a distracted human who has never
seen this get through it?". It is given a goal, not a script, so it clicks
whatever it finds and submits forms nobody wrote a spec for. Read
`agent-tester/README.md` before the first run.

🛑 **PRODUCTION IS DENIED BY DESIGN, IN `agent-tester/preflight.ts`.** Not
discouraged — refused. `AGENT_TESTER_BASE_URL` has no default (a default is how
a suite finds production), `allfantasy.ai` and its subdomains are on a hostname
denylist, and a behavioural probe confirms the `x-allfantasy-e2e` bypass is
actually live before any write-capable mission starts. Do not weaken the
denylist, do not add a fallback URL, and do not route around the probe.

The cost of getting this wrong is read out of `app/api/auth/register/route.ts`:
the e2e bypass needs `NODE_ENV !== "production"` **or** `ALLOW_E2E_SEED=1`, and
the production deploy sets neither. So every signup the agent invents there
sends a **real Resend verification email** to a fake address (bounces charged
against sender reputation), fires **`notifyOwnerOfNewSignup`** into your inbox,
sends a Meta CAPI **`CompleteRegistration`** conversion that teaches the ad
optimiser to buy the wrong audience — **that one is not reversible** — and
counts against `rateLimit(signup:${ip}, 5, 600_000)`, so the run mostly tests
the limiter.

⚠ **A `.vercel.app` URL is NOT proof you are off the production database.**
Vercel preview deployments use the production DB — `lib/email/undeliverableDomains.ts`
records the 114 test rows that fact put into a 146-row `EarlyAccessSignup`
table. Verify with `npx tsx scripts/check-staging-env.ts` (exit 1 = not safe),
never by reading the hostname. `/api/health` cannot settle it either: it reports
whether a DB is connected, not *which* DB.

⚠ **And that check does NOT clear a local dev server.** It overlays
`.env.staging` on `.env`/`.env.local`, but **Next.js never loads `.env.staging`**
— so a pass describes the staging *file set*, not the server you are about to
point an agent at. Observed on 2026-08-29: the check reported "safe" on
`ep-winter-salad-…` from `.env.staging` while `.env.local`, the file `next dev`
actually reads, pointed at `ep-curly-block-…` — the production host. For a dev
server, read the effective value directly:

```bash
grep -m1 '^DATABASE_URL=' .env.local .env | sed 's#.*@##; s#/.*##'
```

🛑 **AND THE SAME TRAP REACHES ANY SCRIPT OR TEST, NOT JUST A DEV SERVER, BECAUSE
`@prisma/client` POPULATES `process.env` FROM `.env` ON IMPORT.** You do not pass
it a URL and you do not opt in. Importing the module is enough.

Measured on 2026-08-31, twice, by two sessions that did not know about each other:
`DIRECT_URL` unset before the `require`, **set after**, host `ep-curly-block-…` —
the production endpoint this file names above. One session's acceptance suite ran
`pg_roles` / `pg_tables` catalog queries against production. Another ran eleven
`.spec.ts` suites, **several of which `CREATE TABLE`**.

⚠ **NOTHING WAS WRITTEN, AND THE REASON IS THE ALARMING PART.** Every one of those
specs failed at its first assertion because the roles and tables they exist to
create were absent. They were stopped by *the very thing they were written to set
up*. That is a near miss, not a safeguard — apply the schema first and the same
run creates tables in production.

**A local-looking test is not a local test.** A suite with no connection string in
it, no `DATABASE_URL` in its config and no network code you can see will still
reach production if anything in its import graph pulls in the Prisma client.

The one suite set that is gated opts in explicitly (`COMMISH_DB_SPECS=1`) rather
than sniffing a hostname — deliberately, because as recorded above a `.vercel.app`
URL is not proof you are off the production database.

⚠ **BUT AN OPT-IN FLAG GATES *WHETHER* A SUITE RUNS, NEVER *WHAT IT CONNECTS TO*,
AND THAT DISTINCTION IS THE WHOLE BUG.** Every DB suite here was already gated —
`RUN_EVENT_DB_IT`, `IMPORT_INTEGRATION_DB`, `TEST_DATABASE_URL`, `COMMISH_DB_SPECS`.
Each header says "point `DATABASE_URL` at a NON-prod DB", which is a sentence
addressed to a human. Set the flag and forget the URL and the author's reasonable
assumption — that an unset variable means "no database" — is false in this repo.
It means production. `RUN_EVENT_DB_IT=1 npm test` was a live round-trip to prod.

**Fixed 2026-08-31 by `vitest.setup.db-guard.ts`, first in `setupFiles` for both
vitest configs.** Setup files run before any test module is imported, so `.env`
has not been read yet — therefore `DATABASE_URL` being set *at that instant* means
a human exported it deliberately, and being unset means the only thing that can
fill it later is Prisma's `.env` load. So the guard pins the unset case to
`127.0.0.1:1`. dotenv does not overwrite an existing variable, which is what makes
the pin hold.

No hostname matching and no escape-hatch flag: naming the URL you want IS the
escape hatch, and unlike a flag it cannot be set once in a shell profile and then
forgotten. Verified red before green — `RUN_EVENT_DB_IT=1 npx vitest run
__tests__/events/outbox-db.integration.test.ts` now fails with `Can't reach
database server at 127.0.0.1:1` and **zero** occurrences of the production host in
its output. ⚠ Read that reason, not the exit code: the first attempt at the same
control used a `--reporter` this vitest does not have and exited 1 before running
a single test, which looked exactly like success.

⚠ **`127.0.0.1:1` in a stack trace means that guard pinned it** — you did not name
a database. It is not a broken local Postgres.

🛑 **AND WHAT IT CAUGHT ON DAY ONE IS THE REASON THIS IS NOT PARANOIA.** Turning
the guard on moved the suite from 93 failed files to 96. The three that moved were
`real-data-validation-phase33`, `-phase34` and `-phase35` — each one described in
its own header as **"real execution against `.env.test`, no mocks"**, and each one
running in every plain `npm test`. Nobody was setting `DATABASE_URL`, so all three
had been doing real, unmocked, write-capable execution **against production**, and
**passing**. The baseline run contains the production host; the guarded run
contains it zero times.

⚠ **`phase35` WAS ALREADY GATED, AND THE GATE WAS THE SAME BUG IN MINIATURE:**

```ts
const HAS_DB = Boolean(process.env.DATABASE_URL || …)   // always true. always production.
```

Someone saw the risk and tested for *presence*. Presence is exactly what `.env`
guarantees. **A gate on `DATABASE_URL` being set is not a gate** — the variable is
never unset in this repo, so that condition is a constant. Gate on
`VITEST_NO_DATABASE !== '1'`, which is false only when a human named a target.

⚠ **AND PINNING THE URL IS ONLY HALF A FIX.** On its own it converts a silent
production read into a permanently red suite, and a red suite nobody reads is how
the problem survives in a new costume. A suite that needs a database must
`describe.skipIf(NO_DB)` — **skip**, not fail, and skip rather than early-`return`
so it still appears in the run summary. Verified both directions: with no target
the three skip and open no connection; with `DATABASE_URL` named they run against
that target and never the sentinel.

**`npm run test:agent:readonly` is the default for an unfamiliar target.** It
sets `AGENT_TESTER_READ_ONLY=1`, which skips the signup probe entirely and never
registers or submits, and it still catches dead links, 5xx, console errors, slow
screens and tap-target problems. Reach for the write-capable scripts only once
you have confirmed the target sets `ALLOW_E2E_SEED=1` and is not on the
production DB. Reports land in `agent-tester/reports/latest.md`.
