# Canonical Database Map & Consolidation Plan (Phase 5H, Stop-Gate 3)

Maps the **real** database structures used for sports data. **Finding: data is fragmented across two parallel planes** — the certified gateway plane and legacy Prisma tables. No migration is created in this phase; migration-required work is documented for explicit authorization.

## Plane A — Certified gateway plane (`sports_data` schema, raw SQL via `SportsRuntimeStore`)
| Concept | Table | Fed by | Status |
|---|---|---|---|
| certified snapshots | `sports_data.sports_snapshot` | gateway sync runtimes | ✅ append-only |
| snapshot records | `sports_data.sports_snapshot_record` | " | ✅ resolved/ambiguous/unresolved classification |
| deterministic events | `sports_data.sports_event` (events runtime) | diff runtimes | ✅ |
| capabilities: players, rosters, transactions, games/schedules, draft_data, **statistics** | (as snapshots) | ESPN/Sleeper adapters | ✅ CERTIFIED |
| **canonical entity images** (5H-e) | `sports_data.canonical_entity_image` | canonicalImage refs | ✅ created + proven (NON-PROD only; additive; is_active/version history) |
| **canonical player values** (5H-e) | `sports_data.canonical_player_value` | canonicalValue refs | ✅ created + proven (NON-PROD; boundary-separated value/ranking/adp) |
| **decision evidence** (5H-e) | `sports_data.decision_evidence` | Decision OS | ✅ created + proven (NON-PROD; tenant/league-scoped; no chain-of-thought/secrets) |
| **B2B activity events** (5H-e) | `sports_data.b2b_activity_event` | OS surfaces | ✅ created + proven (NON-PROD; versioned, idempotency-keyed, privacy-tagged) |
| **league health snapshots** (5H-e) | `sports_data.league_health_snapshot` | League Intelligence | ✅ created + proven (NON-PROD; observed vs derived vs risk separated) |
| non-prod safety marker | `sports_data.nonprod_safety_marker` | guard | fail-closed anchor for migration executors |
| **injuries** (5H-f) | `sports_data.canonical_injury` | API-Sports | ✅ created + **PROVIDER-VERIFIED** (NON-PROD; append-only, correction lineage proven) |
| **availability** (5H-f) | `sports_data.canonical_availability` | derived | ✅ created + fixture-proven (NON-PROD; separate from injury; observed vs derived labeled) |
| **depth charts** (5H-f) | `sports_data.canonical_depth_chart` | RI (REQUIRES_WIRING) | ✅ created + fixture-proven (NON-PROD; provider vs derived labeled) |
| **projections** (5H-f) | `sports_data.canonical_projection` | FantasyProjection (unpopulated) | ✅ created + fixture-proven (NON-PROD; evidence only, never scoring) |
| **corrections** (5H-f) | `sports_data.canonical_correction` | cross-domain | ✅ created + proven (NON-PROD; append-only lineage, as-of) |
| **player-team history** (5H-f) | `sports_data.canonical_player_team_history` | sleeper | ✅ created + proven (NON-PROD; effective-dated; fills dead-writer gap) |
| **player-position history** (5H-f) | `sports_data.canonical_player_position_history` | sleeper | ✅ created + proven (NON-PROD; detail preserved; new domain) |

## Plane B — Legacy Prisma tables (production-authoritative today)
| Concept | Model(s) | Notes |
|---|---|---|
| canonical players | `SportsPlayer`, `Player`, `FantasyPlayer`, `DevyPlayer` | **fragmented across 4 tables** |
| provider identities | `PlayerIdentityMap` (sleeper/espn/mfl/fantasyCalc/rollingInsights/apiSports/fleaflicker/clearSports ids), `PlatformIdentity` | espnId populated in 5F-c/d (7,642 rows) |
| canonical teams | `SportsTeam`, `TeamSeasonStats` | |
| player-team history | `PlayerTeamHistory` | effective-dated ✅ |
| positions | governed canonical service `lib/sports-data-gateway/canonical/canonicalPosition.ts` (Phase 5H-b; sport-isolated + enforcement-locked 5H-b2); production callers NOT yet routed through it | service DONE; **REQ-NORMALIZE** (5H-b2 re-audit: 24+ competing maps, 0 safely migratable this increment — each documented; valuation→5H-c, `team-abbrev` legality collapse→governed migration). **No historical `PlayerPosition` table (REQ-MIGRATION).** |
| headshots | `SportsPlayer.imageUrl` / `SportsPlayerRecord.headshotUrl`, governed policy `lib/sports-data-gateway/canonical/canonicalImage.ts` (Phase 5H-c); ~9 inline resolvers not yet routed through it | **fragmented**; governed policy DONE, adoption REQ-NORMALIZE (visual-safe migration); dedicated `PlayerImage` table REQ-MIGRATION |
| team logos | `TeamAsset.logoUrl`, `SportsTeam.logo`; governed via same `canonicalImage.ts` | fragmented; `TeamImage` table REQ-MIGRATION |
| player values | `AllFantasyMarketPlayerValue` (AF-derived, persisted) + FantasyCalc (in-memory `SportsDataCache`) + Excel `data/historical-values/*` + hardcoded tier tables; governed contract `lib/sports-data-gateway/canonical/canonicalValue.ts` (Phase 5H-c) | **5 parallel value systems, NO canonical player-value field**; governed contract DONE (boundary-separated), adoption REQ-WIRING; certified `PlayerValue` table REQ-MIGRATION |
| schedules/games | `SportsGame`, `FantasyScheduleGame` | two tables |
| player statistics | `PlayerGameLogCache`, `PlayerSeasonStats`, `FantasyStatLine` | **production scoring inputs** |
| player history | `PlayerSeasonStats`, `PlayerTeamHistory` | |
| fantasy values | (FantasyCalc via `lib/fantasycalc.ts`; `AiPlayerMarketMetric`) | not a certified values table — REQ-WIRING |
| projections | `FantasyProjection` (model, season, week, scoringPresetId) | separated ✅; population/verification TBD |
| injuries | `SportsInjury`, `InjuryReportRecord` | not certified |
| availability | (none) | ❌ missing |
| depth charts | (none canonical) | ❌ missing |
| provenance | snapshot `source`; `ProviderSyncState` | |
| correction history | append-only snapshots (Plane A); legacy tables overwrite | mixed |

## Fragmentation summary
- **Players live in ≥5 places:** `SportsPlayer`, `Player`, `FantasyPlayer`, `DevyPlayer`, + certified players snapshot.
- **Statistics live in ≥4 places:** `PlayerGameLogCache`, `PlayerSeasonStats`, `FantasyStatLine`, + certified statistics snapshot.
- **Two schedule tables, two-plane game state.**
- The certified plane (A) is **additive**; Plane B remains the production authority. They are not yet unified.

## Consolidation target (future, migration-gated)
```
Single canonical entity model per concept (player, team, game, stat, value, projection, injury, image, position)
  ← certified snapshots (append-only history) + effective-dated current view
  ← ALL providers via adapters → normalizers → identity resolver → certification
  → one canonical runtime port layer consumed by Decision OS + every OS
```

## Value-plane fragmentation (Phase 5H-c audit)
**Five independent value systems share the 0–10000 scale and are silently swapped with no provenance reaching most
consumers:** (A) FantasyCalc provider values (`lib/fantasycalc.ts` + `fantasycalc-db.ts`, in-memory/cache), (B) Excel
historical values (`lib/historical-values.ts`, filesystem JSON), (C) hardcoded tier tables (`lib/dynasty-tiers.ts`,
stale/name-keyed), (D) T2 projection→value (`lib/trade-value/valueEngine.ts`), (E) AF-derived market value + ADP
(`AllFantasyMarketPlayerValue`, `AllFantasyAdpSnapshot` — the best-isolated). **Merge offenders** collapse statistics,
projections, ADP, and provider values into one ambiguous number: `SportsPlayerRecord` (stats+projections+adp+
dynastyValue in one row), `lib/sports-os/FantasyValueSnapshotService.ts`, `lib/trade-value-console/sports-db-valuation.ts`,
`lib/redraft-war-room/playerValue.ts`. The governed `canonicalValue.ts` (5H-c) defines the boundary-separated contract
these must migrate onto (REQ-WIRING); certified persistence is REQ-MIGRATION. **FantasyCalc value egress lives in
`lib/fantasycalc.ts`/`fantasycalc-db.ts`, NOT in `providers/`** — routing it through a real gateway value adapter is REQ-WIRING.

## Migration-required work (NOT run — needs explicit authorization)
1. Consolidate player tables (`SportsPlayer`/`Player`/`FantasyPlayer`) behind one canonical player + provider-id map (**REQ-MIGRATION**).
2. Canonical `PlayerPosition` table (detailed + eligibility) (**REQ-MIGRATION**).
3. Canonical `PlayerImage` table with source/precedence/validation (**REQ-MIGRATION**).
4. Certified `PlayerValue` (FantasyCalc) + `Projection` value tables separated from stats (**REQ-MIGRATION** if not reusing `FantasyProjection`).
5. Availability + depth-chart tables (**REQ-MIGRATION**).
6. A decision-evidence audit table (**REQ-MIGRATION** — deferred since Phase 5E).
7. ✅ **Phase 5H-e (NON-PROD, authorized):** canonical entity-image, canonical player-value, decision-evidence, B2B activity-event, and league-health-snapshot tables **created + physically proven** in `sports_data` (non-prod only). Production rollout = REQ-MIGRATION (not authorized). See `SPORTS_DATA_NONPROD_MIGRATION_EVIDENCE_5HE.md`.
8. Player-table + statistics-table consolidation remain **DESIGN-ONLY** (not authorized) — HIGH risk, 5+4 legacy tables; legacy retirement not authorized until canonical parity proven via shadow comparison.

**No migration was created or run in this phase.** All above are documented for authorization.
