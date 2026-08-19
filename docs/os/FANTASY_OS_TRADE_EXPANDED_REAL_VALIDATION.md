# Trade Value Console — Expanded Real Validation (Phase 19)

**Status: real validation performed against `.env.test`. One real bug found and fixed (with regression tests, before/after evidence). Readiness: B — continue narrow shadow validation.**

## Environment

Same `.env.test` non-production database used since Phase 13. No auth/QA-identity setup needed (this route requires no session).

## Re-audit of the Phase 18 seam (Task 1)

Confirmed directly from source, no drift since Phase 18: the injection point, feature-flag gate, `TRADE_SHADOW_COMPARE_TIMEOUT_MS = 6000` (with its documented rationale), the `no_player_assets` skip behavior, and the response-fidelity guarantee are all byte-identical to what Phase 18 shipped.

## A self-corrected research error, disclosed rather than hidden

Before building the validation matrix, an initial safety check with a **fabricated** `playerId` (`"nfl:4046"`, never verified against the real database) appeared to show the authoritative route failing to price both trade sides. Investigating further, a `psql` check using an imprecise search pattern wrongly concluded the underlying `SportsPlayerRecord` table didn't exist at all in this environment. Re-verifying with a corrected query found the model does exist (`@@map("sports_players")`, confirmed at `prisma/schema.prisma:284`) and is genuinely populated: NFL 11,242 / MLB 7,224 / NCAAF 5,226 / NHL 4,096 / NBA 1,949 / Soccer 800 real rows. **The failure was caused by using a non-existent id in the test, not a real defect.** A retest with a real, DB-verified id (`NFL:3513`, Nick Chubb) resolved perfectly. This self-correction is recorded here in full rather than silently fixed, matching this effort's established practice of disclosing its own mistakes.

## Candidate-player inventory (sanitized — no raw internal ids published beyond what's already necessary to describe the finding)

| Category | Real candidates found |
|---|---|
| Identity-stable | Star/common NFL players (Ja'Marr Chase, Patrick Mahomes, CeeDee Lamb, Justin Jefferson, Puka Nacua, etc.) |
| Identity-edge — historical/stale | Real players with `last_updated` >30 days stale (e.g. retired/inactive-looking rows) |
| Identity-edge — defensive | Real DL/LB/DB position players |
| Identity-edge — suffix | Real "Jr."/"II" suffix names |
| Identity-edge — duplicate-name | Real players with 2 rows each under the same name (a real, pre-existing duplicate-id-format characteristic of this data source — numeric id + slug id per player) |
| Identity-edge — data quality | One genuinely malformed real row found (`SOCCER:SOCCER:MLB:...` — a mislabeled sport with an MLB team name) — a real, pre-existing test-data quality issue, not touched |
| Direct-ID | Real, DB-verified `sports_players.id` values in both numeric (`NFL:3513`) and slug (`NFL:nick-chubb:HOU`) formats |
| Multi-sport | Real NBA/MLB/NHL/NCAAF/Soccer rows, all genuinely present and priced by the authoritative engine |

## Validation matrix (26 real requests)

Spanned identity-stable (5), identity-edge (8: historical, defensive, suffix, duplicate-name, unresolvable×2, data-quality), direct-ID (4, including one intentionally-invalid id), non-player-asset (4: pick-only, FAAB-only, pick+player, FAAB+player), multi-sport (4: NBA/MLB/NHL/NCAAF), and extra name-input diversity (2). Every request is individually distinct in at least category/sport/strategy — no duplicate-condition padding.

## Results (combined with 2 earlier manual probes, 30 total telemetry events)

| Metric | Value |
|---|---|
| Total telemetry events | 30 |
| `ran: true` | 25 |
| `ran: false` (`no_player_assets`, correctly skipped) | 5 |
| Total real player assets evaluated | 43 |
| `equivalent` | 17 |
| `identity_unresolvable` | 7 (**before the fix below** — see Bug section) |
| `partial_identity_unresolved` | 1 |
| `shadow_execution_failure` / timeout | 0 |
| Shared-service latency p50 / p95 / max | 34ms / 244ms / 372ms |
| Authoritative latency p50 / p95 / max | 2,709ms / 170,395ms / 185,847ms |

## A critical, real, pre-existing finding — NOT a defect in this migration's own code

Two real requests (an intentionally-invalid `playerId`, and one that happened to trigger the same path) caused the **authoritative** `runTradeConsoleAnalysis` pipeline to take **170–189 seconds**. Root-caused directly: `lib/data/players.ts`'s `getPlayer()` synchronously calls `runSportsDataImporter({sports:[sport]})` — a real, expensive external data-refresh job — whenever a `playerId` doesn't resolve on the first lookup. A single unrecognized client-supplied `playerId` can therefore stall the entire request for minutes. **This is squarely a pre-existing characteristic of the authoritative engine's own cache-miss handling, in a file this migration never touches (`lib/data/players.ts`), not a defect in the Phase 18/19 shadow seam.** Per this phase's explicit scope boundary ("do not redesign the Trade engine unless a verified defect requires a narrow fix," and this file is far outside "Trade identity" or anything built this migration), **no fix was attempted** — this is disclosed as a real, significant, out-of-scope finding for whoever owns `lib/data/players.ts` next.

**Critically, this did not compromise the shadow seam's own safety**: across both catastrophically-slow authoritative calls, the shadow seam's own `sharedServiceDurationMs` stayed at 1ms and 1ms respectively (from the raw telemetry) — proving the seam's failure/latency isolation works exactly as designed, completely independent of how badly the authoritative path performs.

## Real bug found and fixed (in this migration's own code)

1. **Proved with evidence:** 5 of the 7 real `identity_unresolvable` events corresponded to the 4 multi-sport requests (NBA/MLB/NHL/NCAAF) plus the malformed-cross-sport case — every genuinely non-NFL real player asset failed identity resolution.
2. **Root-caused:** a direct query confirmed `PlayerIdentityMap` is 100% NFL (0 rows for any other sport) — so `resolvePlayer`'s name-match step (the only step reachable for non-NFL assets, since FantasyCalc — the only cross-provider-id bridge this seam uses — is also NFL-only) can never succeed for a real NBA/MLB/NHL/NCAAF/Soccer player, even though `SportsPlayer` (a separate, real table) has substantial real data for all of them (MLB 7,295 / NBA 1,756 / NCAAB 18,209 / NCAAF 44,897 / NFL 17,257 / NHL 4,115 / Soccer 2,310 rows).
3. **Classified ownership:** the defect is in `lib/shared-services/trade/TradeValueConsoleShadowService.ts` — code built in Phase 18, not the canonical `PlayerIdentityResolver` (whose NFL/Sleeper-focused contract is correct and unchanged) and not the authoritative Trade engine.
4. **Added failing regression tests first:** 2 new tests in `trade-value-console-shadow-service.test.ts` proving the gap (non-NFL name match against `SportsPlayer` was never attempted). Confirmed failing before any fix.
5. **Smallest additive fix:** a new, narrowly-scoped fallback function, `resolveViaSportsPlayerName()`, queries `SportsPlayer` by exact case-insensitive name + sport **only when** the canonical resolver reports `unresolved` **and** the asset's sport is not NFL. A new, honestly-distinct status, `identity_name_match_multisport_fallback`, reports this path separately from the canonical resolver's own `identity_name_match` — never conflated. 0 or >1 matches are reported as `identity_unresolvable`/`identity_ambiguous` respectively, never guessed.
6. **Reran the real case:** all 4 real multi-sport requests, rerun after the fix, now show `resolvedCount: 2/2, unresolvedCount: 0, status: equivalent` — up from `identity_unresolvable` before.
7. **Reran regressions:** the full `trade-value-console-shadow-service.test.ts` suite (13 tests, including the 2 new ones + 3 more covering the ambiguous/no-match/query-failure cases) passes; the seam and route-contract suites (17 tests) pass unchanged; full broad regression confirmed clean (see Verification below).
8. **Documented:** this section, plus updates to the Shadow Compare and Identity Audit docs.

No engine scoring or valuation logic was touched — the fix only changes how a name is *matched* to a canonical identity for non-NFL sports, never how anything is priced.

## Before / after (real data)

| | Before fix | After fix |
|---|---|---|
| Multi-sport requests (NBA/MLB/NHL/NCAAF) | 4/4 `identity_unresolvable` | 4/4 `equivalent`, 8/8 assets resolved |

## Root-cause taxonomy (per the required categories)

- 7 `identity_unresolvable` events → **identity-source gap** (canonical resolver's real, pre-existing NFL-only coverage) — now fixed for the multi-sport subset via the new fallback; the 2 intentionally-fake-name requests remain honestly `identity_unresolvable`/filtered (expected, not a bug).
- 1 `partial_identity_unresolved` → same identity-source gap, mixed with a resolvable asset in the same request.
- 0 unexplained/unknown divergences.
- 1 severe performance finding → **external/internal data-refresh latency**, root-caused to `lib/data/players.ts`, explicitly out of this migration's scope, disclosed not fixed.

## Reproving safety (Task 10)

- Flag disabled → zero shadow execution (unchanged mechanism from Phase 18, not re-tested fresh this phase since no seam-level flag logic changed).
- Playerless requests → correctly skipped (`no_player_assets`), confirmed again in this phase's real run (5/30 events).
- Shadow timeout/exceptions cannot affect the response → proven by the two catastrophic-authoritative-latency real cases above, where the shadow itself completed in ~1ms regardless.
- Telemetry contains no raw asset names — unchanged, already tested.
- No provider writes, no schema changes — confirmed; the only change this phase is the new `resolveViaSportsPlayerName` read-only query and its wiring.
- Rollback remains one flag — unchanged mechanism.

## Distinguishing evidence types

- **Real Phase 18 evidence**: 8 requests, cited, not re-run (no drift found).
- **Real Phase 19 evidence**: 26 new requests + 4 affected-cohort reruns post-fix = 30 new real requests this phase.
- **Direct-ID evidence**: 4 real requests, including one intentionally-invalid id, all real DB-verified where valid.
- **Multi-sport evidence**: real, substantial data confirmed for NFL/MLB/NCAAF/NHL/NBA/Soccer (NCAAB has 0 rows in `sports_players` — the one sport genuinely unavailable in this environment, stated plainly).
- **Inferred conclusion**: the exact single-vs-plural mapping between some telemetry lines and script requests was not perfectly 1:1 reconciled (manual probes interleaved with the scripted run) — the aggregate counts and specific before/after evidence are real and directly verified; the precise positional index-to-request mapping for every one of the 30 events was not individually re-derived.
- **Remaining unknown**: whether the `identity_name_match_multisport_fallback` rate holds at larger real scale; NCAAB support remains entirely unavailable in this environment.
