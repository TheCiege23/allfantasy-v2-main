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

**The code does not comply yet, and the guard says so.** A full scan reports 81
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

When patch-ids differ, read `git diff <main>:<path> HEAD:<path>` in full, check
`git merge-base --is-ancestor <theirCommit> HEAD`, and if both sides are real
work, **stop and ask the author** — that is not a merge strategy question.

⚠ Verify a push by SHA (`git ls-remote origin refs/heads/main`), never by
grepping push output: a rejected push prints `-> main` too.

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

**`npm run test:agent:readonly` is the default for an unfamiliar target.** It
sets `AGENT_TESTER_READ_ONLY=1`, which skips the signup probe entirely and never
registers or submits, and it still catches dead links, 5xx, console errors, slow
screens and tap-target problems. Reach for the write-capable scripts only once
you have confirmed the target sets `ALLOW_E2E_SEED=1` and is not on the
production DB. Reports land in `agent-tester/reports/latest.md`.
