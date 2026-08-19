# Decision OS — Decision Registry

The authoritative, **append-only** map of every decision in AllFantasy migrated to (or planned for) the
Decision OS. One row per decision. **Never remove a row** — when a decision advances
(Legacy → Hybrid → Native → Legacy Removed) update its **status in place**; the row persists as history.

> Maintenance rule: every Decision OS slice adds exactly one row here as part of its build ticket, and
> updates the row's status on every migration-state change (shadow → cutover → legacy removed).

Legend:
- **Scope** — `user` (manager) · `commissioner` · `operator`
- **Decision status** — `Legacy` · `Hybrid` (shadow beside legacy) · `Native` (Decision OS is the source of truth) · `Legacy Removed`
- **Parity type** — `Wrap` (wrap-fidelity: Decision OS wraps an existing deterministic engine, fed its output) · `Independent` (Decision OS recomputes; parity compares two independent computations)
- **Production status** — `Shadow` · `Cutover` · `Off`

---

## Shipped decisions

| Decision ID | Scope | Canonical engine | World resolver | Rule framework | Status | Shadow flag | Parity | Production |
|---|---|---|---|---|---|---|---|---|
| `manager.lineup.set` | user | `computeLineupActionsForUser` (`lib/lineup-actions`) + validators `validateRedraftLineup` / `validateCanonicalRosterPayload` | `resolveLineupWorld` (`lib/decision-os/lineup/world.ts`) — wraps `resolveRedraftRosterConfig` + `evaluateLineupLock` | `lib/decision-os/lineup/rules.ts` — primary `validateRedraftLineup` + lock rule; canonical validator composed for parity | **Hybrid** | `DECISION_OS_LINEUP_SHADOW` | Wrap | Shadow |
| `manager.waiver.claim` | user | `runWaiverAIService` → `suggestWaiverPickups` (`lib/waiver-ai-engine`) | `resolveWaiverWorld` (`lib/decision-os/waiver/world.ts`) — `getEffectiveLeagueWaiverSettings` + unified `Roster` facts | `lib/decision-os/waiver/rules.ts` — `assertWaiverClaimEligibility` (throws) caught + mapped to verdicts | **Hybrid** | `DECISION_OS_WAIVER_SHADOW` | Wrap | Shadow |
| `manager.trade.evaluate` | user | `buildTradeValueSnapshot` via `captureRedraftTradeValueSnapshot` (`lib/trade-value`) — deterministic, no AI | `resolveTradeWorld` (`lib/decision-os/trade/world.ts`) — League trade settings + season + all participant rosters | `lib/decision-os/trade/rules.ts` — deterministic deadline/FAAB + caught legality | **Hybrid** | `DECISION_OS_TRADE_SHADOW` | Wrap | Shadow |
| `commissioner.league.health` | commissioner | `monitorLeagueHealth` (`lib/league-health/league-health-engine.ts`) via `getCommissionerHubHealthForUser` / `buildCommissionerHealthSnapshot` — deterministic, no AI | `resolveCommissionerHealthWorld` (`lib/decision-os/commissioner-health/world.ts`) — from the built snapshot (league + metrics + counts) | `lib/decision-os/commissioner-health/rules.ts` — return-style threshold → `requires_approval` verdicts (assessment, never illegal) | **Hybrid** | `DECISION_OS_COMMISSIONER_HEALTH_SHADOW` | Wrap | Shadow |

### Per-decision notes
- **`manager.lineup.set`** — commits `aad4cccfa`, `bd69e24bf`. The two validators are *complementary* (composed, neither retired). `automation_capable: true` (auto-sub).
- **`manager.waiver.claim`** — commit `3408a8891`. Recommender is pure over injected input; parity keys on `deterministic.suggestions[].playerId`, AI prose ignored. Decision **never executes a claim** (`automation_capable: false`). Avoid `fetchWaiverDashboard` (Sleeper-only widget) and the parallel `redraftWaiverClaim` store.
- **`manager.trade.evaluate`** — commit `7ba2d9b6e`. First GREEN live staging run. Evaluate-only (never `accept/reject/cancel/process/settle`; `automation_capable: false`). **Multi-team:** the legacy evaluator is two-team only; the DCO is `participants[]`-capable; 3+ team trades degrade to `unsupported_by_legacy_evaluator` (honest four answers, no fabricated grade, parity short-circuits `unsupported`).
- **`commissioner.league.health`** — first `commissioner` scope; **assessment-only** decision. Shadow mounts inside `getCommissionerHubHealthForUser` (DB path, after each per-league `buildCommissionerHealthSnapshot`), one league/request, fire-and-forget, skips fallback. **Actions are read-only navigation suggestions** (`/league/...?tab=...`) — the Decision OS **mutates nothing** (never changes settings, announces, locks, reverses trades, processes waivers, adjusts scores; `automation_capable: false`). Risk scores (churn/dispute/abandonment) are **derived from the snapshot memo** (the snapshot drops them), not recomputed. **AI commissioner insights (`getAICommissionerInsights`) are out of scope.** No validator-parity seam — health verdicts are `requires_approval` (assessment), and `core/parity.compareValidatorParity` compares `illegal` categories, so it does not apply; the score-level shadow parity is the gate.

---

## Shared infrastructure (not a decision)

| Module | Purpose |
|---|---|
| `lib/decision-os/core/decision.ts` | The Decision Object + four-answer contract (`assertFourAnswers`, `RuleVerdict`, `DeciderScope`) |
| `lib/decision-os/core/telemetry.ts` | Split events: `decision.issued` / `decision.shadow_parity` / `decision.validator_parity` |
| `lib/decision-os/core/parity/` | `compareKeyedParity` (shadow), `compareValidatorParity`, parity emitters — domain-blind |
| `lib/decision-os/core/shadow/` | `shouldRunShadow(flag)` gate — domain-blind |

---

## Planned / not yet canonicalized

| Decision ID | Scope | Status | Notes |
|---|---|---|---|
| `manager.trade.evaluate` (3+ team) | user | **Unsupported by legacy evaluator** | `buildTradeValueSnapshot` is two-team only. Modeled multi-team-capable in the DCO; awaits a deterministic N-team evaluator before it can be graded/parity-checked. |

---

## Migration KPIs (snapshot)

- DCO consumption (migrated decisions): 100% (architecture-test-enforced)
- Deterministic decisions: 100% (AI is explanation-only, never in the verdict path)
- Sport logic in core: 0% (enforced)
- Explainable decisions: 100% (four answers, no model exposure)
- Telemetry: ~90% — **`decision.validator_parity` seam exists but is not yet production-wired on any slice** (consistent debt; close on one slice before scaling)
- Legacy removed: 0% (by design — all decisions are Hybrid/shadow; no cutover yet)
