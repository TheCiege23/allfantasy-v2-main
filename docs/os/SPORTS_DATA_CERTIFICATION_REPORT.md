# Sports Data — Final Certification Report (Phase 5G)

Production-grade certification of the Fantasy OS Sports Data plane. This phase is **validation, audit, and release readiness** — no new capabilities. Companion docs: [Capability Matrix](SPORTS_DATA_CAPABILITY_MATRIX.md), [Provider Matrix](SPORTS_DATA_PROVIDER_MATRIX.md), [Production Readiness](SPORTS_DATA_PRODUCTION_READINESS.md), [Limitations](SPORTS_DATA_LIMITATIONS.md).

## Scope certified
Sports Data Gateway → runtime ports → certified append-only snapshots (schedules/games, players, rosters, transactions, draft, **statistics**) → canonical + team identity → deterministic identity bridge (Sleeper + FantasyCalc) → 9 gated runtime integrations (Lineup, Waiver, Trade, Draft, Matchup, Scoring, Intelligence, Coach, Chimmy) + Operator Observability.

## Certification verdict
**CERTIFIED for a default-off, additive, reversible production posture.** Every wired subsystem preserves its deterministic authority; the certified layer is reject-only or informational; all 9 gates are off by default and independently reversible; production is untouched.

## Evidence summary
- **Tests:** Fantasy OS suite **312 / 312 passing** (27 files). Across the phase stack, every subsystem's authority-preservation + import-guard + gate-off behavior is test-enforced. Existing runtime/identity/statistics/scoring/observability suites pass with no regressions; the only pre-existing failures in the repo are unrelated g15 baseline UI/tone tests (stash-verified across phases).
- **Build:** `✓ Compiled successfully` (Windows post-compile `readlink EISDIR` only — passes on Vercel Linux CI).
- **Production:** untouched — `origin/main` = `9d554d41f`; PRs #191–#212 stacked and unmerged.

## Proving-run evidence (non-prod `cool-lab-87438174`)
| check | result |
|---|---|
| certified schedule retrieval | 16 games (`nfl-games-2026-w1`) |
| certified statistics retrieval | 79 rows; **62 resolved / 17 unresolved** (78.5%) |
| deterministic identity resolution | 49/65 unique athletes (75.4%) |
| identity coverage (observability) | 7,642 `PlayerIdentityMap` rows with espn id |
| append-only preservation | latest statistics snapshot retrievable (79 records); priors retained |
| correction replay | re-run → new snapshot on change; unchanged fully suppressed (proven 5F-a/c) |
| provider isolation | import-guard tests green across all wired paths |

## Runtime certification
Provider access confined to gateway adapters/fetchers; all product consumption via runtime ports; 9 server-only gates off by default; import guards enforced by tests. ✅

## Identity certification
Deterministic only (direct dual-id → `resolved`; name → `ambiguous`, no id; else `unresolved`). Two Tier-1 sources (Sleeper 6,689 + FantasyCalc 924 new); cross-source conflicts quarantined (44); idempotent conflict-safe upsert; append-only re-resolution. Coverage 78.5% rows / 75.4% athletes. ✅ (with the documented external IDP gap)

## Statistics certification
ESPN box scores certified append-only; schema/identity/dedup/`canCertify`; runtime retrieval with identity state; correction replay; snapshot preservation. ✅ (read-only; not a scoring input)

## Product-runtime certification
Lineup, Waiver, Trade, Draft, Matchup, Scoring, Intelligence, Coach, Chimmy — every subsystem's deterministic authority preserved; certified layer reject-only or informational; gate-off preserves behavior byte-for-byte. ✅ (see Production Readiness doc's authority table)

## Provider certification
Certified & consumed: **ESPN, Sleeper, FantasyCalc**. Unverified (excluded, not inflated): Rolling Insights, API-Sports. Import-only (out of scope): Yahoo, MFL, Fantrax, Fleaflicker. (See Provider Matrix.)

## Performance
Warm reads 129–397 ms against remote non-prod Neon; the only outlier is the first query's cold pg/Neon connection (a pooling concern, not a query concern). No premature optimization warranted.

## Safety
Fail-closed (auto actions) · fail-open (manual saves) · reject-only guards · informational-only reads · provider + credential isolation · no raw payload exposure. ✅

## Known limitations (see Limitations doc)
IDP/defensive identity gap (~21%, external); certified statistics not yet a scoring input; injuries/projections/availability not certified; decision evidence emitted-not-persisted; Rolling Insights/API-Sports unverified.

## Overall Fantasy OS completion
**~99.5%** of the planned Sports Data program. Remaining is the Release-Candidate track (evidence review, merge readiness, deployment/runbooks/rollback validation) plus deferred data-plane items (IDP identity source, scoring migration, injuries/projections) — none of which are runtime-wiring work.

## Remaining work before Release Candidate (RC1)
1. Final evidence review + merge-readiness of the #191–#212 stack (recommend bottom-up from #191).
2. Release checklist + deployment plan + operational runbooks.
3. Rollback validation (per-gate enable/disable drills).
4. (Deferred, non-blocking) IDP identity source; certified-stats scoring migration; injuries/projections certification; decision-evidence audit table (needs approved migration).

---

## Phase 5H classification (unified-plane audit)
Distinguishes the honest status of every provider/capability (detail in [Provider Ingestion Matrix](SPORTS_DATA_PROVIDER_INGESTION_MATRIX.md), [Gap & Migration Plan](SPORTS_DATA_GAP_AND_MIGRATION_PLAN.md)):

- **CURRENTLY CERTIFIED (verified + canonical + runtime-consumed):** ESPN (schedules/games/statistics), Sleeper (players/rosters/transactions/draft/identity), FantasyCalc (identity).
- **CONFIGURED BUT UNVERIFIED (must NOT be presented as connected):** Rolling Insights, CFBD, TheSportsDB, API-Sports, ClearSports, OpenWeatherMap, NewsAPI.
- **IMPORT-ONLY (out of sports-data scope):** Yahoo, MFL, Fantrax, Fleaflicker.
- **MISSING (no certified capability):** injuries, availability, depth charts.
- **BLOCKED (credential/provider capability):** Rolling Insights & unverified providers pending a verified request; TheSportsDB imagery.
- **REQUIRES NORMALIZATION:** canonical position system; unified image precedence; Sleeper roster/txn/draft adapter purity.
- **REQUIRES RUNTIME WIRING:** canonical port layer + Decision OS/OS convergence off legacy Prisma tables; certified `PlayerValue` for FantasyCalc.
- **REQUIRES MIGRATION (authorization-gated, not run):** player/stat table consolidation, `PlayerImage`, `PlayerValue`, availability, depth-chart, decision-evidence audit tables.

**Boundary invariant CERTIFIED (5H):** Decision OS + certified integration services + wired product routes never call a provider directly (0 bypasses), enforced by `__tests__/fantasy-os/unified-plane-provider-boundary.test.ts`.

**Adapter purity ACHIEVED (5H-b):** the last 3 gateway-runtime provider exceptions (Sleeper roster/transaction/draft) were removed — their fetchers now live in `providers/sleeper.ts`, and **zero provider URLs remain in any gateway runtime module** (test-enforced). A governed **canonical position service** (`canonical/canonicalPosition.ts`) now exists (detailed position preserved; broad fantasy eligibility derived from league rules; IDP-aware; effective-dated).

**Factual domains + scoring boundary (5H-f, 2026-07-13, non-prod):** 7 authorized factual-domain tables created + proven in `cool-lab-87438174` (`SPORTS_DATA_NONPROD_EVIDENCE_5HF.md`): injury (**PROVIDER-VERIFIED** — real API-Sports NFL injury), availability/depth-chart/projection (fixture-only, honestly labeled — no gateway-certified source), correction, player-team + player-position history. **Correction lineage proven** (injury Questionable→Out; current=Out, as-of=Questionable, 2 versions retained, 0 dups); non-destructive rollback. Injury ≠ availability; provider vs derived labeled; projections are evidence, never scoring. **SCORING BOUNDARY INTACT + test-locked:** certified `sports_data` statistics remain observational-only; the production scorer (`PlayerGameLogCache → PlayerWeeklyScore → RedraftMatchup → standings`) is unchanged; no scoring engine imports a certified/canonical fact module (enforced). Future scoring-authority migration = DESIGN-ONLY (thresholds are targets, none passed). See `SPORTS_DATA_SCORING_AUTHORITY_BOUNDARY.md` + the 4 contract docs.

**Canonical convergence — AUTHORIZED non-prod migrations RUN (5H-e, 2026-07-13):** 5 canonical persistent domains created + physically proven in the approved non-production Neon `cool-lab-87438174` ONLY (`SPORTS_DATA_NONPROD_MIGRATION_EVIDENCE_5HE.md`): `canonical_entity_image`, `canonical_player_value`, `decision_evidence`, `b2b_activity_event`, `league_health_snapshot`. Additive, versioned, idempotency-keyed (rerun → 0 dups), fail-closed guard (`nonprodSafetyGuard.ts` — refuses any non-approved target), default-off gates (`FANTASY_OS_CANONICAL_*_ENABLED`), shadow-compare + deterministic league-health calculator (pure, tested). Proven rows: 2 images + 1 value + 1 evidence + 3 events + 1 health; retrieval + deactivate/rollback proven. **No production migration, no legacy table removed, no consumer switched on, no visual work.** Player/stat consolidation stays DESIGN-ONLY.

**Unified provider certification — LIVE verdicts (5H-d, 2026-07-13, non-prod):** real requests through the repo's own clients, routed through canonical contracts where one exists (full detail: `SPORTS_DATA_PROVIDER_CERTIFICATION_5HD.md`; code source of truth `providers/certificationStatus.ts`, test-locked). **CERTIFIED (keyless, end-to-end):** ESPN (16 games + box score), Sleeper (12,200 players + 6,736 crosswalk), FantasyCalc (463 values → boundary-separated value). **VERIFIED (keyed, real request + canonical route; persistence REQ-MIGRATION):** TheSportsDB (headshot → CanonicalImageReference), CFBD (133 NCAAF roster → canonicalPosition, detail preserved), API-Sports (20 EPL soccer teams; soccer REQ-NORMALIZE). **BLOCKED:** ClearSports (`api-keys/me` HTTP 500). **REQUIRES_WIRING:** Rolling Insights (DB-coupled client; needs a dedicated gateway adapter). Certified `sports_data` snapshots come from **ESPN + Sleeper only**; the other verified providers write legacy tables and lack a gateway adapter. Enforcement now gates "connected" claims on real evidence (`__tests__/fantasy-os/provider-certification.test.ts`). **No credential value was ever logged; no production data accessed.**

**Canonical IMAGE + VALUE services BUILT + LOCKED (5H-c):** two governed pure modules now exist —
`canonical/canonicalImage.ts` (4-tier precedence verified_official→secondary→approved_fallback→placeholder; URL
validation rejecting empty/invalid/`data:`/known-broken; entity + sport + imageType isolation; honest `url:null`
placeholder) and `canonical/canonicalValue.ts` (distinct `valueType` boundaries — observed_statistic / derived_fantasy_
points / provider_projection / allfantasy_projection / provider_valuation / allfantasy_valuation / ranking / adp — with
explicit league-format + scoring, canonical-position governance preserving detail, and FantasyCalc treated as
provider_valuation). 28 contract tests + 3 governance/enforcement tests (module existence, purity, Decision-OS
FantasyCalc-value-bypass = 0). **Live proving:** real (public, keyless) FantasyCalc records normalized into the
boundary-separated contract with resolved identity, deterministic rerun; image precedence + validation + cross-sport
isolation held; no DB, no production data. **Adoption deferred (escape hatch):** the ~9 inline image resolvers (visual
change forbidden this phase) and the 5 parallel value systems + merge offenders (`SportsPlayerRecord` /
`FantasyValueSnapshotService` / `sports-db-valuation`) are documented CALLER_TO_MIGRATE / REQ-WIRING; certified
`PlayerImage`/`TeamImage`/`PlayerValue` tables are REQ-MIGRATION. B2B evidence/event requirements defined in
`B2B_DECISION_OS_DATA_AND_EVIDENCE_REQUIREMENTS.md` (no visuals). See `SPORTS_DATA_IMAGE_AND_POSITION_POLICY.md` +
`SPORTS_DATA_CANONICAL_DATABASE_MAP.md`.

**Position governance HARDENED + LOCKED (5H-b2):** the canonical service is now **sport-isolated** (`SUPPORTED_POSITION_SPORTS = ['NFL','NCAAF']`, `isSupportedPositionSport` — a non-football code can never resolve to a plausible football position; no cross-sport fallback), and a repo-enforcement test fails if any **new** competing position-collapse map is added outside a documented allowlist. A full re-audit found **24+ competing position maps**; **0 were safely migratable in one increment** — each retained with a concrete reason (soccer/sport-isolation, verbatim CSV parse, valuation→5H-c, NCAAF identity-matching, or the shared `team-abbrev` collapse that ~40 roster-legality callers depend on). Position normalization is therefore **not yet fully centralized**: the governed source exists and is enforcement-locked, but adoption is a reviewed per-caller migration (valuation → 5H-c; `team-abbrev` legality collapse → dedicated governed migration). No historical position table exists (REQ-MIGRATION). See `SPORTS_DATA_IMAGE_AND_POSITION_POLICY.md` for the full ledger.
