# B2B Decision OS — Data & Evidence Requirements (Phase 5H-c)

Non-visual requirements definition. This document specifies **what the Decision OS and connected OS products must
eventually be able to measure and report** for client (B2B) platforms — it does **not** design a dashboard, and no
visual work begins from it. A persisted Decision Evidence + B2B Activity Event model is **REQ-MIGRATION**
(documented here, not created in this phase).

Customer-safe naming only. Product surfaces are **Decision OS / Intelligence / Coach / Assist / Commissioner OS /
League Intelligence / Manager Intelligence / Platform Intelligence** — never "AI".

## Purpose boundaries (customer-safe)
Every future event is collected for one of these disclosed purposes, never a vague "for retention":
**synchronization · continuity · personalization · commissioner operations · support · league health · disclosed
product improvement · aggregate product performance.** Sports data, customer-authorized league data, and internal
product analytics are **three distinct categories** and must never be merged into one ambiguous store.

## How canonical Image + Value feed this (Phase 5H-c linkage)
The governed canonical **position**, **image**, and **value** services are the factual substrate these signals sit
on: a recommendation's evidence must reference the canonical value record (with `valueType`, `leagueFormat`,
`scoringFormat`, `freshnessStatus`, `coverageStatus`, `identityResolutionState`, `provenance`) and — where imagery
is shown — the canonical image reference (`source`, `fallbackRank`, `validationStatus`). This makes every
"where sports-data or provider gaps reduce product quality" signal measurable: a recommendation grounded on a
`stale`/`not_found`/`unresolved` value or a `placeholder` image is a **data-quality event**, not a silent gap.

---

## 1. Decision OS evidence requirements
Each recommendation/decision must be able to emit an evidence record capturing (persistence = REQ-MIGRATION):
- decision id, decision type (trade/waiver/lineup/draft/matchup/commissioner action), OS surface
- inputs referenced: canonical value record ids + `valueType`s, canonical image refs, canonical position, league context (format/scoring/superflex/idp)
- freshness + coverage + identity-resolution state of each input (honest data-quality)
- deterministic-authority result vs certified-evidence result (evidence never overrides authority)
- outcome where **deterministically** measurable (accepted/dismissed/ignored/completed), timestamp, event version

## 2. Commissioner-assistance events
recommendation viewed · recommendation accepted · recommendation dismissed · commissioner action completed ·
time saved (only where measurable) · manual override · unresolved issue · league configuration risk ·
league-health intervention. Each carries tenant id, league id, commissioner identity (authorized), purpose, provenance.

## 3. User decision-support events
trade analysis viewed · draft recommendation viewed · waiver recommendation viewed · lineup recommendation viewed ·
matchup insight viewed · action taken · recommendation ignored · recommendation outcome (deterministic only).

## 4. League-health signals
active managers · inactive managers · lineup completion · waiver participation · trade activity · league interaction
(only where authorized) · draft completion · commissioner responsiveness · unresolved disputes/operational issues ·
abandoned teams · competitive balance · schedule + scoring integrity · data-sync health (provider freshness/coverage).

## 5. Retention & activity signals
return frequency · active league weeks · manager re-engagement · commissioner intervention outcomes · feature adoption ·
league renewal indicators · activity before/after an intervention · churn-risk indicators · user/league inactivity.

## 6. Client product-intelligence signals (per tenant)
feature usage by tenant · workflow completion · drop-off points · data-quality failures · provider freshness failures ·
recommendation coverage · recommendation-to-action conversion · league-health distribution · commissioner workload ·
retention indicators · format-level engagement · sport-level engagement.

## 7. Tenant & privacy boundaries (mandatory on every future event)
tenant isolation · league isolation · user authorization · privacy category · event version · timestamp ·
consent / legitimate-product-purpose boundary · aggregation rules · retention policy · deletion/erasure support.
No cross-tenant aggregation without an explicit aggregation rule; no personal data in identifiers used for analytics.

## 8. Unsupported / honest states
Every signal must be able to report `unsupported`, `not_measured`, `insufficient_sample`, or `data_quality_blocked`
rather than fabricating a number. A league with `stale`/`unresolved`/`placeholder` inputs surfaces reduced
confidence, never a confident-looking fabricated metric.

## 9. Persistence status (Phase 5H-e — created + proven in NON-PROD)
The following were **physically created and proven** in the approved non-production Neon plane (`sports_data`) in Phase 5H-e (see `B2B_EVENT_AND_LEAGUE_HEALTH_SCHEMA.md` + `SPORTS_DATA_NONPROD_MIGRATION_EVIDENCE_5HE.md`) — **production rollout NOT authorized**:
- ✅ Decision Evidence table (`decision_evidence`) — tenant/league-scoped, factual inputs + versions + explanations only, no chain-of-thought/secrets.
- ✅ B2B Activity Event table (`b2b_activity_event`) — versioned, idempotency-keyed, privacy/retention/aggregation tagged.
- ✅ League Health Snapshot table (`league_health_snapshot`) — observed vs derived vs risk separated; deterministic calculator; no invented signals.
- ✅ Canonical `PlayerValue` (`canonical_player_value`) + `PlayerImage` (`canonical_entity_image`) — boundary-separated / precedence-governed.
Each remains **default-off** (gated), additive, and non-destructive; legacy paths stay authoritative. Production migration is a separate authorization.

## 9b. Factual evidence substrate (Phase 5H-f — NON-PROD)
The factual domains that ground "which decisions lack coverage" and "which leagues are affected by injury/availability/sync gaps" now have canonical contracts + non-prod tables: injury (provider-verified), availability, depth chart, projection (evidence), corrections + history. These feed the data-quality / provider-health signals in §6 (a recommendation grounded on a stale/unresolved/unavailable factual input is a measurable data-quality event). Production persistence + OS wiring = REQ-MIGRATION / REQ-WIRING. Scoring authority is unchanged.

## 10. Future client reporting requirements (define only — no visuals)
The eventual client reporting layer must be able to answer, per tenant and per league/format/sport:
what makes the fantasy product work · what reduces engagement · which formats retain users · which commissioner
actions increase activity · which features are used · where users abandon workflows · which leagues are healthy vs at
risk · which recommendations drive action · which interventions improve retention · where provider/data gaps reduce
quality. All from aggregate, privacy-bounded, provenance-tagged signals — never raw cross-tenant personal data.

## 11. Sequencing rule (locked)
**Visuals do not begin until the backend certification gates are closed.** The locked order after 5H-c is:
5H-d Unified Provider Certification → 5H-e Canonical DB Convergence + authorized migrations → 5H-f injuries/
availability/depth-charts/projections/corrections/history/production-scoring boundaries → 5H-g Decision Evidence/
League Health/Activity/Retention/Client Product Intelligence → 5H-h B2B tenant controls/roles/entitlements/privacy/
exports/auditability → 5H-i full Decision OS + connected OS certification → 5H-j B2B pilot + RC readiness. Only after
5H-j passes does the customer-facing visual upgrade begin.
