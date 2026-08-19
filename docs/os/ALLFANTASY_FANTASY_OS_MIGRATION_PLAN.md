# AllFantasy Fantasy OS — Migration & Consolidation Plan

**Status:** Planning document. Read-only — no production code, schema, or file was written, refactored, or modified to produce this plan.
**Locked, authoritative inputs (implement, do not redesign):**
1. [`ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md`](ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md) — layer boundaries, OS modules, roadmap phase order.
2. [`ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md`](ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md) — entities, signals, versioning, confidence model.
3. [`ALLFANTASY_SHARED_FANTASY_DATA_MODEL_SPEC.md`](ALLFANTASY_SHARED_FANTASY_DATA_MODEL_SPEC.md) — canonical objects, ownership matrix, provider mapping.
4. The 2026-07-09 Fantasy OS Pivot Audit (5-agent codebase audit; findings referenced throughout this plan by file path).

**What this document is:** the bridge from what exists today to what those four documents specify. Every subsystem named below was independently verified against the current codebase during the pivot audit — this is not a hypothetical inventory.

---

## Table of Contents

1. Duplicate Subsystem Inventory
2. Migration Order (Zero-Downtime Pattern)
3. Service Boundaries
4. Implementation Dependency Graph
5. Milestones
6. Milestone Detail
7. Repository Roadmap
8. Implementation Backlog
9. Blockers
10. Deliverables Recap & First Implementation Task

---

## Part 1 — Duplicate Subsystem Inventory

| Duplicated subsystem | What exists today | Canonical replacement | Migration difficulty | Key dependencies | Risk |
|---|---|---|---|---|---|
| **Trade systems** | 5 parallel implementations: `lib/trade-engine/trade-engine.ts` (general evaluator, hardcoded to `lib/sleeper-client.ts` via `league-context-assembler.ts`), `lib/league-trade-engine/tradeService.ts` (native in-league workflow), `lib/trade-value/grader.ts` + `lib/decision-os/trade/*` (T2 grader + Decision OS shadow slice), `components/TradeFinderClient.tsx`'s inline `computeTradeGrade()` (4th, ad-hoc), plus 13 more `lib/trade-*` directories (analyzer/builder/finder/negotiation/value-console/market/review/discovery/block/veto/learning/chimmy-trade/trade-runtime) feeding into these to varying degrees | **Trade Service** (Part 3), backed by the shared Decision Pipeline (architecture spec Part 7) | **High** — most surface area, most user-visible numbers (trade grades) | Player Service (identity), Knowledge Graph (`ManagerProfile`), Import Service (provider-neutral context) | **High** — a visible grade changing on cutover can look like a bug to a real user; requires shadow-run parity before switchover |
| — *not a duplicate, keep separate* | `lib/replay-framework/` — deliberately isolated backtesting/validation layer over Sleeper-imported trades, by its own existing architectural rule (observational only, never feeds recommendations) | No change — remains a sibling to Trade Service, not folded into it | n/a | n/a | Low, as long as its isolation rule is respected during Trade Service consolidation |
| **Waiver systems** | 6+ parallel implementations: `lib/waiver-engine`, `lib/waiver-ai-engine`, `lib/waiver-wire`, `lib/waiver-defaults`, `lib/waiver-runtime`, `lib/ai-tools-waiver` + `waiver-ai-prompt.ts`; Decision OS's `lib/decision-os/waiver/*` is a read-only shadow slice, not the operative engine | **Waiver Service** (Part 3), sharing the roster-need calculation with Trade Service | **Medium** — smaller blast radius than trade | Roster Service, Trade Service (shared roster-need logic), Live Sports Data (injury-driven urgency) | **Medium** |
| **Commissioner systems** | 4 non-interoperating subsystems power the Commissioner Hub today: (A) Decision OS behavioral pipeline (`lib/decision-os/behavioral/*`), (B) Phase 6 Decision Intelligence (DNA/Recommendations/Archetypes — derived from A but shadow-gated), (C) `IntelligenceQueryService`/`IntelligenceLeagueSnapshot` (powers all 7 modules of the separate Commissioner Intelligence Hub — its own event taxonomy, disconnected from A), (D) Manager Intelligence Platform (Redraft-coupled). Plus `lib/league-health.ts`'s `monitorLeagueHealth`, now federated (not replaced) via `leagueHealthAlignment.ts` | **Commissioner Service**, reading only from League Service + Knowledge Graph | **High** — most mature, most revenue-relevant existing surface; must not regress a working product | League Service, Knowledge Graph (`LeagueProfile`) | **High** — same-Hub numbers currently can disagree between panels; fixing this touches the product's most polished surface |
| **League intelligence** | Mission Control (`missionControl.ts`) + League Analytics (`leagueAnalytics.ts`) + `monitorLeagueHealth` (`lib/league-health.ts`) + Platform OS (`platformOs.ts`) — already partially converging via `leagueHealthAlignment.ts` (landed in OS-B4.5) | **League Service** | **Low–Medium** — partial convergence already exists | Knowledge Graph (`LeagueProfile`) | **Low** |
| **Recommendation engines** | 6 draft-recommendation orchestrators share one scoring backbone (`lib/draft-helper/RecommendationEngine.ts`) but wrap it via 3 separate independent routes (War Room's `aiDraftHelper`, `draft-ai-engine`, `/api/draft-ai/route.ts`); separately, Decision OS's own Phase 6 recommendations engine (`lib/decision-os/phase6/recommendations`) | **Recommendation Service**, one Decision Pipeline instance per recommendation type (architecture spec Part 7) | **Medium** — backbone is already shared, only the routing layer needs consolidating | Knowledge Graph, Decision OS | **Low–Medium** |
| **Provider adapters** | 6 real adapters (`lib/league-import/{sleeper,espn,yahoo,mfl,fantrax,fleaflicker}`) at wildly uneven depth (Fantrax is CSV-only; Fleaflicker missing scoring/schedule/draft/trades); the deeper architectural bug: `league-context-assembler.ts` bypasses the adapter layer entirely and imports `lib/sleeper-client.ts` directly | **Import Service** (Part 3), with the bypass in `league-context-assembler.ts` fixed so Trade/Waiver Service consume normalized context regardless of source platform | **Medium** (the bypass fix) / **High** (Fantrax live connector, genuinely new integration) | Identity Service, canonical Player identity | **Medium** for the bypass fix; **Medium-High** for new Fantrax/Fleaflicker depth |
| **Player models** | Canonical cross-platform player identity only partially exists — FantasyCalc's own player directory is the only real cross-ID bridge today, and it feeds valuation only, not import reconciliation; `lib/player-data/nflRedraftPlayerIntelligence.ts` is a wholly separate, Redraft-only "Player Intelligence" system with no connection to Decision OS | **Player Service** (canonical `Player` + identity graph, SFDM Part 2/3) | **Medium–High** — foundational, many consumers depend on it existing correctly | none (this is a foundation-layer service) | **Medium** — an incorrect cross-platform match is a quiet correctness bug, not a loud failure, so validation must be strong before cutover |
| **Manager models** | Two parallel manager-psychology systems: `lib/psychological-profiles` (newer, DB-backed) vs. `/api/ai/manager-dna` (older, AI-generated, powers the live `app/manager-compare/page.tsx`); separately, `userOs.ts` (provider-agnostic) vs. the Manager Intelligence Platform (Redraft-coupled, doesn't work for import-only leagues) — a second Manager-OS-level duplication | **Manager Service**, standardized on the provider-agnostic `userOs.ts` path and `lib/psychological-profiles` | **Medium** | Knowledge Graph (`ManagerProfile`), Identity Service | **Medium** — `manager-compare` is a live, user-facing page; cutover must not silently change what a real user sees mid-session |
| **Ranking systems** | 3 parallel Power Rankings engines: `lib/league-power-rankings/PowerRankingEngine.ts`, `lib/platform-power-rankings/PlatformPowerRankingsService.ts`, `lib/rankings-engine/league-rankings-v2.ts` (the one actually wired to the live `app/power-rankings/page.tsx` via `/api/rankings/league-v2`) | Canonical target is likely **`league-rankings-v2`**, since it's already the one live consumers read — the other two become the ones retired, not a net-new build | **Medium** | League Service | **Low–Medium** — the live page already points at the likely-canonical engine, which lowers cutover risk relative to other consolidations |
| **Legacy surfaces** | 3 competing surfaces: `app/legacy/page.tsx` (a live route serving **entirely hardcoded mock data**), `app/af-legacy/page.tsx` (an 18,000+ line real monolith wiring 40+ real subsystems), and a newer, cleaner set of real engines (`legacy-score-engine`, `hall-of-fame-engine`, `career-prestige`) | **Legacy Service**, built on the newer engines | **High** — `af-legacy` is the largest single file touched in this entire plan | Knowledge Graph (`LegacyProfile`) | **High** for the `af-legacy` migration specifically; **Low** (and urgent) for simply retiring the hardcoded-mock `app/legacy` page, which can and should happen independently and immediately |

---

## Part 2 — Migration Order (Zero-Downtime Pattern)

Every subsystem above follows the same four-stage pattern — a strangler-fig migration, never a cutover-in-place:

```
Legacy implementation (still serving all traffic)
        │
        ▼
Shared Service stood up alongside it, in SHADOW mode
  (computes its own answer on every real request, logs the comparison,
   serves NOTHING to users yet)
        │
        ▼
Consumers migrated ONE AT A TIME to read from the Shared Service,
  gated behind a flag, with shadow-parity evidence required before each flip
        │
        ▼
Legacy implementation retired ONLY once every consumer has migrated
  AND a defined parity window has passed with no material divergence
```

Applied to each subsystem in Part 1:

- **Trade:** `trade-engine.ts` / `tradeService.ts` / T2 grader / Trade Finder's inline grader (legacy, 4 of them) → **Trade Service** (shadow, parity-tested against real historical trades) → consumers migrated in this order: Trade Finder's inline grader first (lowest stakes, client-local), then the general evaluator, then native in-league proposals, last → all 4 legacy graders retired.
- **Waiver:** the 6 `lib/waiver-*` systems (legacy) → **Waiver Service** (shadow) → consumers migrated → legacy retired. Sequence after Trade Service reaches shadow stage, since they share the roster-need calculation and building it twice would be wasted work.
- **Commissioner:** the 4 non-interoperating subsystems (legacy) → **Commissioner Service** reading League Service + Knowledge Graph (shadow — run parallel to the live Hub, compare every panel's numbers against what the Hub currently shows) → Hub panels migrated one at a time (Overview first, Audit Feed last, since Audit Feed is closest to raw event data and most sensitive to a numbers mismatch) → legacy subsystems retired.
- **League intelligence:** already mid-migration (Mission Control/League Analytics/League Health partially federated) → finish converging onto **League Service** → retire `monitorLeagueHealth`'s standalone path once `leagueHealthAlignment.ts`'s federation is complete, not partial.
- **Recommendation engines:** the 3 draft-recommendation routes (legacy) → **Recommendation Service** wrapping the already-shared `RecommendationEngine.ts` backbone (shadow is nearly free here, since the backbone is already shared — this is mostly a routing consolidation) → routes migrated → 2 of 3 routes retired.
- **Provider adapters:** `league-context-assembler.ts`'s direct Sleeper import (legacy pattern) → refactored to consume **Import Service**'s normalized output (shadow — run both paths, diff the resulting context object) → Trade/Waiver Service switched to the normalized path → direct import removed.
- **Player models:** FantasyCalc's narrow identity directory (legacy, valuation-only) → **Player Service**'s canonical identity graph (shadow — validate against FantasyCalc's existing directory as a correctness baseline, then extend beyond it) → every consumer of a provider-specific player ID migrated to the canonical ID → narrow directory retired as an import-reconciliation tool (FantasyCalc itself, as an external data source, is untouched).
- **Manager models:** `/api/ai/manager-dna` + Manager Intelligence Platform's Redraft-coupled profile (legacy) → **Manager Service** on `userOs.ts` + `lib/psychological-profiles` (shadow, run against `manager-compare`'s live traffic) → `manager-compare` page migrated → legacy AI-DNA path retired.
- **Ranking systems:** the 2 non-canonical Power Ranking engines (legacy) → confirm `league-rankings-v2` as canonical (likely no new shadow build needed, just consumer confirmation) → 2 legacy engines retired.
- **Legacy surfaces:** `app/legacy/page.tsx`'s mock data — **no shadow needed, retire immediately** (Part 6, Milestone 6) since there is no real logic to migrate away from, only a fake page to remove; `app/af-legacy/page.tsx`'s 40+ real subsystems migrate individually onto **Legacy Service** over the course of Milestone 6, each following the standard 4-stage pattern above.

---

## Part 3 — Service Boundaries

| Service | Inputs | Outputs | Ownership | Dependencies | Consumers |
|---|---|---|---|---|---|
| **Identity Service** | Platform login/OAuth/claim events | `FantasyUser`, `PlatformIdentity`, `Manager`, `CommissionerRole` (SFDM) | Normalized Data Layer | none (foundational) | every other service |
| **Import Service** | Raw provider payloads (Sleeper/ESPN/Yahoo/MFL/Fantrax/Fleaflicker) | Normalized `League`, `Roster`, `Trade`, `WaiverClaim`, `Draft`, `Matchup` facts (SFDM) | Provider Adapter + Normalized Data Layer | Identity Service | Player/League/Roster/Trade/Waiver Services |
| **Player Service** | Import Service output, FantasyCalc/Rolling Insights raw snapshots | Canonical `Player`, `PlayerSeason`, `PlayerStatus` (SFDM) | Normalized Data Layer | Import Service | Trade/Waiver/Game Day/Player Search/Exposure Services |
| **League Service** | Import Service output | `League`, `LeagueSeason`, `LeagueSettings`, `LeagueFormat`, `LeagueScoring`, `LeagueProfile` | Normalized Data Layer (raw) + Knowledge Graph (`LeagueProfile`) | Import Service, Identity Service | Trade/Waiver/Commissioner/Specialty League Services |
| **Roster Service** | Import Service output | `Roster`, `RosterSlot` | Normalized Data Layer | Import Service, Player Service | Trade/Waiver/Game Day/Exposure Services |
| **Trade Service** | League/Roster/Player Service output, Knowledge Graph `ManagerProfile`, Market Value | `Trade`, `TradeAsset`, `TradeOutcome`, Trade Time Machine views | Normalized Data Layer (fact) + Decision OS (evaluation) | Player, League, Roster, Knowledge Graph, Recommendation Service | Feature Surfaces (Trade Center) |
| **Waiver Service** | Same as Trade Service, plus Live Data Service (injury urgency) | `WaiverClaim`, waiver recommendations | Normalized Data Layer (fact) + Decision OS (evaluation) | Player, League, Roster, Live Data, Recommendation Service | Feature Surfaces (Waiver Center) |
| **Recommendation Service** | Context from any requesting service | `Recommendation`, `DecisionSnapshot`, `OutcomeSnapshot` | Decision OS | Knowledge Graph (evidence) | Trade, Waiver, Game Day, Specialty League Services |
| **Knowledge Graph Service** | Signals from Trade/Waiver/Import/Roster Services | `ManagerProfile`, `LeagueProfile`, `PlayerValue`, `PlayerExposure`, `LegacyProfile` (all versioned, confidence-wrapped) | Knowledge Graph | Player, League, Roster Services (as signal sources) | every downstream OS module |
| **Live Data Service** | Rolling Insights, OpenWeatherMap, news/injury feeds | `PlayerStatus`, weather/news events, schedule | Live Sports Data Layer | Player Service (identity join) | Waiver, Game Day Services |
| **FantasyCalc Service** | FantasyCalc raw API | Raw market value snapshots | Market Value Layer | Player Service (identity join) | Knowledge Graph (`PlayerValue` derivation) |
| **Game Day Service** | Roster, Player, Live Data, Knowledge Graph (`PlayerExposure`) | Cross-league search results, status board, alerts | Feature Surface | Player, Roster, Live Data, Knowledge Graph | End-user UI only |
| **Legacy Service** | Knowledge Graph (`LegacyProfile`), historical Trade/Draft/Decision records | Career profile, career rankings, Trade Time Machine, share cards | Feature Surface (reading Knowledge-Graph-owned data) | Knowledge Graph, Trade Service (for Time Machine) | End-user UI only |
| **Commissioner Service** | League Service, Knowledge Graph (`LeagueProfile`) | Health briefs, copy-ready content, storyline material | Feature Surface | League Service, Knowledge Graph, Legacy Service (storylines) | End-user UI only |
| **Specialty League Service** | League Format, format-specific signals | Format-specific evaluation layered onto Trade/Waiver/Recommendation | Feature Surface, using Decision OS's format-adapter pattern | Trade, Waiver, Recommendation Services | End-user UI only |
| **Player Search Service** | Player Service, Roster Service (across every league a user can see) | Global + cross-league player search results | Feature Surface | Player, Roster Services | Game Day Service (primary consumer), general search UI |
| **Exposure Service** | Player Search Service, Roster Service, Knowledge Graph | `PlayerExposure` (canonical shape), exposure UI feed | Knowledge Graph (data) + Feature Surface (UI) | Player Search, Roster, Knowledge Graph | Game Day Service |

---

## Part 4 — Implementation Dependency Graph

```
                        ┌────────────────────┐
                        │   Identity Service   │   (nothing depends on nothing; this is the root)
                        └──────────┬──────────┘
                                   ▼
                        ┌────────────────────┐
                        │   Import Service     │
                        └──────────┬──────────┘
                     ┌─────────────┼─────────────┐
                     ▼             ▼             ▼
            ┌──────────────┐┌──────────────┐┌──────────────┐
            │ Player Service ││ League Service ││ Roster Service │
            └───────┬──────┘└───────┬──────┘└───────┬──────┘
                     │              │               │
      ┌──────────────┼──────────────┼───────────────┤
      ▼              ▼              ▼               ▼
┌───────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐
│ Live Data  │ │ FantasyCalc  │ │ Trade Service │ │ Player Search    │
│ Service    │ │ Service      │ │               │ │ Service          │
└─────┬─────┘ └──────┬──────┘ └───────┬──────┘ └────────┬────────┘
      │              │                │                 │
      └──────┬───────┴────────┬───────┘                 │
             ▼                ▼                          ▼
      ┌────────────────────────────┐            ┌─────────────────┐
      │  Knowledge Graph Service     │◀───────────│ Waiver Service   │
      │  (ManagerProfile, LeagueProfile,          └─────────────────┘
      │   PlayerValue, PlayerExposure,
      │   LegacyProfile)              │
      └───────────────┬─────────────┘
                       │
      ┌────────────────┼──────────────────┬──────────────────┬───────────────────┐
      ▼                ▼                  ▼                  ▼                   ▼
┌───────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────────────┐
│ Recommend- │  │ Legacy Service │  │ Commissioner   │  │ Specialty      │  │ Exposure Service  │
│ ation Svc  │  │                │  │ Service        │  │ League Service │  │                   │
└─────┬─────┘  └───────────────┘  └───────────────┘  └───────────────┘  └─────────┬─────────┘
      │                                                                            │
      └────────────────────────────────┬───────────────────────────────────────────┘
                                        ▼
                               ┌────────────────┐
                               │ Game Day Service │  (the last thing built — depends on nearly everything)
                               └────────────────┘
```

**Reading the DAG:** Identity and Import are the only services with zero dependencies — everything else needs at least one of them. Trade and Waiver Service can be built in parallel once Player/League/Roster exist, since they don't depend on each other (only on shared inputs). Knowledge Graph Service requires signal sources (Trade/Waiver/Roster/Import) to exist before it can populate anything meaningful — this is why the Knowledge Graph spec's own build order defers most derivations until real signal sources are wired. Game Day Service is deliberately last: it's the thinnest consumer-only layer, but it depends on the widest set of upstream services (Player, Roster, Live Data, Knowledge Graph's `PlayerExposure`) of anything in the system.

---

## Part 5 — Milestones

| # | Milestone | One-line objective |
|---|---|---|
| 1 | Shared Services | Stand up Identity, Import, Player, League, Roster Service scaffolding — the foundation every later milestone builds on |
| 2 | Sleeper Import Hardening | Fix the confirmed-stale fetch-resilience gap on the flagship provider before building anything more on top of it |
| 3 | Knowledge Graph Population | Stand up the Knowledge Graph Service with its first two real derivations |
| 4 | Trade OS Consolidation | Collapse the 5 competing trade systems onto Trade Service |
| 5 | Waiver OS Consolidation | Collapse the 6+ competing waiver systems onto Waiver Service |
| 6 | Legacy OS | Retire the hardcoded-mock Legacy page immediately; migrate `af-legacy`'s real subsystems onto Legacy Service over time |
| 7 | Game Day OS | Build the Game Day Service and its UI from scratch — the single largest net-new surface in this plan |
| 8 | Commissioner OS | Collapse the 4 non-interoperating commissioner subsystems onto Commissioner Service |
| 9 | Specialty League OS | Port the 12 existing format rule engines onto the shared pipeline; design (not build) Pirate; flag Empire as unresolved |
| 10 | Additional Providers | Bring Fantrax to a real live connector, deepen Fleaflicker, close the cross-provider PlayoffBracket-results gap |

This matches the architecture spec's roadmap with one deliberate reordering: **Shared Services (identity, import, player, league, roster scaffolding) is pulled forward as its own explicit Milestone 1**, ahead of Sleeper hardening — because Identity Service in particular underpins every later milestone, not just Trade OS, and standing up the service boundary once is cheaper than each later milestone informally reinventing it.

---

## Part 6 — Milestone Detail

### Milestone 1 — Shared Services
- **Objective:** stand up Identity, Import, Player, League, Roster Service boundaries (SFDM Parts 2/6) as real, callable services — without moving any consumer onto them yet.
- **Deliverables:** Identity Service (FantasyUser/PlatformIdentity/Manager/CommissionerRole), a thin Import Service facade in front of the existing `lib/league-import/*` adapters (no adapter logic changes yet — just a consistent facade), Player/League/Roster Service read APIs backed by existing tables.
- **Files likely affected (net-new, additive only):** new `lib/shared-services/{identity,import,player,league,roster}/` modules; no existing file is modified in this milestone.
- **Risk:** Low — purely additive, nothing consumes these services yet.
- **Testing strategy:** contract tests per SFDM Part 8, run against the existing data these services wrap.
- **Rollback strategy:** delete the new modules; nothing else changed.
- **Success criteria:** all five services callable, all passing their contract test suites, zero consumers migrated yet.
- **Browser-verifiable outcome:** none expected this milestone — this is foundation-only, invisible to any UI.

### Milestone 2 — Sleeper Import Hardening
- **Objective:** add retry/backoff/timeout to `SleeperLeagueFetchService.fetchSleeperJson`, closing the confirmed gap (a prior claim that this was already fixed was confirmed stale against current code during the pivot audit).
- **Deliverables:** resilient fetch wrapper, honest freshness/warning surfacing end to end, no silent-null failures.
- **Files likely affected:** `lib/league-import/sleeper/SleeperLeagueFetchService.ts`, `lib/league-import/commissionerGate.ts` (tighten the membership-only gate while touching this area).
- **Risk:** Low — hardening existing code, not new architecture.
- **Testing strategy:** mocked-failure integration tests (timeout, 429, 5xx, network error) confirming retry then honest failure, never silent null.
- **Rollback strategy:** revert the fetch-wrapper change; the surrounding import pipeline is untouched.
- **Success criteria:** zero silent-null outcomes in the mocked failure suite; every failure produces a recorded, user-visible warning.
- **Browser-verifiable outcome:** an import that previously silently under-populated a large/old league now either succeeds fully or shows an explicit freshness warning in the import UI.

### Milestone 3 — Knowledge Graph Population
- **Objective:** stand up Knowledge Graph Service per its own spec's Part 15 build order — schema, minimal signal capture, exactly two derivations (`ManagerProfile`, `PlayerExposure`), confidence envelope, versioned store, privacy gate, minimal Query Service.
- **Deliverables:** as listed in the Knowledge Graph spec, scoped strictly to those two derivations.
- **Files likely affected:** new `lib/knowledge-graph/` module; signal-capture hooks added (additively) to `lib/league-trade-engine/tradeService.ts` and the waiver-claim resolution path, without altering their existing behavior.
- **Risk:** Low-Medium — the signal-capture hooks touch live transactional code paths, even though additively.
- **Testing strategy:** aggregate correctness against known historical leagues; cohort-gating unit tests before any aggregate is exposed.
- **Rollback strategy:** signal-capture hooks are additive and can be disabled via flag without affecting the underlying trade/waiver flow they're observing.
- **Success criteria:** both derivations computable from real imported data, both privacy-gated correctly at the cohort threshold.
- **Browser-verifiable outcome:** none directly user-facing yet — first real consumer arrives in Milestone 4.

### Milestone 4 — Trade OS Consolidation
- **Objective:** collapse the 5 competing trade systems onto Trade Service, using the zero-downtime pattern from Part 2.
- **Deliverables:** Trade Service in shadow mode, parity-tested against real historical trades from all 4 legacy graders; the dormant playoff-impact simulator (`lib/trade-engine/trade-impact-simulator.ts`) wired to a real route for the first time; Trade Time Machine's first working version.
- **Files likely affected:** `lib/trade-engine/*`, `lib/league-trade-engine/tradeService.ts`, `lib/trade-value/grader.ts`, `lib/decision-os/trade/*`, `components/TradeFinderClient.tsx`, `lib/trade-engine/league-context-assembler.ts` (the Sleeper-hardcoding fix happens here specifically).
- **Risk:** High — the largest, most user-visible consolidation in this plan.
- **Testing strategy:** shadow-parity comparison against a corpus of real historical trades before any consumer is switched; regression suite on the consolidated engine; the existing Sleeper validation league (referenced in prior import-hardening work) is a natural first parity target.
- **Rollback strategy:** each consumer migration is independently flag-gated; a regression in one migrated consumer does not require rolling back the others.
- **Success criteria:** all 4 legacy graders retired; trade evaluation produces consistent results regardless of source platform (the direct proof the Sleeper-hardcoding fix worked).
- **Browser-verifiable outcome:** a trade proposal in an *imported ESPN or Yahoo league* produces a real, non-degraded evaluation — something that does not reliably happen today.

### Milestone 5 — Waiver OS Consolidation
- **Objective:** same pattern, applied to the waiver systems; build the waiver-grade capability that doesn't exist today.
- **Deliverables:** Waiver Service, sharing Trade Service's roster-need calculation; a new waiver-grade output, closing a gap the audit found has no equivalent today.
- **Files likely affected:** `lib/waiver-engine`, `lib/waiver-ai-engine`, `lib/waiver-wire`, `lib/waiver-defaults`, `lib/waiver-runtime`, `lib/ai-tools-waiver`.
- **Risk:** Medium.
- **Testing strategy:** same shadow-parity approach as Milestone 4, smaller corpus.
- **Rollback strategy:** same per-consumer flag-gating.
- **Success criteria:** all legacy waiver systems retired; a waiver grade is producible for the first time.
- **Browser-verifiable outcome:** the Waiver Center shows a grade/quality indicator on a completed claim, where today it shows none.

### Milestone 6 — Legacy OS
- **Objective:** two independent tracks — (a) retire the hardcoded-mock `app/legacy/page.tsx` immediately (no shadow needed, nothing real to migrate away from), and (b) migrate `af-legacy`'s 40+ real subsystems onto Legacy Service over time.
- **Deliverables:** track (a) ships in days, independent of everything else in this plan; track (b) follows the standard 4-stage pattern per subsystem inside the monolith.
- **Files likely affected:** `app/legacy/page.tsx` (removed/redirected), `app/af-legacy/page.tsx` (migrated incrementally), `legacy-score-engine`, `hall-of-fame-engine`, `career-prestige` (become the canonical home).
- **Risk:** Low for track (a); High for track (b), given the monolith's size.
- **Testing strategy:** for (a), a content audit confirming no remaining page renders non-derived/mock data; for (b), per-subsystem parity tests as each of the 40+ pieces migrates.
- **Rollback strategy:** (a) is a simple revert; (b) is per-subsystem, isolated by the same flag-gating pattern as Milestones 4/5.
- **Success criteria:** zero live routes serving mock data (immediate); `af-legacy` fully absorbed into Legacy Service (longer-term).
- **Browser-verifiable outcome:** `/legacy` either redirects to real data or is removed, immediately — no user can land on a page of fake numbers.

### Milestone 7 — Game Day OS
- **Objective:** build Game Day Service and its UI from scratch — the largest genuinely net-new surface in this plan.
- **Deliverables:** cross-league player search (the single highest-priority build per the architecture spec), exposure tracking wired to real data (the logic already exists, orphaned — this connects it), roster-status alerts wired to the injury cron (also already exists, orphaned), kickoff-window grouping.
- **Files likely affected:** new `app/game-day/*` surface; `lib/notification-engine.ts`'s `injuryAlert()` (finally given a real caller); `lib/portfolio-manager/portfolio-manager-engine.ts` (finally given a real data source and UI).
- **Risk:** Low on the orphaned-logic connections; Medium on the greenfield UI.
- **Testing strategy:** end-to-end test of "search a player, see every league" across at least two providers.
- **Rollback strategy:** new surface, flag-gated at the route level; disabling the flag fully reverts.
- **Success criteria:** a player search returns every league (native + imported) where that player appears, with current status and a deep link.
- **Browser-verifiable outcome:** searching a rostered player in the new Game Day surface shows it across every one of a test user's leagues, native and imported alike — directly demonstrable in a browser session.

### Milestone 8 — Commissioner OS
- **Objective:** collapse the 4 non-interoperating commissioner subsystems onto Commissioner Service.
- **Deliverables:** one data source for every panel in the Commissioner Hub; the copy-ready content engine (architecture spec Part 11).
- **Files likely affected:** `lib/decision-os/behavioral/*`, `lib/decision-os/phase6/*`, the `IntelligenceQueryService`/`IntelligenceLeagueSnapshot` pair, Manager Intelligence Platform's commissioner-facing pieces, `CommissionerCommandCenterSection.tsx`, `CommissionerIntelligenceHub.tsx`.
- **Risk:** High — this is the most mature, most polished existing surface; a regression here is the most customer-visible risk in this entire plan.
- **Testing strategy:** consistency checks confirming every panel reads the same underlying numbers for the same league, run in shadow before any panel is switched.
- **Rollback strategy:** panel-by-panel flag gating, Overview panel first (lowest risk), Audit Feed last (closest to raw data, most sensitive to mismatch).
- **Success criteria:** zero cross-panel numeric disagreement within the Hub.
- **Browser-verifiable outcome:** every panel in the Commissioner Hub, viewed together, tells one consistent story about the same league — testable by cross-checking any two panels' shared numbers side by side.

### Milestone 9 — Specialty League OS
- **Objective:** wrap the 12 existing format rule engines as format adapters onto the now-consolidated Trade/Waiver/Recommendation Services; design (not build) Pirate; flag Empire as an open product question.
- **Deliverables:** format-adapter interface; all 12 existing formats ported; a validated Pirate rule spec (steal mechanics, protected slots) ready for a future build, not built in this milestone.
- **Files likely affected:** the 12 existing format directories (`lib/dynasty-*`, `lib/keeper*`, `lib/bestball*`, `lib/salary-cap`, `lib/guillotine*`, `lib/survivor`, `lib/zombie`, `lib/tournament*`, `lib/big-brother`, `lib/devy`, `lib/c2c`, `lib/idp`).
- **Risk:** Medium — twelve formats is a lot of surface area, but each is a port of existing logic, not new logic (except Pirate, deliberately deferred).
- **Testing strategy:** per-format regression suite confirming format-specific behavior survives the port (e.g., Survivor/Zombie correctly opting out of trade support).
- **Rollback strategy:** per-format flag gating; a regression in one format's port doesn't block the other eleven.
- **Success criteria:** every existing format produces identical behavior through the new shared pipeline as it did through its standalone implementation.
- **Browser-verifiable outcome:** a Guillotine or Survivor league's trade/waiver flow behaves identically pre- and post-migration, verifiable by direct comparison in a test league.

### Milestone 10 — Additional Providers
- **Objective:** bring Fantrax to a real live connector (replacing the CSV-only stub), deepen Fleaflicker, close the cross-provider PlayoffBracket-results gap.
- **Deliverables:** live Fantrax connector, complete Fleaflicker field coverage, `PlayoffBracket.results` populated for every provider that can supply it.
- **Files likely affected:** `lib/league-import/fantrax/*` (net-new live path, replacing the CSV-only `fetchFantraxLeague()` stub), `lib/league-import/fleaflicker/*`.
- **Risk:** Medium-High on Fantrax specifically (genuinely new integration, dependent on what access model Fantrax actually offers — an open question, see Part 9); Medium on Fleaflicker.
- **Testing strategy:** the same import-fidelity contract test suite Sleeper already has (Milestone 2), run against each remaining provider.
- **Rollback strategy:** provider-by-provider — a failed Fantrax rollout doesn't touch the other five providers.
- **Success criteria:** Fantrax leagues refresh automatically, not via manual CSV upload.
- **Browser-verifiable outcome:** a Fantrax league connected to AllFantasy shows a data freshness timestamp under an hour old, without any manual upload action.

---

## Part 7 — Repository Roadmap

**New directories:**
```
lib/shared-services/
  identity/
  import/
  player/
  league/
  roster/
  trade/
  waiver/
  recommendation/
  knowledge-graph/
  live-data/
  fantasycalc/
  game-day/
  legacy/
  commissioner/
  specialty-league/
  player-search/
  exposure/
app/game-day/            (new Feature Surface, Milestone 7)
```

**Deprecated directories (marked for removal only after their consuming milestone completes — not touched now):**
```
lib/trade-engine, lib/league-trade-engine, lib/trade-value (superseded by lib/shared-services/trade — Milestone 4)
  [retain lib/replay-framework — explicitly NOT deprecated, stays a sibling]
lib/waiver-engine, lib/waiver-ai-engine, lib/waiver-wire, lib/waiver-defaults, lib/waiver-runtime, lib/ai-tools-waiver
  (superseded by lib/shared-services/waiver — Milestone 5)
app/legacy/page.tsx (deleted outright, no successor needed — Milestone 6, immediate)
lib/platform-power-rankings, one of {lib/league-power-rankings OR lib/rankings-engine}
  (superseded by whichever of league-rankings-v2 / PowerRankingEngine is confirmed canonical during Milestone 6 scoping)
```

**Shared libraries:** `lib/shared-services/*` (above) becomes the only place cross-cutting fantasy logic lives going forward, per the architecture spec's Part 16 "no duplicate engines" principle.

**Provider adapters:** `lib/league-import/*` remains the home for all six adapters; no structural change, but every adapter gains a mandatory canonical-identity-write step (Player Service) as part of Milestone 1, and Fantrax/Fleaflicker gain real depth in Milestone 10.

**Feature modules:** existing `app/league/[leagueId]/tabs/*` structure is unaffected by this plan — the migration is entirely in the `lib/` layer; Feature Surfaces (Game Day, Legacy, Commissioner, etc.) consume the new services but their existing routing/UI structure doesn't need to change shape to do so, except for the genuinely new `app/game-day/*` surface.

**Service boundaries:** as defined in Part 3 — this table is the canonical reference for "where does new logic go" going forward.

---

## Part 8 — Implementation Backlog

Prioritized by (1) dependency, (2) customer impact, (3) architectural value, (4) technical risk — in that order, meaning a low-risk task that unblocks nothing still sorts behind a higher-risk task everything else depends on.

| Priority | Task | Milestone | Why this order |
|---|---|---|---|
| 1 | Stand up Identity Service | 1 | Nothing else can be built correctly without it |
| 2 | Stand up Import Service facade | 1 | Second foundational dependency |
| 3 | Sleeper fetch resilience (retry/backoff/timeout) | 2 | Flagship provider; blocks trust in everything downstream |
| 4 | Tighten commissioner-import gate | 2 | Same file area as #3, real trust gap, cheap to fix alongside it |
| 5 | Stand up Player/League/Roster Services | 1 | Required before any consumer-facing consolidation begins |
| 6 | Knowledge Graph schema + signal capture (2 derivations only) | 3 | Every consolidation milestone from here reads from this |
| 7 | Fix `league-context-assembler.ts`'s Sleeper hardcoding | 4 | Highest-leverage single-file fix in the whole plan — unblocks trade intelligence for every non-Sleeper provider |
| 8 | Trade Service shadow build + parity testing | 4 | Highest customer-impact consolidation (most user-visible numbers) |
| 9 | Wire the dormant playoff-impact simulator to a real route | 4 | Cheapest high-value win bundled into the same milestone |
| 10 | Retire the hardcoded-mock Legacy page | 6 | Near-zero cost, real reputational risk fix — can run in parallel with anything above |
| 11 | Trade Service consumer migration (Trade Finder → general evaluator → native proposals) | 4 | Sequenced lowest-risk consumer first |
| 12 | Waiver Service shadow build | 5 | Depends on Trade Service's roster-need calculation existing |
| 13 | Cross-league player search (Game Day) | 7 | Highest-visibility net-new feature; depends only on Player/Roster Service, doesn't need to wait for Trade/Waiver consolidation |
| 14 | Wire `injuryAlert()` to the injury cron | 7 | Cheapest possible fix in the entire plan — logic already exists |
| 15 | Connect exposure tracking to real data + UI | 7 | Logic already exists; same pattern as #14 |
| 16 | Commissioner Service shadow build | 8 | Highest risk-to-reward — deferred until Trade/Waiver/Knowledge Graph are proven patterns |
| 17 | Specialty League format-adapter port (12 formats) | 9 | Deferred until the pipeline it ports onto is stable |
| 18 | Fantrax live connector | 10 | Highest-effort provider work; deliberately last so it builds on a stable, consolidated foundation rather than the current fragmented one |

---

## Part 9 — Blockers

| Blocker | What it blocks | How to remove it |
|---|---|---|
| **Missing schema: `PlayoffBracket.results`** | Cross-platform Legacy/Hall of Fame intelligence about how playoffs actually went | Add the field to the canonical `PlayoffBracket` object (SFDM Part 2, already designed with this field present but nullable); backfill from whichever providers can supply it |
| **Missing provider support: Fantrax live connector** | Milestone 10; any Fantrax league's data freshness | Determine access model first (public API if one exists, authenticated scraping, or a partnership conversation) — this is a scoping question (architecture spec Part 17, open question #3) before it's an engineering task |
| **Missing retries: Sleeper fetch resilience** | Milestone 2, and by extension every downstream consolidation's data quality | Directly addressed by Milestone 2's first task |
| **Missing tests: contract tests per canonical object** | Confidence that any provider adapter actually produces a conformant canonical object | Stand up alongside each service in Milestone 1, per SFDM Part 8 — never retrofitted after the fact |
| **Missing normalization / missing identity mapping: cross-platform player identity** | Player Service, and therefore Trade/Waiver/Game Day/Exposure Services | Milestone 1's Player Service build, extending FantasyCalc's existing directory rather than starting from zero |
| **Missing historical storage: Decision/Outcome Snapshots** | Trade Time Machine, at-the-time vs. hindsight grading | Built as part of Milestone 4 (Trade Service), following the FKG spec's versioning model exactly |
| **Missing contracts: Query Service / Signal Ingestion Service don't exist as real boundaries yet** | The entire "no duplicate engine" enforcement mechanism the architecture spec relies on | Milestone 1 and Milestone 3 build these as the literal first real service boundaries in the codebase |
| **Open-read providers (MFL/Fantrax/Fleaflicker) require no membership proof** | Trust/integrity of imported "commissioner data" for those three providers | Bundle into Milestone 2's commissioner-gate work, even though the audit found it specifically on Sleeper/Yahoo/ESPN's gate — the open-read providers need the same tightening, scoped as a follow-on task in the same milestone |
| **Empire League has no standard rule convention** | Milestone 9's format-adapter completeness | Not an engineering blocker — a product-definition blocker (architecture spec Part 17, open question #1); do not schedule engineering time against it until product defines the ruleset |

---

## Part 10 — Deliverables Recap & First Implementation Task

This document delivers: (1) the migration roadmap (Parts 2, 5, 6), (2) the consolidation matrix (Part 1), (3) the shared service map (Part 3), (4) the dependency graph (Part 4), (5) the milestone plan (Parts 5-6), (6) the engineering backlog (Part 8), (7) the risk register (embedded per-subsystem in Part 1 and per-milestone in Part 6), and (8) the first recommended implementation task, below.

**First recommended implementation task, ready to hand to an engineer or agent:**

> Implement Milestone 1's Identity Service, scoped strictly to the objects defined in the Shared Fantasy Data Model spec's "Identity & Access" group: `PlatformIdentity`, `FantasyUser`, `Manager`, `CommissionerRole`. Build it as a new, additive `lib/shared-services/identity/` module reading from existing identity-related tables — do not modify any existing consumer of identity data in this pass, and do not yet migrate any consumer onto the new service. Write contract tests (per SFDM Part 8) confirming the service correctly resolves identity for all six existing providers (Sleeper, ESPN, Yahoo, MFL, Fantrax, Fleaflicker), using real historical import data already in the database as fixtures rather than synthetic data. Do not touch `lib/league-import/commissionerGate.ts`'s actual gating logic in this pass — that's explicitly Milestone 2's task, sequenced next. This task is complete when the Identity Service is callable, contract-tested, and has zero consumers — standing up the foundation is the entire scope of this first task, nothing downstream should move yet.
