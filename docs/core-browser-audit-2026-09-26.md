# Core browser audit — September 26, 2026

## Scope and release status

Visited every sidebar destination from the supplied screenshots in a dedicated Chrome tab on the signed-in production site. The main data sample was the Sleeper NFL dynasty/IDP league **Defense IDP For Life**, with 65 leagues visible in the account. This is a navigation and targeted control audit, not certification of every nested button, every provider, every league format, or live scoring during a game.

Changes below are local workspace changes. Production has **not** been deployed from this audit. Existing and concurrently edited trade/import files were preserved. The development account can sign in locally but has no imported leagues; it cannot verify parity with the production account's league data.

## Screen-by-screen findings

| Screen | What worked in Chrome | Error or gap | Local action / remaining validation |
|---|---|---|---|
| Home | League selection, overview, history coverage, timeline, fixtures and transactions loaded | Power board included partial Week 3 in records; differed from Standings | Existing workspace all-play cutoff changes preserved; production parity needs recheck |
| My team | Roster, player controls, lineup refresh and source lineup destinations appeared | First kickoff described the entire lineup as locked | Changed wording to games started and individual platform locks; verify player-by-player locking |
| Matchup | Teams, actual fantasy totals, player scoring and projections loaded | 29–47 partial scores labelled Final although starters remained | Provider-stated week now gates final status and default week |
| War Room | Scout cards for 16 managers loaded | Some manager profiles unavailable; manager-to-trade handoff needs further review | No fabricated profile added; Game Plan and nested actions need certification |
| Waivers | FAAB, priority, transaction history and suggestions loaded | Generic Tuesday/weekly advice contradicted instant free-agent rules | Changed shared recommendation to consult actual pickup rules; claim execution and AI analysis not tested |
| Trades | Trade center and extensive trade history loaded | Large history; builder/filter/grade flows need exhaustive testing | Concurrent trade changes preserved; no trade sent during audit |
| Player Finder | Search for Patrick Mahomes returned the matching player; result link navigated | Search and detail content had nested main landmarks | Detail content now uses a labelled section; complete player tabs still need review |
| Draft HQ | Rookie board, picks, names and empty queue/lottery states loaded | Not tested during a running draft | No live draft modified |
| Your week | Week board and matchup projections loaded | Selected Week 2 while the league stated Week 3; partial week counted in records/model | Prefer provider-stated current week; exclude unfinished weeks from records and scoring fits; invalidate old summary version |
| Live scores | My games/All games and sport switching worked; MLB displayed 13 scheduled games | MLB cards displayed Week 0; cannot certify score changes before games begin | Removed Week 0; fantasy and actual-game real-time update verification remains open |
| Standings | Correct 1–1 record after two completed weeks, rank, charts and historical controls | Inconsistent with other pages | Used as an observed parity reference; existing provider-record confirmation preserved |
| Season Outlook | Forecast, odds, drivers and scheduled opponents loaded | Partial Week 3 counted as a finished loss and removed from remaining schedule | Exclude unfinished weeks from records/model; retain current-week games in remaining schedule; invalidate summary cache |
| Your career | League career record and history loaded | Current season displayed four finished games despite only two completed weeks | Exclude current unfinished week and duplicate same-week/team-pair facts; doubleheader formats require separate verification |
| Rankings | Selected-league ranks, records, points and explanations loaded | No obvious top-level failure | Nested comparison controls still need certification |
| Portfolio | 65-league / 574-player exposure view and tab/filter controls appeared | Account-wide scope should remain obvious inside selected league | Full filters and player ownership parity still need certification |
| Commissioner | Health, rules, automation and connections loaded | Completion-dependent charts and individual automation flows need review | No announcements, rule changes or automation switches submitted |
| Notifications | Notices, filters and source links loaded | Old repeated lineup notices; Fix it opened overview | Action links now route to My team/Trades/Waivers/Draft HQ; historical notice deduplication and current starter freshness remain open |
| Sync | League status and freshness rows loaded | Wrong transaction scope; scores always labelled live; no league-specific button | Correct collector scope keys, show freshness, add scoped refresh and truthful outcome counts |
| My Leagues | All 65 current leagues and 492 historical entries loaded | Hardcoded No scores read yet and live scores not ingested text contradicted the core rail | Use shared matchup reader in parallel with existing loader; replace misleading coverage text |
| Settings | Full settings categories loaded | Initial loading state before data arrived | Individual saves and connected-account flows not modified or exhaustively tested |
| Tools | Tool groups and route links loaded | Exposed an internal unresolved product decision in user-facing UI | Removed decision panel; verified local Tools page loads |
| Admin | Command center and diagnostics eventually loaded | Noticeably slow navigation; configuration issues visible | Requires separate admin performance/configuration work; no admin action submitted |

## Sync reproduction and changes

Pressed production **Sync now** once. The button remained busy for several minutes, then reported **Sync did not run. Try again shortly.** Some league freshness labels advanced meanwhile. A failed HTTP round therefore cannot establish that no league changed, and this audit does not claim that all 65 leagues synced.

Railway HTTP telemetry confirms that `/api/core/sync` ended with **499 after 125,006 ms**: the client closed the request before the server could respond. The previous 200-second new-work budget exceeded that observed transport window. The precise party terminating the connection is not established by this log alone.

Local changes add a scoped **Sync this league** action, preserve server-side candidate authorization, use the filtered candidate denominator, return account batches after at most one league per provider, lower the new-work budget from 200 seconds to 20 seconds, bound each client request to 110 seconds, and distinguish successful, failed and already-running leagues. The continuation backstop is 200 rounds so a 65-league account can finish with these smaller batches. The batch budget stops new work; it does not interrupt a collector already running. Provider authentication failures, collector runtime limits and scheduler health still require deployed verification.

## Responsive and performance checks

- Production desktop navigation reached all screenshot destinations. Phone More exposed all sections and closed correctly. Tested actual DOM viewport widths of 390 and 768 CSS pixels; sampled page width did not exceed the viewport. This is not a completed three-device audit of every nested screen.
- Local phone Tools/Home samples had one main landmark and no page-wide horizontal overflow. Sidebar targets increased to 44 CSS pixels and larger text. Browser screenshot capture intermittently timed out, limiting visual certification.
- Disabled automatic prefetch of the entire sidebar to reduce competing server work; no measured production latency improvement is claimed before deployment.
- Local development cold compilation took about 40 seconds and compiled roughly 7,500 modules. Development compilation time is not a production page-load measurement. Production Admin and data-heavy pages still need measured route/data latency work.
- Zero delay cannot be promised for network-dependent provider reads. Loading, freshness and errors must remain clear while those operations run.

## Verification

- Core suite: **80 files / 756 tests passed**, including selected screen, scoring, summary, navigation and roster tests.
- Newest focused sync/outlook checks: **27 tests passed**, including scoped candidate counts and partial-week schedule preservation.
- Added regression cases for provider-stated week completion and completed seasons.
- TypeScript check fails across the workspace, including unrelated AI chat, draft and World Cup files. The check reported no errors in the modified core files at the time of checking. Full release typecheck is still a blocker.
- Local Next development build compiled and the local development login succeeded after network access was allowed. The empty development account verified shell, navigation and empty states; real-league local validation is outstanding.

## Required completion work

1. Validate the patches in an environment with imported test leagues, then deploy and recheck the reproduced Week 3 discrepancies.
2. Run one scoped sync per provider and verify rosters, weekly results, transactions and timestamps against each platform; verify account sync completes without HTTP timeouts.
3. Observe fantasy and actual-game score changes during live games and verify stale-feed recovery, disconnect/reconnect and poll cadence.
4. Finish nested button and form paths: trades, waiver browse/analysis, draft actions, commissioner automations, player tabs, portfolio filters, settings and admin.
5. Resolve repeated/outdated notifications and completion-dependent commissioner charts.
6. Perform complete desktop/tablet/phone visual and keyboard checks on populated pages, and record production loading timings.

The user supplied the exact Railway app and environment link after initially selecting staging. The link identifies service `26e55ff8-c945-4526-8523-f6bfa723357e` in production environment `2e0aba38-9e21-4df0-9957-484a346da227`, serving `www.allfantasy.ai`. This is now the verified target; a separate staging environment has not been identified. The requested account is TheCiege26.

## Continued build for S-7MGGKR3

- Added a shared client sync job. Progress survives core navigation; simultaneous account/league sync controls reuse one active run. The current page refreshes once on completion, including failure after partial work.
- Added checks for duplicate starts, screen unmount/remount, remaining-league continuation and retry after transport failure: 23 sync tests passed.
- Removed repeated full league settings from the week board's team query. Current-period metadata is now one small parameterized query per set of league IDs, running in parallel with the board reads.
- Relevant week-board/context/sync regression checks: 69 tests passed across five files.
- `S-7MGGKR3` was not found in Railway inventory. The subsequently supplied dashboard URL identifies the production target explicitly. No deployment has been made from this audit.

## Continued production flow checks

- MLB game details open, including leaders and play filters. The game link dropped the selected league; local detail and return links now preserve it.
- Every scheduled MLB card showed the same 45%/55% estimate because an NFL score-margin model was applied across sports. Core/public score cards now use that model only during an ongoing NFL game, withholding it elsewhere.
- The Cardinals displayed `LAR`: the NFL historical alias `STL -> LAR` was applied to MLB. Live-score normalization and team filters now apply NFL aliases only to NFL.
- A game-detail HTTP poll failure was silently ignored; it now preserves the last game while marking its data stale.
- Live-score regression checks: **105 passed across nine files**.
- Player news mentioning picks was classified as a draft alert. Notification categories now take precedence over headline keywords, with a player-news fallback.
- A TE injury notification recommended a QB as the best bench replacement. Injury-signal replacement suggestions now require matching player positions; exact flexible-slot eligibility still requires league/slot data.
- Notification and injury-signal checks: **36 passed across three files**.
- Connected Accounts loaded the account's Sleeper, ESPN and Fantrax connections. Yahoo is explicitly unavailable; MFL and Fleaflicker are not connected. These states must not be reported as successful sync coverage.
- Settings correctly identifies existing admin subscription access, while Core incorrectly showed Free with 20 tokens. Core now passes the trusted session email to its existing entitlement resolver and labels existing bypass access explicitly; no access rights were added.
- Rivalry radar also counted the current partial week as a completed meeting. Its history now uses the saved current-period marker; the regression retains the completed Week 2 win and excludes the partial Week 3 loss.
- During the later college-football check, live cards displayed clocks, scores, possession, leaders and play details. Inactive cached NCAAF count was 116, changing to 65 on loading its active feed; cached/live fixture-count parity remains open. Home also showed duplicate upcoming college fixtures and Week 2 labels while the rail showed Week 3; these Home data paths require further investigation.

## Isolated release verification

### Home follow-up

- Shared week resolution now prefers saved provider markers; the portfolio defaults to the most common period in the newest season. An old unscored matchup no longer overrides that marker. The week board uses the same selection rule.
- Upcoming fixtures are deduplicated by sport, exact kickoff, and normalized team names. Different kickoff times remain separate, including doubleheaders. The query remains bounded to 200 rows in the next 24 hours.
- The Game day record ignores tied/unplayed pairings and compares the current scores instead of trusting an old win flag.
- The rivalry summary cache version advances so the completed-period fix is not hidden behind an old cached result.
- Follow-up regression checks passed: 77 tests across six files. Separate arithmetic, fixture and summary checks also passed.
- The optimized Home revision build completed successfully with a dummy localhost database address and generated all 572 static pages. It did not access production league data; deployed verification remains outstanding.

### Score-cache follow-up

- Reproduced deletion of the last weekly scores before a failed or empty provider response.
- Refresh now fetches and validates the non-empty replacement before deleting any cached scores. A short transaction replaces one week atomically, preserving the old scores if persistence fails.
- All 18 cache/sync regression checks passed in both the shared checkout and isolated release checkout.
- The completed optimized build compiled the earlier Home revision `49c0eed539`; this later cache change is covered by its separate regression run and the updated PR checks, not that compiled revision.

### Daily scoreboards and live situation follow-up

- Read-only production fixture counts confirmed MLB has 13 games in each of two feeds, with week `0` versus `null`. Weekly source selection treated them as separate slates and displayed 26. Daily sports now explicitly select one source per Eastern kickoff day; NFL and NCAAF retain weekly selection. Future-day coverage and actual doubleheaders remain intact.
- The NCAAF 116-versus-65 discrepancy is a provider coverage difference, not evidence that all additional games are duplicates. Coverage parity remains open.
- Daily-feed regressions and related live checks passed: 82 tests across five files.
- Sleeper player-score refresh now prefers the saved provider period and previous week, preventing an old zero-point week from redirecting live fantasy ingestion. Other seasons and completed leagues retain the cache fallback. All 29 related live-refresh and collector checks passed.
- Chrome showed an invalid college-game label, `4th & -13`. The summary mapper now withholds impossible next-snap distance while retaining possession and field position. Its related checks passed: 37 tests across three files.
- GitHub's only newly failing unit-test file expected the removed `Week 1 locks` wording. Updated that assertion to verify `Week 1 · first kickoff`, consistent with individual player locks; all 37 My Team tests passed. Mobile smoke/auth, onboarding, retention, referral and draft-room checks passed on revision `f98347283a`.
- The broad suite under a concurrent build passed 787 checks with one trade-history timeout; all 11 tests in that file passed on a standalone rerun.

### Screen loading measurement

- Ten interactive screens now use a client lazy-import boundary while retaining default server rendering. This follows [Next.js lazy-loading guidance](https://nextjs.org/docs/app/guides/lazy-loading); the data readers remain on the server.
- Both optimized builds completed successfully. Core route size fell from 219 KB to 197 KB; reported first-load JavaScript fell from 644 KB to 593 KB (about 8%). Core page CSS entries fell from 38 to 29, and their uncompressed total fell from 821,994 to 688,882 bytes (about 16%). These are build assets, not measured deployed user latency.
- The comparison froze the lazy-screen changes before compilation. Subsequent server-side daily-feed and snap-distance changes were made during that build, so this is not a claim that an immutable final revision was fully built. Their focused regression checks passed separately; final CI and deployed verification remain required.
- Follow-up global typecheck again reports 143 errors, with none in the modified screen registry, score selectors, game summary or their tests. The repository retains its existing type debt.

The release checkout is based on the deployed `main` commit `0b8b61eafed13ddbbfd4167e5c4a63875ddc1fb0`, on branch `codex/core-browser-audit-20260926`. Newer shell route and navigation changes were preserved. The shared development checkout's unrelated edits are not included.

- Focused release checks: **85 tests passed across 10 files**, plus the rivalry regression.
- An initial broad run hit timeouts under concurrent load. With two workers, the full Core suite passed **788 tests across 85 files**; a separate live-score/outlook run passed **97 tests across seven files**.
- Baseline and initial patched typechecks both report **143 errors**, with identical file/error-code counts and none in the changed files. Some diagnostic type-member ordering differs. This is not a clean global typecheck. Both optimized local builds passed, with the revision limitations above.
- No production deployment has been made from this audit.

## Provider basis

### Current-period persistence verification

- Read-only checks confirmed the audited Sleeper league reports `settings.leg = 3`, while its saved AllFantasy settings have no current-period marker. The mapper dropped this field before persistence.
- Sleeper and ESPN imports now preserve the provider's current period as `current_week`. Existing import/refresh writers persist it; an omitted marker does not erase a previously saved marker. Core readers prefer this refreshed canonical value over older raw markers.
- Six focused regression files passed, covering 43 checks for provider mapping, refresh settings, completed-week boundaries, season outlook and sync continuation. Deployment and the populated-account recheck remain outstanding.

Sleeper distinguishes `week`, `display_week` and league `leg`; a nonzero score is not evidence that a fantasy week has finished. See [Sleeper API documentation](https://docs.sleeper.com/) and [Sleeper's weekly score adjustment rules](https://support.sleeper.com/en/articles/3410666-adjusting-weekly-lineups-scores), which describe final scoring after the final game of a week completes.

### Final release follow-up

- Commissioner scoring charts exclude the provider's current week, include legitimate completed zero scores, and explicitly label uncertain progress when no marker exists.
- Identical notifications from the same league and day are grouped without deleting receipts. A grouped action marks every underlying receipt; a failed PATCH keeps the unread count and presents retry feedback.
- Draft HQ retains its page heading when no upcoming draft exists.
- These final regressions passed: 39 tests across three files. The current-week matchup-cache follow-up passed 33 checks across four files.
- All GitHub checks on 4b7c60d9ad passed, including four unit shards, the TypeScript regression guard, mobile smoke/auth, draft room, onboarding, retention and referral checks. The final follow-up revision requires fresh CI and Railway build verification.
- Populated-player audit found a second-model market-value explanation that contradicted the package's displayed prices and an internal lineup diagnostic. The card now keeps package prices authoritative, retains non-price explanations, and withholds internal diagnostic strings. All 28 trade-visual checks passed across two files.
- Final local typecheck completed with the existing 143 diagnostics and no diagnostics in the final chart, notification, or Draft HQ changes.
- Final waiver audit: public Sleeper configuration for the selected league has waiver_type 0 and daily waivers enabled, yet Core said waivers were off and suggested FAAB bids. Corrected 0 to rolling priority and 1 to reverse standings, matching the existing Chimmy provider decoder. Refresh now updates the imported waiver rule mirror as well as League settings, without overwriting processing rules the provider did not supply. Non-FAAB leagues no longer display FAAB budgets or the FAAB bid panel. Added a Waivers heading and neutral claim-activity wording. Provider-refresh and waiver checks passed: 83 tests across seven files.
- Sleeper's documented rolling, reverse-standings and FAAB systems are described at https://support.sleeper.com/en/articles/1876041-what-types-of-waivers-do-you-support . The numeric interpretation is consistent with the application's existing provider decoder and the observed live league; the public support article does not document numeric enum values.
