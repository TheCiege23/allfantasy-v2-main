# Phase 8.0 — Live Sleeper End-to-End Integration Audit

Status: **AUDIT COMPLETE — 2026-07-01**. Read-only investigation. No code
changed, no Decision OS behavior changed, no SDK changed, no features
added. Where a small defect was found that would block accurate
validation, it is documented below, not fixed (per the ticket's own rule).

Architecture Freeze remains active. Stage 1 Soak remains active. This
audit traces the FULL path from a real Sleeper username to the customer
UI and reports, stage by stage, what is real, what is disconnected, and
what is still mocked/unwired.

## Architecture diagram (as-built, not aspirational)

```
Real Sleeper username
   │
   ▼
League Sync UI (LeagueSyncDashboard.tsx, LeagueDiscoverySuggest.tsx, SleeperImportForm.tsx)
   │  POST /api/league/discover  (real api.sleeper.app/v1 calls)
   ▼
League selection → League import
   │  SleeperLeagueFetchService → ImportedLeagueNormalizationPipeline
   │  → SleeperAdapter.normalize → ImportedLeagueCommitService
   │  (real prisma.league/LeagueTeam/Roster writes; Roster.playerData JSON)
   ▼
Canonical World substrate  (lib/decision-os/world/)
   │  port.ts unions Roster.playerData (imported) + RedraftRoster (native)
   │  assemble.ts → CanonicalWorld (origin-blind facts)
   │  8 enrichment views layered on top (F2.1-F2.8: metadata/schedule/
   │  injury/ADP/projections/weather/news/league-intel) — all real,
   │  honest-degrading, staging-validated
   ▼
        ┌──────────────────────────────┬───────────────────────────────┐
        ▼                               ▼                               ▼
Decision-specific Worlds        Behavioral Intelligence API      League Pulse
(lineup/trade bridges,          (Phase 5, DISCONNECTED FROM      (lib/decision-os/
 shadow-only, never live)        Canonical World — reads raw      league-pulse.ts,
                                  event tables via its own         DISCONNECTED FROM
                                  port.ts)                         Behavioral/Phase 6)
        │                               │                               │
        ▼                               ▼                               ▼
  (no UI consumer yet;          GET /api/v1/intelligence/*      LeaguePulseCard +
   shadow telemetry only)       (real, flag-gated, staging-      ManagerDnaCard +
                                  verified — but Phase 6 on       DecisionRecommendationsCard
                                  top of it has ZERO real          on Dashboard/LeagueHome/
                                  callers)                         CommissionerHub
                                                                   (payload is currently
                                                                    UNPOPULATED on the
                                                                    live Dashboard — dead wire)
```

**The single most important structural finding**: there are **three
separate, currently-disconnected intelligence systems** in this repo —
(1) the Canonical World + decision-specific-World bridges (trade/lineup,
shadow-only), (2) the Behavioral Intelligence API (Phase 5, real HTTP,
staging-verified, but built on its own raw-event read path, not
Canonical World), and (3) League Pulse (the newest, simplest, UI-facing
system, built on neither of the other two). None of the customer-facing
Decision OS cards visible today render output that has been through
Canonical World resolution. This is not a regression — each system was
built and validated correctly in isolation — but it means "Decision OS
reaches the customer" is currently true only for League Pulse's own
narrow, hand-rolled logic, not for the deeper Behavioral/Decision
Intelligence machinery this whole repo spent Phases 5-6 building.

## Step 1/2 — Integration audit + Sleeper flow (stage by stage)

| Stage | Real or mocked | Evidence |
| --- | --- | --- |
| Username → league discovery | **REAL** | `app/api/league/discover/route.ts` calls real `api.sleeper.app/v1`; MFL/ESPN/Fantrax explicitly disabled with "coming soon" in the same UI, confirming Sleeper is the one live path |
| League import (rosters/teams/settings/draft) | **REAL** | `SleeperLeagueFetchService.fetchSleeperLeagueForImport` hits `/league/{id}`, `/users`, `/rosters`, `/drafts`, `/transactions/{week}` (all weeks), `/matchups/{week}` (all weeks); persisted via real `prisma.league.create/update` in `ImportedLeagueCommitService` |
| Roster/player ID normalization | **REAL, with a documented fallback tier** | `lib/league-import/playerIdResolver.ts` looks up `PlayerIdentityMap.sleeperId` first, falls back to normalized-name matching, returns a confidence tag (`direct`/`name_match`/`miss`) rather than silently guessing |
| League normalization (imported vs native) | **REAL, confirmed separate path** | Imported leagues land in `Roster.playerData` (JSON) via a distinct bootstrap service; native leagues use `RedraftRoster`/`RedraftRosterPlayer`. Canonical World's `port.ts` unions both — confirmed current, matches the extensively real-data-validated design in `lib/decision-os/world/` |
| Schedule import | **REAL data, not generated** | Real Sleeper matchup results are mapped into `TeamPerformance` rows with actual scores/W-L-T; a separate config-only bootstrap fills missing *behavior settings* (lock windows etc.), never fabricates matchups |
| Scoring settings import | **PARTIAL — the weakest link found in this audit** | The league's real raw `scoring_settings` (every stat→points) IS captured and stored verbatim in `League.settings.scoring_settings`. But no confirmed bridge from that stored JSON into the live `UnifiedScoringConfigService`/`ScoringEngineRegistry` was found — the engine appears to score off a coarse inferred preset (`fb_ppr`/`fb_half_ppr`/`fb_std`/etc.) rather than the league's exact custom per-stat values. **Flagged as needing a closer follow-up audit, not asserted as definitively broken** — the bridging code may exist outside the two directories searched. |
| Historical data | **REAL, async/best-effort** | Walks `previous_league_id` up to 10 seasons back via real Sleeper API calls; runs fire-and-forget after import (`historicalBackfillStatus: pending/complete/failed` on the league), not blocking, not synchronous |

## Step 3 — Decision OS execution (where computed / cached / rendered)

**Canonical World + enrichment (F2.1-F2.8):** all real, additive, honest-degrading, and **staging-validated against a real imported Sleeper league** ("KBI Smoke Black," a genuine non-synthetic import) as of 2026-06-30 — all five conformance scripts (`WORLD_/LINEUP_/WAIVER_/COMMISSIONER_/TRADE_CONFORMANCE_OK`) passed on both native and imported origins. No caching — every resolution is a fresh read-only Prisma query set (`port.ts`), capped and try/catch-guarded per source. Not cached anywhere; this is a genuine gap for a live-traffic scenario (every dashboard load would re-run every enrichment query cold).

**Behavioral Intelligence (Phase 5 — Manager/League/Platform):** real pure functions (`deriveManagerBehavioralIntelligence` etc.) fed by a real HTTP API (`GET /api/v1/intelligence/{manager,league,platform}`), gated by `DECISION_OS_INTELLIGENCE_API_ENABLED` + an API key + a provider-selector flag (`DECISION_OS_INTELLIGENCE_API_PROVIDER=real`, defaulting to a stub that always 503s). **No caching anywhere** — recomputed from raw event tables (waiver claims, trades, drafts) every call. Staging-verified in-process against the real imported KBI league (0 events found, honest degraded-safe response — not a failure, that league genuinely has no waiver/trade activity yet). **Deployed-URL HTTP-level verification is explicitly deferred, not done** — only in-process smoke testing has run.

**This API reads raw event tables directly, bypassing Canonical World entirely** — it is architecturally independent of the World substrate described above, despite both ultimately reading from the same underlying league.

**Decision Intelligence classifiers (Phase 6 — Manager DNA, Recommendation Engine, League Archetypes, Platform Benchmarking, Company Intelligence):** real, pure, well-tested functions — **but zero callers exist outside unit tests.** No API route imports them. No conformance or smoke script has ever run them against real imported-league data. This is the single largest "built but never executed against reality" gap in the whole stack.

**League Pulse (`lib/decision-os/league-pulse.ts`):** real, deterministic, honest-degrading, and the only intelligence system actually rendering on production UI today — but it has **zero imports** from Behavioral Intelligence, Phase 6, or Canonical World. It computes its own scores directly from raw dashboard/league/team/commissioner-health inputs with hand-rolled arithmetic. It has never been validated against the deep Behavioral/Decision Intelligence output because it doesn't consume it.

## Step 4 — Customer experience audit (verified against current code, not just G24)

| Screen | Classification | Evidence |
| --- | --- | --- |
| Dashboard | **Visible and useful** | Renders `LeaguePulseCard` + `ManagerDnaCard` + `DecisionRecommendationsCard` — three cards, exceeding the earlier G24 baseline of one |
| League Home | **Visible and useful** | Same three-card set via `buildLeagueHomePulse`, matching Dashboard's depth |
| Team | **Disconnected from evidence** | Zero `decision-os` imports; `DecisionRecommendationsCard` already has an unused `'team'` variant prop ready to wire |
| Matchups | **Disconnected from evidence** | Zero `decision-os` imports; `MatchupInsightsPanel` renders free-text prose with no confidence/evidence grid |
| Trade Center | **Missing confidence/evidence** | By explicit design (`TradeDiscoveryPanel` docstring: "deterministic partner matching... No AI, no value mutation") — no decision-os card anywhere in trade surfaces |
| Waiver Center | **Missing confidence/evidence** | `WaiverTarget` has free-text `reason` + `priority` number, no confidence/evidence fields, no decision-os imports |
| Draft Room | **Visible and useful** | Strongest surface in the app — `DraftHelperPanel` renders `confidence`, `reason`, and an itemized `evidence[]` array |
| Commissioner Hub | **Visible and useful** | Same three-card set as Dashboard/League Home — supersedes the older G24 "buried" finding |
| AI Coach | **Visible but weak** (reclassified from G24's "too AI-forward") | Now shows a real `confidence` percentage and a `dataSparse` honesty banner, but no itemized evidence grid like Draft Room's |

**"Decision Cards" (the user's 10th named item)**: no component literally named `DecisionCard` exists. The real generic primitive is `components/decision-os/DecisionOsCardPrimitives.tsx` (badge/confidence/evidence-grid/why-panel/insufficient-data building blocks), consumed by all three deployed cards. This IS the reusable "Decision Cards" system the user is likely asking about — it exists, is shared, and has an already-declared-but-unused extension point (Team's `'team'` variant) ready for the next wiring pass.

## Step 5 — Live validation readiness (verified defects only, not fixed)

**Genuinely confirmed blockers/gaps** (each independently verified in code, not inferred):

1. **Dead wire, Dashboard Manager DNA/Recommendations data source.** `DashboardContent.tsx` builds its Manager DNA / Recommendations view models from `initialDashboardPayload`, but no `page.tsx` anywhere in the app ever passes that prop a value — it is always `undefined` at runtime. The cards render, but always show the insufficient-data fallback, never real intelligence, on the live dashboard today. This is a small, isolated, precisely-located defect that blocks accurate validation of "does the customer see real Manager DNA" — documented here per the ticket's rule, not fixed.
2. **Phase 6 (Manager DNA / Recommendations / Archetypes / Benchmarking / Company Intelligence) has never executed against real data.** Even if the dead wire above were fixed, it's not yet established that `ManagerDnaCard`'s expected payload shape is actually produced by Phase 6's real functions anywhere — no route wires them together. This needs direct confirmation before any live validation claim about "Manager DNA" would be meaningful.
3. **Scoring settings import may not faithfully carry custom per-stat rules into the live scoring engine** (Step 2 finding) — needs closer confirmation before trusting live-scoring accuracy for a league with non-standard scoring.
4. **No caching anywhere in the Behavioral Intelligence API or Canonical World enrichment layers** — every request recomputes from cold Prisma reads. Not a correctness blocker, but a real production-load concern once live traffic exists.
5. **HTTP-level (deployed) verification of the Intelligence API is still deferred** — only in-process staging smoke testing has run; a real customer request through a real deployed URL has not been proven.
6. **League Pulse, the only intelligence actually reaching customers today, doesn't consume the deeper Behavioral/Decision Intelligence pipeline at all** — so "the customer experiences Decision OS's real intelligence" is not yet true in the way the phrase implies; they experience a simpler, independently-computed system with the same visual language.
7. **All Canonical-World-based decision bridges (trade, lineup, waiver, commissioner) remain shadow-only** except Commissioner, which has a real kill switch (`DECISION_OS_COMMISSIONER_HEALTH_LIVE`) built and tested but — per the last recorded status — not yet confirmed flipped on in production, still pending its 7-day soak.
8. **Projections used by the trade-value engine are honestly null on non-prod data** (no provider-backed rows in staging); whether real provider projections actually populate in production has architecture support but has not been directly observed end-to-end against a live customer trade.

## Step 6 — Phase 8 roadmap

### Critical Path (required before any live Sleeper username test is meaningful)
1. Fix or replace the `initialDashboardPayload` dead wire so Manager DNA / Recommendations cards receive a real payload source (finding #1).
2. Confirm (or build, if genuinely absent) the bridge from Phase 6's real intelligence functions into whatever payload source item 1 uses — otherwise item 1's fix would just surface a different flavor of "insufficient data."
3. Directly confirm whether the imported league's custom scoring rules actually drive live scoring, or resolve the coarse-preset approximation finding (#3) — this affects whether a live-imported league's week-to-week scores will be correct.

### Validation (required after the first successful live import)
4. Run the existing conformance scripts (`decision-os-world-conformance.ts`, `decision-os-trade-conformance.ts`, etc.) against the freshly-imported live league specifically, not just the existing "KBI Smoke Black" fixture league.
5. HTTP-level (not just in-process) verification of the Intelligence API against a real deployed URL.
6. Confirm Commissioner's live kill switch state in production and whether the 7-day soak has actually completed.

### Production Readiness (required before public release)
7. Add caching to the Behavioral Intelligence API and Canonical World enrichment reads — currently every request is a cold, uncached recomputation.
8. Resolve the redraft-lifecycle production gaps already tracked separately (interactive draft-room browser proof, NCAAF live-stats provider, playoffs consolation bracket, SSE de-dup, quarter/clock feed — carried over from the existing readiness baseline, unaffected by this audit).
9. Decide, deliberately, whether League Pulse should be left as a simpler independent system long-term or migrated to consume the deeper Behavioral/Decision Intelligence pipeline — this is a real architectural decision, not a bug, and should not be made implicitly by whichever gets touched next.

### Premium Experience (customer-facing polish, after the above)
10. Wire Team's already-declared-but-unused `DecisionRecommendationsCard` `'team'` variant.
11. Extend evidence/confidence grids (matching Draft Room's bar) to Matchups, Trade Center, and Waiver Center.
12. Give AI Coach an itemized evidence grid to match its existing confidence/data-sufficiency signals.

## Verified components (this audit's own read-only checks)

- Sleeper username → discovery → import → normalization → historical backfill: all real, evidenced above.
- Canonical World + all 8 enrichment views: real, staging-validated on real imported data.
- Behavioral Intelligence API (Phase 5): real, flag-gated, staging-verified in-process.
- Three customer-facing Decision OS cards on Dashboard/League Home/Commissioner Hub: real components, real (if currently dead-wired in one case) view-model builders.
- Draft Room's evidence/confidence UI: real, unchanged, the strongest surface in the app.

## Mocked/unwired components

- Phase 6 Decision Intelligence classifiers: real code, zero real callers.
- Dashboard's Manager DNA/Recommendations data source: dead wire (`initialDashboardPayload` never populated).
- Trade/lineup/waiver Canonical-World bridges: shadow-only, no UI consumer, no live cutover.
- Team, Matchups, Trade Center, Waiver Center: no Decision OS presence at all yet.

## Production readiness assessment

The infrastructure (Phases 0-7 of this whole series) is genuinely complete and, where tested, real — not vaporware. What's NOT yet true is the specific product claim in the ticket's own framing: "someone enters their real Sleeper username, imports their league, and experiences the full value of the Decision OS end to end." Today they would experience League Pulse (real, but the simplest of the three intelligence systems) and, once the dead wire is fixed, potentially Manager DNA/Recommendations cards showing insufficient-data until Phase 6 is actually wired to a real data source. The deepest, most sophisticated intelligence this repo has built (Phase 5/6 Behavioral + Decision Intelligence) has essentially never been seen by a real customer.

## Recommended implementation order

Critical Path items 1-3, in the order listed (each depends on the previous being at least understood, not necessarily fixed first) — this is the shortest path to a genuinely meaningful first live Sleeper validation.
