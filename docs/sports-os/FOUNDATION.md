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
| 1 | Performance budgets | `lib/sports-os/budgets.ts`, `budgetTelemetry.ts` | **new** |
| 2 | Render the shell immediately | `app/core/[[...screen]]/page.tsx` — `af.shell_ms` | already built |
| 3 | Stream cards independently | same page + `lib/observability/cardTelemetry.ts` | already built |
| 4 | Screen-ready summaries | `lib/sports-os/summaries.ts` | **new** — registry, no screens registered yet |
| 5 | Layered caching | `lib/sports-os/layeredCache.ts` | **new** |
| 6 | Heavy work in jobs | `lib/jobs/`, `lib/queues/bullmq.ts` | already built — reached from `reactions.ts` |
| 7 | One event system | `lib/events/` | already built — the **reaction table** is new |
| 8 | End-to-end observability | `lib/observability/`, `docs/observability/TRACING.md` | already built — budget verdicts are new |
| 9 | Last-known data | `lib/sports-os/freshness.ts` | **new** |
| 10 | Gradual rollout | `lib/sports-os/rollout.ts` | **new** |

🛑 **NOTHING IN THIS LAYER IS WIRED INTO A REQUEST PATH YET.** It is a foundation with tests and no
callers. That is a deliberate stopping point, not an oversight — see *What is not done* at the end,
which names every remaining step and why each is a separate decision.

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

`__tests__/sports-os/` — 55 tests, no database, no queue, no network.

⚠ **FOUR OF THE KEY ASSERTIONS WERE MUTATION-TESTED**, because a green check that has never gone red
is not evidence. Injecting each of these turns the named suite red: giving `db` a device multiplier;
dropping the per-flag salt from the rollout bucket; re-stamping `fetchedAt` when promoting a cache
entry between tiers; making `combineFreshness` take the newest timestamp instead of the oldest.

⚠ **AND THE FIRST ATTEMPT AT THE `fetchedAt` CONTROL STAYED GREEN**, which is worth recording: the
scenario let the promoted entry fall out of memory before the second read, so the mutation was
masked and the test proved nothing. The entry has to still be *in* memory and *past its TTL* at the
moment it is read again. A control has to be derived from the implementation's real failure mode,
not from the one it was written for.

⚠ Note that **no test file in this repo is typechecked** — `tsconfig.json` excludes `__tests__`
repo-wide, and `next.config.js` sets `typescript.ignoreBuildErrors: true`. A mock can contradict its
module's real contract indefinitely without anything going red. Run the suite.

## What is not done

Each of these is a separate decision with a real cost attached, which is why the layer stops here.

1. **No screen has a registered summary.** `registerScreenSummary` has no callers. Registering one
   means writing its `build`, which is a per-screen data-modelling job, and pointing the screen at
   it means moving a read — the migration CLAUDE.md says to do *together with* its writer or not at
   all.
2. **No durable cache tier is wired.** `readThrough` runs memory-only until a `DurableCacheTier` is
   passed. `sportsDataCache` is the obvious candidate; it was left uninjected so this module stays
   importable from a unit test and out of the browser bundle's type graph.
3. **No consumer calls `dispatchReactions`.** The natural site is the outbox relay
   (`lib/events/outboxRelay.ts`), and it needs `enqueue` injected from `lib/jobs/enqueue.ts`, which
   is `server-only`.
4. **No ingestion path emits the new `ingest.*` events.** The catalog entries exist and validate;
   nothing publishes them yet.
5. **The budgets are targets.** See above. They need a week of Sentry data before anyone should
   treat an `over` verdict as an incident.
6. **`recordBudget` has no callers.** The two obvious ones are the existing `af.shell_ms` site in
   `app/core/[[...screen]]/page.tsx` and `traceCard`, which would give every card a verdict for one
   line of change each.
