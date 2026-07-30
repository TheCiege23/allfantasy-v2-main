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

Typed fields for stable, business-critical concepts; constrained JSON (`evidence`, `extensions`) only for
category-specific data not yet normalizable. Key fields: `contractVersion`, `decisionId`, `fingerprint`; identity
(`userId`, `leagueId`, `connectedFranchiseId`, `sourcePlatform`, `sport`, `season`, `period`); classification
(`category`, `subtype`, `scope`, `audience`); content (`headline`, `explanation`, `recommendedAction`,
`evidence[]`); scoring (`confidencePct`, `severity`, `urgency`, `priorityScore`, `expectedImpact`); entities
(`players[]`, `teamRef`); source (`source` ref + **`sourceReadOnly: true`**); time/freshness (`dataAsOf`,
`generatedAt`, `staleAt`, `freshness`); classification-only entitlement/token (`entitlementTier`,
`tokenCostClass`); lifecycle (`status`, `suppressionReason`, `conflictGroupKey`, `supersedes`); audit (`producer`,
`producerVersion`, `runId`); `extensions`.

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
category/subtype/scope/audience/teamRef/players/conflictGroupKey. Content (headline/explanation/scoring) and
timestamps are **excluded**, so a re-run that reworks wording/confidence for the SAME decision keeps the SAME
`fingerprint` → SAME `decisionId` (`dcn:<fingerprint>`) → an idempotent UPSERT, not a duplicate. Use
`buildCanonicalDecision(input)` — the only sanctioned constructor; producers cannot forge the version, id,
fingerprint, or `sourceReadOnly` flag.

## Lifecycle + supersession

`status`: `active` (the only surfaceable state) → `superseded` | `suppressed` | `expired` | `resolved`. A new
decision that sets `supersedes: <oldDecisionId>` causes the store to mark the prior decision `superseded`
(status-gated, idempotent). `conflictGroupKey` groups mutually-exclusive/duplicate decisions (e.g. the same waiver
target across leagues) for a future dedup/portfolio layer — it is populated but **not** acted on in Phase 3A.

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

## Guarantees

- **Provider read-only w.r.t. imported platforms.** `sourceReadOnly` is always `true` (enforced in the type and
  the zod schema). AF may analyze imported (Sleeper/ESPN/Yahoo/Fantrax) leagues and emit read-only deep links, but
  NEVER writes roster/lineup/waiver/trade/draft/commissioner/settings changes to them.
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
(shadow) — never construct the id/fingerprint by hand, never persist outside the boundary, never set
`sourceReadOnly` to anything but `true`, and never charge a token or write to a source platform.

## For future consumers (later phases)

Read only `status: 'active'` decisions; check `isSupportedContractVersion`; treat `evidence`/`extensions` as
best-effort; honor `freshness`/`staleAt`; never surface chain-of-thought; deep-link to source platforms read-only.
Consumption (dashboard Decision Queue, Chimmy, portfolio, entitlement gating, notifications) is NOT built here.

## Database

Additive model `CanonicalDecision` → table `canonical_decisions` (migration
`20260730130000_canonical_decisions`, checksum `bf67b35e200e68bae98050dc0bdfebff48605fcaf95f7f3459a86101a53bc3e3`).
Separate from `decision_intelligence_runs` (which holds AI *run* state, not individual decisions). Indexed for
future queries by user/league/sport/season/category/severity/status/run/conflict-group/connected-franchise/
freshness. Migration applied + verified only on the isolated sandbox; **NOT applied to production** — that is a
later manual release gate (never `prisma migrate deploy`; use the repo's direct-SQL + `migrate resolve --applied`
convention, see `PHASE2_MIGRATION_RUNBOOK.md`).

## What Phase 3A deliberately does NOT activate

Live decision surfacing; the dashboard Decision Queue; Portfolio Resolver / cross-league refresh; Exposure
Intelligence; Consolidated Waiver Board; Sunday Readiness; connected-franchise groups / Fantrax devy connections;
cross-sport ranking; Chimmy consumption; entitlement gating; token charging; email/push alerts; the maintenance
runner. All remain off; the production migration is not applied.
