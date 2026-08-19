# Decision OS — Production Readiness Checklist

**Project:** AllFantasy Decision OS  
**Purpose:** Authoritative record of how the Decision OS layer matured from architecture to
full production deployment. Intended audience: engineering team, leadership, investors, and
any future team members who need to understand the system's provenance and validation history.

---

## What Decision OS Is

Decision OS is AllFantasy's intelligence layer — an origin-blind, additive enrichment system
that sits beside legacy fantasy recommendation logic without replacing it. It assembles a
Canonical World (a provenance-free fact substrate drawn from native and imported league data),
runs rule-based evaluation across four decision domains (Lineup / Waiver / Trade /
Commissioner Health), and attaches structured Decision Objects to API responses behind
environment-variable kill switches. No data is mutated. All rollbacks are instant.

---

## Milestone Tracker

| # | Milestone | Status | Date | Evidence |
|---|-----------|--------|------|----------|
| 1 | Phase 1 — Architecture | ✅ Complete | 2026-06-29 | `lib/decision-os/ARCHITECTURE_FREEZE.md` |
| 2 | Phase 2 — Canonical Enrichment | ✅ Complete | 2026-06-30 | F2.1–F2.8, 63 tests GREEN |
| 3 | Phase 3 — Real-Data Validation | ✅ Complete | 2026-06-29 | `ADR_F1_REALLEAGUE_CONFORMANCE.md` |
| 4 | Phase 4 — Stage 1 Code Readiness | ✅ Complete | 2026-06-30 | 679 tests GREEN, all 4 slices |
| 5 | Commissioner Soak (7 days) | ⏳ Pending | — | `DECISION_OS_COMMISSIONER_HEALTH_LIVE=true` |
| 6 | Trade Soak (7 days) | ⏳ Pending | — | `DECISION_OS_TRADE_LIVE=true` |
| 7 | Waiver Soak (7 days) | ⏳ Pending | — | `DECISION_OS_WAIVER_LIVE=true` |
| 8 | Lineup Soak (7 days) | ⏳ Pending | — | `DECISION_OS_LINEUP_LIVE=true` |
| 9 | Stage 2 Cutover | ⏳ Pending | — | UI reads Decision OS primary |
| 10 | Full Production | ⏳ Pending | — | Legacy paths retired, soak complete |

---

## Phase Detail

### ✅ Phase 1 — Architecture (Frozen 2026-06-29)

Designed and validated the origin-blind Canonical World substrate (`lib/decision-os/world/`),
the Decision Object contract, the four-slice rule framework (Lineup / Waiver / Trade /
Commissioner Health), and the Stage 0→1→2→3 rollout model with environment-variable kill
switches. Architecture freeze declared after all four slices validated on native + imported
real data.

**Key files:** `ARCHITECTURE_FREEZE.md`, `ADR_PHASE4_CUTOVER_READINESS.md`  
**Invariants established:** purpose-blindness (P1), enrichment-as-truth / no fabrication (P2),
AI governance — AI never generates deterministic facts (P3)

---

### ✅ Phase 2 — Canonical Enrichment (Complete 2026-06-30)

Eight enrichment layers built as read-only derived views on top of the frozen substrate.
Each layer is additive — null + uncertainty when data is unavailable, never fabricated.

| Layer | Commit | Coverage |
|-------|--------|----------|
| F2.1 Player Metadata | `5771a78a1` | Name, position, age, experience |
| F2.2 Schedule / Bye Week | `f23068c10` | NFL week calendar, bye weeks |
| F2.3 Injury Status | `c8b4dbc99` | Injury reports, practice status |
| F2.4 ADP / Market Value | `16c87f831` | `AdpDataRecord`, cached ADP enrichment |
| F2.5 Projections | `1fb09cb8a` | `FantasyProjection`, current-week rows |
| F2.6 Weather Context | `5672ca1c8` | Game-day weather for outdoor venues |
| F2.7 News Signal | `05a4610a7` | Recent player news, signal strength |
| F2.8 League Intelligence | `a5d8096d4` | Health score, activity tiers, reputation |

**63 tests GREEN across all enrichment layers.**

---

### ✅ Phase 3 — Real-Data Validation (Complete 2026-06-29)

Validated the full Decision OS pipeline against live data on a non-production Neon DB
(`ep-winter-salad`). Proved origin-blindness, world conformance, trade conformance, and
lineup/waiver/commissioner conformance on both imported Sleeper leagues and native AF leagues.

**Key findings resolved:**
- F0-1: Provider name leak via `scoringSettings.visualTheme.logoUrl` → closed with `narrowScoringSettings` allow-list
- RedraftRoster storage gap → closed with union read adapter (canonical wins)

**Conformance scripts (all GREEN on staging):**
- `scripts/decision-os-world-conformance.ts` → `WORLD_CONFORMANCE_OK`
- `scripts/decision-os-lineup-conformance.ts` → `LINEUP_CONFORMANCE_OK`
- `scripts/decision-os-waiver-conformance.ts` → `WAIVER_CONFORMANCE_OK`
- `scripts/decision-os-trade-conformance.ts` → `TRADE_CONFORMANCE_OK`
- `scripts/decision-os-commissioner-conformance.ts` → `COMMISSIONER_CONFORMANCE_OK`

**ADR:** `ADR_F1_REALLEAGUE_CONFORMANCE.md`

---

### ✅ Phase 4 — Stage 1 Code Readiness (Complete 2026-06-30)

All four slices wired for Stage 1 production enrichment behind environment-variable kill
switches. Decision OS failures are fully isolated — the legacy path is always returned.

| Slice | Kill Switch | Response Field | Commit |
|-------|-------------|----------------|--------|
| Commissioner Health | `DECISION_OS_COMMISSIONER_HEALTH_LIVE` | `decisionOsShadow` on snapshots | `d54c43ca3` |
| Trade | `DECISION_OS_TRADE_LIVE` | `decisionOs: { decisionId, card, completeness, uncertaintySources }` | `323385f7f` |
| Waiver | `DECISION_OS_WAIVER_LIVE` | `decisionOs: { decisionId, card, confidence, legal }` | `debd8b2b7` |
| Lineup | `DECISION_OS_LINEUP_LIVE` | `decisionOs: { decisionId, card, confidence, leagueId }` | `0491144b7` |

**Phase 4.5:** Activation readiness ADR (`ADR_PHASE4_5_STAGE1_ACTIVATION_READINESS.md`) —
per-slice rollback contracts, 7-day soak criteria, activation order, production checklist.

**Phase 4.6:** Production telemetry wired (`ADR_PHASE4_6_TELEMETRY.md`) — fixed prod
blackhole (`console.debug` → `console.log`), added `decision.live_enrichment` event,
instrumented all 4 LIVE blocks with timing, added gate-check script
(`scripts/decision-os-telemetry-gate.ts`). Commit: `26ed201a1`.

**Test suite: 679/679 GREEN.**

---

### ⏳ Phase 5 — Production Soak (In Progress)

**Activation order:** Commissioner → Trade → Waiver → Lineup. Each slice soaks for 7 days
before the next is enabled. Any `parity_failed` event resets the clock for that slice.

#### 5a. Commissioner Soak
- **Flag:** `DECISION_OS_COMMISSIONER_HEALTH_LIVE=true`
- **Gate threshold:** ≥ 100 `parity_passed`, 0 `parity_failed`
- **Start date:** —
- **Pass date:** —
- **Status:** ⏳ Awaiting flag activation

#### 5b. Trade Soak
- **Flag:** `DECISION_OS_TRADE_LIVE=true`
- **Gate threshold:** ≥ 500 `parity_passed`, 0 `parity_failed`
- **Prerequisite:** Commissioner soak ✅ + ADP cron GREEN in prod
- **Status:** ⏳ Blocked on 5a

#### 5c. Waiver Soak
- **Flag:** `DECISION_OS_WAIVER_LIVE=true`
- **Gate threshold:** ≥ 500 `parity_passed`, 0 `parity_failed`
- **Prerequisite:** Trade soak ✅
- **Status:** ⏳ Blocked on 5b

#### 5d. Lineup Soak
- **Flag:** `DECISION_OS_LINEUP_LIVE=true`
- **Gate threshold:** ≥ 500 `parity_passed`, 0 `parity_failed`
- **Prerequisite:** Waiver soak ✅
- **Status:** ⏳ Blocked on 5c

**7-day soak pass criteria (all slices):**
- 0 `parity_failed` events
- ≤ 1% `shadow_error` rate
- ≥ 95% `decisionOs` presence rate (LIVE enriched / total LIVE calls)
- p99 LIVE path latency ≤ baseline
- Legacy response fields unchanged (verified by source-contract test suite)

**Gate script:**
```sh
vercel logs --json --since 7d | npx tsx scripts/decision-os-telemetry-gate.ts
```

---

### ⏳ Phase 6 — Stage 2 Cutover (Not Started)

UI reads Decision OS output as primary. Legacy recommendation logic becomes the fallback.
Requires all four Phase 5 soaks passing + a 30-day coverage audit confirming no regression
in recommendation quality vs the legacy baseline.

No Stage 2 work starts until Phase 5 is complete.

---

### ⏳ Phase 7 — Full Production (Not Started)

Legacy recommendation paths retired after a final 30-day soak with Decision OS as the
sole source. Requires a full coverage audit, rollback plan review, and explicit sign-off.

---

## Engineering State Summary (as of 2026-06-30)

| Dimension | Status |
|-----------|--------|
| Architecture | Frozen — no redesign without ADR |
| Enrichment coverage | 8 layers complete, null+uncertainty for all gaps |
| Real-data validation | Passed on imported Sleeper + native AF leagues |
| Stage 1 code | 4/4 slices complete, kill switches ready |
| Production telemetry | Wired — `[decision-os]` events flow to Vercel log drain |
| Test coverage | 679/679 GREEN |
| DB writes | None — Decision OS is read-only throughout |
| Rollback | Instant — env var change, no deploy required |
| Remaining work | Operational validation only |

The architecture, validation, and rollout infrastructure are complete. The remaining work
is rollout discipline: enable one kill switch, observe for 7 days, advance. Engineering
uncertainty has been resolved.

---

## Key Documents

| Document | Location |
|----------|----------|
| Architecture Freeze | `lib/decision-os/ARCHITECTURE_FREEZE.md` |
| Cutover Readiness (Stage model, kill switches) | `lib/decision-os/ADR_PHASE4_CUTOVER_READINESS.md` |
| Stage 1 Activation Readiness | `lib/decision-os/ADR_PHASE4_5_STAGE1_ACTIVATION_READINESS.md` |
| Telemetry + Alerts | `lib/decision-os/ADR_PHASE4_6_TELEMETRY.md` |
| Real-League Conformance | `lib/decision-os/ADR_F1_REALLEAGUE_CONFORMANCE.md` |
| Non-Prod Imported League Seeding | `lib/decision-os/ADR_F0_NONPROD_IMPORTED_LEAGUE.md` |
| Gate-check script | `scripts/decision-os-telemetry-gate.ts` |
