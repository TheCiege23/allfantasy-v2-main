# Zombie 2025 winnings and trading implementation

## Approved decisions

- The owner selected the 2025 PDF for weekly winnings and Whisperer trade eligibility.
- The owner confirmed a Survivor's normal 2/4/6 win award stacks with the accumulated winnings taken in a bashing.
- NFL bashing and mauling margins are 60. Other sports retain their calibrated margins; the NFL PDF does not define their scoring thresholds.

## Implemented

- New native weekly snapshots seal `beta_2025`, opening cumulative balances, roles and effective combat thresholds. Earlier ledger policy cannot silently become the opening balance for the new policy.
- The ledger records weekly deltas: Survivor awards by opponent; cumulative balance theft; rounded-up, capped Zombie-versus-Zombie theft; and full balance theft on eligible bashings and maulings. Ties do not create a win award. All calculations use cents internally.
- Native ledger writes, both sides' team totals and infection transfer amounts commit in one serializable transaction with bounded conflict retries and a league row lock. Repeat settlement upserts the same week from its sealed opening balance.
- The resolution saves a winnings distribution and the newly awarded weekly pool. Transfer activity does not inflate that pool because debit and credit sum to zero.
- Historical snapshots without the new policy keep the old calculation. A league whose earlier winnings use that policy enters a durable commissioner review hold before a new week's side effects; its old records are preserved.
- Score-only corrections use the original policy, roles, balances and thresholds. Later settled weeks, changed award decisions and recorded external weekly prizes remain review gates. Winner-changing 2025 corrections require explicit review while item replay is being aligned.
- Survivors and Whisperers may trade. Zombies cannot trade even if an older saved switch says otherwise. The shared create/accept/process transaction gate enforces current roles, so an eligible pending offer cannot execute after infection. Commissioner settings cannot enable Zombie trades under this policy.
- Trade intelligence, invitations, league controls, generated weekly rules and matchup captions explain the new policy. Matchup cards calculate from the sealed snapshot and withhold winnings details that could identify a hidden Whisperer.

## Verification

The committed implementation `f8a7321eb` passed all 475 tests in 63 Zombie test files (including the trade-value suite). ESLint on the initial changed file set exited zero; the final committed set is checked separately in the delivery summary. The DB-first guard passed against `HEAD^..HEAD`; the decision boundary guard reported no monitored changed source files for the same range.

The first full TypeScript run exhausted its heap. After a larger-heap run completed, it reported 150 total diagnostics, with zero diagnostics pointing to this change's files. That is a failing full-project check, not a clean compiler gate or a proven baseline comparison. An incremental check of the final candidate is recorded in the delivery summary. No error baseline was increased.

Added scenarios cover the 2025 role matrix, exact and fractional margins, balances below the margin, zero balances, exact 60-point combat boundaries, stacked Survivor awards, ties, reversed home/away winners, duplicate matchups, failed/repeated transactions, historical policy protection, score corrections, trade permissions and secrecy.

The transaction rollback test uses a transaction double; it is not evidence of a new real PostgreSQL or live-manager rehearsal. The earlier four-sport fixture rehearsals do not establish acceptance of these new winnings rules. Full compiler status and boundary guards are reported separately; a process that has not finished is not counted as passing.

## Remaining work, in order

1. Align serum scoring, multiple uses, mandatory revival, item award/loot/trade semantics and last-starter timing. Replace the older infection-shield behavior where the 2025 policy applies.
2. Implement the complete bashing/mauling role-choice and succession workflows, including the Wednesday deadline and remaining ambush allowance; finish multi-matchup ambushes and team-specific locks.
3. Verify pot accounting, seasonal distributions, replacement proration and Ultimate Survivor carryover with the cumulative weekly ledger. The app records prizes; no funds were transferred by this work.
4. Finish and verify exact commissioner voting, replacement, due-announcement delivery, reporting columns and exception recovery. The 2025 PDF has no Whisperer-versus-Whisperer payout rule, so that optional two-Whisperer pairing requires a defined policy instead of a guessed result.
5. Rehearse all four sports using registered managers, actual provider scoring windows and authenticated commissioner controls. Verify scheduled jobs, correction holds, retry recovery and physical iPhone behavior.
6. Integrate with current main and verify the existing six branch migrations against the production schema before any full Zombie production release.

This is the first rules implementation tranche. It does not certify 99% automation or a production release.
