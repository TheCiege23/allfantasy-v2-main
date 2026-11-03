# Zombie completion checkpoint

## Verified release baseline

The authorized release PRs #3159–#3163 are merged. Production serves commit
`8afb4bed3ebc00cdb3551482bbb67f6a83afba81`; its ancestry includes all five PRs.
The production revision endpoint, database health, seven-sport creation catalog
and 15 Zombie workspace artwork files were verified. These checks establish
deployed code and asset delivery, not authenticated visual rendering or a live
scoring season.

All seven sports default to 20 managers. NFL offers even sizes 4–20;
NBA/NHL/MLB/NCAAF/NCAAB offer 4–32, and Soccer 4–40. The current wizard creates
one league or a commissioner universe with two through six leagues. Atomic
six-league creation and rollback were proved in disposable PostgreSQL. Drafts
remain unstarted. Manager count does not guarantee full-season survival.

The owner confirmed seeing 20 managers and the 1–6 selector. The accompanying
browser context points to staging, so this is not recorded as a signed-in
production wizard acceptance result.

## Current fix: scheduled announcement delivery

The old queue set `isPosted` without writing a chat message. The new queue:

- Delivers public announcements to native league chat using a stable message ID.
- Delivers private or targeted announcements only to that user's in-app inbox.
- Keeps private rows without a recipient pending; it never broadcasts them.
- Commits the delivery and posted receipt in one transaction. Concurrent workers
  claim the row conditionally, and a failed delivery rolls back the claim.
- Continues other announcements after one failure and returns a bounded failure
  diagnostic without the private content.
- Excludes weekly reports, whose approval, pinning and correction workflow is
  separate; unscheduled drafts and future announcements are not delivered.

Local verification: 28 focused unit/housekeeping/score-sync tests and three real
PostgreSQL integration tests passed. The database tests cover concurrent workers,
an actual foreign-key delivery failure, receipt rollback, continued delivery,
recovery after fixing the recipient, retry idempotency and approval boundaries.
The same opt-in database suite runs in the existing Zombie CI rehearsal lane.
No schema migration, additional cron, production fixture or automatic backfill of
old falsely-posted records is introduced. This fix still needs normal PR gates
and a verified deployment before it can be called live.

## Remaining work, in recommended order

### 1. Finish the approved 2025 combat workflows

`bashingEngine.ts` still uses a relative 48-hour decision window and treats a
Survivor bashing a Whisperer as an ambush decrement. Complete the PDF's role
choices, succession, inherited remaining ambushes and Wednesday 9 p.m. Eastern
default, including DST, concurrent decisions and retries. Coordinate this with
mauling and item settlement rather than changing winnings in isolation.

`ambushEngine.ts` currently supports swapping the Whisperer's opponent with one
Survivor and closes at the first league game. Complete the approved multi-matchup
remaps and locks based on the affected teams, with no duplicate participants.

### 2. Complete correction and commissioner recovery

`outcomeCorrectionReconciler.ts` explicitly sends 2025 outcome-changing
corrections to review because its older replay planner models infection shields.
`statCorrectionReconciler.ts` also refuses item-policy snapshots. Build a complete
reviewed correction plan covering scoring, roles, inventory, winnings, posted
reports and dependent weeks. Preserve holds when recorded external payouts or
later manager actions conflict. Also prove repeat commissioner approval cannot
duplicate a weekly report; the current manual approval route creates chat rows
separately from its posted receipt.

### 3. Prove seasonal accounting and governance against the PDFs

Reconcile season distributions, residual-dollar rules, Ultimate Survivor
contributions/carryover and replacement-owner winnings proration. The current
replacement service flags and reassigns an owner; this does not prove the full
inactivity contact/48-hour process, late-entry placement or conduct workflow.
Complete acceptance of seconded universe proposals, the 24-hour vote, 75% rule
and audited commissioner overrides. External payments remain human-recorded.

### 4. Calibrate and rehearse every supported sport

The 2025 NFL item policy is deliberately NFL-specific. NBA/NHL/MLB still need
their item scoring policy calibrated and accepted; NCAAF/NCAAB/Soccer also need
explicit gameplay and provider-calendar acceptance. Seven-sport creation tests
do not establish seven-sport gameplay acceptance. The current full native and
recorded-provider week rehearsals cover NFL/NBA/NHL/MLB.

### 5. Close data and real-manager acceptance

Obtain a current licensed NFL ADP source when the owner resumes that deferred
work; do not substitute stale samples. Re-audit missing portraits/profiles and
undocumented provider statistics without guessing values or reusing historical
exception counts as current measurements.

Use separate QA leagues for physical-iPhone draft/search/queue/orientation checks
and a consenting multi-manager live scoring window. Observe normal ingestion,
locks, infections, items, report delivery, correction holds and retry recovery.
Compare weekly reports and universe statistics field by field with the supplied
examples. Do not start the owner's original drafts or manufacture live scores.

No measured result yet establishes **99% automation**. Routine processing,
exception handling, human choices and external payout records must be counted
separately in that live acceptance window.
