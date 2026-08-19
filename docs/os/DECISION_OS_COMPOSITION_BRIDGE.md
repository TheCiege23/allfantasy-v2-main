# Fantasy OS — V8.4 Production Decision OS Evidence Bridge & Composition Validation

**Branch:** `g15-event-foundation` · **Scope:** internal validation tooling. No customer-facing OS change,
**no Decision OS logic change**, no presentation change, no new database, no importer duplication.

> **Success condition met:** the persisted corpus now exercises every legitimately-reachable **production
> Decision OS composition function** through a narrow, read-only, provider-neutral bridge; production and
> validation share the *same* pure composition code; blocked subsystems are documented with their exact
> missing contract; and no production/persistence boundary was weakened.

---

## 1. Part 1 — production composition graph (traced before coding)

The product's composition is already factored into **DB-backed `resolve*Snapshot` wrappers** (async; fetch
+ assemble inputs) that call **pure composition functions**. The pure functions are the real composition
logic; the resolvers only feed them. So the corpus can validate the real composition by supplying those
pure functions' inputs — no extraction, no copied logic, no parallel Decision OS.

| Subsystem | Real entry point | Purity | Classification |
| --- | --- | --- | --- |
| League Health | `monitorLeagueHealth` | pure | **pure-derivation-executed** (V8.3) |
| League Attention Signals | `deriveLeagueAttentionSignals` | pure | **pure-derivation-executed** (V8.3) |
| Daily Brief | `composeDailyBrief` | pure | **production-parity-executed** |
| Notification Feed | `composeNotificationFeed` | pure | **production-parity-executed** |
| Platform Recommendations | `assemblePlatformRecommendations` | pure | **production-parity-executed** |
| Commissioner Recommendations | `assembleCommissionerRecommendations` | pure | **production-parity-executed** (archetype slice) |
| Manager Recommendations | `assembleManagerRecommendations` | pure | **blocked-unavailable-evidence** (needs manager identity + behavioral patterns) |
| Mission Control / Manager Command Center / League Analytics | `resolve*Snapshot` | DB-backed | **blocked-product-state** |

## 2. Parts 2–4 — bridge architecture (smallest legitimate)

Chosen: **a narrow read-only evidence port** (`CompositionEvidencePort` + `CorpusEvidencePort`) that exposes
only the facts the pure composers need (per-league health + attention signals + portfolio aggregates),
derived deterministically from the persisted corpus. **No assembler was extracted** — the pure composers
already exist separately (that is *why* the resolvers can be thin). The bridge reuses them directly.

**Why this does not duplicate the operational importer:** it performs zero fetching, zero writes, zero
Prisma, and reads only the already-persisted validation corpus. The operational product import
(`ImportRun` / `DecisionOsImportedActivity` / `prismaImportedActivityStore`) is untouched. The bridge is a
read-only, engineering-only seam — **not** an alternate production backend.

## 3. Part 5/8 — composition execution matrix (live, 6-league `theciege24` smoke)

```
production-parity-executed   Daily Brief (composeDailyBrief)                 produced=5   owner=platform
production-parity-executed   Notification Feed (composeNotificationFeed)     produced=17  owner=platform
production-parity-executed   Platform Recommendations (assemblePlatform…)    produced=0   owner=platform
production-parity-executed   Commissioner Recommendations (assembleCommis…)  produced=0   owner=commissioner
blocked-unavailable-evidence Manager Recommendations (assembleManager…)      produced=0   owner=manager
blocked-product-state        Mission Control (resolveMissionControlSnapshot) produced=0   owner=platform
blocked-product-state        Manager Command Center (resolveManagerCommand…) produced=0   owner=manager
blocked-product-state        League Analytics (resolveLeagueAnalyticsSnap…)  produced=0   owner=league
```

**The real production Daily Brief and Notification composition executed over corpus-derived evidence** (5
brief items, 17 notifications). Platform/Commissioner assembly executed but produced 0 for this healthy,
limited-slice corpus — a legitimate empty result (execution ≠ output), not a defect and not fabricated.

### Seven-OS semantic status (execution evidence, not shape booleans)

| OS | Status |
| --- | --- |
| Platform | **production composition validated** (Daily Brief, Notifications, Platform recs) |
| Commissioner | **production composition validated** (Commissioner recs, archetype slice) + health/attention pure-derivation |
| League | **pure-derivation validated** (health/engagement/fairness); `resolveLeagueAnalyticsSnapshot` blocked-product-state |
| Manager | **blocked-unavailable-evidence** (manager identity + patterns); `resolveManagerCommandCenterSnapshot` blocked-product-state |
| Trade / Waiver / Draft | **evidence-compatible** (activity/FAAB/draft evidence available); product recommendation engines are the DB-backed resolvers |

## 4. Parts 9–10 — parity + counterfactual composition

- **Determinism/parity:** two ports over identical evidence produce identical executions (deterministic
  fingerprints) — the port is a pure function of its evidence; fixture and file-backed evidence yield the
  same composition inputs.
- **Counterfactual:** adding an unhealthy league raises the real Daily Brief output vs an all-healthy
  corpus (`producedCount` increases); a fully-healthy corpus yields a legitimately empty/healthy brief
  (`isHealthy`, no fabricated work). Proven at the *composition* level, not just the health engine.

## 5. Parts 11–12 — defects + boundaries

**Proven defects: none. Decision OS behavior changed: no.** The Platform/Commissioner empty output was
traced to legitimately-partial inputs (only the archetype slice / portfolio aggregates are available),
not a defect. **Boundaries verified:** no `app/`/`components/` file imports the validation tooling (0
matches); the bridge imports no Prisma/db and performs no writes (test-enforced); no customer route reads
the file-backed store; production write paths unchanged; raw provider ids stay internal (report scanned
clean).

## 6. Parts 13–14 — reports + tests

Artifacts (labeled by evidence level): the composition execution matrix (`--validate` writes
`composition-execution-matrix-*.json`), plus the V8.3 validation/diversity/over-firing reports. Tests:
`__tests__/validation-cohort/composition-bridge.test.ts` (8): execution statuses, blocked-contract honesty,
determinism, counterfactual composition, and boundary (read-only, no prisma). Full targeted **82/82**
(validation-cohort + gateway + white-label); typecheck **158 (baseline preserved)**, 0 errors in touched
files.

## 7. Live smoke scope + remaining

`theciege24`, 6 real leagues, bounded single-account smoke — **not** diverse-user validation, cohort
calibration, cross-provider parity, or pilot completion. No real cohort supplied. Remaining before
diverse-cohort calibration: the real multi-account username cohort. Manager-facing composition and the DB
resolvers remain blocked pending, respectively, a legitimate manager-identity/pattern contract and a
DB-backed store implementation — neither fabricated here.
