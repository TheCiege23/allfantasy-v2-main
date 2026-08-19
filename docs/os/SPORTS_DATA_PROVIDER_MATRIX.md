# Sports Data — Provider Certification Matrix (Phase 5G)

Honest certification status per provider. `connected` = a real request has been verified. `certified` = produces certified snapshots or deterministic mappings consumed by runtime.

| Provider | Connected | Certified | Runtime consumer | Deterministic identity | Statistics | Schedules/games | Known limitations |
|---|---|---|---|---|---|---|---|
| **ESPN** | ✅ (public, no key) | ✅ | schedule/games runtime, statistics runtime | provides ESPN athlete id (needs canonical map) | ✅ box scores (`summary?event=`) | ✅ scoreboard | undocumented rate limits; box-score athlete ids need external canonical map; no injuries/availability |
| **Sleeper** | ✅ (public, no key) | ✅ | players/rosters/transactions/draft runtime; **identity crosswalk (espn_id)** | ✅ Tier-1 (espn_id per player, ~55%) | ❌ no player stats | ❌ | espn_id null for many players (incl. some starters like Justin Fields); no defensive/IDP espn ids; coarse injury_status only |
| **FantasyCalc** | ✅ (public) | ✅ (identity only) | **identity crosswalk (sleeperId+espnId)** | ✅ Tier-1 (2,702 espn ids; +924 new) | ❌ | ❌ | skill-position focused; no IDP/defensive; values not certified |
| **Rolling Insights** | ⚠️ `configured_not_verified` | ❌ | none (gateway) | ❌ | declared (unverified) | declared (unverified) | credentials present in non-prod; **no verified request** — not usable for certification |
| **API-Sports** | ❌ `configured_not_verified`/mock | ❌ | none | ❌ | declared | declared | not verified; not used |
| **Yahoo** | import-only | ❌ | league import | ❌ (no espn/canonical crosswalk) | ❌ | ❌ | OAuth import path only; no identity crosswalk |
| **MFL** | import-only | ❌ | league import | mflId column exists (no espn) | ❌ | ❌ | no ESPN cross-reference |
| **Fantrax** | import-only | ❌ | league import | ❌ | ❌ | ❌ | no identity crosswalk |
| **Fleaflicker** | import-only | ❌ | league import | fleaflickerId column exists | ❌ | ❌ | no ESPN cross-reference |

## Certified providers summary
- **Certified & runtime-consumed:** ESPN (schedules/games/statistics), Sleeper (players/rosters/transactions/draft + identity), FantasyCalc (identity enrichment).
- **Verified-but-not-certified:** none pending.
- **Unverified (excluded from certification):** Rolling Insights, API-Sports — credentials may exist but no verified request was performed; **capabilities are not inflated**.
- **Import-only (out of scope for the certified data plane):** Yahoo, MFL, Fantrax, Fleaflicker.

## Phase 5H-d LIVE certification update (2026-07-13, non-prod — supersedes the "unverified" line above for the attempted providers)
Real requests were performed (see `SPORTS_DATA_PROVIDER_CERTIFICATION_5HD.md`; code `providers/certificationStatus.ts`, test-locked):
- **CERTIFIED (re-affirmed):** ESPN, Sleeper, FantasyCalc (value).
- **VERIFIED (real request + canonical route; persistence REQ-MIGRATION):** **TheSportsDB** (headshot→canonical image), **CFBD** (NCAAF roster→canonical position), **API-Sports** (soccer teams — soccer canonical contract REQ-NORMALIZE).
- **BLOCKED:** ClearSports (provider HTTP 500).
- **REQUIRES_WIRING:** Rolling Insights (DB-coupled client; dedicated gateway adapter needed before a live probe).
No provider is presented as connected without real-request evidence; credential presence alone is never sufficient.

## Deterministic identity provenance
ESPN↔canonical mappings are sourced **only** from provider records that carry both ids in one trusted record: Sleeper (`espn_id`) and FantasyCalc (`sleeperId`+`espnId`). No name/fuzzy/LLM matching is used anywhere. The remaining unresolved (IDP/defensive) players have **no** trusted deterministic espn cross-reference in any available provider — a conclusively external gap.
