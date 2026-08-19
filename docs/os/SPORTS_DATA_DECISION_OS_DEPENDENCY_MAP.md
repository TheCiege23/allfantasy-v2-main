# Decision OS Sports-Data Dependency Map (Phase 5H Audit)

## Core invariant — VERIFIED & now enforced
**Decision OS never fetches a sports provider directly.** Audit result: **0** files in `lib/decision-os/**` and **0** routes in `app/api/decision-os/**` import any provider client (`espn-data`, `fantasycalc`, `upstream-apis`, `sleeper-sync`, `api-football`, `cfb-player-data`, `sports-live-scores-service`, `thesportsdb`, `clearsports`, `unified-player-service`, `ri-players-server`). Locked in by `__tests__/fantasy-os/unified-plane-provider-boundary.test.ts`.

The same holds for the certified sports-runtime integration services (`lib/fantasy-os/sports-runtime/*`): **0** provider imports, **0** provider URLs — they consume gateway runtime ports only.

## How Decision OS gets sports facts today
Decision OS assemblers (e.g. `WaiverContextAssembler`, trade/lineup context builders, `GameDayContextAssembler`) read from:
- **Legacy Prisma tables** (`Roster`, `League`, `SportsPlayer`, `PlayerGameLogCache`) — the production facts.
- **Player-identity resolver** (`lib/shared-services/player-identity`) — canonical.
- **FantasyCalc valuations** (`lib/fantasycalc.ts`) — via the assembler, a synchronization fetcher (not a Decision-OS direct import; the fetch is delegated).
- **Certified gateway ports** (Phase 5E) — additive `sportsContext` grounding, gated.

So Decision OS is **provider-agnostic** but **not yet exclusively on the certified gateway ports** — it still reads legacy Prisma tables for its authoritative facts.

## Per-consumer dependency (Decision OS surfaces)
| Decision OS surface | Sports facts source | Canonical-port? | Gap |
|---|---|---|---|
| League/Manager/Commissioner/Platform Intelligence | legacy tables + certified freshness/coverage (5E-h) | partial | REQ-WIRING to canonical entity ports |
| Trade OS | `PlayerIdentityMap` + FantasyCalc + certified trade guard (5E-f) | partial | values via crosswalk; facts legacy |
| Draft OS | draft session tables + certified draft evidence (5E-f) | partial | |
| Waiver OS | `WaiverContextAssembler` (legacy pool + identity) + certified (5E-e) | partial | |
| Matchup OS | `GameDayContextAssembler` + `MatchupStateNormalizer` + certified games (5E-g) | partial | |
| Recommendation OS | engine inputs (legacy) | legacy | REQ-WIRING |
| Coach / Chimmy | reasoning engines + certified grounding (5E-h) | grounding only | reasoning authoritative |

## Target
Decision OS should receive, per fact: `canonical entity id`, `verified fact`, `history`, `freshness`, `provenance`, `coverage`, `truth classification`, `unsupported-capability markers` — all from a single canonical port layer (Plane A). Today it receives a mix of legacy-table facts + certified grounding. Converging is **REQ-WIRING** (and, for full history/values, **REQ-MIGRATION**).

## Factual inputs (Phase 5H-f)
Canonical injury/availability/depth-chart/projection/correction/history contracts + ports now exist (non-prod tables). Decision OS + connected OS must consume them via ports (never repositories), receiving labeled facts with freshness/coverage/unsupported/correction state — injuries are facts, availability is observed-or-derived (labeled), projections are evidence (never authority). **Not yet wired** (gates default-off); wiring order: Manager Intelligence → Waiver → Trade → Matchup → Commissioner league-health. Scoring authority is untouched.

## Image + value inputs (Phase 5H-c)
Decision OS + connected OS (Trade/Draft/Waiver/Matchup/Manager/League/Commissioner/Platform Intelligence, Coach, Chimmy)
consume **images** via ~9 legacy inline resolvers and **values** via `canonicalPlayerValuations` (the deprecated
FantasyCalc alias, 56 importers) + 4 other value systems. Governed contracts now exist — `canonicalImage.ts` (precedence/
validation/isolation) and `canonicalValue.ts` (boundary-separated value/ranking/adp/projection/stat, format + position
governed) — but consumers are **not yet routed through them** (image = visual-safe migration deferred; value = REQ-WIRING).
Enforcement: no Decision OS file imports a FantasyCalc value client (`lib/fantasycalc`/`fantasycalc-db`) — test-locked.
Decision OS must treat provider values as **evidence** carrying league context + format + freshness + coverage +
provenance, never silently converting them into authoritative recommendations.

## Verdict
- **No provider bypass in Decision OS** — CERTIFIED ✅ (enforced by test; now also covers FantasyCalc value clients).
- **Full canonical-port consumption (position/image/value)** — NOT YET (legacy resolvers + value systems still authoritative) — REQ-WIRING (multi-increment).
