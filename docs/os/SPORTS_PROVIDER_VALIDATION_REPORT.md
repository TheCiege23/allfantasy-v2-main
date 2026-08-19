# Sports Provider Validation Report (Fantasy OS Phase 5)

Status vocabulary: a provider is only `*_connected` when a **real request verified it**. Credentials present
without a verified request are **`configured_not_verified`** (Phase 5 stop-gate).

## Gate 2 — credential presence (non-prod env; names only, never values)
All PRESENT in `.env.local`: `API_SPORTS_KEY`, `CFBD_API_KEY`/`CFBD_KEY`, `CLEARSPORTS_API_KEY`,
`ROLLING_INSIGHTS_CLIENT_ID`/`_SECRET`(+`2`)/`_API_KEY`, `THESPORTSDB_API_KEY`/`THE_SPORTS_DB_API_KEY`,
`OPENWEATHERMAP_API_KEY`, `NEWSAPI_KEY`/`NEWS_API_KEY`, `YAHOO_CLIENT_ID`/`_SECRET`. Sleeper needs no key.
**No credential value was ever read, logged, or committed.**

## Real validation runs
| Provider | Verified? | Evidence |
|---|---|---|
| **sleeper** | ✅ **verified** | `healthCheck` state=healthy (205ms); `fetchPlayers(NFL, limit 8)` → 8 canonical players (partial=false); normalization + provenance confirmed; **Draft port** returned 8 contexts → 1 resolved (certified id → `canon-verified-1`), 7 honestly quarantined (no fabricated canonical ids); freshness `current`, source `sleeper`, snapshot `sleeper-players-nfl:2026-07-11`. **Full pipeline proven end-to-end.** |
| rolling_insights | ⛔ configured_not_verified | creds present (OAuth); no verified request this phase |
| cfbd | ⛔ configured_not_verified | `CFBD_API_KEY` present |
| thesportsdb | ⛔ configured_not_verified | key present |
| api_sports | ⛔ configured_not_verified | `API_SPORTS_KEY` present |
| espn | ⚠ partial | public endpoints used for bracket/playoff; not a formal keyed integration |
| yahoo | ⛔ configured_not_verified | OAuth creds present |
| openweathermap | ⛔ configured_not_verified | key present |
| newsapi | ⛔ configured_not_verified | key present |
| clearsports | ⛔ configured_not_verified | key present; no active consumer found |

## Safe validation procedure (for the remaining providers)
Use the smallest safe request set: `healthCheck` → one sport → one capability → schema validate → normalize →
resolve identity → persist a small snapshot → retrieve through one subsystem port. Never run broad historical
ingestion merely to prove connectivity. Never reuse production-only credentials for unrestricted testing.
