# Sports Data Capability Ownership + Live-Data Gap Audit (Fantasy OS Phase 5D stop-gates)

## Stop-gate 2 — capability ownership (`lib/sports-data-gateway/capabilityRoutes.ts`)
A capability may only enter the live runtime when its provider is **verified**. Sleeper is verified only for its native league scopes.

| Capability | Owner | Verification | Cadence / max stale |
|---|---|---|---|
| players | sleeper | **verified** | 240m / 1440m |
| rosters | sleeper | **verified** | 30m / 60m |
| transactions | sleeper | **verified** | 30m / 60m |
| draft_data | sleeper | **verified** | 30m / 120m |
| schedules | rolling_insights → api_sports/espn | configured_not_verified | 720m / 1440m |
| games / live_scores | rolling_insights → api_sports | configured_not_verified | 30m / 45–60m |
| injuries / availability | rolling_insights → api_sports | configured_not_verified | 30m / 60m |
| statistics | rolling_insights → api_sports | configured_not_verified | 30m / 60m |
| projections | rolling_insights | configured_not_verified | 720m / 1440m |
| weather | openweathermap | configured_not_verified | 60m / 180m |

**Consequence:** Lineup lock stays `unknown` (fail-closed) and Trade/Waiver projection/stats stay `null` until a supporting provider is verified for `schedules`/`games`/`injuries`/`statistics`/`projections`. We do **not** pretend Sleeper supplies these.

## Stop-gate 1 — live-data gap audit (real call paths traced)
| Subsystem | Runtime entry point | Canonical port | Actually wired? | Missing capabilities |
|---|---|---|---|---|
| Trade OS | `lib/trade-engine/*`, `/api/trade-value/analyze` | Trade runtime port (5C) | **No** (port built, not injected) | schedules, injuries, stats, projections |
| Waiver OS | `WaiverContextAssembler`, `app/api/waiver-ai/engine` | interface only | No | availability, injuries, projections, schedules |
| Lineup / Start-Sit | `lib/roster-lineup-engine/lineupLockService.ts`, `lib/redraft/lineupLock.ts` | Lineup runtime port (5C) | **No** (port built, not injected) | schedules (blocks lock beyond `unknown`), injuries, projections, weather |
| Matchup | `scoringEngine.ts`, `MatchupStateNormalizer.ts` | interface only | No | games, statistics |
| Draft OS | draft pool services | Draft gateway port (P5) | partial | draft_data scope (this phase), college mappings |
| League/Commissioner/Manager Intelligence | executive intelligence (`lib/fantasy-os/exec-intelligence`) | none | No | roster/schedule/availability coverage |
| Platform Intelligence | observability summarizer (5C) | partial | No | full provider-health port |
| Coach / Chimmy | AI context assembly | none | No | canonical context assembler |

**Rule:** existing lock/scoring/valuation engines remain **authoritative**; ports **enrich**, never override. Injection points for the ports are the context-assembly functions in each subsystem (not the decision functions).

## Delivered this increment (Phase 5D-a)
Stop-gates + **roster synchronization** scope (real proving run). Everything else in the table above is a subsequent increment; it is honestly **not** wired yet.
