# Gap & Migration Plan (Phase 5H)

Honest per-item status. **No migration was created or run.** Anything marked REQ-MIGRATION needs explicit authorization before running anywhere (never against production).

## Per-provider status
| Provider | AUDITED | IMPLEMENTED | VERIFIED | CERTIFIED | BLOCKED | Next |
|---|---|---|---|---|---|---|
| ESPN | ✅ | ✅ | ✅ | ✅ (schedules/games/stats) | — | maintain |
| Sleeper | ✅ | ✅ | ✅ | ✅ (players/rosters/txn/draft/identity) | — | REQ-NORMALIZE (move roster/txn/draft fetch into adapter) |
| FantasyCalc | ✅ | ✅ | ✅ | ✅ (identity) | — | REQ-WIRING: certify a `PlayerValue` table for values |
| Rolling Insights | ✅ | partial (legacy client) | ❌ | ❌ | credential/verification | verify → REQ-NORMALIZE → REQ-WIRING |
| CFBD | ✅ | partial (legacy) | ❌ | ❌ | verification | verify NCAAF (isolated pool) → normalize |
| TheSportsDB | ✅ | ❌ (no gateway adapter) | ❌ | ❌ | verification | build adapter (identity/imagery) |
| API-Sports | ✅ | partial (legacy `api-football`) | ❌ | ❌ | verification | per-sport adapters |
| ClearSports | ✅ | ❌ | ❌ | ❌ | capability unproven | prove capabilities individually |
| Yahoo/MFL/Fantrax/Fleaflicker | ✅ | import-only | n/a | n/a (out of sports-data scope) | — | keep import-only |

## Capability gaps
| Capability | Status | Blocker |
|---|---|---|
| player statistics (certified) | ✅ CERTIFIED (ESPN) | read-only; not a scoring input yet |
| player identity | ✅ 78.5% rows / 75.4% athletes | IDP gap (external); REQ additional source |
| positions (canonical) | governed module BUILT + sport-isolated + enforcement-locked (5H-b/5H-b2); adoption REQ-NORMALIZE | ~40 `team-abbrev` legality callers + valuation callers (→5H-c) still on legacy collapse; 0 migrated, each documented |
| images (canonical precedence) | governed service BUILT (5H-c) + enforcement-locked; adoption REQ-NORMALIZE (visual-safe, deferred) (+REQ-MIGRATION for `PlayerImage`/`TeamImage`) | ~9 inline resolvers not yet routed through `canonicalImage.ts` |
| valuations (certified table) | governed contract BUILT (5H-c, boundary-separated) + live-proven; adoption REQ-WIRING (+REQ-MIGRATION for certified `PlayerValue`) | 5 parallel value systems + merge offenders; FantasyCalc value egress outside `providers/` |
| projections | model exists (`FantasyProjection`); population UNVERIFIED — keep UNAVAILABLE until proven | provider/model verification |
| injuries | ✅ 5H-f: canonical contract + table (NON-PROD) + **PROVIDER-VERIFIED** (API-Sports live) | production persistence REQ-MIGRATION; identity resolution (api-sports ids → canonical) REQ-WIRING |
| availability | 5H-f: canonical contract + table (NON-PROD, fixture-proven) | separates the legacy merged token; migrating legacy `SportsPlayer.status`/`PlayerStatusEvent` onto it = REQ-WIRING |
| depth charts | 5H-f: canonical contract + table (NON-PROD, fixture-proven) | real RI depth chart exists but RI REQUIRES_WIRING → no gateway cert; certification blocked on the RI adapter |
| projections | 5H-f: canonical contract + table (NON-PROD, fixture-proven); `FantasyProjection` UNPOPULATED, live = heuristic | provider projection source unverified; evidence-only, never scoring |
| corrections + history | ✅ 5H-f: canonical correction + player-team + player-position history tables (NON-PROD, proven) | legacy `PlayerTeamHistory` dead-writer/empty; no legacy position history — new domains |
| decision-evidence audit table | REQ-MIGRATION (deferred since 5E) | authorization |

## Player/statistics table consolidation
`SportsPlayer` / `Player` / `FantasyPlayer` / `DevyPlayer` and `PlayerGameLogCache` / `PlayerSeasonStats` / `FantasyStatLine` are fragmented (Plane B) and run in parallel to the certified plane (Plane A). Unifying is **REQ-MIGRATION** — documented, not executed.

## Prioritized safe (no-migration) work — this and future increments
1. ✅ **DONE (5H):** enforce "no provider bypass in Decision OS / integration services / product routes" (`unified-plane-provider-boundary.test.ts`).
2. ✅ **DONE (5H-b):** move Sleeper roster/txn/draft fetch into `providers/sleeper.ts` (adapter purity) — zero provider URLs remain in gateway runtime; boundary test strengthened to enforce it.
3. ✅ **DONE (5H-b):** single governed canonical position module `canonical/canonicalPosition.ts` (detailed + league-rule-derived eligibility, IDP-aware, effective-dated). ✅ **DONE (5H-b2):** sport-isolation hardening (`SUPPORTED_POSITION_SPORTS`/`isSupportedPositionSport` — no cross-sport fallback) + repo-enforcement test (`unified-plane-provider-boundary.test.ts` fails on any NEW competing collapse map outside a documented allowlist) + governance contract tests. **RE-AUDIT (5H-b2) found 24+ competing maps; 0 were safely migratable this increment** — each retained with a documented reason (see `SPORTS_DATA_IMAGE_AND_POSITION_POLICY.md` ledger): `api-football`=SOCCER (sport isolation), `fantrax-parser`=verbatim CSV parse (nothing to normalize), `idp-kicker-values`/`dynasty-tiers`=valuation grouping (**→ Phase 5H-c**), `devy-classification`=NCAAF identity-matching heuristic, `team-abbrev.POSITION_CANONICAL`=shared collapsing normalizer ~40 roster-legality callers depend on (**governed per-caller migration**). **REMAINING:** (a) route valuation collapsing through 5H-c; (b) governed migration of the `team-abbrev` legality-collapse callers.
4. ✅ **DONE (5H-c):** governed canonical IMAGE service `canonical/canonicalImage.ts` (4-tier precedence + URL validation + entity/sport/imageType isolation + honest placeholder) AND governed canonical VALUE service `canonical/canonicalValue.ts` (distinct valuation/ranking/adp/projection/stat boundaries; league-format + scoring + canonical-position governed; FantasyCalc = provider_valuation). Enforcement + contract tests added; live FantasyCalc value proving passed. **REMAINING:** route the ~9 image resolvers through `canonicalImage.ts` (visual-safe per-caller migration — deferred, phase forbids visual change) and the value consumers/merge-engines through `canonicalValue.ts` (REQ-WIRING); dedicated `PlayerImage`/`TeamImage`/certified `PlayerValue` tables are REQ-MIGRATION.
5. Provider verification increments — **5H-d LIVE results (2026-07-13):** ESPN/Sleeper/FantasyCalc re-CERTIFIED; TheSportsDB/CFBD/API-Sports **VERIFIED** (real request → canonical route; persistence REQ-MIGRATION); ClearSports **BLOCKED** (HTTP 500); Rolling Insights **REQUIRES_WIRING** (DB-coupled client → needs `providers/rolling-insights.ts`). **REMAINING per provider:** RI adapter + probe; ClearSports re-attempt; TheSportsDB→`PlayerImage`, CFBD→NCAAF certified snapshot, API-Sports→soccer canonical contract; each persistence step is REQ-MIGRATION. Gateway adapters exist only for ESPN/Sleeper/FantasyCalc-identity. **One provider per stacked PR.** (See `SPORTS_DATA_PROVIDER_CERTIFICATION_5HD.md` + `providers/certificationStatus.ts`.)
6. REQ-WIRING: canonical port layer + Decision OS/OS convergence off legacy tables.
7. REQ-MIGRATION items — **Phase 5H-e status:** `PlayerImage`(`canonical_entity_image`), `PlayerValue`(`canonical_player_value`), decision-evidence, B2B activity-event, and league-health-snapshot tables were **authorized + physically created + proven in NON-PROD only** (`SPORTS_DATA_NONPROD_MIGRATION_EVIDENCE_5HE.md`); production rollout remains unauthorized. **Player/stat consolidation, availability, depth charts stay DESIGN-ONLY** — stop and request authorization per item. No legacy table removed.

## Rule
Do not batch providers or migrations into one unsafe change. Each provider verification and each migration is its own reviewed, stacked increment. No production rollout while any provider is presented as connected while still `configured_not_verified`.
