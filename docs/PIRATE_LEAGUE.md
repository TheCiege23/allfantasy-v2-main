# Pirate League

Pirate League is a native weekly head-to-head format for NFL, NBA, MLB, and NHL. It shares each sport's redraft roster, scoring, draft, regular-season schedule, and playoff configuration. The Pirate Deck adds protection locks and player claims. Commissioners set the protection count (default 3), winner selection time (default 24 hours), claim response time (default 24 hours), roster overflow grace (default 24 hours), and whether claims continue in the playoffs.

## Weekly rules

1. Before the first game of a scoring period, a manager may protect up to the league limit from any roster slot, including bench and IR. Fewer locks remain valid; unused slots expire at the first game. There is no automatic carryover to the next period.
2. The first scheduled game locks that period's declarations. Submitting more than the limit, or attempting to change a declaration after the lock, voids all its protections for that period. Repeating an identical saved declaration after lock leaves it unchanged.
3. Once games begin, player trades must exchange protected players from both teams. The guard runs when a trade is proposed and again before settlement.
4. A final, non-tied head-to-head matchup gives its winner one claim against the loser. The winner selects one unprotected player and may optionally offer one of their own players in return.
5. The winner selects within 24 hours of claim creation. An unselected claim moves to commissioner review after the deadline. The loser may accept or counter with a requested return player. The winner may accept or decline the counter. The winner's claim remains valid if a counter is declined or unanswered. An unresolved selected claim transfers automatically 24 hours after selection by the score-sync job.
6. Claims do not run in playoffs unless the commissioner enables them. A tie does not create a claim.

### Legal-lineup protection rule

A losing manager forfeits every protection for that scoring period if they leave a required starting slot empty or start a player who is out, on IR, or otherwise inactive **and could have fielded a legal active player**. An eligible active replacement on the bench or available to add from waivers before the relevant lineup lock means the manager had a way to fix the lineup. If no such replacement existed on either the roster or waivers, the protections remain in force. For NFL, evaluate each required starting slot against the player's game-week availability and the slot's lock; the equivalent sport-specific lineup lock applies to NBA, MLB, and NHL. Missing injury, schedule, or historical waiver evidence must not automatically void protections; surface the case for commissioner review with the evidence and a recorded reason.

The Pirate claim engine now enforces a commissioner ruling on open claims. The commissioner sees current roster flags, checks the actual lineup and available replacements at the relevant lock, and records a reason for either forfeiting or keeping protections. A forfeiture voids the losing roster's protected set for that period while retaining the original player IDs so an excused ruling can restore them. Every ruling is recorded in the redraft transaction ledger and shown on the claim board. Other void reasons, such as a late lock change, are never cleared by an excused lineup ruling. If a player was already selected and becomes protected again, the open claim returns to winner selection with a fresh selection window. A claim that is processing or transferred needs separate commissioner resolution.

The shared evaluator checks every required starter slot and uses distinct-player matching to determine whether a complete legal lineup could have been fielded. Locked starters occupy their exact slots, including inactive starters who cannot be removed after their game starts. It supports NFL, NBA, MLB, and NHL and counts waiver players only when an add before that player's lineup lock is certified.

The scheduled score-sync now captures immutable snapshots on both sides of each lineup lock, within seven minutes of the game start. This pass runs before the slower automation bridges and includes every active native Pirate season, independently of the rotating scoring batch. The existing redraft transaction ledger stores the roster, exact saved starter positions, injury reports and ingestion freshness, team game starts, roster settings fingerprint, waiver state, and verified pickup candidates. Deterministic record IDs prevent duplicate snapshots on repeated or concurrent ticks; no database migration is needed.

Injury ingestion writes a separate `lineup-evidence` provider marker only when every configured provider answered without errors and returned statuses were parsed. Capture requires a successful marker within 30 minutes and no newer failed check. The existing general injury freshness marker does not certify automatic penalties; a partial feed can remain useful for player news while leaving protection rulings for review.

Each injury claim also follows the existing sport-specific report-age policy; re-fetching an old OUT report does not make it current. Season-scale designations such as IR remain relevant while reported. Primary-position mismatches and extra-starter findings require commissioner verification, including secondary-position eligibility, rather than certifying an automatic penalty from incomplete position data.

Automatic forfeiture applies only after a final losing matchup and complete evidence. A weekly lineup can qualify when an inactive starter was frozen at its game lock, or an empty slot remained at the last recorded lock. The final saved lineup must still confirm the captured violation. Full active replacements must exist for every required starter; players whose own games start later require an activity snapshot at their own game lock. A commissioner ruling for the roster and period takes precedence across repeated ticks and replacement claims after score corrections. Each automatic ruling records its evidence IDs and preserves the original protected player IDs for commissioner restoration.

Waiver proof currently supports **one immediate pickup requiring no drop**, enough by itself to complete the legal lineup. A bounded candidate search checks the same lifecycle, commissioner locks, roster legality, waiver schedule, dropped-player holds, pending claims, and transaction eligibility used by the actual add/drop path. A claim that must compete through waivers is not a guaranteed acquisition. A candidate must remain available across the lock and have known game-time activity. An incomplete pool never automatically proves that no replacement existed.

Missing snapshots, stale or failed injury ingestion, unresolved identities, changed roster/settings evidence, commissioner roster locks, emergency unlocks, reserve/taxi activations, pickups requiring drops, several combined pickups, and opt-in daily lineup cases remain commissioner reviews. Protections remain in effect while these cases are unresolved. The Pirate Deck shows captured evidence and automatic rulings; when no captured evidence exists, current roster flags remain explicitly provisional. Daily-mode snapshots are recorded for NBA, MLB, and NHL, but automatic daily rulings remain off pending validation of scoring-day exceptions and off-day lineup semantics.

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

`scripts/test-pirate-lineup-staging.ts` exercises synthetic lock snapshots through real automatic claim rulings on the verified separate staging database for all four sports. It checks forfeiture, unchanged locks when evidence is missing, evidence-linked audit records, commissioner restoration, reopened selection, and repeated-tick precedence. The runner removes only the fixture leagues, users, and schedule rows it creates. Its report is `docs/pirate-validation/lineup-evidence-staging.json`.
