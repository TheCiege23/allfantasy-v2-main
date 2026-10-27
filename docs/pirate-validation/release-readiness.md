# Pirate League release readiness — 2026-10-27

## Completed checks

- The four Pirate migrations are applied to the separate staging Neon database. The staging lifecycle exercise passed NFL, NBA, MLB, and NHL, including protection locks, regular-season and playoff claims, automatic transfers, overflow, counteroffers, and score-correction reversals. See `staging-lifecycle.json`.
- The Pirate Deck component passed Pixel 7 and iPhone 13 Chromium viewport checks. It also passed an iPhone 13 WebKit viewport check at 390 px with no horizontal overflow and working touch controls. See `mobile-results.json`, `mobile-results-webkit.json`, and screenshots in this directory.
- Pirate reminders now carry a `league_announcements` notification category. The relay checks push and in-app preferences for categorized messages. Focused Pirate and outbox regression tests passed (28 tests).
- The commissioner confirmed 24 hours for winner selection and 24 hours of roster-drop grace. The existing claim response default is also 24 hours. These match `lib/pirate/rules.ts`.
- Four staged fixture leagues have queued Pirate push and in-app events. Their QA accounts have no push subscriptions, so delivery to a physical phone remains unverified.
- A local staging-backed full-page browser attempt signed in successfully, but the cold Next.js `/league/[leagueId]` route did not finish rendering before Playwright's five-minute navigation timeout. The full app UI remains unverified; the component viewport checks above do not replace it.
- Draft PR #2852 is open. The branch was updated with the latest `main`, and 82 focused Pirate and trade tests passed on that merged branch. GitHub Actions remains the release gate.

## Hosting and staging

- Production runs on Railway in the `AllFantasy` project, `production` environment, `allfantasy-v2-main` service. It tracks `main`; `.github/workflows/railway-deploy.yml` batches production deployments. The Vercel PR check reports `Account is blocked`, and no Vercel Preview is available. Vercel is not the current production deployment path.
- The existing Railway `highlights-preview` environment hosts only its highlights service. The separate `Guilly Staging Web` project uses a different repository. Neither is a full-app Preview for Pirate League.
- Full-page QA needs an isolated Railway staging app deployed from the exact PR commit, with its database URLs pointed only at the verified separate staging Neon database. Set staging-specific app URLs, auth, and notification settings before connecting the source; verify the target host before any migration or traffic. Keep production variables and services unchanged.

## Production preflight

- The verified production Neon host is `ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech`. An earlier read-only migration audit found five local migrations pending there: `20261020010000_guilly_lifecycle_invariants` and the four Pirate migrations. Recheck migration state immediately before production work. A broad `prisma migrate deploy` would include the Guillotine migration unless it is applied or explicitly excluded by a reviewed plan.
- The read-only schema check found the required `leagues` and `redraft_matchups` tables, with no existing Pirate tables to collide with the new migrations.
- The repository production checklist requires a reviewed PR merged into `main` with green CI before deployment. No production migration or deployment has been performed for Pirate League.

## Release sequence

1. Finish the PR's required GitHub Actions checks and review. Decide whether the pending Guillotine migration belongs in the same release; otherwise review a Pirate-only migration procedure instead of using the broad deploy command.
2. Deploy the exact PR commit to an isolated full-app Railway staging service connected to the separate staging database. Sign in on physical Android and iPhone devices; verify protections, claim selection, counteroffers, roster transfer, and the five-second celebration. Subscribe both phones to push and verify an actual claim notification and a muted-preference case.
3. After PR merge and staging sign-off, apply only the reviewed production migrations, let the batched Railway `main` workflow deploy the matching build, and check `/api/health`, Pirate creation, a non-destructive protection edit, the outbox relay, and error logs. Watch the first live scoring period for final-matchup claim creation, 24-hour settlement, and roster consistency.

If a production issue occurs, inspect Railway's last successful deployment and schema compatibility before redeploying that build. Pirate migrations add tables and columns; dropping them would destroy live claim data.
