# ADR G17: Canonical Waiver Engine Convergence

**Status:** Accepted
**Date:** 2026-06-30
**Context:** G16 Core Waiver Engine Audit
**Supersedes:** None
**Ticket:** G17 — Waiver Canonical Convergence Plan

---

## Context

The G16 audit confirmed that AllFantasy runs three independent waiver sub-systems today:

1. **Canonical engine** (`lib/waiver-wire`) — the target Core Waiver Engine. Owns `WaiverClaim`, `WaiverRun`, `WaiverResult`, `WaiverTransaction`, `LeagueWaiverSettings`, `LeagueWaiverState`. Handles FAAB, rolling, reverse-standings, FCFS, tiebreakers, plugin guards, commissioner overrides, automation locks, and notifications via `run-hooks`.

2. **Legacy Redraft engine** (`lib/redraft/waiverEngine.ts`) — self-contained processing of `RedraftWaiverClaim` → `RedraftRosterPlayer` → `RedraftLeagueTransaction`. Does not touch canonical tables, canonical settings, `WaiverRun`, `WaiverResult`, or automation locks.

3. **Guillotine specialty engine** (self-contained within the Guillotine concept) — resolves `GuillotineWaiverRelease` rows directly. Uses its own `releaseStatus` state machine and `Float` bid fields. Never writes canonical audit tables.

These three sub-systems share no processing boundary, settings enforcement, or audit trail. The G16 audit also identified two failing tests whose root causes trace directly to these divergences:

- `waiver-wire-player-route-pool-resolver.test.ts` — the canonical player-browse route (`app/api/waiver-wire/leagues/[leagueId]/players/route.ts`) calls Redraft tables (`prisma.redraftRosterPlayer`) and raw sport player tables instead of the shared `getPlayerPoolForLeague` resolver.
- `league-roster-validation-context.test.ts` — `getRosterDefaults('NFL', 'DYNASTY_IDP')` creates slot name `IDP` instead of `IDP_FLEX`, mismatching the documented slot name and breaking Dynasty IDP waiver eligibility checks.

---

## Decision Drivers

- Specialty formats (Dynasty, Guillotine, Survivor, Devy, etc.) must remain fully functional throughout migration.
- Commissioner Stage 1 soak (`DECISION_OS_COMMISSIONER_HEALTH_LIVE=true`) must not be disrupted.
- No dual-write until parity tests pass.
- The canonical engine must remain the single write authority; legacy tables become read-only compatibility artifacts after migration.
- Risk must be bounded to one format at a time. A failure in one migration phase must not cascade to other format leagues.
- No schema deletions until all consuming routes and cron jobs are confirmed to use canonical tables.

---

## Options Considered

### Option A — Immediate dual-write, legacy tables as audit trail only

New claim submissions from Redraft and Guillotine routes write canonical `WaiverClaim` (and canonical `WaiverRun`/`WaiverResult` after processing) in addition to the legacy tables, behind a feature flag. Processing moves to `processWaiverClaimsForLeague` once dual-write is stable.

**Pros:** Gets Redraft onto canonical audit trail fast. Legacy tables can be made read-only incrementally.

**Cons:** All Redraft UI routes must be modified simultaneously to dual-write. Rollback requires disabling two write paths per claim. If `processWaiverClaimsForLeague` produces different results than `processWaiverWindow`, active leagues see divergence during the overlap window.

### Option B — Canonical compatibility adapter (read translation)

A new `RedraftWaiverAdapter` reads pending `RedraftWaiverClaim` rows and maps them into the canonical `processWaiverClaimsForLeague` input format at processing time, without modifying the creation path. Canonical processor settles the claim and then mirrors the result back into the Redraft tables.

**Pros:** No route changes to claim submission. Processing is canonical immediately. Rollback = disable flag, revert to `processWaiverWindow`.

**Cons:** Mirror-back to Redraft tables re-introduces a write dependency on legacy tables. The adapter must map `RedraftRoster.faabBalance` ↔ `Roster.faabRemaining` for the same league, requiring a join. Roster mutation is complex because Redraft uses `RedraftRosterPlayer` rows while canonical mutates `Roster.playerData`. These two representations must stay in sync or a divergence detection step is required.

### Option C — Route migration, phased by format (SELECTED)

Migrate one format at a time: Redraft first (largest), then Guillotine (specialty bridge). Within each format, the migration has four named phases:

1. **Shadow** — New claims are written to canonical `WaiverClaim` in addition to the legacy table. Processing still runs the legacy engine. Parity reports compare canonical and legacy outcomes per run.
2. **Canonical primary** — Processing switches to `processWaiverClaimsForLeague` behind a feature flag. Legacy processing is disabled. Canonical results are the settlement. Legacy table entries are kept as backward-compatibility read artifacts (history queries only).
3. **Route convergence** — Claim submission and state routes switch to canonical endpoints. Legacy routes return 301 (where web-accessible) or are gated by the feature flag.
4. **Table retirement** — After a minimum 30-day soak with zero regression incidents, legacy tables and routes are removed.

**Pros:** Each phase is independently reversible. Parity testing during Shadow phase proves correctness before cutover. One format's failure does not affect other formats. Decision OS Stage 1 soak is untouched.

**Cons:** Shadow phase requires maintaining both write paths temporarily. The FAAB and roster data models diverge between Redraft and canonical tables until Phase 2, requiring a source-of-truth rule during the overlap.

### Option D — New unified claim model, migrate both at once

Introduce a new `UnifiedWaiverClaim` model that replaces both `WaiverClaim` and `RedraftWaiverClaim`, migrate all create/process paths to the new model, then deprecate the old models.

**Pros:** Clean break; no legacy tables.

**Cons:** Highest risk and most code change. Schema migration required. All routes for all formats must change simultaneously. No incremental rollback. Out of scope for current roadmap phase.

---

## Decision

**Option C — Route migration, phased by format.**

Rationale:
- Each phase is independently reversible at the feature-flag level without a code deploy.
- Parity testing during Shadow proves canonical correctness before any live settlement switches over.
- The four-phase structure maps naturally to the Decision OS Stage model (Shadow → Enriched → Live → Retire).
- Guillotine's specialty `GuillotineWaiverRelease` model requires a targeted bridge (Phase G, below) that can be implemented independently after Redraft is canonical.

---

## Architecture Boundaries After Convergence

```
┌─────────────────────────────────────────────────────────────┐
│ Core Waiver Engine  (lib/waiver-wire)                        │
│  claim-service · process-engine · eligibility               │
│  settings-service · waiver-state-service · run-hooks        │
├─────────────────────────────────────────────────────────────┤
│ Plugin Hooks  (WaiverPluginHooks — to be formalized)         │
│  Guillotine rosterGuard · Survivor freeze · Devy eligibility │
│  Dynasty keeper guard · Tournament round guard               │
├─────────────────────────────────────────────────────────────┤
│ Canonical tables                                             │
│  WaiverClaim · WaiverRun · WaiverResult                      │
│  WaiverTransaction · LeagueWaiverSettings · LeagueWaiverState│
├─────────────────────────────────────────────────────────────┤
│ Legacy tables (read-only after migration)                    │
│  RedraftWaiverClaim · RedraftRosterPlayer (overlap window)   │
│  GuillotineWaiverRelease (specialty bridge only)             │
├─────────────────────────────────────────────────────────────┤
│ Decision OS / AI  (read-only — no claim mutation)            │
│  waiver shadow slice · WaiverCard adapter                    │
│  Phase 5.1 behavioral event port (WaiverClaim loader)        │
└─────────────────────────────────────────────────────────────┘
```

---

## Consequences

**Positive:**
- Single settings, audit trail, FAAB accounting, priority tracking, and notification path for all formats.
- Behavioral Event Port (Phase 5.1) already reads `WaiverClaim` — Redraft events become visible to Decision OS automatically after Redraft migrates.
- Plugin hooks formalized as `WaiverPluginHooks` in parallel with the route migration.
- Commissioner Hub intelligence (Phase 4 live) enriches waiver health using canonical data only — accuracy improves for all format leagues.

**Negative / accepted risks:**
- Shadow phase adds a write overhead per claim for the duration. Mitigated by the feature flag scope (only enrolled leagues participate in shadow).
- Redraft roster model (`RedraftRosterPlayer`) and canonical roster model (`Roster.playerData`) must be kept in sync during the overlap window. The Phase R.2 parity check defines the sync invariant.
- GuillotineWaiverRelease `Float` bid amounts must be coerced to `Int` for canonical `WaiverClaim.faabBid`. The Guillotine bridge documents this rounding rule.

**Not changed by this ADR:**
- Decision OS Stage 1 soak — not disrupted; waiver shadow slice is read-only.
- Specialty concept behavior (Guillotine elimination guard, Survivor freeze) — plugin hooks wrap existing behavior, do not change it.
- `lib/waiver-engine` (AI/recommendation package) — naming collision is a documentation debt, not architectural; rename is a separate refactor.

---

## Rejected Decisions

- **No schema migration in this phase.** `RedraftWaiverClaim` and `GuillotineWaiverRelease` are not dropped until Phase 4 (table retirement) of their respective format migrations, with a minimum 30-day soak after Phase 3.
- **No dual-write without a parity gate.** Shadow phase completes and parity reports must show zero divergence on 5 consecutive processing runs before the canonical-primary flag is enabled.
- **No processor changes for Guillotine before a bridge spec is written.** The Guillotine bridge (Phase G) requires a separate planning pass after Redraft convergence is complete.

---

## References

- G16 audit: `lib/waiver-engine/G16_CORE_WAIVER_ENGINE_AUDIT.md`
- Canonical processor: `lib/waiver-wire/process-engine.ts`
- Redraft engine: `lib/redraft/waiverEngine.ts`
- Phase 5.1 behavioral event port: `lib/decision-os/behavioral/port.ts`
- Decision OS Stage 1 cutover plan: `lib/decision-os/CUTOVER_PLAN.md`
