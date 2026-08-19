# Sports Data — Capability Matrix (Phase 5G Certification)

Status of every certified capability. `implemented` = code exists; `tested` = unit/integration tested; `runtime wired` = consumed by a real product path; `gated` = behind a server-only feature flag (off by default); `certified` = append-only certified snapshot + runtime retrieval proven.

| Capability | Implemented | Tested | Runtime wired | Prod gated | Certified | Known limitations |
|---|---|---|---|---|---|---|
| **schedules/games** | ✅ | ✅ | ✅ (matchup, scoring, lineup, waiver, trade) | ✅ `matchup`/`scoring`/etc | ✅ ESPN, append-only | teamless legacy player sample for player↔game resolution |
| **player identities** | ✅ | ✅ | ✅ (statistics, lineup, waiver) | n/a (data plane) | ✅ deterministic (Sleeper+FantasyCalc) | 78.5% rows / 75.4% athletes — IDP/defensive gap (external) |
| **statistics** | ✅ | ✅ | ⚠️ read-only (not a scoring input) | n/a (data plane) | ✅ ESPN box scores, append-only | not yet a production scoring input; IDP identity gap |
| **lineup** | ✅ | ✅ | ✅ persisting save + Start/Sit + Today Actions | ✅ `lineup` | reject-only/informational | block path unit-proven (teamless live sample) |
| **waiver** | ✅ | ✅ | ✅ claim submit + eligibility + assembler | ✅ `waiver` | reject-only/informational | same teamless caveat |
| **trade** | ✅ | ✅ | ✅ proposal + accept + settlement + analysis | ✅ `trade` | reject-only (grounded) / informational | `individual_game_time` policy declared-not-enforced → guard never invents a rejection |
| **draft** | ✅ | ✅ | ✅ live pick + room/board | ✅ `draft` | informational (never blocks) | sports facts are not draft legality (by design) |
| **matchup** | ✅ | ✅ | ✅ normalizer + game-day + matchup-center | ✅ `matchup` | informational + finality evidence | never finalizes alone |
| **scoring** | ✅ | ✅ | ✅ finalization guard (`updateMatchupScores`) | ✅ `scoring` | stricter-only finalization | no certified player-stat scoring input yet |
| **intelligence** (League/Manager/Commissioner/Platform) | ✅ | ✅ | ✅ manager/commissioner routes + service | ✅ `intelligence` | informational grounding | injuries/projections not exposed |
| **coach** | ✅ | ✅ | ✅ `/api/coach/advice` | ✅ `coach` | informational grounding | reasoning authoritative |
| **chimmy** | ✅ | ✅ | ✅ `/api/ai/chimmy` | ✅ `intelligence` | informational grounding | conversational logic authoritative |
| **observability** | ✅ | ✅ | ✅ admin route (freshness/health/coverage) | ✅ `observability` | counts-only diagnostics | per-source contribution not persisted (no migration) |
| **injuries** | ❌ | — | — | — | ❌ not-certified | no verified provider feed |
| **projections** | ❌ | — | — | — | ❌ not-certified | none |
| **availability** | ❌ | — | — | — | ❌ not-certified | none |

**Feature gates (9, all off by default, server-only, not customer-overridable):** `lineup`, `waiver`, `trade`, `draft`, `matchup`, `scoring`, `intelligence`, `coach`, `observability`.

**Integration services (8):** `lineupIntegration`, `waiverIntegration`, `tradeIntegration` (+`tradeSettlementGuard`), `draftIntegration`, `matchupIntegration`, `scoringIntegration`, `intelligenceIntegration`, `context`/`gates`.

**Gateway runtime modules (18):** `store`, `snapshot`, `checksum`, `events`, `freshnessPure`, `scheduleRuntime`, `rosterRuntime`, `transactionRuntime`, `draftRuntime`, `sleeperRuntime`, `statisticsRuntime`, `statisticsIdentityResolver`, `espnIdentityPopulation`, `playerGameResolution`, `lineupSafety`, `lock`, `certifiedReads`, `observability`.

**Governed canonical contracts (Phase 5H-b/c):** `canonical/canonicalPosition`, `canonical/canonicalImage`, `canonical/canonicalValue`.

**Factual domains (Phase 5H-f, non-prod):** `persistence/factualDomains` + 7 tables — injury (PROVIDER-VERIFIED, API-Sports), availability/depth-chart/projection (fixture-only), correction, player-team + player-position history. Scoring boundary `scoring/scoringAuthorityBoundary` (authority unchanged; certified stats observational-only, enforced).

**Provider certification (Phase 5H-d, 2026-07-13 live):** `providers/certificationStatus` — CERTIFIED: ESPN (schedules/games/statistics), Sleeper (players/identity/rosters/transactions/draft), FantasyCalc (valuation/ranking/adp). VERIFIED (request+canonical, persistence REQ-MIGRATION): TheSportsDB (headshots), CFBD (NCAAF rosters/positions), API-Sports (soccer teams). BLOCKED: ClearSports. REQUIRES_WIRING: Rolling Insights. Certified `sports_data` plane = ESPN + Sleeper only.
