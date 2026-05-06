# Unified import flow

## Routes

| Route | Behavior |
|-------|----------|
| `/import` | Primary entry. Uses `LeagueImportFlow`: legacy-style platform tabs, Sleeper career import (`POST /api/legacy/import` + job polling), or league preview/commit for ESPN/Yahoo/MFL/Fantrax via `/api/leagues/import/preview`. |
| `/legacy-import` | Same shared `LeagueImportFlow` with `returnTo=/af-legacy`. Advanced multi-season tool (`LegacyImportForm`) remains available under **Advanced** disclosure. |
| `/af-legacy` | Full AF Legacy product surface (unchanged); shared APIs with `/import` for Sleeper. |

## Query params (`/import`)

- `returnTo` — safe path for “Back” / redirect context (default sanitized server-side).
- `provider` — one of `sleeper`, `yahoo`, `mfl`, `fantrax`, `espn` (initial tab).
- `username` — prefill Sleeper username.
- `leagueId` or `sourceId` — prefill league/source input for non-Sleeper tabs.

Login callback preserves these params.

## Loading & status

- Sleeper import uses `LegacyImportJob` rows; client polls `GET /api/legacy/import/status?sleeper_username=…` about every 2.5s while the job is `queued` / `running`.
- Progress bar reflects server `progress` (no minimum-duration spinner).
- Full-screen loading UI: `components/unified-import-ui/LegacyImportLoadingScreen.tsx`.

## Results

- Sleeper: full-screen `LegacyImportResults` loads `GET /api/legacy/profile?sleeper_username=…` for Legacy Score / tier / win rate / AI sync messaging.
- League commit: success shows league summary + **Open league**, same component shell.

## Dashboard rankings refresh

- “Go to dashboard” sets `sessionStorage` (`af_rank_refresh_pending`) and navigates with `?rankSync=1`.
- Dashboard client increments `rankRefreshKey` (see `DashboardOverview`) so `RankingsCard` refetches `/api/user/rank`, and calls `router.refresh()` for server-backed widgets.

## Troubleshooting

- **Stuck loading**: Check job status in DB/admin; worker `/api/legacy/worker/run` is pinged during queued/running states.
- **Rankings empty after import**: Wait for job `completed`, then open dashboard with `rankSync` or use **Go to dashboard** from results.
