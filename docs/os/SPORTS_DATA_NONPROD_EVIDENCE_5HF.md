# Non-Production Evidence (Phase 5H-f)

Date **2026-07-13** · Environment: approved non-production Neon `cool-lab-87438174` ("decision-os-phaseA-verify"), db `neondb`, schema `sports_data`. **No production access, no secret logged, no legacy table removed, no scoring authority changed.** Guard: `nonprodSafetyGuard.ts` (marker confirmed present).

## 7 factual-domain tables created (additive, effective-dated)
`canonical_injury`, `canonical_availability`, `canonical_depth_chart`, `canonical_projection`, `canonical_correction`, `canonical_player_team_history`, `canonical_player_position_history` (verified: `factual_tables_created = 7`). Each has a natural unique index (idempotency) + lookup index.

## Proving rows
| Domain | Rows | Evidence class |
|---|---|---|
| injury | 2 versions | **PROVIDER-VERIFIED** — real API-Sports NFL injury (player 14653 "Jackson Powers-Johnson", Raiders, `Questionable`→`Out`) |
| availability | 1 | fixture-only (labeled; production availability is a merged token — see contract) |
| depth chart | 1 | fixture-only (labeled; RollingInsights depth chart is real but REQUIRES_WIRING) |
| projection | 1 | fixture-only (labeled; `FantasyProjection` is UNPOPULATED in prod) |
| correction | 1 lineage | injury status escalation, append-only |
| player-team history | 1 | effective-dated (source sleeper) |
| player-position history | 1 | effective-dated, detail preserved (RB) |

## Correction lineage + as-of (proven)
Injury `v1` (`Questionable`, effective 2026-06-03) → correction inserts `v2` (`Out`, effective 2026-06-10, `correction_of_id=v1`); a `canonical_correction` row links `v2→v1` (previous_hash `h_inj_1` → corrected_hash `h_inj_2`); `v1` deactivated (retained). **Current retrieval = `Out`; as-of 2026-06-05 = `Questionable`** (historical fact preserved); **2 versions retained** (no destructive overwrite).

## Idempotency + rollback (proven)
Rerun of the injury + correction inserts against the natural unique indexes → **0 duplicates** (`injury_dups=0`, `corr_dups=0`, injury_total stayed 2). Non-destructive deactivate/reactivate proven on the availability row (`is_active` toggled, then restored true).

## Provider verification vs fixture (honest labels)
- **PROVIDER-VERIFIED:** injuries (API-Sports live, real NFL data).
- **FIXTURE-ONLY (schema behavior proven, NOT provider-certified):** availability, depth chart, projection — no gateway-certified provider source exists (availability is a derived legacy token; RI depth charts REQUIRES_WIRING; `FantasyProjection` unpopulated).
- No fabricated provider facts were inserted to satisfy minimum counts.

## Not done (by design)
No production migration; no legacy table altered/removed; no consumer switched to canonical reads (gates default-off); no scoring authority change; no bulk backfill.
