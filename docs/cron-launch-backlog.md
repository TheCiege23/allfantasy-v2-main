# Cron launch backlog (Phase 6 cleanup)

As of 2026-06-26, `vercel.json` declares **only crons backed by a real route** (43 entries,
0 missing references). This document records the **28 cron entries removed** during the Phase 6
launch-cleanup audit, why each was removed, and what (if anything) to restore later.

The production health dashboard (`/admin/production-health`) reads `vercel.json` live, so removing
these stopped them from showing as 🔴 *missing route* noise. Nothing here is silently lost — restore
from this list when the corresponding feature/phase is built.

## Removed — replaced by an existing service (will NOT be restored)

| Cron | Replaced by |
|---|---|
| `health-check` | `ProductionHealthService` → `/api/admin/production-health` (Phase 4–5) |
| `data-freshness` | `getSportHealth` / `computeFreshness` (Phase 4) |
| `sync-playoff-brackets` | `/api/brackets/playoffs/cron/refresh-schedule` + `playoffSeriesSyncService` |
| `import-projections` | `runSportsDataImporter` (`/api/cron/import-players`) already imports projections |
| `import-rankings` | `runSportsDataImporter` already imports rankings |
| `ai-adp` | `/api/cron/recompute-allfantasy-adp` + `/api/cron/adp-refresh` |
| `waiver-processing` | `/api/redraft/waiver-process` + `/api/cron/waivers` |
| `import-sync` | granular `/api/cron/import-*` jobs |
| `weekly-engine` | `/api/redraft/score-sync` → `recalculateMatchupsForSeasonWeek` + `updateStandings` (continuous) |
| `score-lock` | redraft scoring is continuous; lineups carry `isLocked` (`lib/redraft/lineupValidation`) |

## Removed — dead / never implemented (will NOT be restored)

| Cron | Why |
|---|---|
| `import-espn-injuries` | No `syncEspnInjuries` was ever built; `/api/cron/import-injuries` (API-Sports) is the real injury path |

## Removed — future features (restore behind a feature flag when the format launches)

Backing engines exist for several of these; the cron route is the only missing piece.

| Cron | Format / purpose | Backing |
|---|---|---|
| `keeper-deadline` | Keeper | `lib/keeper/selectionEngine` |
| `dynasty-cutdown` | Dynasty | `lib/workers/scoring-worker` |
| `c2c-live-scores` | C2C | — |
| `import-draft-grades` | Devy/dynasty | `lib/devy-classification` |
| `integrity-collusion` | Fair-play monitoring | `lib/ai-commissioner/AICommissionerService` |
| `integrity-tanking` | Fair-play monitoring | `lib/ai-commissioner/CommissionerAlertGenerator` |
| `autocoach-pregame` | Premium lineup AI | `lib/autocoach/AutoCoachEngine` |
| `autocoach-status-scan` | Premium lineup AI | `lib/autocoach/AutoCoachEngine` |
| `chimmy-alerts` | Proactive engagement | `lib/chimmy-alerts/*` |
| `waiver-precompute` | AI waiver optimization | — |
| `gameday-preload` | Cache warming | — |
| `daily-cache-refresh` | Cache warming | — |
| `sync-sleeper-players` | Sleeper ID-map refresh | Sleeper in import chain |
| `import-images` | Team logos | fallback resolvers exist |
| `backfill-player-headshots` | Headshot polish | Phase 2 normalization provides headshots |

## Removed — NCAAF, restore in Phase 7 (with implementations)

| Cron | For | Notes |
|---|---|---|
| `import-college-stats` | NCAAF | Player/season stats — High priority, build in Phase 7 |
| `check-transfer-portal` | NCAAF | Roster accuracy — partial backing in `lib/cfb-player-data` |

## Restoring an entry

Add it back to `vercel.json` `crons` **only after** its `app/api/.../route.ts` exists, and (for
data jobs) wrap the work in `withSyncJobRun` so it reports runtime telemetry. Add a metadata entry
to `CRON_METADATA` in `lib/production-health/cronRegistry.ts` for sport/provider/staleness.
