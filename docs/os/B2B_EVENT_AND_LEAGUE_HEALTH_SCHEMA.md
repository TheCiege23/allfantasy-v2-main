# B2B Activity Event + League Health Schema (Phase 5H-e)

Physical schemas created in the approved non-production plane (`sports_data`). Backend contracts + tests only — **no dashboard/visual work**. These persist the signals defined in `B2B_DECISION_OS_DATA_AND_EVIDENCE_REQUIREMENTS.md`.

## `sports_data.decision_evidence`
Auditable decision records — **factual inputs, versions, outputs, and user-visible explanations only; never chain-of-thought, never provider secrets/raw payloads.** Tenant/league-scoped. Key fields: `tenant_id`, `league_id`, `user_id?`, `decision_domain` (lineup/waiver/trade/draft/matchup/commissioner/league_health/manager/platform/coach/chimmy), `decision_type`, `consumer`, `correlation_id`, `canonical_entity_ids[]`, `input_snapshot_references[]`, `source_freshness`, `source_coverage`, `unsupported_inputs[]`, `recommendation_version`/`rules_version`/`explanation_version`, `decision_summary`, `confidence_band?`, lifecycle timestamps (`generated_at`/`accepted_at`/`dismissed_at`/`acted_at`), `outcome_state`, `privacy_category`, `retention_class`, `version`. Correlatable with later user actions via `correlation_id` + `b2b_activity_event.decision_evidence_id`.

## `sports_data.b2b_activity_event`
Versioned, tenant-isolated, idempotency-keyed product-analytics events — **distinct from sports data and from decision evidence**. Unique `(tenant_id, idempotency_key)` (duplicate suppression). Key fields: `tenant_id`, `league_id?`, `user_id?`, `session_id?`, `event_name`, `event_category`, `entity_type/entity_id?`, `decision_evidence_id?`, `source_surface`, `source_os`, `event_version`, `occurred_at`/`received_at`, bounded `properties` jsonb, `privacy_category`, `authorization_context`, `retention_class`, `aggregation_eligibility`.
- **Categories:** commissioner_assistance · user_decision_support · league_activity · workflow_completion · workflow_dropoff · recommendation_interaction · data_quality · provider_health · sync_health.
- **Event names (initial):** recommendation_viewed/accepted/dismissed/actioned · commissioner_action_completed/override · lineup_completed · waiver_claim_submitted · trade_analysis_viewed/proposed · draft_recommendation_viewed · matchup_insight_viewed · workflow_started/completed/abandoned · provider_data_unavailable/stale · league_sync_failed/recovered.
- **Rules:** event creation must never block the primary product action; raw free-form payloads bounded + validated; sensitive fields prohibited; deletion/retention supported.
- **Proven slice (5H-e):** `recommendation_viewed` / `_accepted` / `_dismissed` (3 rows, idempotent, linked to a decision-evidence record).

## `sports_data.league_health_snapshot`
Versioned, deterministic, **evidence-based only — no invented chat/sentiment/churn signals**. Explicitly separates:
- **observed measurements:** `active_manager_count`, `inactive_manager_count`, `trades_completed`, draft state, participation counts;
- **deterministic derived metrics:** `lineup_completion_rate`, `waiver_participation_rate`, `trade_activity_rate`;
- **risk flags** (`risk_flags[]`) and **positive signals** (`positive_signals[]`) — kept OUT of observed metrics;
- **coverage/integrity:** `sync_health`, `data_freshness`, `coverage_status`, schedule/scoring integrity indicators.
**Recommendations are NEVER placed in observed metrics.** Calculator: `lib/sports-data-gateway/persistence/canonicalPersistence.ts::computeLeagueHealthSnapshot` (deterministic, idempotent). Missing inputs → `coverage_status='partial'`, never fabricated.

## Tenant / privacy invariants (all three)
tenant isolation · league isolation · user authorization · explicit `privacy_category` + `retention_class` · versioning · no cross-tenant aggregation without `aggregation_eligibility` · no provider secrets or raw payloads · deletion/erasure supportable. Persistence is **REQ-MIGRATION for production** — created and proven in non-prod only.
