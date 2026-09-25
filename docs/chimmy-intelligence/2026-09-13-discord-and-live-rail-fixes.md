# Discord And Live League Scores

## Railway

AllFantasy is hosted on Railway. Vercel Blob was a storage dependency, not the app host.
The main Railway production service's DISCORD_CLIENT_ID was corrected to the verified
public application ID 1499502145039499344 with deployment skipped. It takes effect
on the next deployment. No client secrets were changed or exposed.

The local client ID and client secret were literal redaction placeholders. The local
public client ID is now corrected. The local secret remains private and must be supplied
by the owner. A private Railway CLI check confirmed that production has a numeric client
ID and a non-placeholder secret; no secret values were printed. Actual token exchange
still requires live verification. Connect/install routes now reject malformed configuration
before sending the user to Discord.

Discord's authenticated application endpoint confirmed both www and apex production
URLs for /api/auth/discord/callback and /api/discord/bot-callback are registered.
The local custom account callback is not registered; do not claim local OAuth certification.

## Score Changes

- The expanded league list now requests current Sleeper NFL scores on opening and every
  30 seconds while visible, in batches of eight. Requests stop on closing/unmounting.
- A session-authenticated endpoint resolves roster ownership from the database rather
  than accepting platform IDs or roster ownership supplied by the browser.
- The week comes from Sleeper's NFL state, not the first zero-score database fixture.
- Opponents are matched by matchup_id. custom_points overrides points, including zero.
- Unpaired weekly standings use actual league-wide points, competition ranks for ties,
  and correct downward/negative score changes. Last known values show an update-delay
  label on failure; live timestamps and week labels are separate from projections.
- Per-process provider cache, in-flight deduplication, bounded workers, timeouts, and
  request pacing limit load. Multiple Railway replicas still need a shared provider
  limiter/cache before large-scale rollout; the current cap is per process.
- Saved fallback standings now notice other teams' scores and preserve tied ranks.

## Verification

All six focused suites passed 41 tests in an isolated release overlay, including
browser-hook timers, hidden-page and delayed-refresh behavior, guild authorization,
OAuth state binding, authenticated score access, and paired guillotine standings.
The release uses the existing Sleeper provider client rather than bypassing it.
PR #841 passed every required GitHub check, including all four unit-test groups,
the browser regressions, no-new-TypeScript-errors, and credential checks. A release
packaging omission was fixed before merge: the Discord permission helper is included,
but its presence alone does not certify private channel creation integration.
This is not a claim that the entire repository is type-clean.
A read-only live comparison at 2026-09-14 01:13 UTC checked
six of the user's Sleeper leagues using the new calculation functions. KBI Commish
Chopped returned 126.28 points and 7th of 20, rather than the screenshot's projected 18th.
These are timestamped observations, not permanent/current scores.

## Remaining Limits

- Release PR: https://github.com/TheCiege23/allfantasy-v2-main/pull/841.
  Merged as ef52150def64c54e25852f00b218a06f86b8ea6d. Railway deployment
  1ca5ff45-6c8f-46fa-887a-92e9dd8a6098 completed SUCCESS. Production health returned
  HTTP 200; unauthenticated score access returned 401; Discord account/install
  endpoints redirected unauthenticated requests to login. Production compilation
  and page generation completed; the build itself skips types/lint, so the separate
  passing CI checks must not be confused with a zero-debt type certification.
  Production OAuth consent/token exchange and the
  authenticated production score endpoint must be tested after deployment.
- Standings reflect Sleeper's reported matchup field. Custom elimination rules,
  removed-roster eligibility, multiple chops, and commissioner tiebreakers are not
  certified. The code does not manufacture elimination decisions from team names.
- ESPN, Yahoo, and other platforms retain their previous behavior; this live fix is
  specifically for Sleeper NFL.
- The port-5190 communications preview uses fixture data and does not certify live
  league scores or authenticated production integrations.
- The previously reported private-upload-storage blocker and full-project TypeScript
  errors are not resolved by this change. No blanket full-build certification is claimed.
- Railway has no private upload bucket. Provisioning was blocked by automatic safety
  review pending explicit approval of usage charges; no bucket was created.
- Signed-in browser verification could not finish: Chrome tab inspection repeatedly
  lost its debugger connection, and the in-app browser is signed out. No fabricated
  session or direct production database writes were used to bypass this blocker.

References: https://docs.sleeper.com/ and https://docs.discord.com/developers/topics/oauth2
