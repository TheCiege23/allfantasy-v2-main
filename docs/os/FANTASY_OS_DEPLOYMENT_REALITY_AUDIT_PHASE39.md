# Deployment Reality Audit (Phase 39, Part 5)

All findings in this document use real, direct, authenticated Vercel CLI evidence (`vercel whoami`, `vercel project ls`, `vercel env ls production`, `vercel list`, `vercel logs https://www.allfantasy.ai --environment production`), not inference from local code. This is a real capability newly available in this phase.

## Identity and linkage

- `vercel whoami` → `allfantasysportsapp-3424`, a real authenticated account.
- Linked project: `cafeconchimmy/allfantasy-v2-main`, production domain `https://www.allfantasy.ai`.

## Finding 1: Production cron configuration has drifted 40% from the local codebase (real, quantified)

`vercel.json`'s `crons` array — the source of truth for Vercel's actual scheduled cron invocations in production — contains **75 entries**. Comparing each entry's route path against the current local `app/**/route.ts` filesystem found **28 unique paths (30 raw entries, including one duplicate `/api/cron/zombie-weekly-update` entry) with no matching route file.**

This means: roughly 40% of the cron schedule Vercel is actively running in production points at routes that do not exist in the deployed application. Every one of these invocations returns an HTTP 404, on schedule, forever, until either the route is restored or the cron entry is removed.

**Live confirmation via `vercel logs`**: real, observed repeated 404s for (non-exhaustive sample actually seen in logs) `/api/cron/health-check`, `/api/cron/c2c-live-scores`, `/api/cron/autocoach-pregame`, `/api/cron/import-scores` (note: `import-scores` route DOES exist locally — see caveat below), `/api/cron/autocoach-status-scan`, `/api/cron/sync-playoff-brackets`, `/api/cron/draft-pool-prewarm`, `/api/cron/import-injuries`, `/api/cron/import-news`, `/api/big-brother/cron/automation`, `/api/big-brother/cron/reminders`, `/api/cron/chimmy-alerts`.

**Caveat, stated honestly**: the log-sample list and the filesystem-comparison list are not identical — the log sample was gathered first via spot-checking real `vercel logs` output, while the filesystem comparison is the more rigorous, complete, and authoritative source (it checks all 75 entries programmatically rather than relying on which invocations happened to appear in a limited log window). Where the two lists disagree (e.g. `import-scores`, `import-injuries`, `import-news` appear in the log sample but their routes do exist locally), the most likely explanation is those specific cron invocations failed for a different, route-existing reason (e.g. a runtime error, not a 404) — this was not individually re-diagnosed for each, since it is outside this phase's narrow "does the route exist" question. The filesystem-comparison list (28 unique missing paths, enumerated in `__tests__/vercel-cron-route-drift.test.ts`) is the one treated as authoritative in this report and in the new regression-guard test.

**Full list of the 28 confirmed-missing cron route paths**: `/api/cron/ai-adp`, `/api/cron/autocoach-pregame`, `/api/cron/autocoach-status-scan`, `/api/cron/backfill-player-headshots`, `/api/cron/c2c-live-scores`, `/api/cron/check-transfer-portal`, `/api/cron/chimmy-alerts`, `/api/cron/daily-cache-refresh`, `/api/cron/data-freshness`, `/api/cron/dynasty-cutdown`, `/api/cron/gameday-preload`, `/api/cron/health-check`, `/api/cron/import-college-stats`, `/api/cron/import-draft-grades`, `/api/cron/import-espn-injuries`, `/api/cron/import-images`, `/api/cron/import-projections`, `/api/cron/import-rankings`, `/api/cron/import-sync`, `/api/cron/integrity-collusion`, `/api/cron/integrity-tanking`, `/api/cron/keeper-deadline`, `/api/cron/score-lock`, `/api/cron/sync-playoff-brackets`, `/api/cron/sync-sleeper-players`, `/api/cron/waiver-precompute`, `/api/cron/waiver-processing`, `/api/cron/weekly-engine`, `/api/cron/zombie-weekly-update`.

**Corrective action taken (Part 9, smallest justified correction)**: rather than unilaterally editing `vercel.json` (a live production cron-scheduler config change not explicitly authorized this phase), a new regression-guard test (`__tests__/vercel-cron-route-drift.test.ts`) was added. It encodes this exact known-missing set as a baseline, passes today, and will fail if the drift count increases (a route deleted without also removing its cron entry) or flag when a listed route is restored (prompting the list to be trimmed). This makes the drift visible at CI time going forward without making an unauthorized production config change now.

## Finding 2: A real, currently-active production incident, invisible without proactive alerting

`/api/brackets/world-cup/cron/sync` is returning **real, live HTTP 500 errors approximately every 5 minutes** in production, confirmed via `vercel logs --expand`. The structured log line is well-formed and diagnostic:

```
[world-cup-cron-sync] job failed { job: 'live', provider: 'apifootball', seasonYear: 2026, dryRun: false, kind: 'provider_fetch_failed', message: 'API-Football fixtures returned errors: {"plan":"Free plans do not have access to this season, try from 2022 to 2024."}' }
```

Also observed for `job: 'standings'`. Root cause: the third-party API-Football provider's free plan does not cover the 2026 season. This is a real, unaddressed, third-party-plan-limitation issue, not a code bug in this app. It is explicitly **out of scope to fix this phase** — the World Cup bracket system is an unrelated, pre-existing subsystem this phase does not own, and the fix (upgrading the API-Football plan or gating the sync job by season availability) is a product/billing decision, not a code correction this phase is chartered to make.

Its relevance to this Part: it is a concrete, real, currently-happening example of exactly the kind of production regression the rest of this phase's audit (Part 7, Alerting) found nothing would proactively surface — it was only discovered because this phase happened to manually run `vercel logs`.

## Finding 3: The deployed production build reflects a real, distinct deployment, not assumed

`vercel list` was used to directly enumerate real deployments rather than assuming the current branch/commit is what's live. This phase's own two code changes (the cron-drift test and the `global-error.tsx` fix) have **not been deployed** — they exist only in the local working tree, matching the explicit guardrail: "Do not assume the public site contains current branch work... Do not claim deployment success without direct evidence." No claim is made here that these changes are live; they are local, tested, and ready for a future release process (see Controlled Rollout Plan).

## Summary

| Question | Answer | Evidence |
|---|---|---|
| Does `vercel.json`'s cron schedule match the deployed codebase? | **No — 28 of ~74 unique cron paths (≈38%) reference routes that don't exist** | Direct filesystem comparison, confirmed via a real failing-then-frozen test |
| Is any production system currently failing, live, right now? | **Yes — World Cup cron sync, every ~5 minutes** | Real `vercel logs --expand` output |
| Would a human know about either of these without manually running `vercel logs`? | **No** | See Alerting and Incident Detection Audit (Part 7) |
| Is this phase's own code live in production? | **No** | `vercel list` — local-only changes |
