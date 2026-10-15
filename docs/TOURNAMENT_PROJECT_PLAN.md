# Tournament project plan

Updated: 2026-10-15. Owner: tournament product / engineering. Target: first playable 64-entrant NBA pilot, then NFL. This file is the working tracker; update status and evidence after each implementation batch.

Status legend: Complete = implemented and locally verified; In progress = some acceptance criteria remain; Pending = not implemented for this tournament format. Production deployment is tracked separately.

## Agreed playing format

NFL and NBA; 64–192 entrants in multiples of four. Recommended pilot: 64 entrants, eight opening leagues, 32 survivors in four second-stage leagues, sixteen finalists in two final draft leagues. Two half-field cuts, three drafts, then one cross-league weekly bracket. Final leagues have separate player pools. No final-stage roster releases. Guillotine is a later format.

## Build sequence and completion gates

| Order | Work package | Status | Completion gate / dependencies |
|---|---|---|---|
| 0 | Planner and commissioner access | Complete locally | Saved editable plans, owner-managed co-commissioners/reviewers, stale-save protection, league/seed previews. Existing 149-test baseline. |
| 1 | Playing rules and verified calendar | Implemented locally; real pilot verification pending | Exact scoring snapshot; positional roster; lineup locks; NBA counted starts; waivers/trade deadlines; dated periods/drafts; correction and postponement policy; validate actual game coverage; publish immutable version before invites. |
| 2 | Registration | Implemented; 64-entry isolated Postgres happy path verified | Depends on 1. Use the frozen publication as the accepted version; one tournament invite; unique entrants; capacity enforcement under concurrency; waitlist, withdrawal and owner participant controls; full-field launch gate. Concurrent admission and mobile join still need staging certification. |
| 3 | Opening leagues and drafts | Eight native leagues and one released/completed 96-pick draft verified on isolated Postgres; live friend pilot pending | Depends on 2. Provision only stage-one native leagues and real drafts; same rules everywhere; deterministic assignments; idempotent retries/reconciliation; draft readiness, autodraft and failure recovery. |
| 4 | Live scores and seeding | In progress: pure engine only | Depends on 3. Persistent versioned scores; provider/lineup integration; enforce counted starts; missing vs zero; finalization; global board, cut line, weekly movement and correction history. |
| 5 | Qualifier cuts and redrafts | Pending | Depends on 4. Audited tie resolution; preview qualifiers; atomically commit cut once; halve entrants/leagues; provision/reseed/redraft; archive prior-stage rosters; recover interrupted jobs. |
| 6 | Championship bracket | Pending | Depends on 5. Persist cross-league matchups and byes; identical windows; weekly winners, ties and score locks; eliminated rosters locked; exactly one champion. |
| 7 | Commissioner operations and engagement | Pending beyond planning controls | Add live staff permissions alongside each operation, then operational checklist, failed-job alerts, announcements, opt-in reminders, seed cards and champion recap. |
| 8 | Artwork, mobile and release | In progress: supplied identity artwork and responsive component checks implemented | Integrate supplied images; participant views; keyboard/screen-reader checks; desktop, iOS Safari and Android Chrome; complete season simulations and staging pilot before release. |

## Current work: package 3 runtime and supplied artwork

- [x] Backward-compatible optional playing contract on existing plans.
- [x] Copy canonical AllFantasy scoring weights into saved plan revisions; expose custom weights.
- [x] Positional starter, bench and additional IR settings; check drafted roster totals.
- [x] Lineup lock, NBA game cap and duration adjustment choices.
- [x] Waiver system, per-stage FAAB budget, processing hour and dropped-player hold.
- [x] Qualifier trade review/deadline settings; final stage trading prohibited by the contract policy.
- [x] Correction window, actual-start postponement policy and audited unresolved-tie policy.
- [x] Dated scoring/draft windows with explicit UTC entry and display timezone.
- [x] Rules readiness checks: every period/draft, overlap, season bounds, correction time, redraft timing, bracket predecessor finalization, supported stats and roster positions.
- [x] Clear schedule-review acknowledgement when dates or cut timing change.
- [x] Server-side fresh Rolling Insights NBA/NFL schedule verification, per-period game assignments, explicit gap-game review, malformed/partial feed guards and game-duration headroom.
- [ ] Run a selected pilot calendar against the deployed provider feed; local fixtures do not certify a real tournament calendar.
- [x] Readable saved scoring/draft schedule in the configured display timezone.
- [ ] Add calendar generation/import to reduce manual date entry.
- [x] Freeze explicit IR eligibility, ineligible-IR add restrictions, zero-dollar FAAB choice, rolling waiver priority/ties and per-draft resets.
- [x] Freeze draft clocks, initial audited shuffle, later seed order, autodraft policy, auction budget/minimum bid/nomination clock/bid extension.
- [ ] Enforce these contracts in the native league/draft/waiver adapters (package 3 and scoring integration).
- [x] Owner-only immutable rule publication with source revision, canonical SHA-256 hash, provider evidence, explicit exception acceptance, atomic state transition, retry recovery and read-only published view.
- [x] Isolate planning/published shells from legacy setup, commissioner operations, settings, conference mutation and automation.
- [x] Bind each registration acceptance to the published revision and hash in the same membership transaction.

The rules editor is inside the existing Commissioner Hub tournament planner and uses existing authenticated save/edit permissions and revision audits. Incomplete contracts remain saveable drafts; no invitation or execution gate is bypassed. Readiness assesses configuration, not operational launch readiness.

## Validation and release evidence

- Baseline: 149 tournament tests and scoped TypeScript passed before this batch.
- Previous batch: 183 tests passed across nine files.
- Calendar/publication batch: 251 tests passed across 15 files; scoped TypeScript passed, including the new verification/publication modules and legacy-write guards. Coverage includes fresh-provider failures, evidence hashes, 1200/1230-game NBA slates, gap acknowledgements, stale edits, transactional publication, retries, published reads and legacy isolation.
- Registration batch: 286 tests passed across 18 files; expanded scoped TypeScript passed, including registration services, API, hub and entrant page. Capacity, queue, rollback and CAS retry tests use isolated transaction simulations; real Postgres staging verification remains pending.
- Opening-field batch: 332 tests passed across 19 files; scoped TypeScript passed. Coverage includes all 33 supported field sizes, exact consent, duplicate prevention, concurrent freeze/withdrawal, rollback, after-start retry recovery, API identity and commissioner controls. Real Postgres and browser/device certification remain pending.
- Native setup batch: broader suite passed 362 tests across 24 files. Final native setup check passed 19 tests, including the additional tenant-binding case. Expanded scoped TypeScript passed with native setup, lifecycle guards, draft service and repository type declarations included. The league-creation ratchet passed. These checks use isolated transaction simulations, not a live database.
- Draft policy batch: 386 tests passed across 27 files, including native runtime/readiness, NFL/NBA policy simulations, owner route/UI diagnostics, legacy isolation and ordinary queue/autopick regression checks. Expanded scoped TypeScript passed. Native service tests use isolated records and locks, not real Postgres contention.
- No production migrations, live leagues, drafts or deployments have been performed.
- Whole-repository compilation and physical-device certification remain outstanding; focused checks do not establish them.

## Research and decisions

Current research checked 2026-10-12:

- NBA official season schedule: https://www.nba.com/news/2026-27-nba-regular-season-schedule . Dates must be mapped to actual games before activation.
- Sleeper basketball scoring settings: https://support.sleeper.com/en/articles/4645009-what-scoring-settings-are-available . Publish exact weights because point/category choices materially change player values.
- Sleeper Lock-In mode: https://support.sleeper.com/en/articles/6522833-lock-in-mode-details . Its one-game approach illustrates how materially counted-game policies differ; AllFantasy's current proposed cap is a distinct configurable policy and needs pilot feedback.

See [technical buildout](TOURNAMENT_LEAGUES_BUILDOUT.md) for architecture, prior research and format arithmetic. NBA pilot dates remain unverified until actual game coverage is checked. No calendar has been silently approved or invented for existing plans.

## Next implementation handoff

Next: finish safe player-catalog refresh/recovery through long-running snake and auction drafts, then verify timer/control races and all native mutation boundaries. Auction expiry, full-nominator skipping, automatic minimum-bid nominations and version-guarded bid/nomination/settlement paths now have isolated service checks. Complete full NFL/NBA service-path draft simulations and actual Postgres contention testing before adding the server-verified readiness transition. Live NBA counted starts, lineup locks, IR eligibility, trade deadlines and provider/correction integration remain package 4 prerequisites. Keep draft launch and waiver automation blocked. Continue scoring persistence in package 4, cut/redraft execution in package 5, and participant/mobile release checks in package 8.


## Completed batch: calendar verification and frozen publication

The commissioner checks saved rules against a fresh provider slate, reviews per-period games and excluded gap games, and explicitly accepts pending NBA Cup-dependent games when present. Publication rechecks the provider and binds the reviewed evidence digest to the exact saved configuration. The transaction rejects concurrent revisions and freezes the shell as rules_published. Repeated requests recover the same publication; no invites or live setup are enabled.

NBA completeness is reported as published-slate coverage: the official schedule initially defines 80 games per team, so 1200–1230 known regular-season games are accepted with an explicit pending-games notice. All known in-scope game times are required. NFL expects 272 games; unknown flex times far outside the tournament window do not block an earlier final. These count guards are plausibility checks, not independent proof that a provider has the right teams. Future scoring gates must recheck late additions, postponements and Cup classification.

Research: [NBA initial schedule](https://pr.nba.com/2026-27-nba-regular-season-schedule), [NBA Cup regular-season classification](https://www.nba.com/news/nba-cup-frequently-asked-questions), [NFL 272-game schedule](https://amp.nfl.com/news/2026-nfl-schedule-release-how-do-travel-rest-prime-time-and-outdoor-games-impact-teams).

No real pilot calendar was supplied or published during development. Production database state and provider caches were not changed. Actual-game verification runs when an authorized editor uses the new saved-calendar check.


## Completed batch: registration and entrant management

- [x] Owner controls in the saved tournament hub: open/reopen registration, replace invite, pause new joins, set a deadline and bounded waitlist capacity, refresh the roster, remove with reason and restore eligibility.
- [x] Cryptographically random invite link; only SHA-256 token hashes persist. Deadline and pause/rotation invalidate admissions through the old link. No invitations or messages are sent automatically.
- [x] Authenticated entrant page with human-readable frozen rules, exact weights, rosters, IR/waiver/draft policies, scoring windows and publication-time schedule exceptions.
- [x] Explicit rule-version acceptance; one persistent membership per tournament/account, preserving acceptance history across withdrawal and rejoin.
- [x] Registered field capped at the published capacity. A full field admits to the bounded waitlist; a disabled/full waitlist rejects admission.
- [x] First-in waitlist order; withdrawal rejoin goes to the back; withdrawals/removals promote eligible accepted entrants atomically before the deadline.
- [x] Owner-only removals/restoration. Restoration does not allocate a seat: the user must rejoin with an active invite and accept again.
- [x] Shell compare-and-set lock shared with other planning/staff writes; bounded retries re-read capacity after contention. Count updates preserve the lock timestamp. Acceptance, membership and counts commit or roll back together.
- [x] Joining, withdrawals and owner changes respect the deadline/opening draft. Pausing joins permits withdrawals and queue advancement until the deadline.
- [x] Existing members can view their own entry without the invitation token, even after rotation; joined entries appear in Tournament Hub. Owner boards omit invite secrets and exclude access by outsiders.
- [x] Legacy registration deletion cannot bypass the new admission/counter controls.
- [ ] Exercise competing joins, rollback, removals and deadline boundaries against real Postgres in isolated staging fixtures. Unit transaction simulation and CAS tests do not certify production concurrency.
- [ ] Add explicit delegated registration-management permissions for co-commissioners with the operational permission work; planning edit permission alone does not grant entrant removal/invite control.

Registration keeps the shell in rules_published so legacy live setup and automation stay blocked. It reserves tournament places only: no native leagues, drafts, lineups or live scores are created by joining. No new database schema is required; registration control, acceptance and audit history use TournamentAuditLog, with membership and its unique tournament/account key in TournamentParticipant.

Older published snapshots that lack draft/transaction policies remain unchanged and cannot open registration. They require a new complete plan; the system never silently appends terms to an accepted frozen version.

Research checked 2026-10-12: [Sleeper shareable league invites](https://support.sleeper.com/en/articles/3995033-how-do-i-invite-friends-to-join-my-league), [IR eligibility settings](https://support.sleeper.com/en/articles/1983643-how-does-injured-reserve-ir-work), and [NFL full-field draft requirement](https://support.nfl.com/hc/en-us/articles/35869704025108-Filling-a-League). The AllFantasy flow adds one tournament-wide link and explicit cross-league rule acceptance. The commissioner copies/shares the link; no third-party communications are sent by the implementation.


## Completed batch: opening field freeze and assignment checkpoint

- [x] Owner-only freeze command in the tournament registration panel, with an explicit full-roster review acknowledgement.
- [x] Require exactly the published number of registered entrants, complete frozen draft/transaction policies, and matching latest acceptance of both publication ID and rule hash for every entrant.
- [x] Exclude waitlisted, withdrawn and removed entrants. The organizer receives no automatic participant place.
- [x] Take the same shell compare-and-set transaction lock as registration. Freezing and membership changes cannot both change the field under that lock.
- [x] Cryptographic Fisher–Yates shuffle recorded once; balanced league assignments use the existing layout, names and divisions. Each pool records draft slots and reverse-draft waiver priority.
- [x] Persist the full published config, rule binding, participant identity snapshot, algorithm identifier and SHA-256 manifest hash in one audit event. Failed persistence rolls back; repeated/concurrent freezes recover the original event without reshuffling, including retries after the draft start.
- [x] Freeze guards all registration mutations, including invite rotation, withdrawal, owner removal and restoration. Existing members retain read access; entrant actions show the lock.
- [x] Owner view displays the frozen league assignments and manifest hash. This is an assignment checkpoint, not a live draft readiness certification.
- [ ] Native league, roster, waiver and draft creation; job execution/reconciliation; enforce frozen contract across native mutation APIs.
- [ ] Real Postgres contention verification, provider readiness, complete NBA/NFL draft simulations and physical-device checks.

The shell remains rules_published with a separate immutable freeze event, preserving existing legacy-operation isolation and published hub access. No schema change, database write, migration, deployment or live tournament freeze was performed during development. The new UI explains that locking cannot be undone in this workflow; support for an audited pre-provisioning reset is not implemented.


## Completed batch: native opening setup and resumable provisioning

- [x] Owner hub command creates or resumes all opening leagues using one transaction/request per league, with progress and a manual refresh. The browser can be closed or reloaded; later requests resume committed checkpoints.
- [x] Stable IDs derived from the freeze ID and resource key; no repeat shuffle. Per-league native records and the success checkpoint commit atomically under the shared shell CAS lock. CAS/serialization conflicts retry at most three times.
- [x] Native League, TournamentRound/TournamentLeague, Roster, LeagueTeam, filled LeagueEntrySlot, RedraftLeagueMember and TournamentLeagueParticipant records. The organizer has commissioner access without a team unless registered in that pool.
- [x] Native persisted sport-specific positional roster settings, full accepted contract and exact scoring overrides. Omitted scoring weights receive explicit zero overrides instead of inheriting defaults.
- [x] Native draft settings and DraftSession with accepted type, roster rounds, slot order, clock, sport and auction budget. Order is locked; autostart is disabled; draft status remains tournament_setup_blocked.
- [x] Waiver settings, per-roster FAAB/priority, shared state snapshot and a processing lock. Map native hold-time/minimum-bid/zero-bid keys; preserve complete transaction policy for subsequent runtime enforcement.
- [x] Canonical SHA-256 manifest hashing independent of database JSON object-key order. Existing unversioned manifests are refused for provisioning, rather than silently replacing their hash; no real manifests were created during these development batches.
- [x] Server deployment tenant resolution, branded ActorContext and the existing withTenant boundary. New League writes live in lib/domain and carry actor.tenantId explicitly. Missing server tenant is an actionable refusal; no guessed tenant. All pools must match the tenant of the first committed setup checkpoint.
- [x] Failed units roll back, leave prior leagues intact and save a safe retry-needed checkpoint where possible. Raw database errors are excluded from audit/UI output.
- [x] Retry reconciliation checks native frozen settings, draft order/clocks, scoring, waiver policy/balances/priorities, rosters, seats, team owners, memberships and tournament bindings. Drift is blocked for review; existing records are not overwritten.
- [x] Lifecycle mutation gates and the shared commissioner-settings helper block these tournament leagues, including commissioner overrides. Direct draft start independently blocks the tournament marker even if a session is reset to pre_draft.
- [ ] Complete the inventory of native mutation APIs that bypass shared helpers, and enforce the accepted contract at every relevant write boundary before release.
- [ ] NFL/NBA pool checks, snake and auction runtime/autodraft enforcement, readiness transition and complete draft simulations.
- [ ] Live scoring/lineup/cap/IR/trade/correction integration and actual-provider checks. Native rows and persisted terms do not certify operational enforcement.
- [ ] Staging verification with the deployed restricted database role, configured COMMISH_TENANT_ID and real Postgres competing requests. No production database writes, migrations or deployments were performed.

Setup status is derived from durable frozen manifests plus success/failure audit checkpoints. There is no background worker or scheduled retry yet; an owner request resumes pending units. All native leagues remain locked in setup, with waiver processing and draft launch disabled. Co-commissioner live operational delegation remains package 7 work; existing planning permissions are preserved.


## Completed batch: draft policy adapters and player-pool diagnostics

- [x] Frozen NFL/NBA starter and bench legality with maximum matching for overlapping NBA/FLEX positions. Additional IR slots do not extend the draft. Manual picks require a unique checked catalog ID and matching name, position and team.
- [x] Tournament snake timeout selection uses the highest-ranked available legal player; rejects off-clock roster requests and frozen slot-order drift. Bypasses personal queues and AI picks for the published best-available policy. Ordinary league behavior retains its existing path.
- [x] Auction adapters use the frozen budget, minimum bid and nomination clock; accept whole-dollar bids, reserve funds for remaining slots, validate bidder/winner roster legality and extend late bids without shortening an early bid clock.
- [x] Owner hub player-pool diagnostics assess unique identities, sport positions, ranked coverage and enough eligible players for every league roster slot. Missing NBA ranking coverage is a blocker, not a silent alphabetical fallback certification.
- [x] Catalog refresh runs outside draft locks. Runtime validation reads a versioned, frozen-manifest-bound audit snapshot with a five-minute expiry. Missing, failed or expired snapshots block tournament picks. Pool checks never unlock drafts or waiver processing.
- [x] Pure full snake simulations cover eight-team NFL and NBA pools. Native bridge, timeout selection, snapshot expiry, owner/API controls, UI diagnostics and auction clock adapters have isolated service tests. These are not complete live draft or season simulations.
- [ ] Finish timer/auction automation: expired bids, no-bid handling, full-nominator skipping, recovery and atomic competing requests.
- [ ] Add safe catalog refresh throughout live drafts, request timeout/retry handling for large fields, and snapshot retention/cache management.
- [ ] Complete mutation-boundary inventory, verified readiness transition, live scoring/lineup/cap/IR/trade enforcement and provider-backed staging pilot.

Draft launch remains blocked. Diagnostics certify catalog shape and positional/ranking coverage only; they do not certify fresh injuries, custom-scoring rankings or provider scoring readiness. No real database changes or live drafts were performed during this batch.

Additional draft regression verification: 86 tests passed across five existing pick/expired-timeout/overnight/hardening test files. Combined with the tournament run, 472 distinct tests passed across 32 files.


## Completed batch: supplied identity artwork and auction expiry hardening

- [x] Inspected all five user-supplied archives as reference material. The proposed 240-team division/wildcard format and specialty rules are separate future product work; the agreed 64–192 entrant points race is unchanged. No archive generators or mockup scripts ran.
- [x] Imported 168 division identity SVGs, 50 Black & Gold SVGs and 50 specialty SVGs as original assets, retaining KB attribution. Production serves only artwork, with allowlisted palette/emblem IDs and app-rendered names. Mockup HTML and sample rosters remain development reference.
- [x] Twenty division presets, custom names, division palettes/emblems, per-league palettes/emblems, image picker and live crest preview in the existing authenticated tournament settings. Optional artwork is saved, published and frozen with the contract; old published hashes/configurations remain unchanged.
- [x] Matching tournament hub/entry headers, registration capacity bar, owner setup crests and native league-home identity. Black & Gold hero banners use the supplied assets. Other league formats retain their existing behavior. Specialty assets are staged for future format-specific integration.
- [x] Registered entrants receive only their own immutable frozen league assignment, draft slot and scheduled time. A local reveal toggle never reshuffles, writes registration state or exposes other entrants. Persisted reveal-seen markers/notifications remain future work.
- [x] Auction timeout nominates the highest-ranked checked legal player at the minimum bid; expired no-bid manual nominations return to the pool without charges. Full or insolvent rosters are skipped. Expired bids and early forced sales are rejected for tournament drafts.
- [x] Optimistic version predicates protect tournament nominations/bids; transactional version claims protect settlement, including lock passthrough/expiry. Repeated initialization preserves budgets. Tests cover competing requests, one settlement/charge and insertion-failure rollback.
- [x] Browser component preview checked at 360px, 390px and 1440px with reduced motion: no page overflow, missing artwork or JavaScript errors. This is an actual component harness using fixture data, not a live authenticated tournament or physical iOS/Android certification.
- [ ] Safe catalog refresh/recovery across long-running drafts; timer pause/resume/control races; complete service-path NFL/NBA season simulations; native write-boundary inventory; verified readiness transition; actual Postgres/provider/device checks.

See [visual handoff integration](TOURNAMENT_VISUAL_HANDOFF.md) for asset mapping and deferred screens. Draft launch and waiver processing remain blocked. No live database writes, schema migrations or deployments occurred.

Verification for visuals/auction batch: the broader run passed 514 of 515 tests across 36 files; the only failure was a 30-second filesystem-scan timeout in the league-creation ratchet. Its isolated rerun passed all three tests in five seconds. Subsequent focused native checks passed all 32 tests, and registration/artwork checks passed 31 tests including the added assignment-privacy/tampering case. Across these runs, all 516 distinct tests passed. Final expanded scoped TypeScript passed. These results do not certify real Postgres contention or physical devices.

Final responsive containment check: all 23 existing planner/registration/setup component tests passed after constraining the planner grid and fieldset widths.


## Completed batch: long-running draft catalog refresh and recovery

- [x] Shared refresh preflight before manual picks, best-available selection, auction nominations/bids/settlement and auction automation. Provider work precedes draft mutation locks; validation inside those locks remains DB-only. Blocked setup sessions do not trigger provider work through engine preflights.
- [x] Five-minute verified snapshots, refreshed on demand during their final minute. A dedicated 45-second refresh lease coalesces concurrent requests and fails closed when unavailable. Provider waits stop after 15 seconds; late resolver results cannot persist or change draft state.
- [x] Durable 30-second failure backoff with safe diagnostics. Failed refresh attempts do not replace successful snapshots or extend their expiry. The last successful pool remains usable only until its original expiry; missing/expired pools block mutations until successful recovery.
- [x] Pin player IDs, names, positions, teams and catalog membership after the first successful check. Ranking changes can refresh; identity drift requires review and does not overwrite the verified pool. No automatic identity rebind/reset workflow is provided.
- [x] Owner-only recovery checks retain the frozen tournament binding and accept an optional opening-league key. Hub checks each created league in a separate request, reports progress, verification expiry and retry time, and preserves partial reports on request failure.
- [x] Existing setup/draft/waiver locks are retained; catalog success never grants launch readiness. No migrations, deployments or live database writes were performed.
- [ ] Snapshot storage retention/compaction and audited identity reconciliation before production release. Audit history is preserved; old payloads are not deleted in this batch.

Next ordered batches:
1. Draft timer pause/resume/reset and control races, including behavior while catalog recovery is blocked.
2. Complete native mutation-boundary inventory and service-path NFL/NBA draft simulations; certify the readiness transition only after required gates pass.
3. Live weekly scoring, lineup/NBA caps/IR/trade enforcement and correction handling, followed by standings, cuts/reseeding and subsequent drafts.
4. Real Postgres/provider staging pilot and physical iOS/Android checks before enabling tournament launch.

This recovery is request-driven, not a new scheduled worker. Ranking freshness and roster coverage do not certify injury feeds, custom-scoring projections or live season scoring. A provider identity change cannot be approved through the ordinary recovery button.

Verification for catalog recovery: the broader draft regression run passed all 138 tests across ten files. The final focused policy/native/API/UI run passed all 61 tests across four files, including two additional recovery integration cases. Across these runs, 150 distinct tests passed across eleven files. The scoped TypeScript check passed; no live provider, real Postgres contention or physical-device certification was performed.


## Completed batch: scoring/roster artwork, tournament extras previews and draft controls

- [x] Inspected tournament-extras-handoff.zip and scoring-roster-labels.zip as design references. Archive generators were excluded and never executed. Existing qualifier cuts, tiebreak order, dates and frozen contracts are preserved; wildcard/category formats and alternative redraft buffers were not adopted.
- [x] Imported 44 original allowlisted SVGs (12 scoring plates, 9 roster strips, 23 position chips); hash manifest saved in artifacts/tournament-visual-handoffs/rules-import-manifest.json. Original PNGs/screens/source remain reference files. KB attribution remains on tournament identity and champion previews.
- [x] Saved-rule scoring labels and responsive roster chips in tournament settings, hub preview and entrant rules. Edited weights show CUSTOM; roster presets match only exact sport, starter/bench/injured counts and total drafted slots. Existing 8-starter NBA defaults remain custom instead of being mislabeled as the supplied 10-starter Standard roster.
- [x] Explicit supported roster picker changes counts and total draft rounds together, normalizes SFLEX to SUPERFLEX and preserves other rules. Published settings remain protected by existing fieldset/server publication guards. IDP and category scoring are not enabled by importing their images. No scoringId/rosterId schema replacement or silent default migration.
- [x] Hub notification and champion-card previews adapt the supplied extras design to the current points race. They use the plan name/artwork and actual scheduled draft time; result fields remain explanatory placeholders. No delivery, opt-in, export, public trophy page or league-chat posting is represented as complete.
- [x] Native tournament pause/resume/reset controls use frozen clocks and transaction version/status/deadline predicates. Every accepted control writes its audit event in the same transaction; failures roll back. Bids and nomination state survive pause/resume, and both timer representations stay aligned.
- [x] Resuming an expired clock preserves zero; reset explicitly grants a full clock. Reset while paused stays paused. Pause does not need a catalog; resume refreshes outside the mutation lock and verifies a usable DB snapshot before changing status. Accepted tournament clock lengths cannot be edited through setTimerSeconds.
- [x] Tournament picks now claim session version/status/deadline inside their insertion transaction, rolling back if a concurrent control wins. Ordinary league behavior keeps its existing update path.
- [x] Responsive actual-component fixture preview at 360px, 390px and 1440px, including roster selection, notification/champion previews and reduced motion: no overflow, missing images or browser errors. Screenshots are development fixtures, not authenticated/device certification.
- [ ] Operational notification preferences/delivery/outbox, finalized-results champion PNG export/public trophy view and backend seeding/advancement controls. The alternative divisions/wildcard control board is reference only.
- [ ] Remaining direct native mutation APIs and automated timer paths (including overnight policies), full NFL/NBA service draft simulations, verified launch transition, audit/catalog retention and identity reconciliation.

Next: complete the native mutation and automated-timer boundary inventory and full draft simulations, then the guarded readiness transition. Follow with live scoring/lineups/caps/IR/trades, corrections, cuts/reseeding and later drafts. Operational extras must use finalized backend events and user channel preferences; the preview controls do not send messages. Draft launch and waivers remain locked. No live database changes, migrations or deployments were performed.

Verification for the visuals/control batch: 137 draft regression tests passed across six files; 58 planner/rules/publication/setup/label tests passed across five files; the initial focused run also passed the eight registration UI tests. The final native run passed all 50 tests including the additional bid-versus-pause case. Across the successful runs, 204 distinct tests passed across twelve files. An earlier run failed to start its Vitest workers (no tests ran); sequential retries passed. The scoped TypeScript check passed, and the actual-component browser harness passed at 360, 390 and 1440 pixels without overflow, missing images or JavaScript errors. These checks do not certify real Postgres contention, actual providers or physical devices.


## Completed batch: generic draft mutation boundaries

- [x] Added marker-presence guards to generic draft undo/reset/swap/trade/edit/next-draft services, including force/allowCompleted and manually changed statuses. Malformed native markers fail closed.
- [x] Disabled generic native overnight/slow automation, slot-order reconstruction and missing-session creation. Tournament clock controls retain their dedicated audited path.
- [x] Protected eleven direct draft handlers covering order, keepers, devy/C2C, settings, lotteries and empty-slot filling after authentication. Read access remains available.
- [x] Prevented generic completion/artifact repair from activating an ordinary season. Native auction last sales await a tournament-specific completion checkpoint.
- [x] Recorded reviewed boundaries and outstanding risks in [native mutation audit](TOURNAMENT_NATIVE_MUTATION_AUDIT.md).
- [ ] Full NFL/NBA service-path simulations and tournament-specific board completion; broader league/roster/trade mutation coverage and readiness certification remain next.

Next ordered work: implement and test the tournament board-completion checkpoint, run full NFL/NBA snake/auction simulations, finish the wider write-boundary audit, then certify readiness. Follow with weekly scoring/lineup enforcement, corrections, cuts/reseeding and later drafts. Draft launch and waiver processing remain locked.

Verification: 121 tests passed across six files (94 native setup/auction/control and ordinary next-draft/undo/pick-trade tests, plus 27 API/commissioner-edit tests). The final expanded scoped TypeScript check passed, including all eleven guarded handlers. Native fixture tests cover five session statuses, forced edits, allowCompleted resets, malformed markers, missing-session recovery refusal and last-auction-sale lock retention. Ordinary commissioner-edit timer expectations were aligned with the existing always-reset-on-removal behavior; that behavior was not changed. Earlier fork-worker runs stalled or timed out during startup and were stopped; the completed thread-worker reruns passed. These are fixture checks, not real Postgres/provider/device certification or full NFL/NBA season simulations.


## Completed batch: tournament draft-completion checkpoint

- [x] Added DB-only board validation against the frozen session, complete sequential pick numbering/ownership, unique checked identities, actual roster ownership and legal starter/bench assignment. NBA multiposition players use the tournament matching policy.
- [x] Auction receipts require positive whole-dollar charges, exact team budgets and reconciled remaining balances, with no unresolved nomination.
- [x] Completion status and versioned board-hash receipt commit atomically behind version/status/deadline predicates. Repeated completion checks verify the existing receipt and current board; manually completed sessions without receipts are refused.
- [x] Manual final picks, auction final sales and completion repair use the checkpoint. A committed sale/pick is preserved if checkpoint saving fails; retry never repeats the sale. Generic season activation and post-draft materialization remain blocked.
- [x] Manual tournament picks validate frozen session/order/clock, refuse commissioner-force/trade/specialty overrides and use the native roster matcher.
- [x] Final verification passed: 78 native fixture tests plus 88 ordinary draft regression tests across six files (166 distinct tests), and expanded scoped TypeScript. No readiness transition, schema change, live database write or deployment.

The receipt validates durable catalog identity rather than current rankings, so a board whose final pick committed against a checked pool can recover completion after catalog expiry. This does not extend snapshot validity for new picks or call providers inside the transaction.

Next: finish the wider league/roster/trade/auction mutation review and guarded readiness workflow; implement actual tournament roster materialization, weekly scoring/lineup/caps/IR/trade enforcement, then corrections, standings, cuts/reseeding and later drafts. Full tournament-season, real Postgres/provider and physical iOS/Android certification remain required before enabling launch.

Verification details: each NFL/NBA snake/auction combination drafted one complete opening league through the real pick or auction engine, with checked catalog recovery and pause/resume, then verified one completion receipt, exact roster sizes and retained league/waiver locks. Tamper tests reuse cloned completed fixtures; concurrency and rollback use the fixture transaction/CAS model, not real Postgres. Tests also cover forced/manual overrides, roster reassignment, clock/order drift, budget reconciliation, duplicate/invalid player identities and missing receipts. An initial worker failed before any tests started; the completed Node/thread rerun passed. The fixture run logged nonfatal analytics-model and local Redis-version warnings; analytics delivery and Redis certification are outside this simulation. Full multi-league tournament stages, live providers and physical devices remain unverified.


## Completed batch: commissioner draft review and main-based isolation

Workspace: C:/Users/Guap_/.codex/worktrees/tournament-readiness/allfantasy-v2-main, detached from origin/main at 4918a0d1f5d9530f4f09d38a46ca87540d3a5f0c. Earlier tournament-only work was carried forward with a three-way patch; newer main draft-history code was preserved. The shared F: source checkout was not edited. This worktree uses a node_modules junction to the existing dependencies; do not recursively delete through that junction. No PR, push, auto-merge, migration or production action was performed.

- [x] Read TOURNAMENT-BUILD-BRIEF.md and the tournament/control READMEs, and inspected TournamentControl.png. The new review panel follows its gold accents, checklists, status cards and existing identity artwork, with responsive phone layouts.
- [x] Owner-only bounded review_draft API checks one frozen opening league per request. Read-only assessment is shared with completion, verifies the current board/receipt/ownership/locks and returns counts and safe reasons without player identities, provider URLs or writes.
- [x] Commissioner hub shows waiting, running, paused, checkpoint-pending, verified and review-required states, partial progress, retryable errors and pending season gates. Reports cannot grant launch permission.
- [x] Retained main's per-selection and auction draft-history events. Native nomination/bid version claims and archive writes commit together; native completion records its history only after board validation.
- [x] Frozen-session checks at nomination, bid, settlement and auction initialization. Direct ordinary roster finalization and redraft-season materialization refuse native markers, including malformed markers.
- [x] API/UI/native fixture checks cover owner access, stale freezes, bounded requests, report privacy, pending checkpoints, failed verification, unchanged native locks and direct materialization refusal. Final ordinary draft-history regressions passed.
- [x] Actual-component browser preview at 360, 390 and 1440 pixels with reduced motion: no overflow, missing artwork or browser errors. Phone panel screenshot: artifacts/tournament-visual-preview/draft-review-390.png. Fixture preview only, not authenticated/device certification.
- [x] Direct scan of 431 changed/new text files found no matching credential-token patterns; the planted fake-token probe was detected and removed. See artifacts/tournament-secret-scan.json. This is a scoped pattern scan, not universal secret certification.

TypeScript limitation: the expanded tournament check reports 18 diagnostics in unchanged Decision OS world/trade files and the shared generated Prisma client (tradeAgentSuggestion missing). A separate baseline config targeting only those unchanged dependencies reproduces the same diagnostics; git confirms no edits to those files. No tournament-file diagnostics were reported. This check is not green, and these issues remain a staging/release gate.

## Design-brief crosswalk

| Brief phase | Current implementation and next work |
| --- | --- |
| 1 Setup/rules | Existing points-race planner, identity, labels and immutable publication are carried forward. Divisions/conferences, wildcard bids and fixed buffer-week defaults need a versioned setup path; never rewrite existing published/frozen contracts. |
| 2 Join/reveal | Existing authenticated registration, waitlist and private frozen reveal remain. New format-specific placement/preferences remain pending. |
| 3 Standings | Backend standings policy/fixtures exist; actual weekly score ingestion/finalization, caps and lineup enforcement remain next. Missing/provisional scores must block future commits. |
| 4 Cuts/redrafts | Draft infrastructure/completion/review now exist. Actual roster materialization, correction closure, cut commits, reseeding, later leagues/drafts and operational retries remain. |
| 5 Brackets | Separate final leagues and cross-league bracket remain agreed. Live bracket advancement and finalized-score commits remain pending. |
| 6 Extras | Existing notification/champion previews remain; actual channel preferences/delivery, PNG export and public trophy page remain pending. |

Next: complete remaining league/team/member/trade/settings/reset/import mutation protections and audited runtime activation/materialization, then implement weekly scoring, lineups, NBA caps/IR and trade enforcement. Readiness transitions must retain pending gates until real database/provider and iOS/Android staging checks pass. No later-format paths from PRs 2320/2321 were needed or assumed merged in this batch.

Final verification for this batch: all 164 distinct tests passed across ten files. The initial API/UI/native run passed 95 of 96; a serialized fixture transaction deadlocked the injected competing bid after native auction archive writes became transactional. The race test was corrected to commit the competing bid immediately before the control transaction, and its focused rerun plus both finalizer protections passed. All 68 selection/archive/budget/roster-finalization regressions then passed. Main archive behavior is preserved; real database contention remains unverified. Browser checks passed at 360/390/1440 with reduced motion, and the actual phone panel screenshot was visually inspected. Expanded TypeScript remains blocked by the 18 reproduced baseline Decision OS/generated-client diagnostics; it is not reported as passing. No deployment or auto-merge was armed.


## Completed batch: opening roster preparation and player-move guards (October 13)

- [x] Owner-only prepare_rosters command, bounded to one frozen opening league. Requires a verified completed board, current owner/freeze binding and intact native league/waiver locks. No generic season creation or activation.
- [x] Extended the existing bipartite roster matcher to return assignments. Complete NFL/NBA starters and bench are materialized deterministically from the checked draft identities; IR/taxi/devy remain empty. Existing team foundation, draft history, FAAB and waiver priority are preserved. These are legal initial lineups, not AI-optimized recommendations.
- [x] Session version claim, every roster's ownership/JSON predicate and roster-preparation audit receipt commit in one transaction. Partial roster writes or audit failure roll back. Repeat preparation verifies the board/roster hashes and does not overwrite existing assignments.
- [x] Commissioner review offers Prepare [league] rosters only after draft verification and shows prepared-but-locked status. Refresh validates persisted roster content against its receipt; drift becomes review-required.
- [x] Ordinary lineup service refuses tournament markers even with commissioner, import, system or skip-lock options. The roster-save route also checks the marker after access checks. Direct AF trade settlement refuses native tournament player/FAAB/pick moves inside its transaction.
- [x] Native draft-snapshot appends are disabled so a late append cannot overwrite prepared lineups. The authoritative native draft board remains the source until audited preparation. Ordinary league append behavior remains unchanged.
- [x] Verification: all 144 distinct tests passed across seven files: 101 native/API/UI tests, one additional real-service late-append test and 42 policy/lineup/trade/salary regressions. The first salary fixture run lacked the newly required league-marker read; after adding that fixture model, all 23 salary tests passed.
- [x] Actual-component preparation flow checked at 360px, 390px and 1440px with reduced motion: no page overflow, missing images or browser errors. Fixture preview only.

TypeScript: the corrected report types now produce no tournament-file diagnostics. The expanded check remains blocked by 18 unchanged Decision OS/shared generated-client diagnostics, reproduced by the prior baseline check. Earlier notes counted these as 19; the diagnostic-line tally is 18. No migration, deployment, live database write, PR or auto-merge was performed. Work remains in the attached C: tournament-readiness worktree.

Next ordered work: build the tournament scoring/lineup projection and weekly score finalization foundation, with missing/provisional scores blocked from commitments; finish NBA game caps, IR, trade enforcement and remaining league/team/member/import/reset mutation boundaries. Audited runtime activation requires those gates plus real Postgres/provider/device staging checks. Roster preparation does not enable the season, create RedraftSeason rows, start waivers or commit cuts.


## Completed batch: weekly scoring policy foundation (October 13)

- [x] Added seasonWeeklyProjection.ts, an internal pure projection over normalized trusted score evidence, prepared roster identity and per-game locked lineup snapshots. It performs no database writes and is not exposed as a client score-ingestion or finalization endpoint.
- [x] Exact sport/rules/roster binding and complete expected team set. Rejects duplicate games, players and lineups; late/unowned starters; out-of-period games; future observations; invalid dates; orphan scores and conflicting revisions.
- [x] Latest score revision wins, including a provisional correction replacing a previously final value. Integer precision preserves four-decimal points, real zero and negative scores. Bench results do not count. Incomplete coverage or missing counted results yields an unknown total plus a separate known subtotal.
- [x] NBA cap projection consumes eligible selected starts in actual-tipoff order, with deterministic game/player ID ordering at ties. Applies existing frozen short-week proration or same-cap policy; all-scheduled mode remains supported. This is projection policy, not live cap enforcement.
- [x] Finalization eligibility requires complete schedule coverage, every counted result final, server time past correction closure and a source reconciliation observed after closure. A final game score alone cannot finalize a tournament week. No inferred opponents or wins.
- [x] 102 tests passed across weekly projection, standings, rules and calendar files. Includes both sports, revisions, missing/provisional/zero results, no-game coverage, caps, lineup snapshots, invalid bindings and correction timing. No provider calls or database mutations were made.

Provider evidence limitation: contracts/rolling-insights/GAPS.md N-01 leaves correction webhook delivery undocumented. This batch uses an explicit normalized evidence contract and fixtures; it does not invent vendor finality or certify coverage. Trusted adapters must validate identity mapping, exact frozen scoring calculation, schedule coverage (including postponed/cancelled games), legal lineup slots and actual counted starts. Hash strings alone are not proof from an untrusted client. Do not expose this function to client-supplied score payloads. A canFinalize result is policy eligibility, not a persisted finalization receipt or permission to commit cuts.

Next ordered work: persist verified per-game lineup locks and the trusted normalized score ledger with server-generated rules/roster bindings, atomic revision/idempotency checks and post-correction reconciliation. Then build durable owner-reviewed week finalization, commissioner scoring status, and feed finalized records into standings. Runtime activation, live NBA cap/IR/trade enforcement, remaining write protections, cuts/redrafts/bracket advancement and real Postgres/provider/device certification remain pending. All existing launch and player-move locks stay in place.

TypeScript verification for this batch: the focused tournament-scoring.tsconfig.json check, including the new module and tests, passed. The expanded repository-dependent check was stopped after several minutes without diagnostics; it is not claimed as passing. The 18 previously reproduced Decision OS/generated-client baseline diagnostics remain unresolved. git diff --check passed.


## Completed batch: persisted opening lineup snapshots and score ledger (October 13)

- [x] Added internal seasonScoreLedger.ts persistence using existing tournament audit storage; no Prisma schema change or migration. Receipts are explicitly marked locked_setup. Services require a verified completed draft, intact native setup/waiver locks, current frozen manifest and matching prepared roster receipt. They refuse an activated shell.
- [x] Capture prepared starter choices with a server-generated lock timestamp before the frozen individual-game or period-start deadline. Canonical game IDs have immutable receipts. Backdated captures, duplicate/unmapped player identities and rebinding a captured game to another start time are refused. Schedule corrections need a later audited reconciliation flow; they are not silently applied.
- [x] Derive rules/roster hashes, rosters and lineups from verified database state. The internal ingest contract accepts only mapped score deltas, source observation/coverage and a request/expected-revision pair. It never accepts client-provided rules hashes, roster hashes or starter snapshots.
- [x] Score revision receipt and draft-session version claim share one short transaction. Deterministic receipt IDs, expected ledger revision and session CAS protect concurrent writes. Exact request retries do not append another receipt; reused IDs with different content, conflicting per-player revisions, changed sources and older observations are refused. Earlier results are retained when a correction batch contains only changed players.
- [x] Readback validates receipt digests, contiguous revision links and the persisted lineup set before rerunning weekly scoring policy. Missing/provisional results remain unfinalized. A newer provisional correction can regress eligibility even when the earlier result was final.
- [x] Bounded setup ledger: at most 250 game snapshots and 250 batch revisions per league/period; at most 10,000 historical score rows per period. Limit exhaustion fails closed. This audit-backed setup foundation needs storage/performance certification before live rollout.

This is internal locked-setup persistence, not an active feed, owner finalization command or production scheduler. No client score-ingestion endpoint was added. The trusted adapter still must prove schedule coverage and provider-to-draft identity mapping, calculate points with the frozen rules, confirm actual starts and reconcile corrections after closure. Captured start times cannot yet be updated for postponements. Initial prepared lineups remain immutable; live lineup changes/IR/trades are a separate gated runtime. Eligibility is not a persisted finalization receipt, and no standings, wins, cuts or bracket results are committed by these services.

Next ordered work: add durable owner-reviewed weekly finalization tied to the reviewed ledger revision, and commissioner scoring-status screens with safe counts, blockers and retry controls. Connect a trusted provider/scoring adapter and schedule/lock capture worker only after provider coverage, actual-game timing, correction reconciliation and remaining mutation boundaries are verified. Live launch, player moves, later drafts/cuts and bracket advancement remain locked.

Verification for the persisted-ledger batch: all 166 tests passed across native setup/draft/ledger, weekly projection, standings and native API files. Includes full NFL/NBA draft fixtures, capture/batch idempotency, correction deltas, missing scores, receipt drift, deleted revision history, late capture, failed audit rollback, lost session claims and competing batches. The ledger TypeScript check reports only the 18 previously reproduced Decision OS/generated-client baseline diagnostics and no tournament-file diagnostics; the overall check remains blocked. git diff --check passed. These are transactional service simulations with a mocked database, not real Postgres contention certification. No migration, live provider call, production database write, PR, push or deployment was performed. No GUI changed in this batch.


## Completed batch: owner-reviewed weekly finalization and commissioner scoring status (October 13)

- [x] Bounded owner-only reviewSeasonOpeningWeek and finalizeSeasonOpeningWeek commands. Ownership is checked before loading and again inside the transaction; frozen tournament/league/key binding is rechecked. Scores, starter identities and hashes are never accepted from the browser.
- [x] Safe review returns counts, state, correction deadline and an opaque ledger digest token. Missing scores remain unknown. No player, roster or game IDs leave the review boundary.
- [x] Finalization verifies the exact reviewed revision/digest, full persisted ledger/lineup integrity and current finalization eligibility. A finalization receipt and completed-session version claim commit atomically. Same-revision retries are idempotent; failed audits/lost claims roll back. Receipts preserve the owner actor and actual server timestamp.
- [x] Corrections append new score revisions and invalidate the prior review token. The earlier finalization stays in audit history, while the new revision requires another review/checkpoint. A setup finalization receipt does not authorize live standings, wins, cuts, reseeding or bracket advancement.
- [x] Added private, authenticated /api/tournament/season-scoring commands with strict review/finalize payloads, bounded league/week fields, safe errors and no-store responses. Ingest and launch commands are rejected.
- [x] Commissioner hub now includes weekly scoring review with frozen opening-week choices, league artwork, missing/provisional/ready/finalized status, correction deadlines, counts and per-league setup finalization. Partial checks are retained on errors. Changing weeks clears review tokens; a failed/ambiguous finalization removes the stale action and asks for another review.
- [x] Actual-component browser checks at 360px, 390px and 1440px passed with reduced motion and no overflow, missing images or page errors. Actual 390px scoring panel screenshot inspected: artifacts/tournament-visual-preview/scoring-review-390.png. Fixture preview only; no physical device or authenticated-production certification.

All receipts and controls explicitly remain locked_setup. Provider ingestion, actual game/postponement timing, live lineup/cap/IR/trade enforcement and remaining mutation boundaries are not enabled by this batch. No migration, production write, push, PR or deployment was performed.

Next ordered work: derive commissioner standings from current, verified finalized-week receipts; invalidate standings eligibility when corrections create an unfinalized revision and preserve missing-week visibility. Then connect trusted schedule/score adapters and correction reconciliation, complete remaining runtime boundaries and certify Postgres/provider/mobile staging before any activation or cut commits. Co-commissioner live delegation remains pending.

Final verification for owner weekly finalization: 165 distinct tests passed across six files (152 backend/API/projection tests, 12 scoring/native/draft-review UI tests and one added real-service missing/provisional finalization refusal). The expanded ledger/UI integration TypeScript check reports only the same 18 unresolved Decision OS/generated-client baseline diagnostics; no tournament-file diagnostics. Browser checks passed at 360/390/1440 with reduced motion and the actual phone scoring panel was visually inspected. git diff --check passed. Real Postgres contention and live provider/device certification remain unverified.


## Completed batch: finalized-week tournament standings (October 13)

- [x] Owner-only reviewSeasonOpeningStandings reads the entire frozen opening field in one read-only RepeatableRead transaction, with ownership/freeze/manifest checks inside the snapshot. Reuses verified draft/roster/ledger/finalization checks. Reads are bounded by frozen participant/league and opening-period counts, with a 15-second transaction timeout. Real Postgres isolation and worst-case query performance remain staging gates.
- [x] Every required league/week has an explicit finalized, missing, unfinalized or review-required state. Only a receipt matching the newest ledger revision and current projected totals contributes points. New corrections remove the prior week's total until re-finalized; other verified weeks remain available as known subtotals.
- [x] Full frozen field remains visible even for uncreated/unprepared leagues. No missing score is inferred as zero. Incomplete stage totals are unknown, known finalized subtotals are separate, and ranks/tie flags remain pending until every requested league/week is finalized. No official seed, cut, stage movement or bracket write occurs.
- [x] Aggregation preserves published tiebreaker order and stops before unsupported wins instead of inventing matchups or applying a later criterion past unknown wins. Output wins remain null. Win-based tiebreakers and audited tie resolution remain seeding gates; opening-stage previous seeds remain unavailable.
- [x] Added strict authenticated private /api/tournament/season-standings endpoint. Accepts tournament/freeze and through-week only; rejects client scores/forged actor fields. Reports contain team display names, league labels, points and safe week statuses, without roster/player IDs or score evidence.
- [x] Commissioner hub includes a responsive opening standings review: frozen through-week choice, finalized checkpoint coverage, missing-week details, safe totals/subtotals, pending ranks and eight-team pages. Changing the week or retrying clears the old board. No advancement controls are exposed.
- [x] Verification: 156 distinct tests passed across six files, including 109 native service fixtures, 13 finalized aggregation cases, 19 prior standings cases and 15 endpoint/UI/native-panel tests. The final aggregation rerun also passed after suppressing tie flags for incomplete data. Fixture tests exercise a full 64-entrant field with one prepared/scored league, correction invalidation/re-finalization, missing weeks, owner/freeze/stage refusals and receipt drift. They do not certify a fully scored multi-league season.
- [x] Browser checks at 360, 390 and 1440 pixels passed with reduced motion, no overflow, missing images or page errors. Phone screenshot inspected: artifacts/tournament-visual-preview/standings-review-390.png. Fixture preview only.

TypeScript integration check reports only the 18 previously reproduced Decision OS/shared generated-client diagnostics and no tournament-file diagnostics. It remains blocked overall. git diff --check passed. No schema migration, live provider call, production database write, PR, push or deployment was performed. Launch, player moves and advancement remain locked.

Next ordered work: add verified opening matchup outcomes for the frozen win-based tiebreakers, connect trusted schedule/scoring adapters with actual-start/postponement and correction reconciliation, then build audited seeding/cut previews from complete finalized stage evidence. Before activation, finish live lineup/cap/IR/trade and remaining mutation boundaries, query/storage certification and real Postgres/provider/iOS/Android staging. Live co-commissioner delegation remains pending.


## Completed batch: verified opening fantasy matchup outcomes (October 13)

- [x] Added seasonMatchupPolicy.ts: validates exact once-per-week pairings for every frozen roster, with no self-opponents, duplicates, foreign teams or byes. Outcomes use finalized four-decimal team totals; wins receive one credit, losses zero and exact ties one-half, consistent with the existing weekly-result credit contract. Original tied-seed resolution rules remain unchanged.
- [x] Internal captureSeasonOpeningMatchups records a verified native fantasy scheduler's explicit pairings before the scoring period starts. The service generates the timestamp, preserves source and frozen bindings, claims the session version and saves a deterministic receipt atomically. Identical retries are read-only; late/backdated captures and schedule rebinding are refused. No synthetic opponents are inferred from NFL/NBA game schedules, platform imports or generic round-robin scoring.
- [x] Owner weekly finalization derives matchup outcomes when a valid locked pairing receipt exists. Its current score checkpoint and outcomes commit atomically; outcome-save failure rolls back both. Repeated finalization is idempotent and can repair a missing outcome receipt against valid locked pairings. No pairing receipt means point finalization can still succeed while wins remain unknown.
- [x] Outcome receipts bind the current score revision, ledger digest, finalized score checkpoint and locked pairing digest. Score corrections invalidate the earlier outcomes until the new revision is finalized; then winners and tie credits are recomputed from current scores. Earlier audit records are preserved.
- [x] Standings verify current outcome receipts before using win credits. Incomplete matchup coverage stops published tiebreaker evaluation at wins. Complete verified coverage enables that criterion in its original order. Unknown wins/losses/ties remain null, with known verified win subtotals and explicit missing matchup periods. A drifted outcome excludes win credits without discarding independently valid finalized points.
- [x] Commissioner standings now show matchup checkpoint coverage, win credits/losses/ties and missing matchup weeks. No arbitrary result, pairing or win input was added to the public APIs. Seeding, advancement and launch remain locked.
- [x] Verification: 182 distinct tests passed across eight files: 114 native service cases, 15 finalized standings cases, 9 matchup-policy cases, 19 existing standings cases and 25 API/UI cases. Covers exact ties/zero/negative points, pairing identity, pre-start deadlines, atomic failure rollback, retries, correction winner changes, outcome drift, unknown wins and preserving tiebreaker order.
- [x] Actual-component browser checks at 360/390/1440 with reduced motion passed with no overflow, missing artwork or page errors. Phone screenshot: artifacts/tournament-visual-preview/standings-matchups-390.png. Fixture preview only, not physical-device certification.

TypeScript check reports only the same 18 unresolved Decision OS/shared generated-client diagnostics and no tournament-file diagnostics. The overall check is not green. git diff --check passed. This batch made no schema migration, real provider call, production database write, push, PR or deployment. Actual schedule provenance, live ingestion and database contention remain uncertified.

Next ordered work: commissioner matchup schedule preview/publication controls backed by the immutable pre-start pairing boundary, then trusted native schedule/score feed integration with identity mapping, actual-start/postponement and correction reconciliation. Complete finalized stage evidence will support audited seeding/cut previews. Live lineup/cap/IR/trade enforcement, remaining write boundaries, co-commissioner delegation and real Postgres/provider/iOS/Android staging remain release gates.


## Completed batch: commissioner matchup preview and publication (October 13)

- [x] Added a deterministic suggested native round-robin schedule anchored to frozen draft-slot order and the actual opening-stage start week. One matchup per team/week, every opponent appears once before repeating, and the next cycle reverses home/away orientation. Suggestions are not authoritative until explicitly published. Home/away does not affect fantasy scoring.
- [x] Owner-only previewSeasonOpeningMatchups and publishSeasonOpeningMatchups commands. Preview is read-only and projects entry display names, never roster/player/user IDs. Its token binds the frozen manifest, rules, prepared roster checkpoint, exact schedule and deadline. Publication rechecks owner/freeze/league binding and this token inside the transaction.
- [x] Uses the existing immutable pre-start matchup receipt, deterministic ID and session version claim; records the publishing owner actor. A second deadline check after the version claim rolls back requests that wait past kickoff. Exact retries remain idempotent even after the deadline; new late schedules and stale previews are refused.
- [x] Already-published schedules from an independent verified native scheduler are displayed as saved, with their actual pairings/source, rather than overwritten by the suggestion. A preview superseded by such a publication becomes stale.
- [x] Added strict private authenticated /api/tournament/season-matchups preview/publish commands. Browser payloads cannot provide opponents, source, actor, lock timestamp or scores. No imported/generic league scheduling behavior changed.
- [x] Commissioner hub controls select an opening league and week, show all suggested pairings, deadline in the frozen timezone and draft/published/closed state, then publish the exact preview. Changing either selection or an ambiguous publication error clears the old preview/token. This first version publishes one bounded league/week; custom opponent editing and bulk season publication remain future work.
- [x] Verification: 159 distinct tests passed across seven files: 119 native service cases, 15 matchup-policy cases, 9 matchup API cases and 16 UI/native/scoring/standings cases. Covers 2/4/6/8/12-team cycle coverage, stage-start offsets, no pre-cycle repeats, orientation reversal, stale previews, privacy, owner/freeze refusals, idempotent/competing publication, audit rollback and deadline crossing while waiting for the session claim.

Research reference: Sleeper's official schedule controls are available on web and mobile (https://support.sleeper.com/en/articles/1955931-can-i-randomize-my-league-s-schedule). That informed keeping preview/publication in the commissioner hub across screen sizes. AllFantasy's immutable reviewed publication token and pre-start deadline are this implementation's contract, not a claim about Sleeper behavior. Frozen tournament rules were not rewritten.

TypeScript integration check reports only the same 18 unresolved Decision OS/shared generated-client diagnostics and no tournament-file diagnostics; overall check remains blocked. No schema migration, provider call, production write, PR, push or deployment occurred. These controls publish setup-only fantasy pairings and do not activate scoring, player moves or advancement.

Next ordered work: trusted NFL/NBA player-stat scoring ingestion with exact frozen-rule mapping, verified draft/provider player identities, actual game-start timing, postponements and post-correction reconciliation. Then complete audited seeding/cut previews from fully verified stage evidence. Live lineup/cap/IR/trade enforcement, remaining write boundaries, co-commissioner runtime delegation and real database/provider/mobile staging remain release gates.

Publication browser verification: actual-component preview/publish/reload flow passed at 360/390/1440 with reduced motion, no overflow, missing artwork or page errors. Actual phone panel screenshot inspected: artifacts/tournament-visual-preview/matchup-publication-390.png. Fixture preview only; real Postgres contention, authenticated production and iOS/Android device certification remain pending. git diff --check passed.


## Completed batch: stat-derived scoring adapter and provenance (October 13)

- [x] Read stored RI integration/contracts/fixture shapes and existing NFL normalization paths; no vendor probing or live provider call. Implemented seasonStatAdapter.ts and internal ingestSeasonOpeningStatEvidence.
- [x] Exact decimal scoring against the immutable rules weights, with one final four-decimal rounding (halves away from zero). Missing/invalid nonzero weighted stats block ingestion. Provider fantasy-point totals and unscored cache defaults are not consumed.
- [x] Measured NBA raw box mapping for supported counting stats and per-game double/triple bonuses. Complete canonical game-stat envelopes support either sport when a trusted upstream worker supplies every required fact. This is not a live NFL vendor adapter.
- [x] Requires complete, unambiguous, current verified player identities for the drafted roster and verified game identities, scoped to provider/sport. Binds raw stat evidence and exact identity registry records into the existing atomic score receipt. Current registry mappings are rechecked during review/finalization/standings; drift blocks commitments.
- [x] Actual-start/regular-season attestations must match captured game identity and calendar windows. Postponed or mismatched starts fail closed. Complete coverage requires every captured game/player line; future observations, orphan identities and duplicate rows are rejected.
- [x] Compacts identical score revisions so unchanged reconciliations do not duplicate history. Preserves corrections and checks source stat revisions as well as numeric score revisions. Stat-provenance receipts cannot mix with low-level numeric ingestion or silently change identity/source mappings.

Important measured limitation: the full current NBA defaults include technical/flagrant foul penalties absent from the committed RI box fixture. Raw RI ingestion blocks that default contract; it does not zero missing events or rewrite the rules. NBA threshold bonus semantics are now specified and tested in the later scoring-evidence batch. Real NFL per-game normalization, actual-start proof, postponement handling and provider correction/coverage reconciliation remain pending. See docs/TOURNAMENT_SCORING_FEED_GAPS.md. Initial tests caught the discipline coverage gap; tests now distinguish an explicit supported fixture contract, a full canonical fixture and the unchanged default-contract refusal.

This batch adds internal adapter/persistence code, not a scheduled worker, provider activation or public ingest endpoint. No UI changed, schema migration, production write, push, PR or deployment occurred. All launch/player-move/advancement gates remain locked.

Next ordered work: audited draft-to-canonical provider identity bridging and supplemental NBA scoring evidence for every enabled weight; then verified actual-start/postponement reconciliation and a DB-backed provider worker with full post-correction coverage. After those gates, certify staged scoring and build seeding/cut previews. Do not enable default NBA scoring while its required events remain unproven.

Final verification for stat-derived ingestion: 181 distinct tests passed across three files (132 native service cases, 11 stat-adapter cases and 38 weekly projection cases), combining the full 178-case rerun with three added cases for current game-identity checks, default NBA raw-feed refusal and conflicting raw stat revisions. Focused reruns passed after the identity-read and source-revision guards were added. The TypeScript integration check reports only the 18 unchanged Decision OS/shared generated-client baseline diagnostics, with no tournament-file diagnostics; it is not green overall. git diff --check passed. No GUI changed or device certification was claimed. Tests use verified-registry/database fixtures and one stored NBA provider fixture, not a live vendor connection or full multi-league production season.


## Completed batch: audited provider-ID bridge for prepared opening drafts (October 13)

- [x] Added internal recordSeasonDraftProviderBridge for NFL/NBA opening leagues in locked setup. It reads the complete prepared draft roster, requires an exact providerPlayerId match to one current verified registry row for every drafted ID, and rejects ambiguous, expired, unverified or duplicate-canonical mappings. There is no name or team fallback.
- [x] Pins the full drafted ID → canonical Player ID crosswalk in an immutable tournament audit receipt bound to the freeze, published rules and prepared roster hash. It claims the draft session version and saves atomically; exact retries do not write. No API exposes arbitrary mapping input.
- [x] Stat ingestion uses that bridge when present for the selected provider, keeps original drafted IDs for lineup and score totals, and includes the bridge digest in each stat receipt. Owner review/finalization and standings recheck both the pinned receipt and current registry identities. A changed or removed mapping requires reconciliation. The existing direct canonical-ID route still works.
- [x] Verification: 183 tests passed across native setup, stat adapter and weekly projection suites; two new service cases cover a full 96-player vendor-keyed draft, scored evidence, idempotency, drift, ambiguous/missing identities and audit rollback. The scoped TypeScript check has no tournament diagnostics and the same 18 unrelated baseline diagnostics, so overall TypeScript remains blocked.

This is an internal setup boundary, with no new GUI, provider worker, live league activation, real database write, PR, push or deployment. The resolved draft catalog still lacks per-player source-namespace provenance, and the bridge only accepts a complete exact provider-ID mapping. Mixed/unknown ID namespaces, NBA technical/flagrant evidence, NFL per-game facts, actual-start proof, postponements, correction coverage and staging remain.

Next ordered work: preserve and verify each frozen draft pick's source namespace, then assemble a complete NBA stat contract from measured trusted source fields including technical/flagrant fouls and bonus semantics. Build actual-start/postponement reconciliation and a provider worker that resubmits complete current-period evidence after corrections. Keep launch and advancement locked until those gates pass.


## Completed batch: frozen draft ID source provenance (October 13)

- [x] The shared sport pool now carries the selected stored SportsPlayer row's source label. The draft resolver tags an ID only when it equals an explicit NFL Sleeper ID or an NBA Rolling Insights external ID from that row; all other ID paths are marked unknown. Equal-looking numeric IDs from different sports/providers are kept separate.
- [x] The tournament's checked catalog persists each player's namespace and source record ID, and its refresh check refuses a changed source mapping after the initial checked pool. Draft picks continue to use their frozen player IDs; no existing league roster is rewritten.
- [x] The internal provider bridge requires every prepared drafted ID to have matching frozen source evidence, rechecks the current SportsPlayer row and verified canonical identity before saving its receipt, and repeats those checks for scoring review/finalization and standings. Earlier catalog snapshots lacking provenance cannot silently acquire it.
- [x] Verification: 185 tests passed across four scoring/draft-source suites, including collision, unknown-source, full vendor-keyed league, source drift and rollback cases. One additional focused regression passed after that run, proving a later catalog refresh cannot replace frozen source provenance. The overall TypeScript check still has the reproduced Decision OS/generated-client baseline errors; no production provider run or real database certification is claimed.

At this batch, NBA default technical/flagrant fouls and 40+/50+ semantics still needed a complete measured source contract; NFL requires per-game facts and actual kickoff proof. Postponement/correction reconciliation, a production worker, mixed/unknown draft namespace migration, staging, live roster boundaries and mobile certification remain. No launch or advancement was enabled.

Next ordered work: establish a complete NBA scoring evidence contract without treating absent discipline events as zero, then implement verified actual-start/postponement reconciliation and post-correction full-period refresh.


## Completed batch: NBA threshold scoring evidence (October 13)

- [x] The measured Rolling Insights NBA box `points` field now yields per-game 40+ and 50+ scoring indicators. The two frozen weights are independent: 50+ points activates both, while 40–49 activates only 40+. The mapper still reads the measured counting fields and does not consume provider fantasy totals.
- [x] A frozen-rule coverage assessment separates mapped box stats, derived box stats, weights requiring another feed, and unsupported custom weights. Raw box ingestion refuses every active weight it cannot prove, including NBA technical and flagrant fouls in the current full defaults. Even a caller-provided zero for those fields is not accepted as measured box evidence.
- [x] Tests cover 39/40/49/50/60-point thresholds, malformed points, default-rule coverage, fabricated foul zeros and full-default ingest refusal. The local play-by-play contract names technical/flagrant actions, but no captured NBA play-by-play fixture yet establishes complete attribution or correction coverage. The default NBA raw path stays locked.
- [x] Verification: 189 tests passed across four tournament scoring/setup/projection/draft-source suites. The tournament TypeScript integration check has no tournament-file diagnostics but still reports the same 18 unrelated Decision OS/generated-client baseline errors, so overall TypeScript is not green. `git diff --check` passed. No real provider or database staging was performed.

Next ordered work: obtain and verify a complete NBA discipline-event feed or trusted canonical facts for technical/flagrant counts, including player attribution and post-correction reconciliation. Then address independently verified actual starts/postponements and full-period refresh before staged activation. NFL game-level scoring, live runtime boundaries, real Postgres/provider/mobile certification and advancement remain pending.


## Completed batch: provider-backed NBA foul evidence audit (October 13)

- [x] Used the configured Rolling Insights NBA entitlement through the repository's one-time fixture capture script for an already-saved final game. Captured `contracts/rolling-insights/fixtures/play-by-play.NBA.json` (game `20260315-1-13`, 437 plays) and verified the fixture contains none of the configured API credentials. TheSportsDB remains the schedule/artwork enrichment source; tournament scoring continues to use Rolling Insights.
- [x] The measured play feed has one `technical_foul_committed` event, a delay-of-game technical with `players: []`, and no flagrant example. This is evidence of an action shape, not proof that player discipline penalties can be completely scored. Updated the provider endpoint/play-by-play contracts and gap N-19.
- [x] Added a pure fail-closed foul evidence inspector that counts only one explicitly identified `fouler` with a numeric provider ID and matching action, reports unattributed plays, rejects duplicate sequences/wrong games and omits reversed/no-play events. It does not supply scores to the live or setup ledger. Default NBA raw scoring remains blocked until full attribution and correction coverage are verified.
- [x] Verification: the captured fixture passed a fake-token-calibrated credential scan; both edited YAML contracts parsed; 16 focused NBA evidence/scoring tests passed. The scoped TypeScript check explicitly includes the inspector and test and still reports only the same 18 unrelated Decision OS/generated-client baseline diagnostics. No tournament-file diagnostics. No provider worker, real database staging, PR or deployment was performed.

Next ordered work: obtain an attributed technical and flagrant example or written vendor guarantee covering player identity and missing/team events, then implement full-game foul reconciliation against current provider data. Validate how corrections and event reversals change the feed before using penalty counts. Actual-start/postponement and real database/mobile staging gates remain.


## Completed batch: NBA play-by-play correction comparison (October 13)

- [x] Added full-snapshot comparison for one verified game ID. It canonicalizes and hashes plays by sparse sequence ID, ignores harmless response ordering, recognizes newly appended plays, and sends changed, removed, reversed or late-backfilled earlier plays to review. The current snapshot replaces prior foul counts; no delta is mistaken for a new scoring event.
- [x] The comparison is an internal evidence report only. It cannot attest that the provider returned every play or every correction, and it does not unlock technical/flagrant scoring. The captured delay-of-game technical still has no player attribution.
- [x] Verification: 18 focused NBA play-by-play/scoring tests passed, including reversal, changed fouler, removed play, sparse backfill, true append and reordered captured fixture cases. The scoped TypeScript check reports no tournament diagnostics and the same 18 unrelated Decision OS/generated-client baseline errors; overall TypeScript remains blocked. `git diff --check` passed. No live provider polling, database write or scoring activation occurred.

Next ordered work: secure measured player-attributed technical/flagrant examples or written provider semantics, plus complete current-game and correction-window guarantees. Then connect a trusted full-game discipline report to the verified identity registry and scoring ledger. Independently, address actual-start/postponement reconciliation and staged provider/database/mobile certification.


## Completed batch: commissioner scoring-source readiness (October 13)

- [x] The owner-only opening-setup response now derives source coverage from the frozen published weights. NBA reports measured box stats, derived stats, and exact active weights requiring additional evidence; NFL reports that no certified per-game adapter is connected. The report never uses API-key presence as evidence of a usable scoring feed.
- [x] The responsive commissioner hub shows a scoring-feed readiness card with plain-language blockers. It distinguishes box-field mapping from tournament launch readiness and keeps launch blocked for actual-start and full correction-window worker certification even when custom NBA scoring disables foul penalties. TheSportsDB remains schedule/artwork enrichment.
- [x] Verification: 143 native setup, UI and source-readiness tests passed across three suites, including frozen default foul blockers and a custom box-supported NBA ruleset that still cannot launch. The scoped TypeScript check includes the hub UI and its Vitest matcher types; it reports no tournament diagnostics and the same 18 unrelated Decision OS/generated-client baseline errors, so overall TypeScript is not green. `git diff --check` passed. No scoring provider worker or league activation was enabled.

Next ordered work: certify player-attributed NBA technical/flagrant events and complete correction handling with provider evidence, then connect a trusted full-game discipline report through verified identity mapping. In parallel, build audited actual-start/postponement reconciliation. Keep real Postgres/provider/mobile staging and all tournament advancement gated.

## Completed batch: published schedule drift review (October 13)

- [x] Added a read-only comparison of frozen published game IDs, scheduled times, and scoring periods against a fresh Rolling Insights season schedule. It flags moves within/across periods, postponements, cancellations, replacements, missing or new games, unknown classifications, and conflicting rows. The original assignments remain unchanged.
- [x] Added an owner-only commissioner hub control. The service checks the frozen manifest and published calendar hashes before fetching provider data, then displays current coverage blockers and the first 20 schedule changes in a mobile-friendly card. A scheduled tipoff is explicitly not actual-start proof, and launch stays blocked.
- [x] Added pure comparison, protected service, and hub UI tests; all 20 focused calendar/review/UI tests pass. The scoped TypeScript check has no tournament diagnostics and retains the same 18 unrelated Decision OS/generated-client baseline errors. The provider response is mocked in tests; no live schedule or database write is claimed.

Next ordered work: establish independently verified actual game starts and a commissioner-reviewed postponement reconciliation policy tied to immutable score receipts. Then build a full-period provider refresh worker that handles corrected games and complete coverage. NBA discipline attribution and NFL per-game stat contracts, real Postgres/provider/mobile staging, and launch/advancement certification remain pending.

## Completed batch: postponement review path and TheSportsDB artwork adapter (October 13)

- [x] The schedule report now gives the commissioner a case-specific, read-only reconciliation checklist for same-period changes, cross-period moves, cancellations, replacement/new games, and feed conflicts. Every case requires independent actual-start evidence and an audit of locked lineups, ingested scores, and finalized weeks. No period transfer or score correction is applied automatically.
- [x] Confirmed TheSportsDB artwork from saved NFL vendor responses: the Jalen Hurts record includes `strThumb` and `strCutout`; all 32 returned NFL teams include `strBadge` and `strLogo`. The API's current official documentation lists player and team lookups. This confirms the fields and measured NFL sample, not complete NBA/player coverage or current CDN uptime.
- [x] Fixed the app's artwork adapter to recognize vendor sport names (for example, `American Football` for NFL), tolerate `player`/`players` response keys, use the measured `search_all_teams.php?l=NFL` path for league logos, and refuse an unrelated team's logo when no team matches. NBA `Basketball` mapping is covered with a synthetic response; a captured NBA fixture remains to be collected through the repository's approved fixture workflow.
- [x] Verification: 25 focused calendar, reconciliation, commissioner UI, and artwork tests passed. The scoped TypeScript check found no new tournament/artwork errors; it still reports the same 18 unrelated Decision OS/generated-client baseline errors. `git diff --check` passed.

Remaining actual-start gate: the stored NBA play-by-play fixture has a period-one jump ball but no UTC timestamp for the play, while schedule `game_time` is a scheduled tipoff. Neither is sufficient to certify the true start time. A trusted, timestamped event source and receipt-level reconciliation must be established before scoring or lineup-lock changes can be unlocked. TheSportsDB is artwork/metadata enrichment, not a fantasy scoring source.

Next ordered work: secure and validate a timestamped actual-start source for NFL and NBA, implement immutable start-evidence receipts and a commissioner-reviewed correction flow against prior lineup/score/finalization receipts, then full-period correction refresh. Keep launch and advancement locked until real provider/database/mobile certification.

## In progress: provider-observed actual-start windows and correction detection (October 13)

- [x] Added server-side sampling for one published NFL/NBA game. It verifies the frozen publication and current regular-season schedule, fetches a fresh Rolling Insights live row for the provider's Eastern game day, and appends a hash-bound observation without storing player boxes or API credentials. A failed, missing or ambiguous provider response saves nothing.
- [x] Added an evidence evaluator that requires a close pregame → in-progress observation pair and keeps the possible start wholly inside the published scoring period. A later postponement, cancellation, status regression, contradictory timestamp, schedule-time change, wide observation gap or late lineup lock fails closed. The commissioner hub can sample and see the start bounds and review reason; launch and scoring remain blocked.
- [x] For one selected game, the sampler now reads each frozen opening league's deterministic lineup receipt and relevant score/finalization history, verifies the saved hashes/bindings, and reports affected league and revision counts. It checks the latest saved lineup-lock time against the start window. This is a bounded audit preview; it does not rewrite, reverse or approve any receipt.
- [x] Twenty focused evidence, server-sampling, receipt-impact, schedule-review and commissioner UI tests passed. The server tests cover exact-match provider rows, immutable receipt hashes, unavailable responses, owner access and later postponement invalidation. No real game-day provider call or database staging write was made.
- [x] The scoped TypeScript check includes the new service, route and UI. It reports no tournament diagnostics and the same 18 unrelated Decision OS/generated-client errors; overall TypeScript is not green. `git diff --check` passed.
- [ ] A bounded provider-status window is not an exact start timestamp. The measured NBA play-by-play has no UTC timestamp on its opening jump ball; the current `startVerified` internal ingest assertion is **not** satisfied by this sampler. It remains necessary to establish a timestamped source or formally adapt the ledger to bounded starts, bind each league's immutable lineup/score/finalization receipts, and implement audited correction application and full-period refresh. No live worker or provider polling schedule is enabled.

Next ordered work: certify an exact NFL/NBA start source or safely migrate lineup/scoring logic to bounded windows; then persist per-league reconciliation decisions and corrected score versions before any launch gate opens. Validate with real provider calls during games and a staging Postgres tournament.

## In progress: start-evidence correction gate (October 13)

- [x] Opening score ingestion and idempotent retries now recheck all saved game-start observations before accepting a batch. Weekly review, re-finalization and standings reads use the same gate, so a later postponement or status regression invalidates an older setup checkpoint instead of leaving it eligible for advancement.
- [x] The gate verifies each observation's frozen manifest/publication hash, resolves the game's canonical scoring ID through the verified Rolling Insights game registry when present, requires the lineup lock to predate the bounded start, and refuses a claimed exact start outside that window. The commissioner sees the correction-review reason through the existing scoring panel.
- [x] The start sampler's impact preview also resolves a verified provider ID to the canonical game ID before counting lineup, score and finalized-week receipts.
- [x] Local validation: 148 focused start/impact/sampling/native-setup tests pass, including a finalized-week invalidation and provider-to-canonical ID case. Scoped TypeScript has no new tournament diagnostics; the same 18 unrelated Decision OS/generated-client errors remain. `git diff --check` passes. No live provider or Postgres staging write was made.
- [ ] This remains a fail-closed setup safety check. A status transition cannot certify exact kickoff/tipoff. Existing `startVerified` stat input is still an internal assertion, not established by the sampler. No worker, automated score reversal, rescheduled-game lineup recapture, full-period provider replay, or launch transition was enabled.

Next ordered work: obtain a trusted exact-start event feed or implement a formally specified bounded-window scoring model, then build auditable per-league correction decisions and full-period provider refresh. Verify game-ID mappings and transaction contention with real provider data and staging Postgres before activation.

## In progress: full-period stat correction reconciliation (October 13)

- [x] The internal stat ingest boundary compares each new full-period snapshot with the prior saved raw snapshot. It pins order-independent content digests and receipt-bound counts for changed player results, backfilled results, game-status changes and advanced provider revisions. The old score and raw evidence receipts remain append-only.
- [x] A deleted prior game or player result, a backward provider revision, changed stats/finality without a newer player revision, a changed game start/season classification, or a downgrade from complete coverage fails closed. New valid revisions continue through the existing score projection and require a fresh commissioner finalization before standings use them.
- [x] The commissioner scoring panel shows only safe correction counts from the latest provider refresh; it does not expose raw player boxes.
- [x] A pure NBA start-order assessment proves that disjoint observation windows can be ordered, while overlapping windows cannot establish which game consumes a counted start first. This is a specification aid only; it does not enable live scoring.
- [x] Local validation: 143 node tests across reconciliation, native setup and bounded ordering plus five jsdom commissioner UI tests pass. Scoped TypeScript reports no new tournament diagnostics and the same 18 unrelated Decision OS/generated-client errors; `git diff --check` passes. No live provider request, database staging write, PR, push or deployment was performed.
- [ ] There is still no provider polling worker or independent guarantee that a fetched payload is the provider's full current period. The exact actual-start source and verified NBA technical/flagrant attribution remain open. Rescheduled/canceled games need a separate audited lineup/period correction workflow. Live scoring and advancement stay blocked.

Next ordered work: obtain a trusted exact-start event timestamp for NFL/NBA (or an explicit NBA cap-order policy that resolves overlapping windows), then implement a provider worker that fetches complete current-period snapshots through correction closure and submits versioned refreshes through this boundary. Test real-provider behavior and multi-league Postgres contention before activation.

## In progress: whole-period provider feed review (October 13)

- [x] Added a reusable Rolling Insights collector that reads each elapsed US Eastern game day in a selected frozen scoring period, after rechecking the current regular-season schedule against every published assignment. Games scheduled later on the current day stay pending. Missing rows are reported, never scored as zero; duplicate rows, unknown season classification, provider failures/304s and schedule drift fail closed.
- [x] Added an authenticated owner-only, read-only Commissioner Hub control for one published period. It reports game-row coverage, final statuses and a compact snapshot digest without returning player boxes. It does not write scores, create start attestations or activate a tournament.
- [x] Reviewed current public provider documentation. Rolling Insights describes schedule time and live status, but no certified actual kickoff/tipoff timestamp was identified. TheSportsDB livescore documentation calls `strEventTime` a game start time but marks its behavior uncertain; it is not sufficient to certify actual play start. Sources: https://www.rolling-insights.com/datafeeds/nfl-api/ and https://api.thesportsdb.com/docs_api_data . The measured NBA play-by-play fixture also has no UTC wall-clock field on its opening event.
- [x] Local validation: 17 focused server tests and eight jsdom commissioner UI tests passed, including same-day future games, duplicate and missing rows, protected access, and a safe response without player boxes. Scoped TypeScript reports no tournament diagnostics; the same 18 unrelated Decision OS/generated-client errors remain, so overall TypeScript is not green. No real provider or Postgres staging call was made.
- [ ] This is an interactive feed preview, not a scheduled correction worker. A final game row does not prove all drafted player lines or enabled NBA discipline stats are complete. Exact start, NBA cap ordering for overlapping windows, full post-correction polling and audited rescheduled-game handling still block scoring.

Next ordered work: obtain a vendor-backed exact-start contract or publish an explicit frozen NBA ordering policy, then build a bounded background worker that retains complete current-period raw evidence and calls the internal revisioned scorer only after player/identity/coverage checks. Verify rate limits, real game-day behavior and Postgres contention before activation.

## In progress: measured player-box preflight (October 13)

- [x] The owner-triggered whole-period review now inspects the captured Rolling Insights NBA `player_box.away_team/home_team.<providerPlayerId>` shape. It counts provider player lines and flags missing or malformed boxes, duplicate player IDs across sides, and invalid supported weighted fields without exposing raw boxes to the browser.
- [x] The same review names active frozen NBA scoring stats that the measured box cannot provide, including technical/flagrant fouls under the default rules. Supported fields are still checked even when other weighted stats are unavailable. The NFL box path remains explicitly unmeasured; NBA row counts do not prove drafted-player coverage or DNP outcomes.
- [x] Verification: 21 focused server tests and eight Hub UI tests passed; a final four-test box-audit rerun passed after the supported-field correction. Scoped TypeScript reports no new tournament diagnostics and the same 18 unrelated Decision OS/generated-client errors; overall TypeScript is not green. Whitespace checks passed. No real provider, staging database, score ingestion, or deployment was performed.
- [ ] No period scoring or background polling is enabled. Provider start times remain scheduled values; exact play starts, verified player/game crosswalks, all expected drafted player/game rows, and correction-window closure are still needed before a worker can submit revisioned scores.

Next ordered work: audit one opening league's locked player/game receipts against verified provider identities and the measured NBA box, treating absent players as unresolved rather than zero. Then add bounded, rate-limited periodic refresh with retained raw evidence, after the exact-start/ordering and provider correction contracts are settled.

## In progress: one-league locked player/game coverage (October 13)

- [x] The Commissioner Hub's whole-period check can select one created opening league. It reads that league's hash-bound lineup receipts and the current verified Rolling Insights game/player identities through the existing prepared-scoring boundary; an immutable draft provider-ID bridge is revalidated when present. Ambiguous, missing or expired mappings remain unresolved.
- [x] A pure comparison matches locked player/game pairs against the measured NBA `player_box`, separating matched rows, missing game rows, malformed boxes, absent players in final boxes, pending live-game players and unresolved identities. The browser receives counts and league name only. NFL boxes remain unmeasured, and absent NBA rows/DNPs never become zero scores.
- [x] Focused validation: 22 server tests and nine Hub UI tests passed, including ambiguous/expired identities, final versus live absences, owner gating, a forged actor, and the selected-league request. After a receipt-reader type repair, scoped TypeScript reports no tournament diagnostics and the same 18 unrelated Decision OS/generated-client errors; overall TypeScript is not green. No provider polling schedule, score ingestion or deployment was enabled.
- [ ] A frozen lineup receipt may cover fewer games than the published period, and a provider's final box may omit DNPs. This preview does not establish complete period/player coverage, exact start order or correction closure; scoring and advancement remain blocked.

Next ordered work: reconcile every published game and every drafted player's game/DNP status for a league with a vendor-backed completeness contract. Then build a bounded, rate-limited refresh job that retains raw evidence and submits versioned score updates only after actual-start and correction gates pass.

## In progress: full-period game and drafted-player outcome matrix (October 13)

- [x] The selected-league Hub review now accounts for every published game in the chosen period and every drafted player in the prepared league. It separates future games from elapsed games lacking feed rows, shows elapsed games without a locked player receipt or explicit no-player outcome, flags locked games outside publication, and counts drafted players with no locked game or verified no-game outcome. It reports locked pairs as matched, live pending, scheduled for later, missing or unresolved without producing zero scores.
- [x] Measured the committed NBA `/live` fixture: seven final games, 145 player lines, all `status: "ACT"`. The public Rolling Insights material describes final boxes but does not establish whether absent, zero-minute, inactive or DNP players appear. No committed NFL final per-game box fixture exists. Wrote `contracts/rolling-insights/TOURNAMENT_COMPLETENESS.md` with the precise vendor contract questions and required examples. This is a request for evidence, not a certified feed guarantee.
- [x] Validation: 24 focused server tests and nine Hub UI tests passed, including future games that remain pending rather than missing. The final scoped TypeScript run found no tournament diagnostics and retained the same 18 unrelated Decision OS/generated-client errors; overall TypeScript is not green. Whitespace checks passed. No live API probe, database staging write, score ingestion, PR or deployment occurred.
- [ ] `explicitDnpOutcomes` and `completeGameAndPlayerCoverageVerified` remain false. A published game without a locked receipt could contain zero drafted players; an unassigned drafted player could have a bye or no game. Neither case can be inferred from absence. Exact starts, NBA discipline attribution, complete corrections and a scheduled scoring worker also remain blocked.

Next ordered work: obtain explicit provider game/player/DNP and correction semantics with captured NBA and NFL examples, then add immutable no-player/no-game/DNP evidence to close each matrix gap. Only then schedule bounded refresh and feed the revisioned scorer after start-order and staging checks.

## In progress: candidate outcome evidence and corrections (October 13)

- [x] Added an append-only server audit ledger for player-game DNP/played, player-period no-game/game-expected, and game-period no-drafted-players/drafted-players-expected claims. Each receipt retains a bounded raw source artifact and checksum, frozen manifest/rules/league/period identity, idempotent request ID, revision, and previous-revision digest. Corrections append a new revision; altered history or reused request IDs fail closed.
- [x] Intake checks locked provider player/game pairs, drafted players without a locked game, and published games without a locked player receipt. An unresolved locked game identity blocks a no-player game claim. The selected-league Hub review shows only candidate counts and correction totals; raw player IDs/artifacts remain server-side.
- [x] Focused pure, store, period-review and Hub tests passed (20 tests), with an additional eight-test evidence regression rerun after the artifact-copy guard. Scoped TypeScript reports no new tournament diagnostics; its existing 18 Decision OS/generated-client errors still prevent a green overall check. Candidate claims remain `contract: unverified`, do not change `explicitDnpOutcomes` or `completeGameAndPlayerCoverageVerified`, and cannot score or advance a team. No public evidence-submission route or scheduled worker was enabled. No live vendor request, staging database write, push, PR or deployment occurred.
- [ ] Vendor-written DNP, no-game, game-coverage and correction semantics with raw NBA/NFL examples are still required. The ledger has no automatic provider intake yet. Exact actual-start ordering, NBA discipline attribution, a full correction-closure policy and staging Postgres validation also remain open.

Next ordered work: capture representative NBA and NFL raw final, DNP/inactive, no-game, zero-stat and corrected-final examples under the provider contract. Then build a bounded worker that appends these evidence receipts from actual source rows and reconciles every published game and drafted player before versioned scoring is enabled.

## In progress: measured NFL/NBA box-line capture (October 13)

- [x] Used the configured Rolling Insights accounts for one bounded NFL slate (2026-10-11, 13 final games) and one NBA slate (2026-03-16, eight final games). The selected saved examples have 69 and 22 flat provider player lines respectively, all `ACT`. No obvious DNP/inactive marker appeared in either full slate's player boxes. Local raw captures are gitignored, credential-scanned, and summarized in `contracts/rolling-insights/TOURNAMENT_SAMPLE_AUDIT.md`.
- [x] Added a `box_line_present` candidate outcome, distinct from played, DNP and zero points. A pure planner accepts only unique locked player/game IDs found in a final regular-season box and reports missing, absent, malformed, nonfinal and unresolved cases without inventing outcomes. It caps a batch at 50 and supports skipping unchanged prior artifacts.
- [x] Added an internal one-day capture path. It rechecks the frozen publication against the fresh season schedule, spaces the schedule and live requests by six seconds, refuses duplicate provider rows, and writes at most ten candidate receipts per run through the append-only audit store. It returns counts only. No public route or cron invokes it, and it cannot certify coverage, scoring or launch.
- [x] Local verification: 27 focused evidence, capture, period-review and Hub tests passed, followed by six capture and eight ledger regression tests after final provenance/chain changes. Scoped TypeScript found no new tournament diagnostics; the same 18 unrelated Decision OS/generated-client errors keep the overall check red. Captured sample SHA-256 values were independently rechecked, raw files are ignored, and changed-file whitespace checks passed. No staging database write, push, PR or deployment occurred.
- [ ] The observed `ACT` label and one zero-stat line do not prove played/DNP semantics. No actual DNP/inactive or corrected-final pair was captured. Vendor guarantees, a distributed rate limit, staging Postgres concurrency tests, exact start/order and NBA discipline attribution remain open.

Next ordered work: obtain vendor-written NFL/NBA player-outcome and correction semantics and capture explicit DNP/inactive and corrected-final examples. Then test this bounded intake against a staging tournament, add resumable scheduled polling with a distributed rate limit, and promote only vendor-backed outcomes into coverage and versioned scoring after start-order checks pass.

## In progress: verified game identity and resumable box capture (October 13)

- [x] The one-day capture now relates published canonical game IDs to Rolling Insights `game_ID` through the current, unique, verified game identities already bound to frozen lineup receipts. A different provider ID no longer silently drops a final box row. An expired or ambiguous binding stays unresolved; the evidence store independently checks the provider ID against a published canonical game and its locked player/game pair.
- [x] A partial-write retry test exercises a twelve-player final box with the ten-receipt cap: four durable receipts survive a simulated fifth-write failure, and the next run skips those four and records the remaining eight. The capture still emits counts only and cannot certify play, DNP, points, coverage or launch.
- [x] Focused identity, outcome-audit, capture and adjacent Hub-review tests pass (20 tests), including an unresolved binding that must not use a coincidental same-ID provider row. All seven changed TypeScript files transpile without syntax diagnostics, and whitespace checks pass. No staging database write, external release or scoring activation was made.
- [ ] Vendor-written DNP/inactive and corrected-final semantics remain missing. There is no tournament-designated staging database in the current configuration, distributed rate limiter or scheduled polling job. The scoped TypeScript process was stopped after several minutes of resource contention without diagnostics; overall type verification is still outstanding.

Next ordered work: obtain explicit vendor outcome/correction examples, provision an isolated staging tournament database for transaction and contention tests, and add a distributed rate-limited poller that resumes from stored receipts. Keep automatic scoring and advancement disabled until exact-start/order and NBA stat attribution are verified.

## In progress: NBA/NFL examples and candidate evidence worker (October 13)

- [x] Captured more entitled final slates: NBA March 17 and April 12, and NFL October 12. An NBA April 12 final line is `ACT` with `minutes: "0"` and 17 numeric fields at zero. The selected NFL October 11 example has an `ACT` line with two present numeric fields at zero. Raw selected rows remain local and ignored; digests and safe counts are in `contracts/rolling-insights/TOURNAMENT_SAMPLE_AUDIT.md`.
- [x] Re-fetched the saved NFL October 11 and NBA March 16 final rows about four hours later; both game-row digests were unchanged. No corrected-final pair or explicit DNP/inactive marker was found. An off-day NBA request returned HTTP 304, so no-game cannot be certified from it. The vendor publicly says it checks corrections for 12 hours and recommends 5–10 seconds between calls, but does not document player completeness or an authoritative closure signal.
- [x] Added an owner-authenticated, environment-gated, one-league/one-day evidence worker endpoint. The shared lease covers schedule/live calls and a six-second cooldown; each run saves at most ten `box_line_present` candidate receipts through the existing audit ledger and resumes from prior artifacts. It skips subjects whose latest candidate is a stronger explicit outcome. The worker is disabled by default and cannot score, finalize or advance teams. Four focused planner/capture/worker/route suites passed (14 tests). Scoped TypeScript found no tournament errors, but the same 18 unrelated Decision OS/generated-client diagnostics keep the check red.
- [ ] Explicit vendor DNP/inactive, player no-game, corrected-final and 304/empty-day semantics are still missing. The lease and audit writes need isolated multi-worker Postgres/Redis staging checks before scheduling. NBA actual-start order and player-attributed discipline stats also block scoring. Full-repository type verification and device/release checks remain open.

Next ordered work: obtain written vendor semantics and raw DNP/correction examples; run a 64-person NBA staging simulation from published rules through registration, eight drafts and multiple corrected scoring weeks; verify concurrent audit capture and the mobile join flow. Do not expose live gameplay or invites as production-ready until the opening draft/runtime, scoring and release gates pass.

## Completed milestone: isolated 64-manager NBA opening setup (October 13)

- [x] Created a separate Neon validation project (`sparkling-mountain-37208979`, database `tournament_pilot`) with no production rows copied. The existing validation URL rejected authentication, and the main project cannot make a schema-only branch because of its legacy anonymous web-access role. Pushed the current Prisma schema to this isolated project only.
- [x] Exercised the real registration service for 64 synthetic `example.invalid` accounts against the isolated Postgres database: one invite token, exact published-rule hash acceptance, 64 registered places, zero waitlisted, full-field freeze, and eight 8-person native leagues.
- [x] Verified each league has eight tournament bindings and a native NBA draft with `teamCount: 8`; all eight drafts and leagues remain intentionally blocked. A second run reconciled the existing freeze and setup without duplicating leagues. Focused staging test passed twice (fresh run ~80 seconds of test execution; repeat ~6 seconds).
- [ ] This synthetic configuration uses the local fixture calendar, not the actual 2026–27 NBA slate. No real friend invites, draft picks, live scoring, lineup locks, cross-league cuts, or mobile browser checks were executed. The isolated project has no production tenant RLS roles/policies, so this run does not certify production tenant isolation or concurrent admissions.

**Next milestone before invitations:** verify the actual NBA season calendar and draft window, resolve and pin the NBA player catalog, then implement an audited opening-draft release that turns only the eight verified frozen leagues into playable drafts. Exercise commissioner controls, eight managers in a draft, autodraft/reconnect, completion and roster checkpoints on isolated Postgres and mobile browsers. Keep live scoring and tournament advancement behind their separate provider-evidence gates. The NBA season opens October 20, 2026, so the draft window must be earlier than that date.

## In progress: measured 2026–27 NBA calendar, catalog and opening-draft release (October 13)

- [x] Cross-checked the configured Rolling Insights schedule against the NBA's published opening date. The provider returned 1,266 games with timestamps: 66 preseason and 1,200 regular season. The first regular game is October 20 at 3:00 p.m. ET. The proposed 24-period pilot calendar covers 1,144 of the currently scheduled regular games, leaves 30 Cup-dependent games unassigned pending schedule publication, and deliberately excludes 56 games in redraft/correction gaps. These exclusions and the October 19 draft window are a review proposal, not approved or published commissioner rules.
- [x] Measured the current public NBA player catalog: 499 active/questionable players with unambiguous Rolling Insights IDs and standard draft positions. Of these, 401 have a valid measured 2025–26 points-per-game line. The draft resolver can use those prior-season measurements as a deterministic autodraft ordering fallback; it does not label them ADP or projections. Stale 2026 ADP snapshots cover only 93 NBA players, below the 96 selections required per eight-team opening league.
- [x] Copied only those 499 public athlete rows into the isolated `tournament_pilot` catalog, verifying 499 unique provider IDs. No production user data or production catalog rows were changed. Local ignored review artifacts retain the provider schedule and public catalog counts.
- [x] Added an owner-only, feature-flagged `release_draft` command and Commissioner Hub control. It requires all eight frozen leagues, matching published calendar and fresh provider schedule, current checked player pool, exact frozen draft contract, eight managers/seats, unchanged season locks, and an append-only release receipt. Only draft start/picks and tightly scoped controls are allowed afterward. Scoring, waivers, player moves and advancement remain locked. The release flag defaults off.
- [x] Local verification: the representative 96-pick NBA snake draft simulation passed with an audited release receipt; 15 ranking/release/draft-policy tests and 19 commissioner UI/route tests passed. The scoped tournament TypeScript check and tracked-file whitespace check passed. These are local checks, not a staging app run or device validation.
- [x] Pre-invite commissioner UX: the registration deadline now displays in the browser's local time and converts the selected time back to an exact UTC instant. A focused Eastern-time round-trip test passes alongside the registration UI suite. Physical device and live invite checks remain pending.
- [x] Ran one eight-manager/96-pick NBA draft through the real draft services and isolated Neon Postgres (`tournament_pilot`). GitHub Actions [run 38738286881](https://github.com/TheCiege23/allfantasy-v2-main/actions/runs/38738286881) passed both isolated database tests on October 15. The draft test verified audited release, one timer autopick, 95 manual submissions, pause/resume, a fresh Prisma connection after pick 24, 96 unique picks, one completion receipt, eight prepared rosters, and league/waiver locks. The database has one release, one completion, one roster-preparation, one pause and one resume receipt. This used the copied 499 public NBA player identities, test-only deterministic rankings, a synthetic future calendar, and a mocked provider schedule review; it did not exercise the live NBA calendar, production database, browser UI, or scoring.
- [ ] Recheck the proposed calendar's 56 excluded games with the commissioner, keep monitoring the 30 Cup games, and test desktop/iOS/Android invite and draft flows before exposing friend invitations. The provider's actual-start, DNP and correction gaps still block competitive scoring.

**Next milestone toward invitations:** run the actual proposed NBA schedule through the publish/release checks and validate the join, commissioner, and draft flows on desktop, iOS, and Android browser sizes. Present the October 19 draft window, 56 excluded games, and pending Cup-game policy for commissioner approval. Once these pass, enable draft-only access for a small invited pilot; keep scoring and tournament advancement behind their separate provider-evidence gates.

## In progress: actual-schedule and browser invite audit (October 15)

- [x] A read-only call to the live Rolling Insights 2026–27 season schedule returned 1,200 regular games. The proposed calendar passed its validator with 1,144 assigned games, 56 scheduled exclusions and 30 Cup-dependent pending games. The exact digest, UTC excluded-day counts, proposed windows and commissioner decisions are in [the NBA pilot calendar review](TOURNAMENT_NBA_PILOT_CALENDAR_REVIEW.md).
- [x] Added an audited direct draft-room link for an assigned manager only after the frozen league's provision and release receipts match the publication, manifest, league and draft IDs. Commissioner setup also links released drafts; long league names wrap on phone widths.
- [x] Synthetic browser previews passed nine Playwright checks across desktop Chromium, Android-sized Chromium and iPhone-sized WebKit: rule acceptance/join request, league reveal/draft link, and commissioner draft release/link. The preview server used an unreachable localhost database URL and mocked requests; no real friend accounts or invites were created. Physical devices remain untested.
- [x] Focused registration/UI/native-setup regressions passed (174 tests), plus a targeted commissioner release-link receipt test. The repository TypeScript ratchet passed with 139 existing diagnostics against a 143-error baseline, with no new errors; changed-file ESLint found no errors and one pre-existing hook warning.
- [x] Shifted the proposed stage-2/3 redrafts to 6–10 p.m. Eastern with the following scoring periods starting at 10 a.m. Eastern; the live provider recheck still assigned 1,144 games and excluded 56.
- [ ] Obtain commissioner approval for all three draft windows, registration cutoff, 56 scoring exclusions and Cup handling. Re-verify the calendar after any date change and publish the frozen rule version before registration.
- [ ] Validate a real signed-in invite link and a full eight-league release against the isolated pilot database/deployment, with 64 consenting managers (or an expressly test-only synthetic cohort), production catalog/config checks and physical iOS/Android smoke. Keep scoring and advancement disabled until their separate provider-evidence gates are met.

**Next practical milestone:** resolve the commissioner calendar choices, recheck the live provider slate, and exercise the real authenticated invite-to-draft path against the isolated pilot environment. Only then open draft-only friend invitations. A 64-manager field remains required for the actual tournament draft.

## In progress: authenticated invite rehearsal (October 15)

- [x] Commissioner approved the October 19, December 30 and March 17 draft windows, the 56 currently excluded scheduled games and review of 30 Cup-dependent games when scheduled. The registration cutoff remains to be confirmed at publication. Approval alone did not publish rules or open invitations.
- [x] Added a pilot-only browser lane to the isolated database workflow. It checks the exact Neon endpoint/database, signs in an owner and one entrant through credentials, joins through the real invite page, fills the other 63 seats with synthetic service calls, freezes through the authenticated route, provisions eight leagues through the authenticated route and verifies that unreleased drafts have no entrant link. A release request must remain blocked with the draft flag off.
- [ ] Run the new browser lane on the isolated pilot database and address any runtime failures. This lane uses a labeled synthetic publication with the approved dates; it does not certify the provider schedule or release a playable draft.
- [ ] Recheck the real NBA slate, publish the owner-approved immutable version through the live calendar route, and exercise a provider-backed release and signed-in draft room against the pilot database. Verify the production player catalog and complete a phone browser smoke before opening real invitations.

**Next milestone after this lane passes:** publish the approved NBA rules from a fresh provider check and complete one actual provider-backed opening-draft release through the authenticated commissioner route. Then open the draft-only friend pilot, contingent on 64 real rule-accepting entrants and the October 19 draft schedule. Competitive scoring and advancement remain disabled until provider evidence is complete.
