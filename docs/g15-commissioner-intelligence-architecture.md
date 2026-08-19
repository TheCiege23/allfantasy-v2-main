# G15 — Commissioner Intelligence Engine: Architecture Review & Roadmap

**Author:** Lead Principal Architecture review
**Date:** 2026-06-27
**Status:** Design only — no implementation code. To be split into phases G15.1–G15.6.
**Grounding:** The "Master Handoff" was not attached to the request; this review is grounded
in the **actual codebase** as audited in G13/G14 (files cited inline). Reconcile against the
handoff if/when provided.

---

## 0. Bottom line up front (the 5 decisions that matter)

1. **Do not build a new event bus from scratch.** The platform already has the primitives:
   an in-process pub/sub (`lib/league-events/realtime-store.ts`), `bullmq` + `ioredis` in
   `package.json`, `graphql-yoga`, and a job-instrumentation layer (`withSyncJobRun`,
   `cronRegistry`). Evolve these behind a single `EventBus` port; don't greenfield.
2. **Adopt CQRS-lite with a transactional outbox — not full event sourcing.** Keep the
   current state tables (`RedraftSeason`, `RedraftMatchup`, `PlayerWeeklyScore`, …) as the
   system of record. Add an append-only **domain event log** written via an **outbox** in the
   same transaction as the state mutation. Intelligence/Story are **read-model projections**
   off that log. This avoids the #1 event-driven failure mode (dual-write inconsistency) and
   avoids the cost/risk of re-sourcing the transactional core.
3. **Unify the three overlapping "event-ish" concepts into one normalized domain-event log.**
   Today there are three: ephemeral SSE notifications (`leagueRealtimeStore.publish`),
   persisted activity (`LeagueEvent` + `activityEvent`), and persisted trade-market events
   (`lib/trade-market/redraftTradeMarketEvents.ts`). These overlap and will diverge. The
   Intelligence Engine needs **one** canonical, normalized, durable event stream; the others
   become **projections/consumers** of it.
4. **Intelligence consumes normalized data; Chimmy consumes Intelligence — never raw
   providers or raw DB.** Formalize the existing deterministic-context-envelope direction into
   an `IntelligenceQueryService`. Chimmy and the AI tool registry become thin clients of it.
5. **AllFantasy is Customer #1 by dogfooding the public API contract.** The app should read
   intelligence through the *same* versioned contract external licensees will use, so the
   public API is always battle-tested and never drifts from an "internal-only" path.

Everything below elaborates and sequences these.

---

## 1. Current architecture (what actually exists)

| Layer | Where it lives | Notes |
|---|---|---|
| **Core engine (sport/concept-agnostic)** | `lib/redraft/*` — `scoringEngine`, `standingsEngine`, `playoffEngine`, `waiverEngine`, `tradeEngine`, `scheduleEngine`, `lineupLock`, `lineupValidation`, `redraftSeasonScoringRunner` | This is the reusable foundation (validated in G14). |
| **Sport plugins** | `lib/redraft/sportAdapters/{nfl,ncaaf,nba,nhl,mlb,ncaab,soccer}.ts` (`parseRawStats` + lock time); `lib/sportConfig/configs/*` (categories, slots, schedule/playoff defaults, feature flags); `lib/{nfl,ncaaf}-{roster,scoring,schedule}` | Healthy plugin pattern; config-driven cadence (`lineupFrequency`, `lineupLockType`, `hasBye`). |
| **Live scoring** | `lib/live-scoring/orchestrator.ts` (pure, DI'd tick), `server/services/liveScoring/liveScoreRunner.ts`, `lib/live-scoring/provider.ts` (`LiveStatsProvider` port), `nflLiveStatsProvider.ts`, `workerLoop.ts` | Provider already abstracted behind a port — good. NFL-only impl today. |
| **Realtime / events (ephemeral)** | `lib/league-events/realtime-store.ts` → `/api/leagues/[id]/events/stream` (SSE) → `useLeagueRealtimeRefresh` | In-process pub/sub; emits `{eventType, meta}`; **not durable**; **single-process**. |
| **Persisted activity** | `LeagueEvent`, `activityEvent`, `server/services/auditService.ts`, `/activity-feed` | Separate persisted record path. |
| **Trade market events** | `lib/trade-market/redraftTradeMarketEvents.ts` (`recordRedraftTradeMarketEvent`, normalized, idempotent, best-effort) | A nascent normalized-event pattern — the right shape, wrong scope (trade-only). |
| **Score read boundary** | `server/services/canonicalPlayerScores.ts`, `lib/live-scoring/playerScoreReadAdapter.ts` | Already unified the read across `PlayerWeeklyScore` (raw) and `WeeklyScore` (computed). |
| **AI / Chimmy** | `lib/redraft/ai/*`, `lib/ai-orchestration-engine/*`, `lib/ai/*`, `lib/ai-context-envelope/schema.ts`, `lib/ai-tool-registry/*`, `lib/ai/aiCache.ts`; providers openai/deepseek/xai | Deterministic context envelope exists; AI lives under `redraft/` (concept coupling risk). |
| **Jobs / ingestion** | `withSyncJobRun`, `cronRegistry`, cron import routes, `ProviderDiagnostics`, `rateLimitManager`, `sportsDataCache` | Good instrumentation; provider adapters normalize at ingestion. |
| **Entitlement / billing** | `userSubscription` (Stripe), `lib/redraft/ai/requireAfSub.ts`, route-level checks | Gating logic scattered across routes. |
| **DB-first guard** | `scripts/check-db-first-api-boundary.mjs`, `audit-db-first-architecture` | Enforces DB-first API boundaries — keep. |

---

## 2. Architectural risks (be critical)

**R1 — The realtime bus is in-process and ephemeral (top scalability blocker).**
`leagueRealtimeStore` is single-process memory. With >1 server instance, SSE subscribers on
instance B never see events published on instance A, and nothing is durable for
replay/aggregation. An Intelligence Engine that depends on this will be wrong under
horizontal scale. *Mitigation:* `EventBus` port → Redis (pub/sub for fan-out, Streams for
durability) + BullMQ for async processing.

**R2 — Event-concept fragmentation (top correctness/duplication blocker).**
Three overlapping event paths (R-store / `LeagueEvent` / trade-market) will drift in schema
and coverage. Building Intelligence on any one of them locks in that path's gaps. *Mitigation:*
one normalized domain-event log; the rest become projections/emitters.

**R3 — Dual-write risk.** If we publish events separately from the state mutation, crashes
produce state-without-event or event-without-state. *Mitigation:* transactional outbox.

**R4 — NFL/weekly assumptions leaking into "normalized" concepts.**
`redraftSeasonScoringRunner` is explicitly "NFL only"; weekly cadence, DST, game-clock are
NFL-shaped. NBA/MLB/NHL are daily-lineup; soccer is continuous; tournaments/survivor have
non-matchup competition. A normalized event model must **not** assume weeks/matchups.
*Mitigation:* events carry their own period + competition semantics; cadence stays in config.

**R5 — AI coupled to provider/DB shape and to the `redraft` concept.**
`lib/redraft/ai/*` reaches into redraft tables/providers. As concepts multiply (Dynasty,
Best Ball, …), this either forks or leaks. *Mitigation:* AI depends only on the Intelligence
read API, which is concept/sport-agnostic.

**R6 — Scattered entitlement logic.** Premium gating in routes via `requireAfSub` won't scale
to a tiered Commissioner Intelligence product or external licensees. *Mitigation:* a single
`FeatureGate`/entitlement service enforced at the API boundary.

**R7 — No external-API seam.** All access is app-internal Next routes. Bolting on a public
API later usually forks logic. *Mitigation:* define the public contract now and have the app
consume it (dogfood).

**R8 — Best-effort audit writes can silently drop intelligence facts.**
`recordRedraftTradeMarketEvent` is best-effort `try/catch` (correct for UX, dangerous for an
analytics system of record). *Mitigation:* the outbox makes event emission part of the
transaction, not best-effort.

---

## 3. Target architecture (CQRS-lite + outbox + projections)

```
            ┌──────────────────── WRITE SIDE (system of record) ─────────────────────┐
 Commands → │  Core Engines (lib/redraft/*)  ──tx──►  State tables + OUTBOX row        │
            └─────────────────────────────────────────────┬──────────────────────────┘
                                                           │ outbox relay (BullMQ)
                                                           ▼
                                         ┌──────── EventBus (port) ────────┐
                                         │ Redis Streams (durable log)     │
                                         │ + Redis pub/sub (fan-out/SSE)   │
                                         └───────┬───────────────┬─────────┘
                          ┌───────────────────────┘               └───────────────────────┐
                          ▼                                                                 ▼
        ┌──────── Intelligence Engine ────────┐                              ┌──── Realtime/SSE fan-out ────┐
        │ projection workers → read models     │                              │ (current UX, now multi-node) │
        │ (power rank, parity, manager profile,│                              └──────────────────────────────┘
        │  competitiveness, trade index, luck) │
        └───────────────┬──────────────────────┘
                        ▼
        ┌──────── Intelligence Read API (v1) ────────┐ ◄─── FeatureGate (entitlements)
        │  query read models (no raw provider/DB)     │
        └───────┬───────────────┬───────────────┬─────┘
                ▼               ▼               ▼
          Story Engine      Chimmy / AI     App UI / Widgets / SDK / White-label
```

**Bounded contexts (DDD):** *League & Competition* (existing Core), *Ingestion/Normalization*,
*Intelligence*, *Story*, *Identity & Entitlement*. Dependency rule: domain → application →
infrastructure; providers/persistence behind ports (the `LiveStatsProvider` port is the model
to replicate).

**Why CQRS-lite, not full event sourcing:** event-source the *read models* (rebuildable by
replaying the log) but keep transactional aggregates as current-state tables. This is the
pragmatic sweet spot: replayable analytics + no rewrite of the proven engines.

---

## 4. Event Bus strategy

- **One port, swappable adapters:** `EventBus { publish(event), subscribe(type, handler) }`.
  - *Adapter 1 (now):* wrap `leagueRealtimeStore` for local fan-out (zero regression to SSE).
  - *Adapter 2 (G15.1):* Redis Streams (durable, consumer groups, replay) for the domain log;
    Redis pub/sub for low-latency SSE fan-out across instances.
  - *Async processing:* **BullMQ** (already a dependency) for projection workers, retries,
    backoff, dead-letter — reuse the `workerLoop.ts`/`live-score-worker.ts` daemon pattern.
- **Delivery guarantees:** at-least-once + idempotent consumers (keyed on `eventId`). Never
  rely on exactly-once.
- **Ordering:** per-`(leagueId, seasonId)` partition ordering (Streams key) is sufficient;
  global ordering is not required and not affordable.
- **Backpressure / isolation:** per-projection consumer groups + checkpoints so a slow/broken
  projection can't block live scoring or the SSE path.

---

## 5. Event schema strategy (versioned, normalized, sport/concept-agnostic)

**Envelope (every event):**
```
eventId         (uuid, idempotency anchor)
type            (e.g. "competition.matchup.finalized")  — namespaced
schemaVersion   (int; additive evolution; never repurpose fields)
occurredAt      (domain time)   recordedAt (ingest time)
sport           (NFL|NCAAF|NBA|MLB|NHL|SOCCER|…)   — enum, open for extension
leagueConcept   (REDRAFT|DYNASTY|KEEPER|BEST_BALL|GUILLOTINE|SURVIVOR|TOURNAMENT|ZOMBIE|BIG_BROTHER|DEVY|C2C|SALARY_CAP|IDP)
tenantId        (for white-label/multi-tenant; default = AllFantasy)
leagueId, seasonId
actor           (userRef | system | commissioner | provider)
subjects[]      (normalized entity refs — never raw provider ids)
period          (cadence-agnostic: {kind: week|day|gameday|stage|continuous, index, label})
payload         (typed per type; sport-specific metrics live in a `metrics: Record<string,number>` map)
source          (engine | ingestion:<provider> | commissioner)
correlationId / causationId   (tracing & event chains)
idempotencyKey
```

**Principles:**
- **Normalized refs, not provider ids.** `PlayerRef{ canonicalId, displayName, position, teamRef }`
  resolved at emit time (the `resolveDisplayPlayer` / team-defense fallback patterns already do
  this) — no `sleeper:`/`nfl:def:` ids leak downstream.
- **Sport detail in a metrics map, not columns.** Reuse the `ParsedStats` (`Record<string,number>`)
  pattern so a new sport adds keys, not schema.
- **Cadence in `period`, not the type.** "Week" is one `period.kind`; daily/stage/continuous are
  first-class — kills R4.
- **Additive versioning + a schema registry** (typed Zod schemas in `lib/events/schemas/*`,
  validated at the bus boundary). `zod` is already a dependency.

**Normalized taxonomy (illustrative, not exhaustive):**
`lifecycle.*` (league.created, season.activated, draft.completed, schedule.generated,
season.completed, season.archived) · `roster.*` (player_added, player_dropped, lineup.set,
lineup.locked) · `transaction.*` (waiver.submitted/processed, trade.proposed/accepted/
vetoed/processed) · `competition.*` (score.updated, matchup.updated/finalized,
standings.updated, playoff.bracket_generated, playoff.advanced, champion.crowned) ·
`governance.*` (commissioner.action, settings.changed) · `data.*` (provider.sync.*,
stat.corrected, data.warning). Every concept maps onto these; concept-specific nuance rides in
payload, not new top-level categories.

---

## 6. Intelligence Engine service boundaries

- **Ingestion/Normalization** (owns provider adapters → normalized stat lines + `data.*`
  events). Inbound anti-corruption layer. The only place that touches raw provider shapes.
- **Event Store + Bus** (durable log + fan-out; §4–5).
- **Projection workers** (one per read model; checkpointed, idempotent, independently
  rebuildable). Examples: power rankings, parity/competitiveness index, manager tendency
  profiles, luck-adjusted records, trade-market index, waiver trends, schedule strength,
  injury/availability impact.
- **Intelligence Read API** (`IntelligenceQueryService` + `/api/v1/intelligence/*`): the only
  way anyone reads intelligence. Returns read models; never raw provider/DB rows.
- **Analyzer plugin registry** (mirror `lib/ai-tool-registry`): projections/analyzers register
  by `(concept, sport, metric)` so new sports/concepts extend without core edits (OCP).

Intelligence depends on the event log only. It does **not** call the engines or providers
directly. It is sport- and concept-agnostic by construction.

---

## 7. Story Engine service boundaries

- **Depends on Intelligence, not vice versa.** Intelligence = facts/metrics; Story = narrative
  over facts. Story reads the Intelligence API + the event log, never raw data.
- **Deterministic context envelope** (`lib/ai-context-envelope`) is the contract feeding the
  LLM — grounding + `AIConsistencyGuard` prevent hallucinated facts.
- **Artifacts:** weekly recaps, rivalry/drama threads, awards, power-ranking narratives,
  season story, champion story, "what changed this week." Each is a pure function of
  (events + read models + envelope) → narrative, cacheable (`aiCache`) and regenerable.
- **Provider-agnostic LLM routing** via the AI Gateway pattern (already in the platform's
  guidance) — model fallbacks/observability without provider lock-in.

---

## 8. Chimmy consuming normalized intelligence (not raw providers)

- Today Chimmy/AI tools sometimes reach into redraft tables/providers. Target: Chimmy is a
  **pure consumer of the Intelligence Read API + Story Engine**.
- The `lib/ai-tool-registry` tools become **thin adapters over `IntelligenceQueryService`**
  (e.g., `getLeaguePulse`, `getManagerProfile`, `getMatchupBreakdown`, `getTradeMarketIndex`).
- Benefits: one grounding source → consistency (`AIConsistencyGuard`); decoupled from provider
  churn; cacheable; the *same* queries power widgets/SDK; AI moves out from under `redraft/`
  into a concept-agnostic `lib/intelligence/ai` boundary.

---

## 9. Database schema additions

Additive only — existing tables remain the system of record.

| Table | Purpose | Key columns / notes |
|---|---|---|
| `domain_event` | Append-only normalized event log | `eventId` (uniq), `type`, `schemaVersion`, `occurredAt`, `sport`, `leagueConcept`, `tenantId`, `leagueId`, `seasonId`, `payload jsonb`, `idempotencyKey` (uniq); time-partitioned; indexed `(leagueId, seasonId, occurredAt)` and `(type, occurredAt)`. |
| `event_outbox` | Transactional outbox | Written in the same tx as the state mutation; relay marks `dispatchedAt`. Guarantees no dual-write (R3/R8). |
| `intelligence_projection_checkpoint` | Per-projection cursor | `projectionId`, `lastEventId`, `lastOccurredAt` — enables replay/rebuild + idempotency. |
| `intelligence_read_model` (or per-metric tables) | Denormalized read models | e.g. `power_ranking_snapshot`, `manager_profile`, `competitiveness_index`, `trade_market_index`; versioned, rebuildable; never authoritative (the log is). |
| `entitlement` / `feature_grant` | Modular gating | Derived from Stripe `userSubscription` → feature grants; queried by `FeatureGate`. |
| `tenant` (forward-looking) | White-label/multi-tenant | Default row = AllFantasy; isolates licensee data + theming/config. |

The `domain_event` log supersedes ad-hoc event paths; `LeagueEvent`/`activityEvent` and the
trade-market events become **projections** of it (migrate readers, then deprecate writers).

---

## 10. Aggregation pipelines, analytics, storage

- **Write path:** engine mutation + `event_outbox` row in one tx → BullMQ relay → `domain_event`
  + bus publish.
- **Streaming projections** (low latency): live scoring, league pulse, matchup deltas — update
  read models on each event (reuse the incremental orchestrator pattern from `lib/live-scoring`).
- **Batch projections** (heavy/season-scope): manager profiles, season trends, luck-adjusted
  records — scheduled via `cronRegistry` + the worker daemon; idempotent + checkpointed.
- **Storage tiers:** hot read models in Postgres; optional Redis cache for hottest aggregates;
  cold `domain_event` partitions archivable to Blob. Read models are **disposable** — any can be
  dropped and rebuilt by replaying the log (the core benefit of CQRS-lite).
- **Observability:** extend `withSyncJobRun`/`ProviderDiagnostics` to projection lag, DLQ depth,
  rebuild status → the existing production-health dashboard.

---

## 11. Subscription gating (modular)

- **One `FeatureGate` service:** `can(principal, feature, context) → Allow|Deny|UpgradeRequired`.
  Stripe `userSubscription` → `entitlement`/`feature_grant` rows → gate decisions. Replaces
  scattered `requireAfSub` checks.
- **Enforce at the API boundary**, not just UI, so external licensees are gated identically.
- **Feature taxonomy:** `commissioner_intelligence.<feature>` (e.g. `manager_profiles`,
  `trade_market_index`, `season_story`, `white_label`, `api_access`). Free tier = basic
  read models; premium = advanced analytics + Story + API.
- **Tier ≠ code path.** Same code, gated data/feature flags — premium stays modular and never
  forks the engine.

---

## 12. API architecture (Customer #1 + external licensing)

- **Versioned public contract:** `/api/v1/intelligence/*` (REST) for stable, cacheable reads +
  **GraphQL** (`graphql-yoga`, already present) for flexible composite queries by app/widgets.
- **Dogfood:** the AllFantasy app consumes the *same* v1 contract internally — no separate
  "internal" path that drifts. This is what makes external licensing safe later.
- **Gateway concerns (one middleware layer):** authN (session for app, **API keys/OAuth** for
  licensees), `FeatureGate` authZ, rate limiting (`rateLimitManager`), `tenantId` scoping,
  versioning, idempotency, observability.
- **Distribution surfaces, one contract:** SDK = typed client generated from the v1 schema;
  embedded widgets = thin components calling v1; white-label = `tenant` theming/config + scoped
  data. None re-implement logic.
- **Compatibility policy:** additive evolution; deprecate with sunset headers; never break v1.

---

## 13. SOLID / DDD / clean-architecture / plugin mapping

- **SRP/bounded contexts:** Ingestion, Intelligence, Story, Entitlement, League-Core each own
  one responsibility with explicit interfaces.
- **OCP via registries:** sport plugins (`sportAdapters`/`sportConfig`), concept plugins
  (`league-concepts`), analyzer plugins, AI-tool plugins — extend by registration, not edits.
- **DIP/ports & adapters:** `EventBus`, `LiveStatsProvider` (exists), `IntelligenceQueryService`,
  `FeatureGate` are ports; Redis/BullMQ/Stripe/providers are adapters.
- **LSP:** every sport/concept satisfies the same normalized event + read-model contracts
  (no NFL-only branches in Core — enforce with the existing contract-test discipline).
- **Clean architecture:** domain (engines, event model) has zero infra imports; the `server-only`
  boundary and `check-db-first-api-boundary` guard already push this direction.
- **Event sourcing where appropriate:** read models only; transactional core stays state-based.

---

## 14. Where I'd improve on the likely handoff (critical recommendations)

1. **Reject a bespoke event bus** in favor of evolving `leagueRealtimeStore` → Redis/BullMQ
   (already in the stack). Less code, proven infra, horizontal-scale-ready.
2. **Reject dual-write event emission**; mandate the transactional outbox. This is the single
   most common event-driven production bug and it's cheap to prevent now.
3. **Unify events first, features second.** Building Story/manager-profiles on the current
   fragmented event paths would bake in gaps. The normalized log is the foundation; everything
   else is a projection.
4. **Forbid "normalized" models that encode weeks/matchups/DST.** Cadence and competition shape
   must be data (`period`, `metrics`), or NBA/MLB/NHL/soccer/tournament/survivor will each force
   a fork.
5. **Make AllFantasy consume the public API contract internally** from day one — the only
   reliable way to ship external SDKs/widgets/white-label later without a rewrite.
6. **Treat analytics writes as system-of-record, not best-effort.** Move audit/market events
   onto the outbox so facts can't silently drop.

---

## 15. Phased roadmap (G15.x — minimal-tech-debt sequencing)

Each phase is independently shippable, reversible, and ends with proof (the G11–G14 discipline:
engine harness + tests + staging/browser proof before any readiness move).

- **G15.1 — Event foundation (no behavior change).** `EventBus` port + Zod schema registry +
  envelope; in-process adapter wrapping `leagueRealtimeStore`; `event_outbox` + `domain_event`
  tables; outbox relay (BullMQ). *Exit:* engines emit normalized events transactionally; SSE
  unchanged; replay works in staging.
- **G15.2 — Unify + first projection.** Re-platform the activity feed (and trade-market events)
  as **projections** of `domain_event`; add `intelligence_projection_checkpoint`; prove a full
  rebuild from the log. *Exit:* one consumer migrated, zero UX regression, log is authoritative.
- **G15.3 — Redis bus + multi-node.** Swap the bus adapter to Redis Streams/pub-sub; verify SSE
  across >1 instance. *Exit:* horizontal-scale proof.
- **G15.4 — Intelligence Read API + entitlements.** `IntelligenceQueryService` + `/api/v1/
  intelligence/*` + `FeatureGate`/`entitlement`. Ship 2–3 read models (power rankings,
  competitiveness, manager profile). *Exit:* app reads intelligence via v1; gating enforced at
  the boundary.
- **G15.5 — Chimmy migration.** Repoint AI tool registry + Chimmy to the Intelligence API;
  remove direct provider/DB reads from AI. *Exit:* AI grounded solely on normalized data;
  consistency guard green.
- **G15.6 — Story Engine + external seam.** Story Engine over the read models; publish the v1
  SDK + first embeddable widget behind API-key auth + `tenant` scaffolding. *Exit:* a licensee
  can read intelligence through the same contract the app uses.

**Sequencing rule:** foundation (G15.1–G15.3) before any premium feature (G15.4+). Do not ship
Story or external API before the event log is unified and durable, or technical debt compounds.

---

## 16. Anti-goals & decision log

- **Anti-goal:** full event sourcing of the transactional core (cost > benefit; the engines are
  proven).
- **Anti-goal:** a second scoring/score-store implementation for analytics (reuse
  `canonicalPlayerScores`).
- **Anti-goal:** NFL/weekly assumptions in any "normalized" type.
- **Open decisions for the team:** (a) Redis Streams vs. Vercel Queues for the durable log;
  (b) per-metric read tables vs. one `intelligence_read_model` jsonb table; (c) GraphQL vs.
  REST as the *primary* external surface; (d) tenant isolation model (row-scoped vs.
  schema-per-tenant) for white-label.

> **Reconcile with the Master Handoff when provided.** If the handoff specifies a different bus,
> storage, or API stance, treat §0 decisions as the recommendation to debate, not a fait
> accompli — but the outbox + unified-event-log + dogfooded-API principles should hold
> regardless.
