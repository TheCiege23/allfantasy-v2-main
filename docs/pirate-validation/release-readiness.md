# Pirate League release readiness — 2026-10-27

## Single-drop proof and live-data preparation — 2026-10-28

- A single immediate acquisition may now include one specified unlocked bench drop. The exact transaction must pass canonical eligibility, undroppable and weekly drop limits; the dropped player is removed before full-lineup matching. Separate transaction plans are never combined. The Deck names the option and states that evidence collection makes no roster move.
- Live staging ingestion initially found 25 unparsed NFL statuses. Version 2 separates complete provider coverage from each player's certainty. Every matching report for a needed player must be known, current, and agree on activity. Unrelated unknown reports no longer disable all rosters; unknown or conflicting relevant reports retain protections. Version 1 snapshots remain review-only. Expected return weeks do not remove current injury reports from consideration.
- With explicit user authorization, Rolling Insights credentials were copied directly from the local main configuration into the isolated staging service, with values kept out of output. The first output-based transfer was rejected by automatic approval review; the successful direct transfer used the refreshed Railway CLI session and official API. Production configuration was not edited.
- Notification-free live ingestion refreshed all four sports. See `live-rehearsal-readiness.json` for actual counts and timestamps. These are one-time checks; the isolated project currently has only its web service, so unattended live rehearsal still needs scheduled data refresh and score/capture jobs.
- `test-pirate-capture-staging.ts` exercises the actual database capture and automatic claim pipeline across a real clock boundary with synthetic NFL games and rosters and a real provider coverage marker. It checks exact starter slots, immutable deduplicated snapshots, automatic forfeiture, retained original locks, and an unknown expected-return report preserving protections. This is distinct from a live NFL scoring period; fixture cleanup is recorded in `capture-rehearsal-staging.json`.
- The expanded four-sport synthetic lifecycle checks single-drop forfeitures, linked audits, and that the proposed drop makes no actual roster move. The focused suite passed 102 tests, including versioned feed, per-player uncertainty, and mobile commissioner controls. Chromium Pixel 7/iPhone 13 and WebKit iPhone 13 emulations passed. Scoped type checking found no changed-source diagnostics; ESLint had no errors (two existing apostrophe warnings).
- Full CI caught the new capture harness's direct league insert through the tenant-isolation ratchet. The harness now provisions its own explicit tenant atomically through `lib/domain/stagingLeagueFixture.ts` with a validated actor, staging/test guards, and cleanup. All six targeted tenant-safety and ratchet checks passed, in addition to the 102 focused feature tests.
- Remaining legal-lineup automation: opt-in daily lineups, reserve/taxi activations, and several combined acquisitions. Remaining release checks: unattended live scoring-period rehearsal, physical Android QA, human PR review, and guarded production release after sign-off.

## Legal-lineup evidence update — 2026-10-28

- Immutable lock snapshots and evidence-linked automatic rulings are implemented without a schema migration. The pass runs before slower score-sync bridges and outside the scoring batch rotation. Captured evidence and automatic/commissioner ruling labels are visible on the Pirate Deck.
- Automatic cases require exact saved starter slots, a complete recent injury-ingestion attestation, known identities and game times, a full distinct-player legal replacement lineup, and confirmation from the final saved week lineup. Future participants require activity evidence at their own game starts. Roster locks, emergency overrides, missing data, daily lineups, reserve/taxi activations, and acquisitions requiring drops remain commissioner reviews with protections intact.
- A single immediate pickup requiring no drop can serve as waiver evidence only after the actual lifecycle, roster, waiver-window, hold, pending-claim, and transaction gates accept it. Bounded witness search does not certify an entire empty waiver pool or several combined transactions.
- Focused evidence, injury, commissioner, Pirate Deck, and score-sync regressions passed. The synthetic staging lifecycle passed NFL, NBA, MLB, and NHL: automatic forfeiture, retained original lock IDs, missing-evidence protection retention, linked audits, commissioner restoration, reopened winner selection, and repeated-tick override precedence. See `lineup-evidence-staging.json`; the runner removed its fixture leagues, users, and schedule rows.
- The commissioner previously confirmed iPhone Home Screen push delivery, Pirate league creation, and saved rule defaults. Physical Android verification and a real scoring-period rehearsal remain release checks. Production has not been deployed from this update.

## Completed checks

- The four Pirate migrations are applied to the separate staging Neon database. The staging lifecycle exercise passed NFL, NBA, MLB, and NHL, including protection locks, regular-season and playoff claims, automatic transfers, overflow, counteroffers, and score-correction reversals. See `staging-lifecycle.json`.
- The Pirate Deck component passed Pixel 7 and iPhone 13 Chromium viewport checks. It also passed an iPhone 13 WebKit viewport check at 390 px with no horizontal overflow and working touch controls. See `mobile-results.json`, `mobile-results-webkit.json`, and screenshots in this directory.
- Pirate reminders now carry a `league_announcements` notification category. The relay checks push and in-app preferences for categorized messages. Focused Pirate and outbox regression tests passed (28 tests).
- The commissioner confirmed 24 hours for winner selection and 24 hours of roster-drop grace. The existing claim response default is also 24 hours. These match `lib/pirate/rules.ts`.
- Four staged fixture leagues have queued Pirate push and in-app events. Their QA accounts have no push subscriptions, so delivery to a physical phone remains unverified.
- A local staging-backed full-page browser attempt signed in successfully, but the cold Next.js `/league/[leagueId]` route did not finish rendering before Playwright's five-minute navigation timeout. The full app UI remains unverified; the component viewport checks above do not replace it.
- PR #2852 is open. Earlier integration verification passed 82 focused Pirate and trade tests; the current update's 102 focused tests and rehearsal reports are recorded above. GitHub Actions remains the release gate for every new commit.

## Hosting and staging

- Production runs on Railway in the `AllFantasy` project, `production` environment, `allfantasy-v2-main` service. It tracks `main`; `.github/workflows/railway-deploy.yml` batches production deployments. The Vercel PR check reports `Account is blocked`, and no Vercel Preview is available. Vercel is not the current production deployment path.
- The existing Railway `highlights-preview` environment hosts only its highlights service. The separate `Guilly Staging Web` project uses a different repository. Neither is a full-app Preview for Pirate League.
- The isolated Railway **AllFantasy Pirate Staging** project now serves `https://pirate-web-staging.up.railway.app` against the verified separate staging Neon database, with staging-specific URLs, auth, and push configuration. The commissioner tested the physical iPhone flows above. Pin and verify each update's exact PR commit; refresh live data and configure the bounded rehearsal jobs before unattended scoring-period QA.

## Production preflight

- The verified production Neon host is `ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech`. An earlier read-only audit using the separate G checkout found five local migrations pending there: `20261020010000_guilly_lifecycle_invariants` and the four Pirate migrations. The Guillotine file is absent from this PR branch and current `main`; it exists in G. Recheck both the database migration table and the exact checkout migration directory immediately before production work. `prisma migrate deploy` applies the pending files in the checkout where it runs.
- The read-only schema check found the required `leagues` and `redraft_matchups` tables, with no existing Pirate tables to collide with the new migrations.
- The repository production checklist requires a reviewed PR merged into `main` with green CI before deployment. No production migration or deployment has been performed for Pirate League.

## Release sequence

1. Finish the PR's required GitHub Actions checks and review. Decide whether the pending Guillotine migration belongs in the same release; otherwise review a Pirate-only migration procedure instead of using the broad deploy command.
2. Deploy the exact PR commit to an isolated full-app Railway staging service connected to the separate staging database. Sign in on physical Android and iPhone devices; verify protections, claim selection, counteroffers, roster transfer, and the five-second celebration. Subscribe both phones to push and verify an actual claim notification and a muted-preference case.
3. After PR merge and staging sign-off, apply only the reviewed production migrations, let the batched Railway `main` workflow deploy the matching build, and check `/api/health`, Pirate creation, a non-destructive protection edit, the outbox relay, and error logs. Watch the first live scoring period for final-matchup claim creation, 24-hour settlement, and roster consistency.

If a production issue occurs, inspect Railway's last successful deployment and schema compatibility before redeploying that build. Pirate migrations add tables and columns; dropping them would destroy live claim data.
