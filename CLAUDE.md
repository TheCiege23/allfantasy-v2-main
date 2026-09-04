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

### ⚠ A CHECK THAT CANNOT FAIL READS AS A PASS

Three sessions hit this in one day, each in a different tool, each believing
they had verified something. The common cause: **a pipeline's exit status is the
LAST command's**, so the thing being tested never decides the result. Use
`${PIPESTATUS[0]}`, or do not pipe the command whose status you are reading.

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

### 🛑 ONE SESSION BATCHES AND PUSHES TO `main`

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

So there are now two guards on a push to `main`, in this order:

| | question | script |
|---|---|---|
| 1 | is it your **turn**? | `scripts/push-queue.mjs check` |
| 2 | may **anyone** push right now? | `scripts/check-inflight-prod-build.mjs` |

The queue runs first because it is local and cheap — only the head of the line
ever spends a Vercel API call.

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
