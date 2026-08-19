# Provider Certification Proving Report (Phase 5H-d)

Date: **2026-07-13** · Environment: **non-production** (keyless public endpoints + configured non-prod credentials; no production DB access, no secret logged). Method: **real requests** through the repo's own provider clients, routed through the governed canonical contracts where one exists. Source of truth in code: `lib/sports-data-gateway/providers/certificationStatus.ts` (evidence-gated; test-locked by `__tests__/fantasy-os/provider-certification.test.ts`).

**Success is not measured by how many API clients exist. It is measured by how many providers were proven through request → validation → normalization → (persistence or documented gap) → retrieval → OS consumption.**

## Verdict summary
| Provider | Credential present | Live request | Canonical route | Persistence | Status |
|---|---|---|---|---|---|
| ESPN | keyless | ✅ 16 canonical games (0 rejected) 2026 w1; box score athletes | CanonicalGameSchedule + CanonicalPlayerGameStat | certified snapshot | **CERTIFIED** (re-affirmed) |
| Sleeper | keyless | ✅ 12,200 players; 6,736 dual-id crosswalk | CanonicalPlayer + identity | certified snapshot | **CERTIFIED** (re-affirmed) |
| FantasyCalc | keyless | ✅ 463 values → distinct valuation+ranking | CanonicalPlayerValue (boundary-separated) | REQ-MIGRATION | **CERTIFIED (value)** (re-affirmed) |
| TheSportsDB | ✅ | ✅ real player headshot URL | CanonicalImageReference (verified_secondary, validated) | REQ-MIGRATION | **VERIFIED** |
| CFBD | ✅ | ✅ 133 NCAAF roster rows, 16 positions | canonicalPosition (NCAAF, detail preserved) | REQ-MIGRATION | **VERIFIED** |
| API-Sports | ✅ | ✅ 20 soccer teams (EPL 2023) | — (soccer, outside NFL/NCAAF canonical scope) | REQ-MIGRATION | **VERIFIED** |
| ClearSports | ✅ | ❌ `api-keys/me` HTTP **500** (provider-side) | — | none | **BLOCKED** |
| Rolling Insights | ✅ (multiple) | ⚠ client DB-coupled — not cleanly probeable | — | none | **REQUIRES_WIRING** |

## Per-provider detail

### ESPN — CERTIFIED (re-affirmed)
Keyless public endpoints. `fetchEspnSchedule()` → 16 canonical games (0 rejected), season 2026 w1, canonical IDs (`espn:nfl:401872656`, team `espn:nfl:team:26`, status mapped). `fetchEspnBoxScore()` → real athlete rows. Feeds `sports_data` certified snapshots via `scheduleRuntime`/`statisticsRuntime`; append-only + idempotent (5F). Statistics remain observational, **not** a scoring input.

### Sleeper — CERTIFIED (re-affirmed)
Keyless. Player directory (12,200) + deterministic sleeper↔espn dual-id crosswalk (6,736 rows). Adapter purity (5H-b): all network access confined to `providers/sleeper.ts`; runtime modules hold zero provider URLs. Feeds certified snapshots (players/rosters/transactions/drafts). Customer-authorized league data kept distinct from general sports data.

### FantasyCalc — CERTIFIED value (re-affirmed)
Keyless. 463 live values → `normalizeFantasyCalcValue` produced DISTINCT `provider_valuation` + `ranking` records (never merged), identity resolved via espnId. FantasyCalc is a **provider valuation** source, NOT observed sports truth. Value network egress still lives in `lib/fantasycalc.ts`/`fantasycalc-db.ts` (outside `providers/` → REQ-WIRING); a certified `PlayerValue` store is REQ-MIGRATION.

### TheSportsDB — VERIFIED
Configured key (public fallback `123`/`3` exists but env key present). Real Mahomes headshot URL → `resolveCanonicalImage` accepted at `verified_secondary` tier, validated (not placeholder). Full image-capability certification needs a `PlayerImage`/`TeamImage` table (REQ-MIGRATION) + consumer adoption. No gateway adapter yet (legacy `lib/workers/providers/thesportsdb.ts`).

### CFBD — VERIFIED
Configured key (Bearer). Alabama 2024 roster: 133 rows, 16 distinct positions → `canonicalPosition` (NCAAF): DL→DL (IDP), OL→OL, LS→LS, QB→QB — **detail preserved, NCAAF sport-isolated**. NCAAF↔NFL identity continuity requires a governed college→pro transition mapping (NOT assumed on name match). Certified-snapshot persistence REQ-MIGRATION; today writes legacy Prisma tables / `SportsDataCache`.

### API-Sports — VERIFIED
Configured key (`x-apisports-key`). 20 EPL 2023 teams via the soccer product (`v3.football.api-sports.io`). **Soccer is outside the NFL/NCAAF canonical position/value scope** — a soccer canonical contract is REQ-NORMALIZE. Each API-Sports product/sport is a separate schema (American-football host `v1.american-football.api-sports.io` is a distinct client); do not build a universal cross-sport schema. Persistence REQ-MIGRATION.

### ClearSports — BLOCKED
Credential structurally present; base `https://api.clearsportsapi.com/api/v1`. Auth probe `api-keys/me` returned **HTTP 500** (provider-side error) on repeated attempts. **Not connected.** Capabilities unproven. Re-attempt when the endpoint responds. (Note: the ClearSports client has the strongest request hygiene — retries, per-minute limit, diagnostics — but the endpoint itself failed.)

### Rolling Insights — REQUIRES_WIRING
Credentials structurally present (multiple `ROLLING_INSIGHTS_*`; OAuth + RSC-token modes; base `https://datafeeds.rolling-insights.com`). The legacy client (`lib/upstream-apis.ts` `fetchRollingInsights`, plus `lib/rolling-insights.ts`, `lib/players/ri-players-server.ts`, `lib/workers/providers/rolling-insights.ts`) is **DB-coupled** (requires a real prisma deps object; a stub crashed reading `sportsTeam`). It cannot be cleanly probed without a dedicated `providers/rolling-insights.ts` gateway adapter. **Live verification deferred** to that adapter increment — NOT connected until then.

## Data-plane classification (Stop-Gate 3)
- **Certified gateway plane (`sports_data` snapshots):** ESPN, Sleeper only (BaseProviderAdapter + runtime sync).
- **Legacy Prisma tables only** (`SportsPlayer`/`SportsTeam`/`SportsGame`/`SportsInjury`/`PlayerSeasonStats`/`DepthChart`/`SportsDataCache`, `source='<provider>'`): Rolling Insights, API-Sports, API-Football, ClearSports, CFBD, TheSportsDB.
- **In-memory + identity crosswalk:** FantasyCalc (values cached in-memory; `providers/fantasycalc.ts` is identity-only).
- **No provider client is imported by `lib/decision-os/*`** (verified) — Decision OS consumes canonical/runtime layers only.

## Remaining (documented, not run)
- **Rolling Insights:** build `providers/rolling-insights.ts` gateway adapter (decouple from prisma deps) → then real request → canonical normalization.
- **ClearSports:** re-attempt when provider endpoint recovers.
- **TheSportsDB / CFBD / API-Sports:** wire verified data to certified persistence (`PlayerImage`/`TeamImage`, NCAAF certified snapshot, soccer canonical contract) — all REQ-MIGRATION / REQ-NORMALIZE.
- **FantasyCalc:** move value egress into a `providers/` value adapter; certified `PlayerValue` table (REQ-MIGRATION).
- **Gateway adapters** for RI/ClearSports/TheSportsDB/CFBD/API-Sports do not exist yet (only ESPN/Sleeper/FantasyCalc-identity) — REQUIRES_WIRING per provider.
