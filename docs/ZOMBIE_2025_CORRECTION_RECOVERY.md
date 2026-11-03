# 2025 NFL stat corrections and commissioner recovery

This change builds on the consent-based combat workflows in PR #3181. The rules remain the approved 2025 NFL policy, including stacked Survivor win awards, two-serum revival, inherited remaining ambushes and the original Wednesday 9 p.m. Eastern combat deadline.

## Recovery behavior

1. An ordinary score-only correction can reconcile automatically only when replay proves that roles, inventory, winnings, infections and combat decisions are unchanged. There is no automatic outcome-changing approval.
2. The head commissioner opens **Automation → Stat corrections & recovery**, selects the earliest affected completed week, and prepares a saved review. A correction hold prevents new settlements, trades, item use, ambushes and combat responses while that history is being reconciled.
3. The review shows individual before/after matchup scores, team roles, cumulative winnings, item awards/removals/transfers/spends, and retained/defaulted/pending combat decisions. Dependent settled weeks are replayed in order from their corrected opening state.
4. The preview is sealed against the current scores, ownership, inventory, resolutions, choices, reports and payout records. A changed input or crossed decision deadline requires a fresh preview. Approval needs an explicit review confirmation and reason.
5. One serializable transaction applies the entire supported range: roles, inventory, revival spending, Whisperer identity/budget, infection/combat records, choices, winnings, corrected snapshots and the approval receipt. Repeated or concurrent approvals reuse that receipt. A late failure rolls back the entire game-state correction.
6. Existing eligible manager choices are retained. A choice that no longer exists or is no longer eligible is superseded. Newly earned choices retain the original scoring slate's deadline; the already-approved spare/decline default applies if that deadline has passed. A preview explicitly shows those consequences; no hidden deadline reset occurs.
7. The source snapshots and reports are retained in the review as an immutable before-state. Members receive a private notice describing only their own corrected role and winnings. Shared notices and reports preserve hidden Whisperer identities.
8. Native standings, universe statistics and linked weekly reports are refreshed through a durable follow-up. The review remains visibly pending until that completes. Housekeeping retries a bounded batch, and the commissioner can retry it. A latest-review pointer prevents an older retry from overwriting a newer correction.
9. The current unsettled period receives corrected passive-item receipts before the hold is lifted, then the normal scorer refreshes it. No item is spent again. Its changing player scores do not invalidate a review of completed weeks; completed-week scores, pairings, ownership and item/role decisions remain sealed.

## Explicit recovery boundaries

- The affected range must contain complete finalized 2025 NFL matchups, valid item score receipts and sealed pre-settlement snapshots. Other sports retain their existing correction policy.
- Earlier unresolved corrections, changed ownership, incompatible legacy rules or unverified ledger changes remain holds.
- Unrecorded or conflicting intervening trades, item use, ambushes or overrides are not silently discarded. Checkpoint and current-state proofs identify those dependencies. They need explicit operational reconciliation; an approval reason cannot bypass the proof.
- A payout-sensitive correction with an external payout record requires the commissioner to record the actual external reconciliation reference and note, then prepare a fresh review. That acknowledgement is bound to the exact payout and corrected scores. The original external payout record is preserved; the application moves no money.
- An active or interrupted settlement must finish before the completed-week correction workflow applies. A preview reports that dependency without introducing a new hold that would prevent it finishing. Starting a new settlement rechecks the hold under the same league lock. Missing historical snapshots cannot be manufactured from today's inventory.
- The original user drafts remain unstarted. No production data is seeded or modified during implementation tests.

## Report approval and publication

Manual report approval now commits one announcement, one linked chat row and its posted receipt together. Concurrent approvals and network retries do not post twice. A corrected historical report is rendered from that week's reviewed state, rather than today's roster masquerading as an older week. Follow-up failures stay pending and retryable.

The migration also installs a PostgreSQL publication guard: an unposted weekly report cannot become posted while its league has a correction hold. This protects queued senders that selected a report before the hold began. Legacy duplicate reports are preserved in the review evidence and updated through their linked records.

## Validation and release

The opt-in PostgreSQL recovery suite settles controlled fixtures through the real infection, item, combat and winnings services. It covers winner changes, dependent weeks, retained/revoked Whisperer succession, reversal of an unearned two-serum revival, stale previews, external payout reconciliation, runtime holds, the report publication guard, concurrent approvals, final-write rollback, follow-up retry, hidden report identities and automatic unchanged-consequence corrections.

Separate UI/API tests cover owner access before private reads, cross-league denial, snapshot redaction, explicit approval, stale feedback and accurate pending status. The Zombie hosted rehearsal runs both the combat and recovery database suites. These are controlled integration checks, not a claim of provider scoring calibration or physical iPhone acceptance.

The additive migration is `20261102070000_zombie_correction_reviews`. Deploy it through the repository's guarded production migration process before serving the new code. It adds review storage, a correction hold, a latest-review pointer and the report publication invariant. Implementation applied it only to disposable loopback PostgreSQL.

## Remaining product acceptance

- Protected checks and an ordered release of announcement delivery, combat and recovery, with guarded migrations and authenticated live verification.
- Season payout/carryover, replacement-owner accounting and universe governance acceptance against the supplied rules.
- Sport-specific item/gameplay calibration and full acceptance for NBA/NHL/MLB/NCAAF/NCAAB/Soccer.
- Current licensed ADP/profile/portrait coverage and a consenting real-manager scoring week with physical iPhone checks.
- Measurement of routine automation, human choices and exception recovery before claiming 99% automation.
