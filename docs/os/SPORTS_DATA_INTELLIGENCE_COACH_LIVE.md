# Live Intelligence / Coach / Chimmy / Operator Observability (Certified Sports Context) — Fantasy OS Phase 5E-h

The final runtime-wiring phase. Certified sports context is injected as **factual grounding only** into the customer-facing intelligence layer and a new operator-observability surface, behind server-only gates (`FANTASY_OS_SPORTS_DATA_INTELLIGENCE_ENABLED`, `FANTASY_OS_SPORTS_DATA_COACH_ENABLED`, and a new `FANTASY_OS_SPORTS_DATA_OBSERVABILITY_ENABLED`), **off by default**. Certified data may only improve factual grounding — it never invents intelligence, never changes any recommendation/ranking/confidence/score, and never overrides reasoning.

## Shared service
`lib/fantasy-os/sports-runtime/intelligenceIntegration.ts` — `CertifiedIntelligenceIntegrationService` composes the existing runtime primitives (store meta reads, `buildCertifiedFreshness`, `PROVIDER_INVENTORY`, `CertifiedMatchupIntegrationService`). It reimplements no reasoning/recommendation/confidence/scoring. Methods: `describeSnapshotFreshness`, `describeProviderHealth`, `describeEvidenceAvailability`, `describeLeagueSportsContext`, `describeManagerSportsContext`, `describeCommissionerSportsContext`, `describeCoachSportsContext`, `describePlatformSportsContext`.

### Honest capability truth
- `describeEvidenceAvailability()` reports **certified** = players / rosters / transactions / games / draft_data; **not-certified** = statistics / injuries / projections / live_scores / play_by_play / depth_charts / news / weather.
- `INTELLIGENCE_UNSUPPORTED` (always `unavailable`, never inferred): injuries, projections, statistics, playerAvailability, rankings, predictions, managerPsychology, commissionerIntent, retentionLikelihood.
- `describeProviderHealth()` returns provenance only (provider, sports, status, capabilities, lastVerifiedAt) — **never** env-var names, client locations, or credentials.

## Wired surfaces (all informational; reasoning stays authoritative; gated; wrapped)
| Surface | Route | Gate | Reasoning authority (unchanged) |
|---|---|---|---|
| Coach | `POST /api/coach/advice` | `coach` | `getAICoachResponse` — `recommendation`/`explanation` returned unchanged |
| Chimmy | `POST /api/ai/chimmy` | `intelligence` | `runUnifiedOrchestration` — response unchanged |
| Manager Intelligence | `GET /api/decision-os/manager-command-center` | `intelligence` | `resolveManagerCommandCenterSnapshot` — snapshot unchanged |
| Commissioner Intelligence | `GET /api/decision-os/mission-control` | `intelligence` | `resolveMissionControlSnapshot` — snapshot unchanged |
| Platform / Operator | `GET /api/admin/fantasy-os/sports-data/observability` (NEW, admin-gated) | `observability` | n/a (read-only observability) |
| League Intelligence | `describeLeagueSportsContext` (service method) | `intelligence` | facts-only bundle; exercised by unit test + proving run |

In every wired route the certified context is attached as a sibling `sportsContext` field — it never feeds the reasoning engine and never mutates the existing payload. Gate off (default) → response byte-for-byte unchanged.

## Operator observability route
`GET /api/admin/fantasy-os/sports-data/observability` — `requireAdmin()` AND `isSportsDataEnabled('observability')`. Exposes provider health, certified snapshot freshness, evidence availability, snapshot versions, and gate diagnostics (names + booleans only). **Never** exposes credentials, connection strings, or raw provider payloads. Read-only.

## Import guard
The service and all wired routes reach providers only through gateway ports and certified snapshot reads — no `sleeper-client`/`espn-client`/provider URL, no direct `fetch`. Test-enforced.

## Decision evidence
Emitted per surface: subsystem, snapshot version, freshness, provider health, evaluated timestamp, gate state, evidence availability. No provider payloads/credentials. Not persisted (no migration).

## Proving run (non-prod certified snapshots, `cool-lab-87438174`)
- `describeSnapshotFreshness` → games (`nfl-games-2026-w1`, provider espn, delayed) + players (`nfl-players-2026-07-12`, provider sleeper, delayed) — real freshness.
- `describeProviderHealth` → sanitized entries (sleeper `production_connected`, rolling_insights/cfbd `configured_not_verified`) — no env-var names, no credentials.
- `describeEvidenceAvailability` → certified [players/rosters/transactions/games/draft_data] vs not-certified [statistics/injuries/projections/…]; unsupported map all `unavailable`.
- `describeCoachSportsContext` / `describePlatformSportsContext` → Coach + platform receive grounding; unsupported stay unavailable.
- **No provider request** (certified snapshot reads only). **Recommendations unchanged** (gate-off default; sibling-field attach when on).

## Disable / rollback (independent)
Unset any of `FANTASY_OS_SPORTS_DATA_INTELLIGENCE_ENABLED` / `_COACH_ENABLED` / `_OBSERVABILITY_ENABLED` → the respective surface reverts instantly. No production DB touched; no migration.

## Gate registry
9 gates now: lineup, waiver, trade, draft, matchup, scoring, intelligence, coach, **observability** (new). All server-only, disabled by default, not customer-overridable.

## After Phase 5E-h
Runtime wiring is complete. The next milestone is **Phase 5F — Certified Capability Expansion** (certified player statistics, injuries, availability, projections, multi-provider verification, final provider certification) — not more wiring.
