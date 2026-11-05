# 2025 NFL combat and Whisperer workflows

Authority: the user-supplied **Beta Zombie League Rules 2025 (1).pdf**. The user chose this policy over conflicting historical spreadsheet/update examples. The existing 2025 item and winnings services remain the settlement authorities. The user separately approved stacking the normal Survivor win award with stolen winnings.

## Decisions approved by the user

- Each initial Whisperer candidate has 24 hours to accept or decline. Exhausted candidates require commissioner review and a new consenting nominee.
- Mauling succession closes Wednesday at 9 p.m. America/New_York. No response means no successor. Bashing defaults to spare at the same deadline.
- Dates are anchored to the saved scoring slate, with daylight saving time respected.

## Implemented

- Independent cryptographically randomized veteran-first offers, durable offer order, private inbox delivery, consent, stale-offer protection and idempotent responses. All registered managers are eligible when there are no veterans.
- Before the initial draw, the owner can record an audited historical veteran eligibility review for managers who completed a prior universe year. Eligibility is sealed once offers begin. This supports imported history without inventing veteran status from roster order; automatic history certification is separate work.
- NFL activation opens offers; weekly settlement waits for the initial selection. The Zombie tab shows pending decisions and an exhausted-draw commissioner nomination form.
- Combat uses sealed pre-infection roles, adjusted matchup scores and existing item/revival receipts. At a 60-point margin, a Survivor may spare/infect a Survivor or spare/replace the Whisperer. A replacement inherits the current remaining ambush budget, without a refill or halving.
- A Zombie mauling the Whisperer demotes the old Whisperer immediately. Only a mauler actually revived by spending two serums may accept succession. Insufficient serums, decline or timeout leaves no replacement. The succession response never spends serums again.
- Real Bashing/Mauling event rows, choices, team role changes, private notifications, shared generic chat receipts and audit entries are persisted transactionally. Repeated requests do not repeat effects.
- Enhanced NFL Whisperers can review and remap the complete current-week matchup field, including matchups unrelated to their own. Every team appears once. Unchanged pairs retain their original rows and score receipts.
- A pair locks when either team's starter begins; unknown kickoff data and finalized/scored rows fail closed. Other unlocked pairs remain editable after an unrelated game starts. The service rechecks locks before committing.
- A remap consumes one of two seasonal ambushes exactly once. Retries use a durable request receipt and the reviewed schedule hash. The normal scorer rebuilds team item bonuses for the new pairs; a score refresh failure reports the committed remap rather than spending again.
- Scoring refuses to write a score calculated for opponents that changed while it waited for the league lock.
- Defeated Whisperers lose active-role visibility. Hidden candidate order, target identities and inventories are excluded from the member role endpoint. Existing commissioner audit access remains restricted.
- Legacy non-NFL behavior is retained. Unsupported NFL extra powers and legacy defeat replacement cannot bypass the 2025 workflow.

## Verification and release

An additive `zombie_role_workflows` migration supports durable choices. It was applied only to disposable local PostgreSQL during implementation. Production needs the repository's guarded migration/release process; no bare production migration is authorized by this document.

The opt-in PostgreSQL suite exercises real locks, concurrent retries, item loot, mandatory two-serum revival, offer expiry, combat defaulting, succession budgets, complete remaps, and rollback after a late chat receipt failure. Only the post-remap scoring refresh is stubbed there; it is not provider accuracy evidence. Separate scorer tests cover stale opponent rejection and reading bonuses for the new pair. UI and API tests cover reviewed request retries, feedback, eligibility sealing, member/owner boundaries and private data redaction.

The hosted Zombie rehearsal runs the database suite and explicitly accepts the NFL fixture offer. Fixture consent is guarded to loopback databases and never assigns a production manager's role.

## Still required before calling the full product complete

1. Protected PR checks, guarded migration and deployment, followed by authenticated manager/commissioner verification on the live project.
2. Outcome-changing correction reconciliation for 2025 winnings, loot and completed combat choices. Current correction holds remain in place; automatic reapplication of every combat consequence is not certified.
3. Full-season payout/carryover and replacement-manager governance acceptance, including historical membership certification across renewals.
4. Sport-specific calibration and full acceptance for non-NFL Zombie variants. The 2025 PDF's combat model is certified here for NFL only.
5. A real-manager draft and complete provider-fed scoring week, plus physical iPhone portrait/landscape acceptance. Existing user drafts remain unstarted.
