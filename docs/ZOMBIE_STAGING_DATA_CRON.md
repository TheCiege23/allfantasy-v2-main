# Zombie staging sports-data imports

The isolated Railway project `allfantasy-zombie-rehearsal` has a separate `zombie-data-cron` service. It builds only the Node runner and its tests, calls the web app's existing authenticated import route every six hours, then exits. The four TheSportsDB jobs each name exactly one of NFL/NBA/NHL/MLB; one API-Sports NFL job supplements the football schedule and week numbers.

## Configuration

- Source: the reviewed Zombie PR commit, pinned alongside `zombie-web`.
- Settings reference: `railway.zombie-staging-cron.json`. The connector rejected the custom config-file path, so its Dockerfile, start command, restart policy, and cron fields were applied directly to this service.
- `ZOMBIE_STAGING_BASE_URL=https://zombie-web-staging.up.railway.app`.
- `ZOMBIE_STAGING_SEASON=2026`.
- `ZOMBIE_CRON_SECRET=${{zombie-web.CRON_SECRET}}` uses a reference inside this isolated project.
- `ZOMBIE_STAGING_CRON_ENABLED=1` only after the web deployment includes the scoped import route.
- The runner refuses any project other than `2fa5548e-62f6-467d-9a63-6e6773c62f8a`, any environment other than `staging`, and any other destination origin.

Generate a distinct cron secret for this staging service in Railway. Do not copy production variables. The cron service needs only that reference and its non-secret settings; provider and database credentials stay on the web service.

## Verification

The small Docker build executes `node --test zombie-staging-cron.test.mjs` in its copied working directory. Tests cover isolation guards, the four sport scopes, partial/empty provider responses, continuing after a failed sport, redirect refusal, and credential-safe logging. `__tests__/cron/tsdb-schedule-sports.test.ts` covers the optional scope allow-list; omitted scope preserves existing production behavior.

The runner logs job name, HTTP status where relevant, row counts, partial/failure state, and elapsed time. It does not log headers, provider response bodies, URLs containing credentials, or raw exception messages. HTTP 200 with a provider error, no games, or deferred work is not reported as a successful import. Requests are sequential, bounded, and not retried automatically. The next six-hour run can continue a partial schedule sweep.

On October 28 all four Node tests passed in the Railway Docker build. The `ed53a33` web deployment then became healthy after Railway's [US East / EU West build incident](https://status.railway.com/incident/TX3M5SWF) delayed rollout. The first enabled bootstrap completed all five jobs successfully. Neon confirmed TheSportsDB season-2026 game rows: NFL 321, NBA 1,266, NHL 1,409, and MLB 2,470; API-Sports stored a separate 321 NFL rows. All have game dates. The four `cron-import-schedules-tsdb` runs each recorded the expected single-sport scope, a success status, and matching write counts.

The six-hour schedule is restored and `ZOMBIE_STAGING_CRON_ENABLED=1`. To bootstrap another run through this connector, temporarily clear the cron schedule and deploy the pinned source with the current settings. A replay of an older cron deployment did not start a task with the new run settings, so inspect runtime logs and stored rows rather than assuming a successful deployment executed an import. Restore the six-hour schedule and deploy the current settings after the task completes. Runtime JSON logs expose their safe job/status/count fields as structured Railway attributes; the runner also supplies a readable message.

Player tables remain empty; this service imports game calendars and teams. Draft-pool/player ingestion and provider fantasy scoring still need a separate acceptance pass.

Verify `SportsGame` row counts by sport, source, and season and check `sync_job_runs` for `cron-import-schedules-tsdb` with a single-sport scope. Stored game coverage establishes calendar/lock readiness. Provider player scores, a completed fantasy draft, weekly settlement, and corrections still need their own acceptance run.

## Fresh staging schema prerequisites

Normal `prisma migrate deploy` does not install every object declared by the Prisma schema: some existing migrations are deliberately parked outside the deploy path. On October 28 the owner approved repairing the isolated staging schema. The repair installed the T-101 tenancy tables and League tenant column (the role ordering guard was explicitly omitted for this isolated single-tenant rehearsal), `leagues.lastViewedAt` and its partial index, and `rosters.redraftRosterId` with its unique index and foreign key. These repairs did not install Commissioner OS role isolation or mark its guarded migration as replayable.

All four staging Zombie leagues were then created successfully. Do not move the guarded Commissioner OS migration into the common deploy directory to recreate this fixture. Provision a fresh environment explicitly, and compare its required models with the database before asking testers to create leagues.
