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
