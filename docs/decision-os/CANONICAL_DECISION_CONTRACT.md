# Decision OS — Canonical Decision Contract (Phase 3A)

**Status: DORMANT / NOT LIVE.** Phase 3A adds the contract, a shadow-only persistence path, adapters, and an
additive table. Nothing here is wired to a route, the dashboard, Chimmy, notifications, tokens, or the maintenance
runner. It does no work until a later phase deliberately enables it. Do not treat any part of this as
production-ready or user-facing.

## Why

The repo has several decision/recommendation/signal lineages (deterministic `Decision`/`DecisionOSInsight`, the AI
`ThreeBrainDecisionResult`, `Recommendation`/`RecommendationSet`, `CommissionerRecommendationContract`, plus
per-domain start/sit/waiver/trade/draft shapes and two signal vocabularies). The canonical decision is the ONE
versioned envelope every brain (Decision OS, Commissioner OS, Manager OS, Chimmy Intelligence, draft/trade/waiver/
lineup intelligence, AF Legacy, Best Ball, Salary Cap, C2C, Devy — across NFL, NCAAF, and future sports) maps its
outputs into, so a single dashboard / Chimmy / portfolio layer can consume them uniformly later. Different systems
produce different decision **categories**; they share this identity + envelope.

Code: `lib/decision-os/canonical/` (pure barrel `index.ts`; server-only Prisma store imported directly from
`prismaDecisionStore.ts`).

## Envelope (`CanonicalDecision`, `contract.ts`)

Typed fields for stable, business-critical concepts; constrained + BOUNDED JSON (`evidence`, `extensions`) only
for category-specific data not yet normalizable. Key fields: `contractVersion`, `decisionId`, `fingerprint`;
identity (`userId`, `leagueId`, `connectedFranchiseId`, `sourcePlatform`, `sport`, `season`, `period`);
classification (`category`, `subtype`, `subjectKey`, `scope`, `audience`); content (`headline`, `explanation`,
`recommendedAction`, `evidence[]`); scoring (`confidencePct`, `severity`, `urgency`, `priorityScore`,
`expectedImpact`); entities (`players[]`, `teamRef`); source (`source` ref + `sourceExecutionPolicy` +
**derived `sourceReadOnly`**); time/freshness (`dataAsOf`, `generatedAt`, `staleAt`, `freshness`);
classification-only entitlement/token (`entitlementTier`, `tokenCostClass`); lifecycle (`status`,
`suppressionReason`, `conflictGroupKey`, `supersedes`); audit (`producer`, `producerVersion`, `runId`);
`extensions`.

**`subjectKey`** is the typed subject/action discriminator: a stable, deterministic id for the SPECIFIC subject a
decision concerns when category+scope+players+teamRef do not already make it unique — which manager an
`inactive_manager` signal is about, which trade proposal a `trade_review` evaluates, which matchup a
`matchup_opportunity` concerns. It participates in identity (below) and MUST be stable across re-runs for the same
logical subject (a roster/proposal/matchup id, never a per-run/random id).

**Bounds.** Validation caps every string to its column, `evidence` to 50 items, `players` to 60, and `extensions`
to 50 keys / 8 KB serialized, so constrained JSON can never silently become the real contract; oversized input is
rejected before persistence rather than truncated by the database.

Contract version: `CANONICAL_DECISION_CONTRACT_VERSION = '1'`. Consumers must check
`isSupportedContractVersion(...)` and ignore/upgrade unknown versions.

## Taxonomy (`taxonomy.ts`)

Controlled, extensible category set — adding a category is additive; validation rejects unknown categories.
Commissioner (`league_requires_review`, `roster_incomplete`, `lineup_missing`, `inactive_manager`,
`draft_scheduled`, `waiver_run_today`, `trade_pending`, `high_league_health`); Manager (`manager_lineup_missing`,
`manager_waiver_pending`, `start_sit`, `waiver_target`, `drop_candidate`, `trade_review`, `trade_target`,
`roster_risk`, `matchup_opportunity`, `injury_attention`, `bye_week_risk`, `draft_recommendation`); Portfolio
foundations (`cross_league_conflict`, `player_exposure`, `duplicate_waiver_target`, `sunday_readiness`,
`connected_devy_context`). **Portfolio categories are representable only** — no Portfolio Resolver, consolidated
waivers, Sunday Readiness, exposure, or connected-franchise resolution is computed in Phase 3A.

## Identity + idempotency (`identity.ts`)

`fingerprint = sha256(stable identity tuple)` — user/league/connected-franchise/platform/sport/season/period/
category/subtype/scope/audience/teamRef/players/conflictGroupKey/**subjectKey**. Content
(headline/explanation/scoring) and timestamps are **excluded**, so a re-run that reworks wording/confidence for the
SAME decision keeps the SAME `fingerprint` → SAME `decisionId` (`dcn:<fingerprint>`) → an idempotent UPSERT, not a
duplicate. `subjectKey` is what keeps distinct same-category subjects apart (two inactive managers, two trade
proposals with the same players, two matchups) — without it they would collapse to one decision. Use
`buildCanonicalDecision(input)` — the only sanctioned constructor; producers cannot forge the version, id,
fingerprint, or the derived `sourceReadOnly` flag.

### Logical identity — exactly which fields define a "decision"

A decision's logical identity is: contract version · WHO (`userId`, `leagueId`, `connectedFranchiseId`) · WHERE
(`sourcePlatform`, `sport`, `season`, `period`) · WHAT KIND (`category`, `subtype`, `scope`, `audience`) · ABOUT
WHAT (`teamRef`, `players`, `conflictGroupKey`, `subjectKey`). Everything else — wording, evidence, confidence,
severity, urgency, priority, timestamps, freshness, status — is CONTENT, not identity, and may change across runs
for the same decision.

## Lifecycle + supersession

`status`: `active` (the only surfaceable state) → `superseded` | `suppressed` | `expired` | `resolved`. A new
decision that sets `supersedes: <oldDecisionId>` causes the store to mark the prior decision `superseded`
(status-gated, idempotent). `conflictGroupKey` groups mutually-exclusive/duplicate decisions (e.g. the same waiver
target across leagues) for a future dedup/portfolio layer — it is populated but **not** acted on in Phase 3A.

## Audit history + run linkage (current-state + immutable per-run occurrences)

`canonical_decisions` holds **current state** — one row per `decisionId`. The store ALSO appends an immutable
revision to `canonical_decision_revisions` on every persist, so a re-run never silently overwrites prior generated
content or run linkage:

- **OCCURRENCE IDENTITY is `(decisionId, runId)`** — DB-enforced unique. A logical decision has AT MOST ONE
  immutable revision per run. `runId` is therefore REQUIRED: shadow persistence rejects a null-runId decision
  (an occurrence needs a run to be labelled by). A later, different run appends a new revision.
- **`contentHash` is a NON-identity integrity field** — `sha256` over the MATERIAL content (status, text,
  evidence [order-normalized], scoring, source, freshness, supersession), with `runId`, `decisionId`, and all
  timestamps EXCLUDED. It is used ONLY to DETECT a same-run write whose content differs from the stored occurrence.
- **Same-run replay is handled deterministically**: an identical retry is a no-op; a same-run write with changed
  prose / re-stamped `generatedAt` / reordered evidence never creates a second row and never overwrites the first —
  a genuine content difference is surfaced as a typed conflict (`revisionConflicts`), the FIRST occurrence
  preserved. This holds under concurrency (the unique constraint + immutable upsert guarantee it).

This is the minimal "current-state + immutable per-run occurrences" model (not full event-sourcing). It gives:
same-run retry idempotency; separate traceability of each run; audit of previous generated content; deterministic
current-state selection (below); recoverable supersession + producer-version + source-snapshot lineage; and no
duplication. `runId` is a deliberate **soft link** (no FK): a canonical decision may be produced by brains other
than the three-brain `DecisionIntelligenceRun` pipeline, so `runId` is not guaranteed to reference a
`decision_intelligence_runs` row. Revisions cascade with their parent decision (for data-subject deletion); the
store exposes NO update/delete, so within its lifecycle revisions are strictly append-only + immutable. `getRevisions`
returns them in deterministic `(createdAt, id)` order. Read by nothing live in Phase 3A.

## Concurrency + deterministic current-state ordering

`persistBatch` runs in ONE interactive transaction (atomic batch), safe for concurrent writers, with an
authoritative ordering rule so current state is DETERMINISTIC rather than last-writer-wins:

- **Current-state write is ordering-gated + atomic.** The existing row is locked with `SELECT … FOR UPDATE`; it is
  updated ONLY when the incoming generation is strictly newer per `isNewerGeneration` — primary key `generatedAt`,
  deterministic tie-break `runId`. The first insert races through the unique `decisionId`; a concurrent insert
  raises P2002 and the bounded retry re-evaluates under the lock. Consequences: an older / delayed / retried run
  can NEVER regress a newer current decision; concurrent different-run writers converge on the same winner
  regardless of commit order; equal `generatedAt` breaks by `runId`; and a stale write cannot undo a supersession
  (the older generation fails the gate, so `status = superseded` stands).
- **Revision write is race-safe + immutable** on unique `(decisionId, runId)` (upsert with a no-op update → never
  overwrites; content mismatch surfaced as a conflict, first occurrence preserved).
- **Bounded retry** re-runs the whole atomic batch ONLY on P2002 (unique) or P2034 (write conflict / deadlock);
  every other error surfaces immediately (no blanket error swallowing). A mid-batch failure rolls the batch back.

**Trust boundary.** `generatedAt` and `runId` are producer-supplied; the ordering is deterministic given those
inputs. A later phase with an authoritative monotonic run sequence should replace `generatedAt` as the primary
ordering key. Current state and revisions are DECOUPLED: an older run that does not become current is still recorded
as its own immutable revision (full audit), it simply does not advance the current-state row.

## Shadow-mode boundary (`decisionStore.ts`, `shadowFlag.ts`, `prismaDecisionStore.ts`)

`shadowPersistDecisions(...)` is the ONLY persistence entry point and is inert by default:
1. Phase 3A accepts only `mode: 'shadow'`; any other mode is refused with no write.
2. Writes require `DECISION_OS_CANONICAL_SHADOW_ENABLED === 'true'` (exact string). Missing / '' / 'false' / '1'
   / 'yes' → disabled; it returns immediately WITHOUT validating, touching the store, calling a provider,
   reserving a token, minting freshness, or activating any consumer.
3. Only when both hold does it validate (`validate.ts`), dedup by `decisionId`, apply supersession, and hand valid
   decisions to the injected store's atomic `persistBatch` (upsert-by-`decisionId` → retry-safe).

This flag is INDEPENDENT of `DECISION_OS_MAINTENANCE_ENABLED`. Both remain off. The store is dependency-injected
(`CanonicalDecisionStore`); tests use `InMemoryCanonicalDecisionStore`, production uses
`PrismaCanonicalDecisionStore` (server-only). No UI, Chimmy, or notification code reads from the table.

**Authentication boundary (future).** Phase 3A exposes NO route, cron, or job that calls `shadowPersistDecisions`.
When a later phase adds a callable boundary, its required order is: (1) authenticate + authorize the internal
caller, (2) evaluate `DECISION_OS_CANONICAL_SHADOW_ENABLED`, (3) confirm `mode: 'shadow'`, and only then (4) reach
the run/DB/provider/token/freshness dependencies. Because no caller exists yet, authentication is that future
boundary's responsibility and is NOT claimed as implemented here. Import-safety is guaranteed today: importing the
pure barrel (`index.ts`) triggers no DB/provider/token/freshness/Chimmy/notification work, and the only
`server-only`, `@/lib/prisma`-touching module (`prismaDecisionStore.ts`) is deliberately excluded from the barrel.

## Guarantees

- **Provider read-only w.r.t. imported platforms — via a typed execution policy.** Every decision carries
  `sourceExecutionPolicy ∈ { external_read_only, advisory_only, native_actionable_dormant }`, and `sourceReadOnly`
  is DERIVED from it by the builder (producers can't set it directly). Validation enforces the invariant that an
  external platform (Sleeper/ESPN/Yahoo/Fantrax/MFL/Fleaflicker — see `EXTERNAL_SOURCE_PLATFORMS`) can NEVER be
  `native_actionable_dormant` and must be `sourceReadOnly = true`. AF may analyze imported leagues and emit
  read-only deep links but NEVER writes roster/lineup/waiver/trade/draft/commissioner/settings changes to them, and
  no adapter can produce an externally-writable decision. The policy exists so the universal contract stays
  accurate (a future NATIVE AllFantasy decision may be actionable) WITHOUT granting any execution now: Phase 3A
  persists only and executes nothing on any policy, so `native_actionable_dormant` is representable but inert.
- **Token-neutral.** `entitlementTier` / `tokenCostClass` are CLASSIFICATIONS only. Phase 3A never reserves,
  finalizes, or releases a token, and never mints freshness.
- **Provider-neutral.** Provider-specific ids live only inside `source`; the canonical decision otherwise uses AF
  canonical identities (`Player.id`, league/roster ids). Sleeper/ESPN/Yahoo/Fantrax are all just `sourcePlatform`
  strings.
- **NFL + NCAAF are first-class.** The envelope encodes no NFL-only assumption; both validate identically and flow
  through the same adapters. New sports need no envelope change.
- **Connected Sleeper/Fantrax devy forward-compat.** `connectedFranchiseId` + `connectedFranchise.ts` reserve the
  typed handle for a future user-authorized cross-league/cross-sport franchise group. AF NEVER infers a
  connection — it is user/commissioner-authorized only (`CONNECTED_FRANCHISE_AUTHORITY = 'user_authorized_only'`).
  No resolution, no Fantrax calls, no connection records in Phase 3A.

## Adapters (`adapters.ts`)

Pure transforms from existing normalized AF shapes into the envelope: `adaptCommissionerSignal`,
`adaptManagerRecommendation`, `adaptLineupStartSit`, `adaptWaiverTarget`, `adaptTradeReview`. They call no
provider, touch no DB, and never write to imported platforms. They represent missing data honestly (nulls / empty
evidence) rather than fabricating confidence, evidence, platform, or timestamps.

## For future producers

Build a decision with `buildCanonicalDecision(input)` (or an adapter), then hand it to `shadowPersistDecisions`
(shadow) — never construct the id/fingerprint/`sourceReadOnly` by hand (they are stamped/derived), never persist
outside the boundary, supply a stable `subjectKey` whenever multiple same-category decisions can coexist, leave
`sourceExecutionPolicy` at `external_read_only` for imported-platform analysis, and never charge a token or write
to a source platform.

## For future consumers (later phases)

Read only `status: 'active'` decisions; check `isSupportedContractVersion`; treat `evidence`/`extensions` as
best-effort; honor `freshness`/`staleAt`; never surface chain-of-thought; deep-link to source platforms read-only.
Consumption (dashboard Decision Queue, Chimmy, portfolio, entitlement gating, notifications) is NOT built here.

## Database

Additive models `CanonicalDecision` → `canonical_decisions` (current state) and `CanonicalDecisionRevision` →
`canonical_decision_revisions` (immutable audit history; occurrence identity UNIQUE `(decision_id, run_id)` with a
non-null `run_id`; `content_hash` is a non-identity integrity field; FK → `canonical_decisions.decision_id` ON
DELETE CASCADE). Migration `20260729130000_canonical_decisions`, checksum
`a8df22c2fd1a68211dd938fbb44427d071ddc63fbc63e725279a3530f4e73bb8`. (The original folder was `20260730130000_…`,
a **future date** relative to the 2026-07-29 creation date; it was renamed to a valid same-day timestamp that
sorts after the latest merged migration `20260729120000_intelligence_run_provider_exec_marker`.) The tables are
separate from `decision_intelligence_runs` (AI *run* state, not individual decisions). Indexed for future queries
by user/league/sport/season/category/severity/status/run/conflict-group/connected-franchise/freshness. Migration
is purely additive (2 CREATE TABLE + indexes + 1 FK between the two new tables; no ALTER/DROP on any existing
table), generated offline via `prisma migrate diff` (datamodel-to-datamodel). Applied + verified only on a freshly
created disposable Neon database (both tables + all indexes + the `(decision_id, run_id)` occurrence unique + FK,
and the full store integration suite ran green against it) that was deleted afterward — a NEW disposable database
was created each pass rather than reusing a prior sandbox whose history holds an older filename. **NOT applied to
production** — that is a later manual release gate (never `prisma migrate deploy`; use the repo's direct-SQL +
`migrate resolve --applied` convention, see `PHASE2_MIGRATION_RUNBOOK.md`).

## What Phase 3A deliberately does NOT activate

Live decision surfacing; the dashboard Decision Queue; Portfolio Resolver / cross-league refresh; Exposure
Intelligence; Consolidated Waiver Board; Sunday Readiness; connected-franchise groups / Fantrax devy connections;
cross-sport ranking; Chimmy consumption; entitlement gating; token charging; email/push alerts; the maintenance
runner. All remain off; the production migration is not applied.
