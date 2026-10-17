# DB-First API Migration Checklist

Last updated: 2026-04-08
Baseline: 63 violations (`npm run guard:db-first-api`)

## Usage
- Owner: assign a person accountable for migration.
- ETA: target completion date.
- Exception tag: add `db-first-exception: reason` only while actively migrating.
- Done criteria: route/library reads from DB-backed models only, no direct monitored data API calls.

| Priority | File | Owner | ETA | Exception Tag Needed | Status | Notes |
|---|---|---|---|---|---|---|
| P0 | app/api/trade-finder/matchmaking/route.ts | Unassigned | 2026-04-12 | No | Done | Direct route-level Sleeper fetches replaced with internal service calls. |
| P0 | app/api/season-strategy/route.ts | Unassigned | 2026-04-12 | No | Done | Route-level external player fetch removed; non-NFL player map now DB-backed. |
| P0 | app/api/sleeper/players/route.ts | Unassigned | 2026-04-12 | No | Done | Route migrated to DB-backed slim player map from sports player records. |
| P0 | app/api/mock-draft/league-import/route.ts | Unassigned | 2026-04-14 | Yes | Done | Route-level direct Sleeper URL fetches removed; now uses shared service accessors. |
| P0 | app/api/legacy/transfer/route.ts | Unassigned | 2026-04-14 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/trade/analyze/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/trade/league-managers/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/rankings/analyze/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/rankings/historical-ratings/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/trade-ideas/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/trade/league-analyze/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. *(The route itself was removed on 2026-09-30 — commit `1b2e29ca4`.)* |
| P1 | app/api/legacy/rankings/league-format/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/rankings/playoff-forecast/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/league/refresh/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/trade/roster/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/admin/api-status/route.ts | Unassigned | 2026-04-18 | No | Done | Monitored API URL literals removed from route; Sleeper health uses shared accessor and monitored external providers are ingestion-managed. |
| P1 | app/api/legacy/player-finder/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors with per-league roster/user caching. |
| P1 | app/api/legacy/backfill/playoffs/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/rankings/adaptive/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/rankings/enhanced/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/import-sleeper/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/leagues/import/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/leagues/import/batch/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/mock-draft/manager-dna/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/smart-recommendations/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/legacy/ai-gm-analyze/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/league/sleeper-user-leagues/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/league/sleeper-discover/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P1 | app/api/league/discover/route.ts | Unassigned | 2026-04-18 | No | Done | Route-level direct Sleeper URL fetches removed; now uses shared Sleeper client accessors. |
| P2 | lib/trade-engine/league-context-assembler.ts | Unassigned | 2026-04-24 | Yes | Not Started | Replace direct Sleeper endpoints with DB-backed context assembler inputs. |
| P2 | lib/trade-pre-analysis.ts | Unassigned | 2026-04-24 | Yes | Not Started | Move external lookups behind ingestion pipeline and persisted snapshots. |
| P2 | lib/upstream-apis.ts | Unassigned | 2026-04-24 | Yes | Not Started | Keep direct calls only in ingestion context; route-facing reads from DB. |
| P2 | lib/sports-router.ts | Unassigned | 2026-04-24 | Yes | Not Started | Default all route consumers to DB branch first; external fetch only ingestion-safe paths. |

## Tracking Commands
- Changed-files gate: `npm run guard:db-first-api -- --changed --base <sha> --head <sha>`
- Full baseline scan: `npm run guard:db-first-api`
