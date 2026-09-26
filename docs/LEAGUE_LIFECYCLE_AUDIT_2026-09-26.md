# League lifecycle audit and fixes

This audit follows the user request from Create a League through configuration, drafting, roster assignment, season scoring, median games, and dynasty/keeper renewal. The attached Word handoff supplied historical context; its merge and production-write instructions were not treated as new authorization.

## Changes

- The core keeper panel loads with the draft room so selecting Keepers does not leave an empty lazy boundary.
- No Review now persists as instant review, which the native trade runtime recognizes. Best Ball with disabled trading still persists disabled trading.
- Third-round reversal reaches the draft session and saved settings, and only applies to snake drafts.
- Invalid timezone names, dates, times, and incomplete schedules are rejected before creation.
- Dynasty startup depth, bench, IR and taxi selections reach the creation payload and installed roster configuration. Sport-specific BN/IR/IL keys are preserved, including zero-slot choices.
- Startup draft capacity uses the same sport templates as roster bootstrap. An over-capacity startup is rejected instead of leaving an impossible draft.
- Dynasty waiver type, FAAB budget, playoff field and regular-season length reach persisted runtime settings. Draft finalization derives season length from the selected regular season and playoff rounds.
- Roster bootstrap reloads settings after saving custom slots so metadata cannot overwrite the saved sport configuration. It also writes the installed roster size.

## Verification

Base: origin/main at 9af6337bd9ec045292c58f765931a08175eb4469. Changes are in an isolated checkout; the shared F drive edits are preserved.

The initial regression run passed 546 of 548 tests. Both initial queue-autopick failures passed in isolation; slow module loading under concurrent load caused those failures. An expanded run with bounded workers passed 633 of 633 tests, covering creation, joins, asset enrichment, draft execution, rookie drafts, roster finalization, keeper/dynasty carryover, weekly scoring, median standings, commissioner settings, and specialty automation. The final-change report passed all 157 assertions; its process returned exit 1 without a failed assertion, so the four directly changed test files were repeated and completed with exit 0: 40/40 tests passed.

Browser verification passed all four existing creation scenarios. The existing keeper click audit initially failed with an empty panel; after eager loading the keeper component, its unchanged assertions passed for selection, eligibility, commissioner override, round-cost board locks and removal. Browser API responses were mocked, and database URLs were pinned to a blocked local port. Windows cross-drive dependency resolution required temporary NODE_OPTIONS and webpack symlink settings; next.config.js and tsconfig.json were restored before commit.

The real test-database smoke test created redraft, dynasty and keeper leagues with 12 rosters and 12 entry slots each. It checked draft rounds, 3RR, median games, instant review, dynasty playoff settings and keeper count, then rolled back the transaction and confirmed the synthetic user was absent.

Most regression tests use mocked database and provider fixtures; neither they nor the creation transaction are evidence of a real live season completing.

Full TypeScript checking reported 143 errors outside edited source files. A focused check of the final edited source graph reported five errors in lib/meta-client.ts; no same-base compiler comparison was performed. The secret scan passed.

## Authorized production observations

The user explicitly authorized read-only production checks. Every query ran within BEGIN READ ONLY. No migration, backfill, league creation or data mutation was performed by the read-only audit. Code deployment was subsequently authorized separately.

- The partial draft_sessions_leagueId_open_key index is present and permits one open draft per league. The old whole-league and league/season uniqueness constraints are absent from the index census. Zero leagues have multiple open drafts. The migration described in the handoff has already been applied.
- The ADP table has 2025/2026 NFL rows only. Other sports have no measured vendor ADP coverage in that table.
- Recent player_season_stats rows cover NFL and some 2025 MLB data. This is not a census of every stats source; other draft enrichment tables may contribute.
- SportsPlayer contains images across sports, but coverage is incomplete, particularly NCAAB. SportsTeam contains logos across sports, with substantial gaps for college sports and soccer.
- Raw sports_players headshot counts alone are misleading: the draft also reads SportsPlayer images and SportsTeam logos. The audit inspected both stores.

Row counts include historical entries and duplicate provider identities; they are not percentages of the active draftable pool. Existing URL counts also do not prove that each remote image loads.

The reproducible aggregate audit is scripts/audit-league-lifecycle-readonly.cjs. It enforces READ ONLY and never prints credentials or manager information.

## Still required for full live acceptance

1. Exercise real authenticated league creation, joins, draft setup, picks, completion and scoring against an isolated test database, including concurrent joins/picks.
2. Verify active draft-pool image URLs, identity matching, logos, stats and ADP for each supported sport. Fix ingestion and mappings where real coverage is missing; do not invent ADP or disguise logos as headshots.
3. Exercise the authenticated dynasty and keeper offseason UI, including keeper selection/locking and future-pick trading; the real service/database carryover and next-draft paths have passed fixture verification.
4. Verify every offered specialty concept through its real lifecycle. Automation unit coverage alone is not complete product acceptance.
5. Verify released code paths after Railway reports a successful deployment. The user has authorized code releases; production test-data writes have not been performed.

## Follow-up verification and release

PR #1347 merged as 50b6f5047a9efb3ed549b50a7017f58f8c931e5a, with the supplied branding and lifecycle fixes. The user explicitly authorized production releases. Railway deployment verification is tracked separately from merge status.

A real known-test-database service smoke passed for redraft (2 teams), dynasty (8 teams) and keeper (8 teams). It installed roster and scoring configuration, assigned synthetic owners, finalized completed draft fixtures twice, generated schedules, calculated weekly passing-TD scores and median standings twice, and verified full-PPR receptions. Finalization added no duplicate players. Dynasty used the selected 12 regular weeks plus one playoff week. The fixtures contained 30, 80 and 128 roster players respectively. All tracked synthetic leagues, owners and weekly scores were deleted. These checks use completed pick fixtures; they do not certify authenticated pick submission or real provider assets.

That smoke exposed a UI/server mismatch: dynasty, keeper and Best Ball offered team counts the server rejects. The follow-up uses the canonical sport/concept catalog for limits and steps, and resets an incompatible selection when changing concepts. Four rendered UI regression tests pass, including server acceptance of every offered specialized count.

Protected CI for the first release passed, including the check for no new TypeScript errors. The earlier full compiler baseline errors remain outside this change.

The expanded real test-database smoke also passed next-season creation for all three formats. Dynasty carried all 80 active players into the next season, created a rookies-only draft and applied one traded future pick. Keeper placed one locked keeper in its next full draft. Redraft created its next standard draft. A second renewal request returned DRAFT_STILL_OPEN for each format. Cleanup explicitly verified zero tracked leagues, users and weekly-score rows. This uses a completed-season fixture and seeded keeper/future-pick records, not a full authenticated offseason UI journey.

## Real pick submission and contention repair

A guarded known-test-database smoke exercised the actual draft-start service and pick-submission service on a two-team, two-round snake draft. The real authority helper allowed the manager's roster and refused another manager's roster and a nonmember. Two simultaneous submissions produced exactly one first pick. Stale overall and duplicate player requests were rejected, and the last pick automatically completed the session and materialized four season roster players. Tracked synthetic leagues and users were removed.

The run reproduced a Postgres lease race: both transactions observed a missing lease; the losing unique insert was classified as an infrastructure error, so draft submission entered its fail-open path. The pick unique index still prevented duplicate commits. The repair classifies competing insert/deletion errors (P2002/P2025) as lock contention, so draft callers return the ordinary retry response. The repaired real database run passed without entering the infrastructure fail-open path. Twenty-eight unit assertions passed, including genuine connection-failure fallback. This verifies service behavior with real DB writes and identity checks, not browser authentication/session cookies or a full normal-size draft.

## Authenticated API verification

The team-count release (#1349, b1a3ce9489d5e307b51d36f13af1b23cb6427aa5) reached Railway SUCCESS. The preceding branding/persistence release also reached SUCCESS.

A real local Next server connected to the known test database passed the authenticated creation smoke: anonymous POST /api/leagues returned 401; the credentials callback established a real NextAuth cookie session; authenticated creation installed two rosters, roster configuration and a draft. A spoofed commissionerId was stripped and league ownership matched the authenticated user. Cleanup verified zero tracked synthetic leagues/users. Temporary Next/TypeScript cross-drive settings were restored and the owned server stopped.

Automatic review initially rejected this test because inherited Meta credentials might send test conversions. The safer rerun restarted the server with Meta pixel/conversion, email and shared Redis credentials explicitly disabled. Server logs confirmed the Meta event was skipped because no conversion token was set. No signup endpoint was called.

Remaining acceptance includes the full authenticated browser journey through joins/settings/draft picks, full-size real drafts, active-pool remote image coverage, cross-sport stats/ADP completeness and each offered specialty lifecycle.
