# Zombie season operations and acceptance

This work follows the approved 2025 NFL rules. Replacement and departed owners receive their team's final winnings multiplied by weeks managed divided by the league's completed weeks. Any uncovered or rounded portion is redistributed to the other teams. Universe votes require 75% of Yes/No votes; abstentions are recorded and excluded.

## Implemented workflow

- The Zombie tab exposes season operations to league members. Head commissioners receive private accounting and owner-recovery controls. Source snapshots are not returned to ordinary members.
- A season accounting review reads collected funds, the configured commissioner fee/cap, the sealed 2025 weekly ledger, completed schedules, roles, ownership stints and external prize records. Ambiguous duplicate/separate prize accounting is an explicit dependency.
- Survivors split the remaining season pot. With no Survivors, the active Whisperer receives one third and Zombies split the rest. An all-Zombie field splits the whole remainder. Residual dollars go in descending season-points order, with roster ID as a deterministic final tie-break. Amounts conserve exact cents.
- Five-dollar Alpha contributions require an external reconciliation confirmation/reference. The first tracked opening pot must be specified. Later seasons read the previous approved carryover. Survivors win the available Alpha pot; otherwise it rolls forward. Ownership proration applies to Alpha awards too. Disabling an outstanding pot requires reconciliation.
- Approval checks the unchanged saved source under universe/league locks. Concurrent/repeated approvals produce one receipt. A later changed allocation requires a new external reconciliation reference and saved review; the prior approved allocation is retained in immutable history before the latest receipt changes, in the same transaction. No payment API is called.
- Participation contact creates an in-app notice and a full 48-hour deadline. The owner may respond. Unanswered contacts escalate to the commissioner once; nobody is automatically removed. A reviewed replacement updates canonical/native ownership, membership, inventory owner IDs and pending decisions together, preserving owner stints and replacement history. A current or prior owner cannot gain a second team in that universe season. Owners entering after Week 9 are restricted to Gamma by the reviewed universe-renewal gate.
- Post-draft Zombie co-manager invitations and accepted co-manager access are denied. Ordinary league co-owner behavior remains covered by its existing tests.
- A distinct owner must second an offseason universe rule proposal. The electorate is saved, the 24-hour clock starts on seconding, and each owner's ballot can change only until close. One linked vote notice appears in each league. Housekeeping tallies due votes; abstention-only votes do not pass. Passed rule text is a next-season mandate, not permission to execute arbitrary text against live settings. Commissioners implement an approved change in its relevant setting/workflow. In-season conduct rulings remain commissioner decisions.

## Seven-sport and manager acceptance

The evidence view covers NFL, NBA, NHL, MLB, NCAAF, NCAAB and Soccer. It reads stored calendars, final player rows, completed matchups and observed margins without fetching providers. These counts establish availability, not scoring completeness or statistical calibration. The 2025 NFL policy is not silently copied to other sports.

Commissioners can record an observed calibration review bound to the actual saved league configuration; later configuration changes invalidate that signoff. Managers can consent or withdraw without starting drafts. A physical-iPhone report requires device, iOS and all checklist results, including failures. A real-week report requires two consenting current managers, a completed unheld scoring week, its posted report, and explicit observations of normal ingestion, no synthetic scores, and reviewed locks/items. These remain manager-reported attestations, distinct from automated rendering or provider verification. A later reported iPhone failure supersedes an earlier pass.

The owner confirmed the leagues are **not full yet**. Therefore no real-manager week or physical-iPhone pass was recorded by this implementation, and no original draft was started. Controlled database fixtures cannot close these acceptance items. Current provider completeness and non-NFL gameplay calibration remain pending actual evidence.

`scripts/audits/zombie-seven-sport-readonly.cjs` produces an anonymized inventory under a PostgreSQL read-only transaction. It requires an explicit season and permits production only through the known-target check plus `ALLOW_ZOMBIE_READONLY_PROD=1`. It does not query provider APIs, seed users, change leagues or infer acceptance from row counts.

## Release and validation

The additive migration `20261102170000_zombie_season_operations` creates versioned operations records. Apply through the repository's guarded migration/pre-deploy path before serving this code. Development applied it only to disposable loopback PostgreSQL. No new cron or deployment path is introduced; the existing Zombie housekeeping performs vote tally and contact escalation.

Exact-cent policy tests and disposable-PostgreSQL integration tests cover accounting conservation, stale reviews, concurrent approval, private source access, external-prize classification, ownership history/48-hour response, late replacement, universe membership, vote timing/tally, consent and refusal to infer live acceptance from fixtures. UI/API tests cover explicit financial approval, blocked previews, member controls, errors and session-derived actors. Hosted protected checks and authenticated production acceptance are separate release gates.
