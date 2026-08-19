-- Fantasy OS Phase 5H-e — canonical convergence migration (ADDITIVE, non-destructive, idempotent).
-- APPLIED PHYSICALLY to the approved NON-PRODUCTION Neon project ONLY: cool-lab-87438174 (decision-os-phaseA-verify),
-- database neondb, schema sports_data. NOT authorized for production. No legacy table is dropped or altered.
-- Executors must call lib/sports-data-gateway/persistence/nonprodSafetyGuard.ts (fail-closed) before running.

-- Non-production safety marker (executors fail closed if absent / project id mismatch).
CREATE TABLE IF NOT EXISTS sports_data.nonprod_safety_marker (
  marker text PRIMARY KEY, project_id text NOT NULL, project_name text NOT NULL, note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sports_data.nonprod_safety_marker (marker, project_id, project_name, note)
VALUES ('FANTASY_OS_NONPROD_APPROVED', 'cool-lab-87438174', 'decision-os-phaseA-verify', 'Phase 5H-e authorized non-production migration target.')
ON CONFLICT (marker) DO UPDATE SET project_id = EXCLUDED.project_id, project_name = EXCLUDED.project_name, note = EXCLUDED.note;

-- 1. Canonical Entity Image (players + teams; sport-isolated; append-only history via is_active + version).
CREATE TABLE IF NOT EXISTS sports_data.canonical_entity_image (
  id text PRIMARY KEY, canonical_entity_id text NOT NULL, entity_type text NOT NULL, sport text NOT NULL,
  image_type text NOT NULL, source text NOT NULL, source_entity_id text, url text, managed_asset_reference text,
  validation_status text NOT NULL, freshness_status text NOT NULL, fallback_rank int NOT NULL, width int, height int,
  retrieved_at timestamptz, effective_at timestamptz, expires_at timestamptz, provenance text NOT NULL,
  is_placeholder boolean NOT NULL DEFAULT false, unsupported_reason text, content_hash text,
  version int NOT NULL DEFAULT 1, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_entity_image_natural ON sports_data.canonical_entity_image (canonical_entity_id, entity_type, sport, image_type, source, content_hash);
CREATE INDEX IF NOT EXISTS ix_canonical_entity_image_active ON sports_data.canonical_entity_image (canonical_entity_id, entity_type, sport, image_type, is_active, fallback_rank);

-- 2. Canonical Player Value (boundary-separated valueType; dynasty/redraft + scoring isolated; positions preserved).
CREATE TABLE IF NOT EXISTS sports_data.canonical_player_value (
  id text PRIMARY KEY, canonical_player_id text, sport text NOT NULL, source text NOT NULL, source_player_id text,
  value_type text NOT NULL, league_format text NOT NULL, scoring_format text NOT NULL, position_detail text NOT NULL,
  valuation_bucket text, superflex boolean NOT NULL DEFAULT false, idp boolean NOT NULL DEFAULT false,
  value double precision, rank int, tier int, generated_at timestamptz, retrieved_at timestamptz, effective_at timestamptz,
  freshness_status text NOT NULL, source_version text, identity_resolution_state text NOT NULL, coverage_status text NOT NULL,
  provenance text NOT NULL, unsupported_reason text, content_hash text, version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_player_value_natural ON sports_data.canonical_player_value (source, source_player_id, value_type, league_format, scoring_format, superflex, idp, content_hash);
CREATE INDEX IF NOT EXISTS ix_canonical_player_value_lookup ON sports_data.canonical_player_value (canonical_player_id, value_type, league_format, scoring_format, is_active);

-- 3. Decision Evidence (tenant/league-scoped; factual inputs + versions + outputs; NO chain-of-thought/secrets).
CREATE TABLE IF NOT EXISTS sports_data.decision_evidence (
  id text PRIMARY KEY, tenant_id text NOT NULL, league_id text, user_id text, decision_domain text NOT NULL,
  decision_type text NOT NULL, consumer text NOT NULL, request_id text, correlation_id text,
  canonical_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb, input_snapshot_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_freshness text, source_coverage text, unsupported_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation_version text, rules_version text, explanation_version text, decision_summary text, confidence_band text,
  generated_at timestamptz NOT NULL, expires_at timestamptz, accepted_at timestamptz, dismissed_at timestamptz,
  acted_at timestamptz, outcome_state text, provenance text NOT NULL, privacy_category text NOT NULL,
  retention_class text NOT NULL, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_decision_evidence_tenant_league ON sports_data.decision_evidence (tenant_id, league_id, decision_domain, generated_at);
CREATE INDEX IF NOT EXISTS ix_decision_evidence_correlation ON sports_data.decision_evidence (correlation_id);

-- 4. B2B Activity Event (tenant/league-scoped; versioned; idempotency-keyed; privacy/retention tagged).
CREATE TABLE IF NOT EXISTS sports_data.b2b_activity_event (
  id text PRIMARY KEY, tenant_id text NOT NULL, league_id text, user_id text, session_id text, event_name text NOT NULL,
  event_category text NOT NULL, entity_type text, entity_id text, decision_evidence_id text, source_surface text,
  source_os text, event_version int NOT NULL DEFAULT 1, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb, privacy_category text NOT NULL, authorization_context text NOT NULL,
  retention_class text NOT NULL, aggregation_eligibility text NOT NULL, idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_b2b_activity_event_idem ON sports_data.b2b_activity_event (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ix_b2b_activity_event_tenant ON sports_data.b2b_activity_event (tenant_id, league_id, event_category, occurred_at);

-- 5. League Health Snapshot (observed vs derived vs risk flags kept separate; recommendations NOT in observed metrics).
CREATE TABLE IF NOT EXISTS sports_data.league_health_snapshot (
  id text PRIMARY KEY, tenant_id text NOT NULL, league_id text NOT NULL, sport text NOT NULL, season text,
  week_or_period text, health_version int NOT NULL DEFAULT 1, computed_at timestamptz NOT NULL, window_start timestamptz,
  window_end timestamptz, active_manager_count int, inactive_manager_count int, lineup_completion_rate double precision,
  waiver_participation_rate double precision, trade_activity_rate double precision, draft_completion_state text,
  commissioner_response_indicators jsonb NOT NULL DEFAULT '{}'::jsonb, abandoned_team_indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  competitive_balance_indicators jsonb NOT NULL DEFAULT '{}'::jsonb, scoring_integrity_indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule_integrity_indicators jsonb NOT NULL DEFAULT '{}'::jsonb, sync_health text, data_freshness text, coverage_status text,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb, positive_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb, provenance text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_league_health_snapshot_natural ON sports_data.league_health_snapshot (tenant_id, league_id, season, week_or_period, health_version);
CREATE INDEX IF NOT EXISTS ix_league_health_snapshot_league ON sports_data.league_health_snapshot (tenant_id, league_id, computed_at);

-- ROLLBACK (non-destructive): rows are deactivated via UPDATE ... SET is_active=false (image/value) or retained for
-- audit (evidence/events/health). Tables themselves are NOT dropped in-phase. Legacy tables remain authoritative.
