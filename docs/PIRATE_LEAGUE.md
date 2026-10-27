# Pirate League

Pirate League is a native weekly head-to-head format for NFL, NBA, MLB, and NHL. It shares each sport's redraft roster, scoring, draft, regular-season schedule, and playoff configuration. The Pirate Deck adds protection locks and player claims. Commissioners set the protection count (default 3), winner selection time (default 24 hours), claim response time (default 24 hours), roster overflow grace (default 24 hours), and whether claims continue in the playoffs.

## Weekly rules

1. Before the first game of a scoring period, a manager may protect up to the league limit from any roster slot, including bench and IR. Fewer locks remain valid; unused slots expire at the first game. There is no automatic carryover to the next period.
2. The first scheduled game locks that period's declarations. Submitting more than the limit, or attempting to change a declaration after the lock, voids all its protections for that period. Repeating an identical saved declaration after lock leaves it unchanged.
3. Once games begin, player trades must exchange protected players from both teams. The guard runs when a trade is proposed and again before settlement.
4. A final, non-tied head-to-head matchup gives its winner one claim against the loser. The winner selects one unprotected player and may optionally offer one of their own players in return.
5. The winner selects within 24 hours of claim creation. An unselected claim moves to commissioner review after the deadline. The loser may accept or counter with a requested return player. The winner may accept or decline the counter. The winner's claim remains valid if a counter is declined or unanswered. An unresolved selected claim transfers automatically 24 hours after selection by the score-sync job.
6. Claims do not run in playoffs unless the commissioner enables them. A tie does not create a claim.

The claim is recorded and the roster change is applied transactionally to the native redraft roster and its legacy roster mirror. A five-second visual celebrates completed claims. If the game schedule or season is missing, the protection edit path refuses to guess a lock time.

Commissioners can select for an overdue winner, void a disputed open claim with a reason, retry an overdue transfer, or reverse a completed steal after a finalized score correction changes the winner. Reversal checks that the stolen and exchanged players remain on the expected rosters, moves them back transactionally, records the commissioner and reason on the claim and transaction ledger, and creates a claim for the corrected winner. A roster conflict requires manual resolution.

A one-way steal can put the winner over the roster limit. The manager has a 24-hour grace period by default to choose a drop. The Pirate Deck shows the deadline, ordinary acquisitions are blocked while the roster is full, and a reminder is sent if overflow remains after grace. The system never picks a drop.

Push and in-app reminders use the durable notification outbox before protection lock, when a claim is created or selected, and two hours before a response deadline. The relay rechecks claim state before delivery so a settled claim does not produce a stale reminder.

## Further league ideas

- **Anti-collusion rule:** record a snapshot of the losing roster and locked protection set at kickoff. This makes later drops, trades, and disputes easier to adjudicate.
- **Season balance:** consider a limit on how many times one team can be raided, or a temporary shield after a loss, to keep rebuilding teams engaged.

The default preserves the winner's right to a selected unprotected player without automatically choosing a player for an expired selection or cutting an overflow player.

## Staging validation and next release steps

The four Pirate migrations were applied to the verified separate staging database. `scripts/test-pirate-staging-lifecycle.ts` creates isolated NFL, NBA, MLB, and NHL fixtures and exercises protection locks, final matchups, counteroffers, unanswered transfers, overflow, repeated score correction reversals, selection expiry, playoff claims, and playoff score correction recovery. Results are in `docs/pirate-validation/staging-lifecycle.json`.

`scripts/test-pirate-mobile-component.cjs` checks the real Pirate Deck component at Pixel 7 and iPhone 13 viewport sizes with Playwright Chromium. Both passed touch interaction and horizontal overflow checks. An iPhone 13 WebKit viewport run also passed. Screenshots and measurements are in `docs/pirate-validation/`. These are browser emulations; physical Android and iOS devices have not been tested.

Before a production migration, run the full staging web app on physical Android and iOS devices and verify real push delivery. The commissioner confirmed the 24-hour winner selection and 24-hour overflow grace defaults.

The current production preflight, remaining gates, and ordered release steps are recorded in `docs/pirate-validation/release-readiness.md`.
