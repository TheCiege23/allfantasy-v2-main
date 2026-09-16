# Sports OS foundation

The shared layer every screen and job is built on. Code: `lib/sports-os/`, imported through
`@/lib/sports-os`.

## What this is, and what it deliberately is not

It is **ten points, and five of them were already built.** The honest version of this table matters
more than a tidy one, because the expensive mistake here is re-implementing a thing that exists —
`/core` already streams cards behind a shell, already traces them per card, and already samples per
route with a budget in traces-per-hour.

| # | Point | Where it lives | State |
|---|---|---|---|
| 1 | Performance budgets | `lib/sports-os/budgets.ts`, `budgetTelemetry.ts` | **new** — shell + every card instrumented |
| 2 | Render the shell immediately | `app/core/[[...screen]]/page.tsx` — `af.shell_ms` | already built |
| 3 | Stream cards independently | same page + `lib/observability/cardTelemetry.ts` | already built |
| 4 | Screen-ready summaries | `lib/sports-os/summaries.ts` | **new** — eight screens wired: standings, week, season-outlook, career, career records, the trade board, the waiver board and the portfolio inventory; plus the home's three portfolio records, built by a peer on this layer |
| 5 | Layered caching | `lib/sports-os/layeredCache.ts`, `durableTier.ts` | **new** — memory + `SportsDataCache` |
| 6 | Heavy work in jobs | `lib/jobs/`, `lib/queues/bullmq.ts` | already built — reached from `reactions.ts` |
| 7 | One event system | `lib/events/` | already built — reaction table, relay consumer, `ingest.*` emit are new |
| 8 | End-to-end observability | `lib/observability/`, `docs/observability/TRACING.md` | already built — budget verdicts are new |
| 9 | Last-known data | `lib/sports-os/freshness.ts`, `components/sports-os/FreshnessChip` | **new** — visible on `/core/standings` |
| 10 | Gradual rollout | `lib/sports-os/rollout.ts` | **new** |

**One surface is live on it: `/core/standings`**, behind a 10% rollout — see *The first wired
surface* below. The rest of the layer still has no callers, and *What is not done* at the end names
every remaining step and why each is a separate decision.

## How the pieces compose

One read of one screen, with every point on it:

```ts
import {
  readScreenSummary,       // 4 — precomputed shape, read-through
  describeFreshness,       // 9 — the timestamp the card renders
  measure,                 // 1 + 8 — timed against a declared budget
  evaluateRollout,         // 10 — is this user in the cohort
  DEFAULT_ROLLOUTS,
} from '@/lib/sports-os'

const onSummaries = evaluateRollout('sports-os.screen-summaries', userId, DEFAULT_ROLLOUTS).enabled

const standings = await measure({ phase: 'card', name: 'standings', device }, () =>
  onSummaries ? readScreenSummary('standings', { leagueId }) : buildStandingsLive(leagueId),
)

const view = describeFreshness(standings)   // { data, ageMs, isStale, label: '4m ago', source }
```

And the write side, where an import fans out (point 7 → 4, 5, 6):

```ts
// The importer emits ONE event and knows nothing about what happens next.
await getEventPublisher().publish({ type: EVENT.INGEST_LEAGUE_COMPLETED, ... }, { tx })

// A consumer turns it into invalidations and jobs, from the table in reactions.ts.
await dispatchReactions(event, { invalidate, enqueue })
```

## The three properties worth understanding before using any of it

**A summary is read-through and self-populating.** This is the single most important design decision
in the layer, and CLAUDE.md records why at length: `ingestCFBDStats` existed for months with no
scheduled caller, so the `DevyPlayer` stat columns a surface had been pointed at were never
refreshed, and it served nulls while looking correct. *"Pointing a surface at a table nothing
refreshes is worse than the live call it replaced."* Here a cold or invalidated summary costs one
rebuild on the next read. The event reactions make that rebuild happen ahead of the visit — a
**latency and quota win, never a correctness prerequisite**. That is the `getFantasyCalcValuesDbFirst`
shape, and it is the reason this layer can ship before its writers are scheduled.

**A stale value is labelled, never silent.** Every cached read returns a `Fresh<T>` carrying
`fetchedAt` and a `source`. `last-known` means a refresh *failed* — a card must warn about it even
when the data is thirty seconds old. `combineFreshness` is deliberately conservative: a card built
from one live read and one last-known read is a last-known card, because taking the newest timestamp
would let one fresh value launder five stale ones.

**A budget never decides anything.** `evaluateBudget` is an observation. It does not shorten a
timeout, shed a card, or change what the user sees. A performance budget that can fail a request
turns a slow page into a broken one — the same rule `pre-push-smoke.mjs` follows when it fails open.

## The budgets

⚠ **THESE ARE TARGETS, NOT MEASUREMENTS, AND THE DIFFERENCE IS THE WHOLE CAVEAT.** They were chosen
from the shape of the product and from the one figure `docs/observability/TRACING.md` records — a
1,836 ms `/core` render trace. **Nothing in the table is a p95 we have actually held.** A budget
nobody has ever met is a wish, not a contract. Re-set them from Sentry once there is a week of
per-screen, per-device data, and say in the commit message that you did.

| Phase | Target | Ceiling | Device-scaled? |
|---|---:|---:|---|
| `shell` | 400 ms | 800 ms | yes |
| `card` | 800 ms | 2,000 ms | yes |
| `screen` | 1,200 ms | 2,500 ms | yes |
| `interaction` | 200 ms | 500 ms | yes |
| `db` | 300 ms | 900 ms | **no** |
| `provider` | 1,500 ms | 5,000 ms | **no** |
| `import` | 20 s | 60 s | **no** |
| `notification` | 30 s | 120 s | **no** |
| `job` | 60 s | 180 s | **no** |

⚠ **ONLY CLIENT-FELT PHASES GET THE DEVICE MULTIPLIER** (mobile ×1.5, tablet ×1.25). A query does
not run slower because the caller is holding a phone; giving `db` a mobile multiplier would hide a
genuine regression behind the user's hardware.

⚠ **`db` IS DATABASE TIME, SUMMED, NOT WALL CLOCK** — the same meaning `af.db.ms` already carries. A
`Promise.all` of four 80 ms reads spends 320 ms of this budget in 80 ms of wall clock. That is
deliberate: the budget is about the load we put on Postgres, which is the thing that runs out first.

⚠ **`unknown` IS A VERDICT.** A `NaN` or `Infinity` duration is not a measurement, and it reads
`unknown` rather than `within`. The first version of this module collapsed it into `within` —
`Number.isFinite(Infinity)` is false, so an unbounded duration clamped to 0 and a hung read would
have reported as comfortably inside budget. Its own test caught it. A status that is neither pass
nor fail is not a pass.

Budget verdicts are written on the request's root span as `af.budget.<phase>_ms`,
`af.budget.<phase>_verdict` and `af.budget.<phase>_ratio`, so "which screens are over budget on
mobile" is a Sentry filter rather than a spreadsheet join against thresholds someone has to keep in
sync.

## The reaction table

`lib/sports-os/reactions.ts` is the single place that says what an event makes wrong (summaries to
drop) and what it makes due (jobs to enqueue). Adding a consumer means adding a row there, never
editing the importer.

🛑 **FAN-OUT IS THE EXPENSIVE DIRECTION AND THE WORKER IS ONE JAVASCRIPT THREAD.** CLAUDE.md records
48 sub-second cron runs taking 65–350 s because the worker's single thread was *loaded*, not
CPU-pegged. Enqueueing five jobs per import is a straightforward way to reproduce that. So:

- `ingest.scores.refreshed` plans **no job at all** — summary invalidation only. It fires on a live
  cadence, and enqueueing per score tick is exactly how that queue builds.
- `MAX_JOBS_PER_EVENT` caps every plan at 4.
- `sports-os.ingest-reactions` starts at **0%** in `rollout.ts`.

Invalidation happens first and is never skipped because an enqueue failed: dropping a stale summary
costs one rebuild, leaving it costs a wrong screen. `dispatchReactions` never throws — it runs from
an at-least-once consumer, where a rejection re-delivers the event and re-runs the reactions that
already succeeded.

New event types added to `lib/events/catalog.ts` for this (additive; no existing payload shape was
touched): `ingest.league.started` / `.completed` / `.failed`, `ingest.rosters.refreshed`,
`ingest.scores.refreshed`, `ingest.player_values.refreshed`, `ingest.projections.refreshed`.

⚠ **`provider` IN AN INGEST PAYLOAD IS A SOURCE NAME, NEVER A URL.** Rolling Insights passes
`RSC_token` as a query parameter, so a provider URL in an event payload is a credential sitting in
the outbox table.

## Rollout

The bucket is `hash32(flag + ':' + subjectId) % 10000`.

⚠ **THE FLAG NAME IS IN THE HASH, AND THAT IS THE WHOLE DESIGN.** Hashing the subject alone would
put the same unlucky 5% of users in the first cohort of *every* expensive feature — they would carry
every regression we ship while 95% of users see none of them. Salting per flag makes each rollout an
independent draw, and the test asserts that two flags' 10% cohorts do not coincide.

Precedence: kill switch → denylist → allowlist → percentage. The denylist beats the allowlist,
because the list that takes something away has to be the one that wins. An anonymous subject is off
below 100% — there is no stable cohort for them, so bucketing would re-roll on every request, which
is half-rendered A and half-rendered B.

`parseRolloutEnv` falls back to the **code default** on an unparseable value rather than to off: a
typo'd variable silently disabling a shipped feature is the worse failure, and on Railway correcting
it costs a redeploy (writing a Railway variable *is* a deploy).

## Testing

`__tests__/sports-os/` (92), `__tests__/core-app/` (12), `__tests__/observability/` (5) and
`__tests__/fantasy-os/sync-invalidates-standings` (6) — no database, no queue, no network.

⚠ **ELEVEN OF THE KEY ASSERTIONS WERE MUTATION-TESTED**, because a green check that has never gone
red is not evidence. Injecting each of these turns the named suite red: giving `db` a device
multiplier; dropping the per-flag salt from the rollout bucket; re-stamping `fetchedAt` when
promoting a cache entry between tiers; making `combineFreshness` take the newest timestamp; keying
the standings summary on the AF uuid instead of the platform id; dropping the season from its scope;
making the durable envelope check a bare cast; dropping `scopeKey`'s trailing separator; and — at the
sync call site — passing a uuid, removing the call, and moving it into the success-only path.

Five more for point 9: seeding the chip's clock from `Date.now()` on first render (the hydration
bug); never ticking after mount (the frozen-label bug); collapsing `last-known` into plain stale;
dropping the never-fetched guard; and removing the chip from the refusal branch.

Four more for the relay consumer: sweeping by the event's `leagueId` instead of the screen's own
key; letting errors escape the handler; gating both halves on one flag; and bucketing on `eventId`
instead of `leagueId`.

⚠ **FIVE OF THOSE CONTROLS WERE WRONG ON THE FIRST ATTEMPT**, which is the part worth keeping. One
let a promoted cache entry fall out of memory before the assertion ran, so the mutation was masked.
One left the original call in place and added a second one, so the test never saw the condition. And
the first version of the hydration test tried to read "first paint" out of testing-library's
`render`, **which flushes effects synchronously** — so it was reading post-effect markup and could
never have observed the thing it claimed to check; it was replaced with a real `hydrateRoot` against
server HTML, asserting on React's own mismatch warning.

And two more on the relay consumer, both instructive. The "never throws" test drove
`leagueKeyForEvent` and `enqueue` — but **both are invoked inside `dispatchReactions`, which already
catches per-item**, so the consumer's own `try/catch` was never reached and deleting it left the
test green; `onResult` is the one call outside it, and that is what the test drives now. The
bucketing test used **two** events at 50%, which is a coin flip that can land the same way by
chance — and did, so an `eventId`-keyed mutation stayed green; it uses twelve now.

**A control that stays green is a finding about the control, not a verdict on the code.**

⚠ **AND THE FIRST ATTEMPT AT THE `fetchedAt` CONTROL STAYED GREEN**, which is worth recording: the
scenario let the promoted entry fall out of memory before the second read, so the mutation was
masked and the test proved nothing. The entry has to still be *in* memory and *past its TTL* at the
moment it is read again. A control has to be derived from the implementation's real failure mode,
not from the one it was written for.

⚠ Note that **no test file in this repo is typechecked** — `tsconfig.json` excludes `__tests__`
repo-wide, and `next.config.js` sets `typescript.ignoreBuildErrors: true`. A mock can contradict its
module's real contract indefinitely without anything going red. Run the suite.

## The first wired surface: `/core/standings`

`lib/core-app/leagueStandingsSummary.ts`, behind `sports-os.screen-summaries` at 10%.

`getLeagueStandings` reads every `WeeklyMatchup` row the league has, every team, and the user's own
rows, then ranks, computes week-by-week movement, builds a trend and projects a pace — on every
visit, for every member, all season. It now runs behind the summary layer, with the
`SportsDataCache`-backed durable tier so a board survives a deploy and is shared across replicas.

TTL 2 minutes, stale-while-revalidate 10 minutes. The TTL is **sized against the data underneath
it**, not picked for feel: `ensureMatchupsCached` only refetches the live week once its rows are
older than its own 30-minute staleness threshold, so a shorter TTL here would rebuild an identical
board from identical rows.

🛑 **THE CACHE IS KEYED ON THE PROVIDER'S LEAGUE ID, NOT OUR UUID, AND REVERSING THAT BREAKS
INVALIDATION SILENTLY.** Three facts force it:

1. `WeeklyMatchup.leagueId` holds the provider's id — CLAUDE.md records that only 2 of those on
   production match a `League.id`.
2. `syncConnectedSleeperLeague`, the only place that knows those rows changed, holds
   `connection.externalLeagueId` and has **no AF league id in scope at all**.
3. `League.platformLeagueId` has **no standalone index** — only
   `@@unique([userId, platform, platformLeagueId, season])`, which a lookup by platform id alone
   cannot use as a left prefix.

So keying on our UUID would turn every invalidation into an unindexed scan of `League`, on a path
that runs once per league per sync. Keying on the provider's id — the same id the cached data is
keyed on — makes it a bounded prefix delete with no lookup at all.

⚠ **THE SEASON IS IN THE KEY TOO.** The platform id alone is not unique across seasons, and the
board carries the league's display name from the AF row; without the season, two AF leagues sharing
a platform id would collide and one would render the other's name.

⚠ **`scopeKey` NOW TERMINATES EVERY FIELD WITH `&`, AND THAT IS LOAD-BEARING.** The sweep is a
prefix match on `…l=<id>&`. Without the terminator, invalidating `lg1` also sweeps `lg10`. Two tests
pin this — one on the ordering, one on the terminator — because a reordering would fail nothing else:
the sweep would simply stop matching and boards would serve stale with nothing red.

### On "migrate the read and wire the writer together"

That rule is about a surface pointed at a table **nothing refreshes** — the `ingestCFBDStats` /
`DevyPlayer` failure. It is structurally impossible here, because the summary is read-through: a
missing or invalidated entry costs one rebuild on the next read, never a blank board. **The TTL is
the correctness bound; the invalidation is a latency optimisation.** It swallows its own failures and
can never fail the sync above it, which has already done the real work.

⚠ **IT RUNS EVEN WHEN `ensureMatchupsCached` REJECTED**, deliberately: that call deletes stale weeks
*before* refetching them, so a partial failure still leaves the table changed. Skipping the sweep on
error is how a cached board survives pointing at rows that no longer exist. A mutation control pins
this branch specifically.

### What the sync's own tests did not cover

🛑 **A POSITIVE CONTROL FOUND THAT `sleeper-sync-collector` AND `sleeper-sync-integration` NEVER
REACH THIS CALL SITE.** Throwing unconditionally from `invalidateLeagueStandings` left both suites
completely green — so their pass said nothing whatever about the wiring. `sync-invalidates-standings`
was written against the `sync-league-gone` harness, which drives the real `syncConnectedLeague`
rather than a helper, and it is mutation-controlled three ways: passing a UUID instead of the
provider id, removing the call, and moving it into the success-only path.

## The freshness chip

`components/sports-os/FreshnessChip.tsx` — point 9's visible half. The envelope makes it
structurally impossible for a loader to hand a screen a cached value without its age; the chip makes
that age impossible for the *reader* to miss. Carrying `fetchedAt` all the way to a component that
then ignores it would be the whole point thrown away one step from the finish.

Rendered in the `/core/standings` header, on **both** branches. ⚠ **The refusal branch is labelled
too, and that is not decoration**: an `available: false` board is cached exactly like an available
one, so "we could not read this league's results" can itself be minutes old, and a reader who has
just fixed the cause needs to see that rather than assume the refusal is live.

**Three states, not two.** `fresh`, `stale` (past TTL, a refresh is expected) and `last-known` (a
refresh already **failed**). Collapsing the last two would hide the only one a reader can act on —
and `last-known` warns even when the value is young, because it does not mean "slightly old".

🛑 **A RELATIVE TIMESTAMP RENDERED ON THE SERVER IS WRONG TWICE, AND THIS IS THE DESIGN THAT AVOIDS
BOTH.** It freezes — the server writes "just now" into the HTML and it stays there for as long as
the tab is open, which is a confident lie about the one thing the component exists to report. And
recomputing it during hydration is a mismatch; `Standings.tsx` already carries a note about pinning
a number locale for exactly this reason. So the **server** computes the first label and passes it as
a prop, first paint renders that prop (hydration is byte-identical by construction), and only after
mount does an effect start recomputing on a 30s tick. The machine-readable instant rides along in
`<time dateTime>` so precision is available without printing a locale-formatted string.

⚠ **NO ENVELOPE MEANS NO CHIP.** At 10% rollout most readers still take the direct call, which has
no envelope. `freshness={null}` renders nothing — never a chip reading "unknown", which would claim
uncertainty about a value that was just computed.

⚠ `FreshnessMeta` exists so the chip takes the freshness fields **without** the payload. A `Fresh<T>`
prop would serialize the entire computed standings board across the server/client boundary just to
render "4m ago".

## The relay consumer

`lib/sports-os/reactionConsumer.ts`, registered in `/api/cron/decision-os-activity-ingest` beside
the audit-feed and intelligence-snapshot consumers. That is the relay that **actually runs** — it is
in `cron-schedule.json` as `?relayOnly=1`. This is what makes "an importer emits one event and knows
nothing about what happens next" true in production rather than on paper.

🛑 **IT MUST NEVER THROW, AND THAT IS A HARDER RULE HERE THAN ANYWHERE ELSE IN THIS LAYER.** The
relay's contract is explicit: a consumer that throws fails the **whole event**, which is retried and
then **dead-lettered**. So a cache invalidation that could not reach Postgres would permanently
destroy a real domain event's delivery — *and take the audit feed and intelligence snapshots with
it*, because they consume the same event. A reaction is a latency optimisation; it is not allowed to
cost a fact.

⚠ **THE TWO HALVES ARE SEPARATE FLAGS**, because their risk profiles are not comparable.
`sports-os.reaction-invalidation` (10%) is a memory delete plus a league-bounded prefix delete whose
worst case is one extra rebuild. `sports-os.ingest-reactions` (**0%**) enqueues jobs, multiplying
load on a worker that is one JavaScript thread. One flag covering both would price the cheap half at
the expensive half's risk. Both bucket on **leagueId**, so a league is wholly in or out — per-user
bucketing would give one league's members different behaviour for the same event.

⚠ **A SCREEN OWNS ITS OWN EVENT→CACHE-KEY MAPPING** (`leagueKeyForEvent`). A `DomainEvent` carries
canonical ids by contract, so its `leagueId` is our UUID — while the standings cache is keyed on the
**provider's** id. Without the hook the sweep would build a prefix from the wrong id, match nothing,
and leave every board stale with nothing red. Note the asymmetry that makes this cheap: here we hold
the primary key, so it is one `findUnique`; the sync going the other way has no index at all.

### Two job types were removed rather than wired

🛑 **THE REACTION TABLE ONCE PLANNED `ai:digest` AND A NOTIFICATION DISPATCH. NEITHER IS REAL, AND
BOTH WERE CHECKED AGAINST THEIR WORKERS RATHER THAN ASSUMED:**

- `lib/workers/ai-worker.ts`'s `digest` branch is an acknowledged **placeholder** — it logs and
  returns ok, doing no work. Enqueuing it costs a Redis round trip and emits a log line that makes
  the system look like it is reacting while nothing happens. **That is the
  surface-pointed-at-a-table-nothing-refreshes failure in job form.**
- `notification_fanout` **throws** without `payload.notification` (a full `NotificationJobPayload`
  with userIds and a title). A generic reaction cannot know who to notify — only the trade or waiver
  handler can — so routing there would enqueue a guaranteed-failing job.

So `ReactionJob['queue']` is narrowed to `'league_engine'` and its `kind` to `LeagueEngineJobKind`.
Widening it is a deliberate edit that must come **with** a handler that does the work, and the
`Record` over the union in the consumer makes the compiler insist on a mapping.

## Budget instrumentation

Two sites, which is all it took to make point 1 measured rather than declared.

**The shell** — `app/core/[[...screen]]/page.tsx`, beside the existing `recordRootDuration`.
`af.shell_ms` says how long; `af.budget.shell_verdict` says whether that was acceptable for **this
screen on this device**, which is the question a dashboard actually gets asked. The device is read
from headers here because the shell budget is device-scaled.

**Every card** — `traceCard`, via `recordBudgetOnActiveSpan`.

🛑 **THE PER-CARD VERDICT GOES ON THE CARD'S OWN SPAN, NOT THE ROOT, AND THAT IS NOT A STYLE
CHOICE.** The attribute name is keyed on the *phase*, so nineteen cards writing `af.budget.card_ms`
to one root span is not nineteen measurements — it is one measurement of whichever card happened to
finish last. `recordBudget` is for phases that occur once per request (`shell`, `screen`, `db`,
`import`, `job`); `recordBudgetOnActiveSpan` is for those that repeat.

⚠ **THE WRITE MUST PRECEDE THE SPAN CLOSE.** Sentry ends the span when the promise `startSpan`'s
callback returns settles, so attaching the measurement with `.finally` and returning the *original*
promise races that close — and a late attribute write on a closed span is **silently dropped**, a
telemetry bug that leaves no trace anywhere. `traceCard` returns the derived promise instead, and a
test asserts the ordering rather than assuming it.

⚠ A rejected card read is still measured. A read that fails after nine seconds is the most
over-budget thing on the page; dropping it because it threw is how a timeout looks fast in the data.

⚠ And a verdict **decides nothing** — it never sheds a card or shortens a timeout. A performance
budget that can fail a request turns a slow page into a broken one.

## The import finally announces itself

`syncConnectedSleeperLeague` emits one `ingest.league.completed` per AllFantasy league behind the
connection. That is what closes the loop: until something emitted, the reaction path was inert no
matter how well the consumer was tested.

⚠ **OUTSIDE THE SLEEPER-ONLY BLOCK, DELIBERATELY.** `ingest.league.completed` is provider-agnostic —
an ESPN or Fantrax league's rows come from the parity collectors and its consumers care just as
much. Emitting inside that block would have quietly made the whole reaction path Sleeper-only.

⚠ **THE ENVELOPE CARRIES OUR CANONICAL ID.** The sync scope holds only the provider's, so it resolves
through `resolveLeagueIdsForConnection` — the same helper the sync store already uses on every
scope, with the same query shape `setLastSuccessfulSyncAt` already pays on every successful run. The
consumer's rollout bucket *and* its cache-key resolver both read `leagueId`, so emitting the platform
id would bucket on a foreign id and resolve to nothing.

⚠ **THE RUN'S CLOCK IS IN THE IDEMPOTENCY KEY.** `runKey` is `<provider>:<externalLeagueId>:<season>`
— **stable across every run** — so a key built from it alone would dedupe the second sync of a league
against the first, forever, and the reaction path would fire exactly once per league for all time.

⚠ It does **not** replace the direct `invalidateLeagueStandings` call. That is synchronous and
unconditional; the event reaches its consumer only when the relay next runs its cron, and only for
the 10% inside the rollout. The direct call is the fast path for the one screen we know about.

## Calibration: measured 2026-09-16, and the numbers stay as they are

First pass at calibrating the budgets against production Sentry (`all-fantasy`, 7 days to
2026-09-16). **The conclusion is to change nothing**, and that is a result rather than a punt.

### What the data says

Real `/core` document renders (`af.surface:core af.nav:document`), span duration:

| device | n | p50 | p75 | p95 | declared target / ceiling |
|---|---:|---:|---:|---:|---:|
| desktop | 149 | 316 ms | **1,117 ms** | 4,225 ms | 1,200 / 2,500 |
| mobile | 13 | 241 ms | **3,941 ms** | 16,096 ms | 1,800 / 3,750 |

**The desktop target is validated.** p75 of 1,117 ms against a declared 1,200 ms is as close as a
guess gets. That number was picked from the shape of the product and it turns out to be right.

🛑 **THE MOBILE BUDGET MUST NOT BE RAISED TO MATCH ITS p75, AND THIS IS THE WHOLE POINT OF THE
EXERCISE.** Mobile is 3.5x slower than desktop at p75 and blows its budget before any calibration.
Moving the budget to 3,941 ms would enshrine a four-second mobile page load as acceptable and make
the budget a mirror — **a check that cannot fail, in a new costume**, which is the failure this
repository has paid for repeatedly. The budget is not wrong here. Mobile is slow, and the budget
said so on day one, which is exactly what it is for.

⚠ The ceilings are exceeded at p95 on both devices. With n=149 and n=13 and a tail dominated by a
handful of very slow renders, that is not yet evidence the ceiling is mis-set rather than evidence
of a slow tail. Revisit with volume.

### How long until the rest is calibratable

🛑 **THE COUNTS ABOVE ARE ONE DAY, NOT SEVEN, AND THE FIRST VERSION OF THIS SECTION GOT IT WRONG BY
7x.** A 7-day query and a 24-hour query return **identical** counts (149 / 13 / 1), because the
`af.*` dimensions only began flowing ~2026-09-15 when the classification and sampling work landed.
Dividing 163 by seven gave "~23 renders a day" and the confident conclusion that calibration was
*months* away. Both were wrong.

⚠ **THE CONTROL THAT SETTLED IT:** a 2-hour window returns **2** spans. So `period` is honoured and
the 24h/7d identity is real data, not a stuck query. A number that does not move when you change the
window is not a measurement — check that before dividing by the window.

So the real figures are **per day**: ~163 real `/core` renders (desktop 149, mobile 13), and per
screen `home` 51, `hubs` 22, `trades` 12, `commissioner` 10, **`standings` 2**, `live` 1.

That puts per-device calibration about **a week** away (~1,000 desktop and ~90 mobile samples), and
the top three or four screens a **week or two** behind that. `standings` at ~14/week stays thin for
a while — which is worth knowing, since it is the screen this layer wired first.

Until then, **calibrate at the phase level with screens pooled**; the per-name overrides in
`budgets.ts` stay reasoned guesses and should be labelled as such rather than given false precision.

⚠ `af.screen` is `other` for 98 of ~220 core spans — the largest single bucket. Whatever is
collapsing there is worth finding before anyone trusts a per-screen split.

### 🛑 Two phases could not be calibrated at all — one is now fixed

`af.shell_ms` and `af.db.ms` are **not queryable in Sentry**. Both come back as
`INVALID — Unknown attribute`, typed as strings, while the string attributes on the very same spans
(`af.surface`, `af.screen`, `af.card`) query fine.

So every numeric attribute this layer adds — `af.budget.*_ms`, `af.budget.*_ratio` — lands in the
same hole. The **verdict** is a string and will be queryable; the raw milliseconds will not.

⚠ **THE MECHANISM IS NOT ESTABLISHED.** It could be a volume threshold before Sentry registers a
numeric attribute, a type-registration issue, or something else; this was observed, not diagnosed.

✅ **SIDESTEPPED FOR THE SHELL**: it now also emits a `core.shell` span (`recordCompletedSpan` in
`lib/observability/rootTiming.ts`), carrying `af.screen` and `af.device`. `span.duration` is a
native field and queries fine — that is how the card numbers above were obtained. The span is
created **retroactively**, back-dated to the phase start, because opening one where the phase begins
would leak on every early return between `/core`'s auth gate and its shell; a span created and
ended on one line cannot leak. It is **inactive**, so it never re-parents the `core.card` spans that
stream behind it.

⚠ **`af.db.ms` IS STILL UNCALIBRATABLE.** It has no span equivalent, and unlike the shell it is not
one phase with two clean boundaries — it is a per-request sum accumulated in `lib/prisma.ts`. Left
alone rather than guessed at.

⚠ And the fix does not prove the diagnosis. It routes around an unexplained Sentry behaviour; if the
numeric attributes start aggregating later, that is worth knowing rather than assuming this was why.

### The queries, so this is repeatable

```
# per-card, the shape that works (span.duration is native, af.* numerics are not)
dataset=spans  query="span.op:core.card"
fields=[af.card, count(), p75(span.duration), p95(span.duration)]

# per-device core renders, real navigations only
dataset=spans  query="af.surface:core af.nav:document"
fields=[af.device, count(), p50/p75/p95(span.duration)]

# once the budget verdicts land in production (string, so queryable)
dataset=spans  query="af.budget.shell_verdict:over"
```

⚠ And note the card table is **not** usable yet either: 19 cards, 18 of them with `count() == 1` —
about 21 spans, in a day. A p95 from one sample is that sample.

⚠ **AND 21 CARD SPANS AGAINST 51 `home` RENDERS IS ITSELF ODD**, since a home render fans out to
~19 card reads and `traceCard` opens a span for each whenever the parent is sampled. Roughly 970
would be expected. Recorded as an open question rather than explained — it is the sort of gap that
means a dimension is quietly not being captured.

## The second surface: `/core/week`

`lib/core-app/weekAllSummary.ts`, on the same flag and the same bucket subject as standings — so a
user is wholly on summaries or wholly off, rather than reading a cached standings board beside a
live week board.

It pays better than standings did. `getWeekAll` reads every `WeeklyMatchup` row across **all** the
user's played leagues, and it runs twice on a hot path: as the `week` card on the `/core` home (the
busiest screen, ~51 renders/day) and as the `/core/week` board. Standings is one league at ~2
renders/day.

🛑 **IT IS USER-SCOPED, AND THAT CHANGES WHAT INVALIDATION CAN DO.** Standings is keyed on one
league, so `invalidateScreenForLeague` sweeps it with a bounded prefix. This board spans every
league the user plays, so its key carries a userId and **no league id at all** — while the sweep is
a prefix match on `l=<leagueId>&`.

So **`invalidatedBy` is deliberately empty**, and a test asserts that. Listing the score and import
events would *look* like event-driven invalidation and be a silent no-op: `planReactions` would name
`week`, the consumer would build a prefix from the event's league id, and it would match nothing.
**An invalidation that cannot fire is worse than one that is absent**, because the absent one is
visible in the file. The TTL is the whole correctness bound here.

⚠ If this ever needs to be event-driven, the fix is **not** to add events to that list. It is either
a user-keyed sweep (needing league→members, a query the reaction path does not have) or splitting
the board per league. Both are real work.

⚠ **THE CARD STAYS INSIDE `traceCard`.** A cache hit should show up in the trace as a fast card, not
vanish from it — measuring the cheap path is the point.

### `toPlayedLeagues`, and the generic that broke 40 things

The played-leagues rule (drop `hasUnifiedRecord: false` AF Legacy rows, sort by name) lived inline
in the page. A second caller needed it, so it moved to `lib/core-app/playedLeagues.ts` rather than
being copied — two implementations of one rule is the failure this repo already paid for with the
SQL copy of `normalizePlayerName`.

🛑 **THE FIRST VERSION CONSTRAINED `T extends PlayableLeague`, WHICH LOOKED STRICTER AND WAS STRICTLY
WORSE.** The page's league rows and `DashboardLeagueListPayload.leagues` (typed `unknown[]`) do not
both satisfy that constraint, so inference collapsed `T` and the return type lost every field the
callers use. **The ratchet caught it: 185 against a baseline of 143 — 40 new errors in the page.**
`T` is now unconstrained with the same internal casts the inline version used.

## The third surface: `/core/season-outlook`

`lib/core-app/seasonOutlookSummary.ts`, on the same flag and the same subject again — `/core/standings`
with no league held renders **both** the standings board and the outlook, so splitting the cohorts
would put one screen's two halves on different data paths.

**This is the one that pays for the whole layer.** `getSeasonOutlook` plays each league's remaining
schedule out ten thousand times. Its own header does the arithmetic: 63 connected leagues at ~78
remaining games each is **≈49 million simulated games on a single page load**, on a `force-dynamic`
route that pays it every visit. `TOTAL_GAME_BUDGET` stops that hitting the platform's ~300s edge
kill — and it does so by **cutting iterations**, so a heavy account silently slides from 10,000 per
league toward the 1,500 floor and `basis` reports the reduced number.

So the cost is not only latency, it is answer quality, and a cache hit serves the **full-iteration**
board a cold load might not have been able to afford.

🛑 **CACHING CANNOT CHANGE WHAT THIS PAGE SAYS, ONLY HOW LONG IT TAKES TO SAY IT.** The model is
seeded, not random: `createRng` is a mulberry32 fed from a hash of the platform league id, with no
clock and no `Math.random()` anywhere in it. Identical rows produce a byte-identical board. Worth
stating because a reader who assumes Monte Carlo means jitter would go looking for a
"cached numbers differ from a fresh run" failure mode that does not exist here.

🛑 **`focusLeagueId` IS PART OF THE KEY, AND OMITTING IT WOULD DROP A CARD SILENTLY.** The third
argument is additive — it guarantees the focused league gets its branch simulations even when it is
not among the eight most contested. A focused board is therefore a **superset**, and the two are not
interchangeable in the direction that matters: serving a focused read a board built cross-league
leaves that league's swing card missing, with no error and no empty state. The scope is
`{ userId, leagueId: focusLeagueId }`, and a test asserts three separate build calls across
`null`/`l1`/`l2` plus a hit on the repeat.

⚠ **`invalidatedBy` IS EMPTY AGAIN, FOR A SHARPER REASON THAN `weekAllSummary`'s.** The week board's
key carries no league id, so a prefix sweep could not match it. Here **half the keys do** — every
focused scope — so a sweep *would* fire, and that is the problem. It would drop the focused board and
leave the cross-league one standing, so `/core/standings` with a league held and without one would
print different playoff percentages for the same team until the TTL caught up. That is precisely the
"two surfaces, two different answers to *where do I sit*" failure `seasonOutlook.ts` exists to
prevent, reintroduced through the cache instead of through the model. Both scopes expiring together
is the consistent behaviour.

⚠ **THE STALE WINDOW IS AN HOUR, MUCH LONGER THAN THE OTHER TWO.** Stale-while-revalidate is worth
most exactly where a rebuild is most expensive. The 10-minute TTL is set against the rows underneath
rather than against user patience: `ensureMatchupsCached` only refetches once its rows are older than
~30 minutes, so a shorter TTL would re-run 49 million simulated games to reproduce the previous
answer exactly — which the determinism above guarantees it would.

## The fourth surface: `/core/career?view=records` — and two candidates REJECTED

`lib/core-app/careerRecordsSummary.ts`. `getCareerRecords` reads **every played roster-week this
account has ever had**, across every league it has ever imported; `page.tsx` already gates it behind
`?view=records` because "no other tab needs it".

🛑 **IT HAS ZERO CLOCK REFERENCES, AND THAT IS THE WHOLE REASON IT QUALIFIES.** `careerRecords.ts`
contains no `new Date()` and no `Date.now()` anywhere, so a career record changes when a week
FINALIZES and never with the passage of time. Staleness costs a newly-set personal best appearing
late — not a number that drifts while you look at it. Hence a **30-minute TTL and a 2-hour stale
window**, where the week board runs 2 minutes and 10. A test asserts both the absence of the clock
and the floor on the TTL, so the next session cannot copy this TTL onto a surface that cannot bear
it.

### ⚠ `home` / `dash34` — this section said DISQUALIFIED, and that was too strong. **CORRECTED 2026-09-16.**

🛑 **IT WAS DONE, BY SOMEONE ELSE, AND IT WORKS.** `lib/core-app/homePortfolioSummary.ts` (`b439f4b4`,
2026-09-16) caches the home on **this layer** — `registerScreenSummary`, `readThrough`,
`sportsDataCacheTier`, not a parallel one. The reasoning below is still right about what breaks; what
it got wrong was treating it as the end of the argument. There was a third option this document did
not consider:

| option | verdict |
|---|---|
| cache the rendered clock-relative text | wrong — the stale countdown described below |
| do not cache at all | what this document concluded |
| **store the INSTANTS, recompute the text at read time** | **what actually works** |

That module stores the instants, recomputes the countdown and every "reported 30 min ago" on every
read, and additionally invalidates once a counted-down kickoff has passed. Keep the analysis below —
it is why the naive version fails — but read it as *how* to cache the home, not as *do not*.

⚠ **AND IT CLOSED THE INVALIDATION GAP THIS DOCUMENT CALLS UNAVOIDABLE.** Several summaries here say
a user-scoped key cannot be swept by league and that the fix "needs league→members and is real work".
`portfolioFingerprint` does it without any of that: hash every field the joins read from the league
list, `lastSyncedAt` included, and a new import, a removed league or a finished sync changes the hash,
so the next render rebuilds. No writer has to remember anything and no event has to be plumbed.
**That is strictly better than a TTL for that gap**, and both `careerSummary` and
`tradesBoardSummary` should adopt it — see the sixth surface for why they have not yet.

The original note follows, and remains accurate about the failure mode:

`getDash34Data(userId, leagues, now)` takes a clock and **renders it into the payload**: `countdown`
is `formatCountdown(nextGame.startTime − now)`, `next24` is a window ending at `now + 24h`,
`reportedAgo` is `formatAgo(now − reportedAt)`, and the injury-staleness filter compares against
`now`. A summary over it would serve a countdown reading "12 minutes" when the game kicks off in two,
and keep already-started games in `firstLock`.

`dash34.ts` had already solved its caching at the right granularity, and its own comment states the
rule a summary would have broken: *"THE CLOCK INSIDE THE CACHED READ IS ITS OWN. `now` cannot be part
of the cache key — a millisecond timestamp would defeat the cache — so each query filters on its own
`new Date()` and the wrapper re-filters against the caller's `now`, dropping games that started
inside the revalidation window."* It caches the three shared, user-independent queries through
`unstable_cache` and deliberately leaves the user-scoped reads and the assembly uncached.

**The rule that generalises: a summary may cache a payload derived from rows, never one with a clock
rendered into it. Check for `now` in the signature before reaching for this layer.**

### ⚠ `rankings` is expensive but the wrong SHAPE

`getRankingsData` has no clock either, but it blends a global read — `loadRankedProfiles`, an
**uncached** `$queryRaw` over every ranked manager on the product, run on every request to three
views — with per-viewer fields (`you`, `reconciliation`, `scope`). Caching the blend per user would
store one copy of the entire ladder **per viewer**. That global scan is a real cost and worth fixing,
but it is a shared-read problem whose fix is a shared cache around `loadRankedProfiles`, not this
layer. Recorded so the next session does not mistake *expensive* for *summary-shaped*.

## The fifth surface: `/core/career` — and the first scope field added since

`lib/core-app/careerSummary.ts`. This one COMPLETES a screen rather than starting one:
`?view=records` already read through `careerRecordsSummary`, and this is the default view beside it.

`getCareerData` derives the trophy room from everything the account has imported, reading **two**
sources because neither alone is correct — `legacy_leagues` + `legacy_rosters` carry the rich
per-season detail but are Sleeper-only, while `leagues.import_*` is the only source that knows which
platform a season came from.

🛑 **ZERO CLOCK REFERENCES — the check this layer now runs FIRST.** `career.ts` has no `new Date()`
and no `Date.now()`. A career season is settled history: it changes when an **import** runs, not when
time passes. This is the rule that disqualified `home`/`dash34`, applied as an entry criterion rather
than discovered late: *a summary may cache a payload derived from rows, never one with a clock
rendered into it.*

### `?platform=` is part of the key, and the case-fold must agree

Two filters are two different boards, so they must not share an entry — the same reason
`focusLeagueId` is part of the season-outlook key. That needed a new `platform` field on
`SummaryScope`.

⚠ **THE NORMALISATION HAS TO AGREE WITH THE BUILDER'S, NOT MERELY EXIST.** `getCareerData` folds its
argument with `.trim().toLowerCase() || null`, and `scopeKey` folds `platform` the same way. If only
one of them folded, `?platform=Sleeper` and `?platform=sleeper` would share one cache entry while
being computed as two different reads — **a key and its payload disagreeing, with no symptom until
someone switches the dropdown and sees the wrong board.** The fold happens ONCE, in
`readCareerSummary`, and that single value goes to both the scope and the builder. A mutation control
pins it from both ends.

🛑 **ADDING A SCOPE FIELD IS A CACHE-WIDE CHANGE, AND THE SAFETY IS ONE LINE OF `push`.** `scopeKey`'s
`push` skips a null/undefined value entirely, so a screen that never sets `platform` emits the
byte-identical key it emitted before the field existed — which is what let this be added without
invalidating the four summaries already live on `main`. `push('pf', …)` is appended LAST for the same
reason. A test asserts the exact key strings for the no-platform cases, and a mutation that makes
`pf=` always emit turns it red.

### ⚠ Its TTL is FIVE MINUTES, and that is the invalidation gap talking, not the data

On volatility alone this could sit for hours — longer than any other summary here. It does not,
because a user-scoped key carries no league id and so cannot be swept by league (`weekAllSummary`'s
problem). The TTL is therefore the **only** thing that makes a newly imported league appear — and an
import is exactly when someone opens this screen. Five minutes still collapses the repeated loads of
one browsing session, which is where the seven prisma reads and the two-source merge actually hurt.

A test pins the TTL at or below five minutes, so a later "the data would allow hours" optimisation
fails rather than silently hiding fresh imports.

## The sixth surface: `/core/trades` — and the first to use `period`

`lib/core-app/tradesBoardSummary.ts`. `getTradesBoard` reads every claimed team the account has, then
every `LeagueTrade` history row behind them, and re-orients each trade against the reader.

🛑 **Clock check first, as an entry criterion.** `tradesBoard.ts` has no `new Date()` and no
`Date.now()`, and `getTradesBoard(userId, currentWeek)` takes no `now` — the week arrives as a plain
**number** the caller already resolved. That is an identifier for which slate the board is about, not
a clock, and it belongs in the key.

**`SummaryScope.period` already existed for this** ("a week for NFL, a gameday elsewhere") and was
unused until now, so unlike career this needed **no new scope field** — which mattered, see below.

⚠ **`build` TAKES THE WEEK OFF THE SCOPE, NEVER RE-RESOLVES IT.** Re-resolving could return a
different week than the key was built from, filing one week's board under another week's key. A
mutation hardcoding the week in `build` turns three tests red.

⚠ **`null` (no week context) IS ITS OWN SCOPE.** `resolveCurrentWeek` returns null when no league has
a `WeeklyMatchup` row to resolve from, and `getTradesBoard` treats that as a real board rather than an
error. Folding it to `0` would serve a no-context board to a week that has one; a mutation doing
exactly that is red.

### 🛑 Why it uses a TTL when the fingerprint is the better tool

Trades appear when a sync imports them — the same invalidation gap career has, and the fingerprint
above solves it properly. It was not adopted here **purely for sequencing**: the fingerprint wants to
be part of the cache key, `SummaryScope` has no field for it, and when this was written the fifth
surface's change to `lib/sports-os/summaries.ts` (adding `platform`) was still unmerged — a second
concurrent edit to the one module every summary depends on would have put two branches of the same
author in conflict over it.

⚠ **THAT BLOCKER IS NOW GONE:** the fifth surface landed, so the next change to `SummaryScope` is
free to be the fingerprint's.

So the TTL is the interim bound and **the fingerprint is the named follow-up for both `careerSummary`
and `tradesBoardSummary`**, recorded here rather than left to be rediscovered.

## The seventh surface: `/core/waivers` — the simplest key, and the tightest TTL

`lib/core-app/waiversBoardSummary.ts`. `getWaiversBoard(userId)` reads every claimed team the account
has and the waiver state behind each, across every league.

🛑 **Clock check first.** `waiversBoard.ts` has no `new Date()` and no `Date.now()`, and the function
takes no `now`.

⚠ **WAIVERS ARE THE MOST CLOCK-ADJACENT SCREEN TO PASS THAT CHECK, so the reasoning is worth
stating.** A waiver has a processing time and the reader is often looking precisely because a
deadline is near — but the deadline is a **stored instant** on the league's settings, not something
this function renders against `now`. It derives no countdown and no "closes in 2 hours" string. That
is the distinction this layer now turns on, and it is the same one `homePortfolioSummary` exploits
from the other side: **a stored instant is data; a rendered countdown is not.**

**`{ userId }` and nothing else** — the only summary here with no second key dimension. Worth noting
only because the previous three each had one (a focus league, a platform filter, a week) and each
needed a test pinning it.

### ⚠ Its TTL is 2 minutes — the shortest of the user-scoped boards, and not for symmetry

The other user-scoped boards sit at five: a trade or an import landing a few minutes late costs
nothing. **This is the one screen where staleness could change what a reader DOES rather than only
what they read** — they are usually checking against a deadline and deciding whether to bid. A test
pins it at or below two minutes so a later "harmonise the TTLs" pass fails rather than quietly
lengthening it.

## The fingerprint: three TTLs replaced by one precise trigger

`SummaryScope.fingerprint`, adopted by `careerSummary`, `tradesBoardSummary` and
`waiversBoardSummary`. The mechanism is `portfolioFingerprint` from the peer's
`lib/core-app/homePortfolioSummary.ts` — a digest of every field the joins read from the league list,
`lastSyncedAt` included.

**What it fixes.** Three summaries here carried a note saying a user-scoped key cannot be swept by
league (`invalidateScreenForLeague` matches an `l=<leagueId>&` prefix; their keys have no league id),
so `invalidatedBy` on them is a documented no-op and the TTL carried the whole correctness. That
meant **guessing how long a user would tolerate not seeing a league they had just imported** — and
an import is exactly when someone opens these screens. A sync now moves `lastSyncedAt`, the digest
changes, the key changes, and the next read is a miss that rebuilds. No writer remembers anything and
no event is plumbed.

### ⚠ So two of the three TTLs went UP, and that is the result, not a side effect

| summary | TTL before | after | why |
|---|---:|---:|---|
| career | 5 min | **30 min** | 5 was standing in for invalidation; the digest does that now |
| trades | 5 min | **30 min** | same |
| **waivers** | 2 min | **2 min** | **unchanged — see below** |

The two tests that pinned career's and trades' TTLs *short* are now **inverted**: they assert the TTL
is no longer short. That is deliberate. Those pins protected a property the fingerprint provides
better, so restoring a five-minute TTL alongside the digest would be cost without the reason — and a
mutation doing exactly that turns them red.

🛑 **WAIVERS KEPT ITS 2 MINUTES, AND THE REASON IS THE INTERESTING ONE.** Career's and trades' short
TTLs were proxies for invalidation. Waivers' is not: **a waiver claim changes without the league list
changing at all** — another manager places a bid and nothing about the league row moves — so the
digest cannot see it. The two mechanisms are complementary there, not redundant, and a test asserts
both halves: the digest still rebuilds it when a sync *does* move the list, and the TTL stays short
for what the digest cannot reach.

### ⚠ Keyed, not stored — a deliberate divergence from `homePortfolioSummary`

That module stores the digest beside the payload and compares on read, forcing a refresh on a
mismatch. Both work. Keying is chosen here because it needs no change to the stored shape or the read
path, and because it gives a changed portfolio a genuinely **cold** build —
stale-while-revalidate must not serve a pre-import board to the person who just imported. The cost is
a superseded key lingering unread until its own TTL, which is bounded and cheap.

⚠ **THE DIGEST MUST COVER AT LEAST WHAT THE BUILDER READS.** These pass the **unfiltered** league
list, not `toPlayedLeagues`: `getCareerData` reads `legacy_leagues`, and a legacy row is exactly what
that filter drops. A digest over MORE than the builder uses costs an extra rebuild — the safe
direction. One over less serves stale silently.

⚠ **AND FOR CAREER IT IS A PROXY, NOT AN EXACT INPUT.** `getCareerData` resolves its own leagues from
`LeagueTeam.claimedByUserId` rather than from the dashboard list, so the digest is not literally its
input the way it is for the home's joins. It changes whenever a league is added, removed or synced —
which is when this board changes — and the TTL remains the backstop for anything it misses. Stated
because "the fingerprint is exactly their input" is true of `homePortfolioSummary` and not of this.

## The eighth surface: `/core/portfolio` — and the first summary that stops HALF WAY on purpose

The league inventory: "what do I have", as against home's "what needs me now". It passes the clock
check — `portfolio.ts` has no `new Date()` and no `Date.now()`, and neither do the screen's two side
panels — for the same reason `career` did: an inventory changes when an import runs, not when time
passes.

### ⚠ Its cost is a SERIAL FAN-OUT, which is a new shape on this layer

Every summary before it paid a fixed handful of wide reads. `getPortfolio` pays a per-league trip:

1. one `leagueTeam.findMany` for the claimed teams,
2. one `leagueTeam.groupBy` for the team counts,
3. **and then `findRosterForTeam` once per claimed team, inside a sequential `for` loop** — each a
   `$queryRaw`, each awaited before the next begins.

An eight-league account therefore pays ten round trips that do not overlap, and the cost grows with
exactly the people who use the screen most. That is why a screen returning a short list is worth
caching.

⚠ **AND THE LOOP IS NOT A BUG TO FIX ON THE WAY PAST.** `findRosterForTeam` tries the durable
`source_manager_id` before the direct column — the reason it reaches 96 of 98 claimed teams where the
naive join reached 13 — and batching it is a real change to a predicate `myTeam.ts` and
`playerImpact.ts` share with it deliberately. Caching the result does not touch it.

### 🛑 Only ONE of the screen's three loaders is summarised, and the boundary is FORCED

The screen loads three things in one `Promise.all`. Only the first is on the summary layer:

| loader | inputs | summarisable |
|---|---|---|
| `getPortfolio(userId)` | the userId | ✅ buildable from the scope |
| `getCrossLeagueExposure(userId, leagueIds, 12)` | the league ID **list** | ❌ |
| `getCrossLeagueValueActions(userId, leagueRows, 12)` | league **rows** | ❌ |

`ScreenSummaryDefinition.build` takes `(scope: SummaryScope)` and nothing else, and a scope holds
short scalars — `scopeKey` drops any value over 64 characters. A league list cannot go in one, so the
two panels cannot be rebuilt on a miss.

⚠ **AND THE OBVIOUS WORKAROUND IS THE BUG.** Having `build` re-derive the league list itself would
compile, pass every test, and be wrong: the fingerprint in the KEY comes from the page's list, so a
builder resolving its own could file one portfolio's panels under another portfolio's key. That is
precisely the failure `tradesBoardSummary` pins a test against for the week — **the builder must take
what was keyed, never re-resolve it.**

So the screen gets faster, not free, and that is recorded rather than quietly rounded up. Widening
`build` to accept caller-held inputs is a change to the module every summary depends on, and belongs
in its own change with the key/payload agreement worked out first.

### Its TTL is 30 minutes, and that is the fingerprint talking rather than a copy

Matching career's and trades', and arrived at the same way. An inventory changes on import, and the
digest sees an import: a new league, a removed one or a finished sync moves the list, the key
changes, the next read rebuilds cold.

🛑 **IT IS NOT SHORT FOR WAIVERS' REASON, AND THAT IS THE DISTINCTION TO KEEP.** Waivers stays at two
minutes because a claim changes with *nothing about the league list moving*, so its digest cannot see
it. Nothing on this screen has that property — every field here derives from rows a sync writes, and
a sync moves `lastSyncedAt`. The digest genuinely covers this board rather than proxying it, which is
a stronger claim than the one `career` can make about itself.

### ⚠ `portfolioOnSummary` was already taken, by a different portfolio

Worth one line because it surfaced as a compile error and could just as easily have been a silent
shadow. `app/core/[[...screen]]/page.tsx` already had a `portfolioOnSummary` — the **home's**
portfolio card, from the peer's `homePortfolioSummary.ts`. This screen's flag is
`portfolioScreenOnSummary`. Two unrelated surfaces are both reasonably called "portfolio"; only the
fact that both are `const` in one function scope turned the collision into `TS2451` rather than into
a flag silently reading the wrong bucket.


## What is not done

Each of these is a separate decision with a real cost.

1. ~~No screen has a registered summary.~~ **Done** — standings, week, season-outlook, career and
   career records. **Five of nineteen.** `home` and `rankings` were examined and **rejected**, each
   for its own reason — see the fourth surface. The open lead is still not another screen: it is the
   uncached global `loadRankedProfiles` scan, which wants a shared cache rather than a summary.
2. ~~No durable cache tier is wired.~~ **Done** — `lib/sports-os/durableTier.ts` over
   `SportsDataCache`, used by the standings summary.
3. ~~No consumer calls `dispatchReactions`.~~ **Done** — see *The relay consumer* below.
4. ~~No ingestion path emits the new `ingest.*` events.~~ **Partly done** — the collector sync emits
   `ingest.league.completed` for every provider. The other six `ingest.*` types still have no
   producer.
5. **The budgets are mostly still targets — but the desktop `screen` target is now measured.** See
   *Calibration* above: desktop p75 is 1,117 ms against a declared 1,200 ms. At ~163 `/core` renders
   a day the rest is roughly a week away per-device and a few weeks per-screen. Two phases (`shell`,
   `db`) cannot be calibrated at all until their durations are queryable; `shell` now emits a `core.shell` span and
   is calibratable, `db` still is not.
6. ~~`recordBudget` has no callers.~~ **Done** — see *Budget instrumentation* below.
7. **The card verdict is device-neutral.** `traceCard` has no request headers in scope, so it uses
   the `unknown` multiplier. `af.budget.card_ms` is exact and the root span's `af.device` allows the
   split in Sentry; threading a device through all nineteen call sites is the fix when the verdict
   itself needs to be per-device.
7. ~~The standings screen does not render its freshness.~~ **Done** — see *The freshness chip* below.
