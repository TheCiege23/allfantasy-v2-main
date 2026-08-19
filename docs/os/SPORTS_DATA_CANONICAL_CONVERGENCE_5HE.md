# Canonical Convergence Plan + Fragmentation Ledger (Phase 5H-e)

Converge the parallel data planes **additively**: certified `sports_data` snapshots + legacy Prisma tables + legacy image/value services + decision/activity events → canonical persistent domains → canonical ports → default-off guarded consumers. **No legacy source is removed; no production migration is run.**

## Status legend (per the required distinctions)
`schema designed` · `migration created` · `migration run (non-prod)` · `backfill proven` · `retrieval proven` · `shadow proven` · `production rollout NOT authorized` · `legacy retirement NOT authorized`

## Fragmentation ledger (source → canonical target)
### Players & identity
| Source | Authority | Canonical target | Identity key | Migration risk | Backfill / retirement |
|---|---|---|---|---|---|
| `SportsPlayer` / `Player` / `FantasyPlayer` / `DevyPlayer` + certified players snapshot | legacy Prisma (prod) | one canonical player + provider-id map | canonical id ← Sleeper/FantasyCalc dual-id | HIGH (5 tables) | **DESIGN-ONLY** — full consolidation not authorized this phase |
| `PlayerIdentityMap` | legacy | canonical id map (keep) | espnId/sleeperId | low | retain |

### Statistics & history
| Source | Authority | Canonical target | Migration risk | Status |
|---|---|---|---|---|
| `PlayerGameLogCache` / `PlayerSeasonStats` / `FantasyStatLine` + certified statistics snapshot | legacy + certified | canonical stat (append-only) | HIGH | **DESIGN-ONLY** (append-only snapshot already exists for ESPN; consolidation not authorized) |
| `PlayerTeamHistory` / position history / corrections | legacy | effective-dated canonical | med | design-only |

### Images  → **AUTHORIZED (run non-prod)**
| Source | Canonical target | Status |
|---|---|---|
| `canonicalImage.ts` runtime contract + ~9 inline resolvers + `TeamAsset`/`SportsPlayerRecord.headshotUrl`/provider image fields | `sports_data.canonical_entity_image` | schema designed · migration created · **run (non-prod)** · backfill proven (player+team) · retrieval proven · rollback proven · production NOT authorized · legacy retirement NOT authorized |

### Values → **AUTHORIZED (run non-prod)**
| Source | Canonical target | Status |
|---|---|---|
| FantasyCalc (`lib/fantasycalc(-db).ts`, `canonicalPlayerValuations`) + dynasty-tiers + idp-kicker + ADP + projection-derived + market + historical | `sports_data.canonical_player_value` (boundary-separated) | schema designed · migration created · **run (non-prod)** · backfill proven (1 FantasyCalc provider_valuation) · retrieval proven · production NOT authorized. FantasyCalc value adapter in `providers/` still REQ-WIRING. |

### Decision & B2B evidence → **AUTHORIZED (run non-prod)**
| Source | Canonical target | Status |
|---|---|---|
| recommendation outputs / decision-context envelopes / commissioner actions / telemetry | `sports_data.decision_evidence` | schema designed · migration created · **run (non-prod)** · 1 record proven · retrieval proven |
| activity logs / recommendation interactions | `sports_data.b2b_activity_event` | schema designed · migration created · **run (non-prod)** · 3 events proven (idempotent) |
| league-health calculations | `sports_data.league_health_snapshot` | schema designed · migration created · **run (non-prod)** · 1 snapshot proven (deterministic) |

## Convergence flow (implemented for the 5 authorized domains)
```
legacy / provider / certified source
        ↓  (nonprodSafetyGuard — fail-closed)
dry-run-safe, idempotency-keyed backfill (ON CONFLICT DO NOTHING)
        ↓
sports_data.canonical_* (additive, versioned, is_active/history)
        ↓
canonical runtime port (CanonicalImagePort / …ValuePort / DecisionEvidencePort / B2BActivityEventPort / LeagueHealthSnapshotPort)
        ↓
default-off guarded consumer (FANTASY_OS_CANONICAL_*_ENABLED)
        ↓
shadow comparison (legacy vs canonical) → evidence for later consumer migration
```

## Ordered remaining convergence work (design-only / deferred)
1. Bulk, resumable backfill executors (image/value) from legacy — bounded batches, checkpoints, rollback manifest (framework contracts exist; bulk run deferred).
2. Consumer vertical slices behind gates: Trade OS / Manager Intelligence factual value context; Commissioner → Manager → Trade evidence; recommendation-interaction events on real surfaces.
3. Player-table + statistics-table consolidation — **DESIGN-ONLY**, needs explicit authorization (HIGH risk, 5+4 tables).
4. Legacy retirement — **NOT authorized**; only after canonical parity is proven via shadow comparison across a full season.
5. Production rollout — **NOT authorized**; non-prod only until RC.
