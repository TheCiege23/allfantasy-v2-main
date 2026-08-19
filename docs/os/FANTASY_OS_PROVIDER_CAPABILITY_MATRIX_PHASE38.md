# Provider Capability Matrix (Phase 38, Part 1)

Fresh audit — nothing from prior phases or product docs was trusted; every row below is derived from direct code reading.

| Provider | Auth method | Import: real or stub | Multi-sport | Sync mechanism | History | Real production caller | Feature flag |
|---|---|---|---|---|---|---|---|
| **Sleeper** | Public read-only API | Real, complete (extensively validated across Phases 13-37) | Yes | Full re-fetch via generic resync route | Yes | Yes | None |
| **ESPN** | Cookie (`SWID`+`espn_s2`), decrypted per-user, with anonymous fallback | Real, complete — real HTTP to ESPN's fantasy API, full mapper (roster/scoring/schedule/draft/transactions/standings) | **No — NFL only** (hardcoded) | Two real mechanisms: generic resync + legacy `/api/league/sync` | Yes — season discovery + post-commit backfill service | Yes | None found |
| **Yahoo** | OAuth2, real token-refresh flow (`YAHOO_CLIENT_ID`/`SECRET`) | Real, complete — dedicated Yahoo-JSON-envelope parsing, full mapper | **Yes — NFL/NBA/MLB/NHL** | Same two-tier pattern, both real | Yes — same discovery+backfill pattern as ESPN | Yes | Requires env vars present (no explicit on/off flag) |
| **Fantrax** | None live — reads from a local `FantraxLeague` DB table | **Partial/stub in practice** — real code exists but no confirmed ingestion path populates the underlying table; the separate legacy sync route is an **explicit stub** (`throw new Error('Fantrax sync is under development...')`) | Code supports it; moot without real data source | Resync re-reads the same possibly-stale row; legacy sync hard-stubbed | Dependent on the same unresolved ingestion gap | Routes are real but return "not found" without a pre-seeded row | None found |
| **MFL** | API key, decrypted per-user | Real, complete — real HTTP (JSON/XML), full mapper; scoring-rule detail weaker (string-matching, not real per-stat rules) | **No — NFL only** (real provider constraint, MFL's API is football-only) | Two real mechanisms, both real HTTP | Yes — discovery + backfill | Yes | None found |
| **Fleaflicker** | None — public, unauthenticated API | **Real but thin** — only current-season rosters+standings; schedule/draft/transactions/scoring/history all explicitly `'missing'` in its own coverage self-report | Yes — NFL/MLB/NBA/NHL | Resync only (re-fetches the same thin payload); **not in the legacy sync route's provider switch at all** | **No** — no discovery, no backfill service file exists | Yes (generic routes only) | None found |

## Real data availability in `.env.test` (measured, not assumed)

| Provider | Real imported leagues |
|---|---|
| Sleeper | **3** |
| ESPN | **0** |
| Yahoo | **0** |
| Fantrax | **0** |
| MFL | **0** |
| Fleaflicker | **0** |

Confirmed via direct query against the exact `ImportProvider` enum values (`lib/league-import/types.ts`). Only Sleeper has any real data to validate intelligence execution against in this environment.
