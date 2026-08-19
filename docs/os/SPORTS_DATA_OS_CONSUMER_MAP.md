# Sports Data OS Consumer Map (Fantasy OS Phase 5)

Every subsystem consumes a narrow **port** (`lib/sports-data-gateway/ports.ts`) backed by the gateway — never a
raw provider client. Each port response carries `SportsDataContext` (freshness/provenance).

| Subsystem | Port (interface) | Needs | Status |
|---|---|---|---|
| Draft OS | `DraftSportsDataPort` (`GatewayDraftPort` impl ✅) | canonical players, positions, teams, eligibility, injuries, projections, ADP, rookies, schedules/byes | **port impl + tested + validated** |
| Trade OS | `TradeSportsDataPort` | identity, roster status, injuries, projections, season stats, schedule, age/exp, pick context | interface defined; impl pending |
| Waiver OS | `WaiverSportsDataPort` | availability, ownership, recent perf, injuries, projections, schedules, role/depth | interface defined; impl pending |
| Lineup / Start-Sit | `LineupSportsDataPort` | schedule, kickoff, injury, active/inactive, projections, weather, scoring | interface defined; impl pending |
| Matchup OS | (add `MatchupSportsDataPort`) | live/final scores, stats, projections, game status, scoring rules | pending |
| League / Commissioner Intelligence | (read ports) | schedules, participation, transactions, roster completeness, availability | pending — no unsupported commissioner judgments from player news |
| Manager Intelligence | (read ports) | deterministic participation/decision context ONLY | pending — never infer psychology/competence/retention |
| Platform Intelligence | health/coverage read | provider coverage, freshness, unresolved identities, API health, sync status by sport/capability | pending — never expose credentials/secrets |
| Chimmy / Coach | canonical snapshots + deterministic results | canonical ids, timestamps, freshness, provenance, limitations, truth labels | pending — must NOT call external APIs; narrative never overrides deterministic data |

## Contract rules
- Ports expose only what the subsystem needs (no whole-snapshot passing).
- Provider failure → port fails closed (empty + `unavailable` context), never fabricated data (proven by the
  Draft-port outage test).
- Unsupported capability → the subsystem renders `Insufficient Evidence`.

## Remaining
Trade/Waiver/Lineup/Matchup port **implementations** + League/Commissioner/Manager/Platform/Chimmy wiring are
the next increments (interfaces + the Draft reference impl are in place to pattern them).
