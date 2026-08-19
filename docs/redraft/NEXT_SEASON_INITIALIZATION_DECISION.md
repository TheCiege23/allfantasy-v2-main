# Draft, Schedule, and Playoff Initialization Decision

## Decision matrix

| Domain | Synchronous | Deferred work item | Separate action | Beta decision | Evidence |
|---|---:|---:|---:|---|---|
| Draft | No | Yes | Yes | **Separate commissioner action**, with a durable transactional request event | No renewal fixture observed this program has draft order or keeper decisions resolved at renewal time (keeper handling is not implemented anywhere in the audited renewal system); forcing synchronous draft creation would require inventing draft-order/keeper policy this phase has no authority or evidence to decide. |
| Schedule | No | Yes | Yes | **Separate commissioner action**, with a durable transactional request event | Real NCAAF fixture (`totalWeeks: 17`, `playoffStartWeek: 15`) differs from real NFL fixtures — schedule generation must account for sport-specific calendar/week-count differences that this phase's scope explicitly forbids redesigning (Schedule Runtime is a separate, larger subsystem). |
| Playoffs | No | Yes | Yes | **Separate commissioner action**, with a durable transactional request event | Playoff bracket structure depends on final regular-season standings, which do not exist yet for a freshly-created destination season (all rosters start at 0-0-0) — bracket materialization is inherently a later-season operation, not a renewal-time one; only *configuration* (format, seed count) could theoretically be copied, but no such per-season configuration field was found on `RedraftSeason` distinct from `League.settings` (already snapshotted). |

## Why not synchronous for any of the three

Each would require either (a) inventing new business logic this phase has no product authority to decide (keeper/draft-order policy, sport-specific schedule generation, playoff seeding), or (b) reaching into a separate, substantially larger subsystem (Draft OS, Schedule Runtime, Playoff Engine) that this phase's explicit guardrail forbids redesigning. Building any of the three synchronously would violate "do not broaden the phase into unrelated league-management work."

## Why not silently absent either

Per Part 11's explicit requirement ("do not leave 'deferred' as undocumented absence"), each domain now has **durable, transactional evidence** that initialization was requested: `EVENT.NEXT_SEASON_DRAFT_INITIALIZATION_REQUESTED`, `EVENT.NEXT_SEASON_SCHEDULE_INITIALIZATION_REQUESTED`, `EVENT.NEXT_SEASON_PLAYOFF_INITIALIZATION_REQUESTED` — all three added to the event catalog, all three emitted transactionally inside the same `createNextSeason` transaction (immediately after `NEXT_SEASON_CREATED`), each idempotent by its own deterministic key (`draft-init-requested:<destinationSeasonId>`, etc.), each referencing the real, committed destination season id. The API result's `limitations` array now uses the exact machine-readable tokens the brief specified (`SCHEDULE_INITIALIZATION_REQUIRES_COMMISSIONER_ACTION`, etc.) alongside a human-readable explanation, rather than a vague prose-only disclaimer.

## What consumes these events

**Nothing yet** — no downstream consumer (a commissioner-facing "pending initialization" UI, a background job, or a notification) was built this phase. The events are real, transactionally durable, and idempotent, but currently sit in the outbox unconsumed. This is the honest, disclosed state: the *intent* is durably recorded; the *fulfillment* is not yet built.
