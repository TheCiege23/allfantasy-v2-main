# My team audit — 2026-09-27

Scope: `/core/my-team`, its league view, roster controls, source links and Chimmy entry points.

## Confirmed defects and changes

- A single Thursday kickoff marked entire lineups locked. The board now follows individual future deadlines, keeps started players visible, and prioritizes remaining actions. Unknown schedules do not establish a lock.
- Bench comparisons could recommend players whose games had started. Both sides of a comparison now exclude known past kickoffs. Provider locks and AutoSubs remain explicit verification steps.
- Omar Cooper's current IR report was stored as Omar Cooper Jr. Name suffix variants now match the newest club-compatible report. A newer cleared designation overrides an older injury.
- Sleeper's import omitted its `best_ball` rule. Imports and re-sync preserve the explicit provider rule; the selected roster reads it from the existing provider response. Best Ball gets automatic-lineup guidance and roster review instead of manual swaps. League names do not determine this rule.
- Empty-slot actions opened the import flow. Imported teams now use verified provider lineup links. Native teams get an explanation when no provider action exists.
- Chimmy actions now carry the exact league ID. My team reuses its resolved roster for urgent moves rather than adding a second triage read. Bench comparisons and projection questions open the existing authenticated Decision OS-backed chat flow without auto-sending.
- Paused leagues are excluded from urgency while remaining in inventory. Read failures show an error, rather than a healthy empty account. Missing rosters identify available-data gaps and offer league setup or imported-league sync.
- Kickoff times explicitly show UTC. New intelligence controls wrap and have 44px minimum touch targets.

## Domain references

[Sleeper AutoSubs](https://support.sleeper.com/en/articles/9731991-how-does-player-autosubs-work) documents provider-specific paired locks. AllFantasy therefore labels individual deadlines and asks users to confirm AutoSubs locks on the provider.

[Sleeper league types and formats](https://support.sleeper.com/en/articles/3537396-league-types-formats) distinguishes roster lifecycle from Classic/Best Ball scoring. This change uses the provider flag, not dynasty status or the league name.

## Verification

Targeted tests cover per-player deadlines, 65-team batched reads, paused inventory, read failures, alias freshness, club mismatches, Best Ball import/roster behavior, source links, scoped unsent Chimmy actions, bench eligibility, projection agreement and refresh behavior.

Release checks and authenticated production evidence will be appended after deployment.

Local targeted validation: 111 tests passed across 11 files. git diff --check passed.

The player card opened from My team used an exact injury name and contradicted its own IR news. It now uses the same suffix variants and club guard. An additional 22 player-card tests passed across two files (133 targeted tests total).

## Live intelligence regression

An authenticated pre-release question returned a best lineup containing inactive Caleb Williams and Dallas Goedert at full points. The optimizer used cached vendor tags but did not remove unavailable candidates. It now reads the current club-matched injury reports, scores reported unavailable current starters at zero, and excludes them from the candidate pool. Healthy/Active tags are not presented as injury warnings.

The existing started-game checker now supplies per-player constraints to the optimizer and two-player comparisons. Started starters retain their declared slot; started bench players cannot become new starters. Missing placement or projection for a started starter blocks the comparison. Unknown locks remain explicitly unverified, and source-platform AutoSubs still require confirmation.

Two-player requests involving an unavailable or already-started option return a clear reason rather than a computed start recommendation. Best Ball roster-review prompts avoid requesting manual lineup optimization.

Final targeted validation: 225 unique tests passed across 17 files (111 page/roster tests, 22 player-card tests, and 94 engine/action tests with two overlapping action tests). The pre-engine-fix full TypeScript ratchet passed at 143 existing errors; final-head CI is required before release.

Production release #1371 passed all 19 executed checks and deployed successfully (Railway deployment 38e9fd7b-d8a1-4352-b155-12046a9d9d31, main commit 617ab4dc9e13c8b738b652481b24ac725d1d27da, includes My team merge 6e1e349e3c19ae75ac2518509ced95cfcf3ba8fb). The database-connected health check passed. The BB Dynasty roster shows automatic Best Ball, Omar Cooper IR at zero, and matching roster/matchup totals of 51.4. Its selected-league sync completed successfully.

Follow-up: blocked comparisons now offer remedies for unavailable players and provider locks instead of a sync loop. Board unreadable/hidden counts exclude paused teams while the full inventory link includes them. Player-card schedule forecasts explicitly identify their published baseline; the lineup applies league scoring and current injury availability. Targeted validation passed 67 tests across three files. The first attempt failed on the Windows temporary drive's lack of space; rerunning with temporary files inside the worktree passed.

Authenticated cross-league testing found that an explicit roster-review question could be seeded into the previous scope or erased while saved drafts loaded. The composer now waits for storage hydration and the requested league, applies each numbered request once, preserves existing user drafts, and never auto-sends. Additional drawer and scoped-conversation regressions passed 23 tests across three files.

The full inventory picker opens 65 leagues, but its generic empty decision queue falsely implied all lineups were clear. My team's inventory now omits that uncomputed queue and links back to lineup priorities. The final board/picker suite passed 31 tests, replacing the earlier 30-test run. Follow-up validation totals 91 unique tests across six files.

Performance evidence: opening the 65-league inventory generated a large burst of /core/my-team prefetches in Railway logs at 13:36:52-13:37:01 UTC, with tail requests taking 7-10 seconds despite HTTP 200. Inventory league tiles now disable speculative Next.js prefetch; the chosen league still navigates normally. Post-release verification will check the inventory navigation without that burst.
