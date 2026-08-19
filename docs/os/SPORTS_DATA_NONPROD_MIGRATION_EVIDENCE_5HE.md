# Non-Production Migration Evidence (Phase 5H-e)

Date: **2026-07-13** · Environment: **approved non-production only** — Neon project `cool-lab-87438174` ("decision-os-phaseA-verify"), database `neondb`, schema `sports_data`. **No production access. No secret logged. No legacy table removed.** Executor guard: `lib/sports-data-gateway/persistence/nonprodSafetyGuard.ts` (fail-closed; requires this exact project id + name + the marker row).

## Safety marker (fail-closed anchor)
`sports_data.nonprod_safety_marker` → `FANTASY_OS_NONPROD_APPROVED` = `cool-lab-87438174 / decision-os-phaseA-verify`. Confirmed present before any insert.

## Migrations physically created (additive; `CREATE TABLE IF NOT EXISTS`)
All 5 authorized tables created in `sports_data` (verified: `canonical_tables_created = 5`), each with a natural unique index (idempotency) + lookup index:
1. `canonical_entity_image` — uq (canonical_entity_id, entity_type, sport, image_type, source, content_hash)
2. `canonical_player_value` — uq (source, source_player_id, value_type, league_format, scoring_format, superflex, idp, content_hash)
3. `decision_evidence` — ix (tenant_id, league_id, decision_domain, generated_at) + (correlation_id)
4. `b2b_activity_event` — uq (tenant_id, idempotency_key)
5. `league_health_snapshot` — uq (tenant_id, league_id, season, week_or_period, health_version)

## Backfill / proving rows (the required minimum, real INSERTs)
| Domain | Rows | Evidence |
|---|---|---|
| player image | 1 | `img_player_mahomes_tsdb` (thesportsdb, headshot, rank 2, valid) |
| team image | 1 | `img_team_kc_registry` (registry, logo, rank 1, valid) |
| player value | 1 | `val_fc_gibbs_dyn` (fantasycalc, **provider_valuation**, dynasty/ppr, value 10135) |
| decision evidence | 1 | `de_commish_5he_1` (commissioner domain, unsupported_inputs=[injuries:not_certified], privacy=league_operational) |
| B2B activity events | 3 | `recommendation_viewed` / `_accepted` / `_dismissed`, all linked to `de_commish_5he_1` |
| league health snapshot | 1 | `lh_5he_1` (11 active / 1 inactive, lineup 0.917, draft complete, coverage partial) |

## Idempotency (proven)
Reran the identical inserts (with distinct candidate ids) against the natural unique indexes + `ON CONFLICT DO NOTHING` → **0 duplicate rows created**; counts unchanged (images 2, values 1, events 3, health 1). `dup_rows_created = 0`.

## Rollback / deactivation (proven, non-destructive)
`UPDATE canonical_entity_image SET is_active=false, version=version+1 WHERE id='img_player_mahomes_tsdb'` → row **retained** (auditable), `is_active=false`, `version=2`. Re-activated to restore the intended final state; active retrieval resolves the strongest active image by `fallback_rank` (`thesportsdb rank=2 valid`).

## Retrieval (proven)
Active-image resolution returns the lowest `fallback_rank` active row; value retrieval returns the boundary-typed record (`provider_valuation 10135`, rank NULL); 3 activity events correlate to the decision-evidence id.

## Not done (by design)
- No legacy table altered or dropped; legacy paths remain authoritative and default-on.
- No production migration; no deploy.
- Full legacy backfill (all images/values) NOT run — only the required proving minimum; bulk backfill is a bounded, resumable executor task for a later increment.
- Consumer vertical-slice wiring (Trade OS / Manager Intelligence / Commissioner Intelligence) NOT switched on — the domain gates are default-off; shadow-compare is the migration-planning tool.
