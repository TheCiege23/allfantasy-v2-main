# Native tournament draft mutation audit

Updated October 12, 2026. Scope: generic draft writers discovered during the tournament draft audit. This inventory is a release checklist, not certification of every league mutation endpoint.

Tournament markers remain permanent. Guards use marker presence, including malformed or null bindings, independently of the session status. Ordinary authorization still precedes the added API guards. Approved tournament pause/resume/reset-clock controls remain in seasonDraftControls; generic destructive reset is a different operation.

| Boundary | Behavior for native season tournaments |
| --- | --- |
| DraftSessionService: overnight reconciliation | No generic overnight timer writes |
| DraftSessionService: slot order repair | No generic lottery/roster reconstruction |
| DraftSessionService: missing session creation | Refuses generic creation; recover through provisioner |
| DraftSessionService: undo, manager swap, destructive reset | Refused, including allowCompleted |
| DraftPickTradeService: append trades | Refused |
| commissionerPickEditService | Refused before transaction, including force |
| createNextLeagueDraft | Refused; later rounds require tournament advancement |
| SlowDraftRuntimeService: automation tick | Skipped; no overnight/meta/queue policy inherited |
| DraftSessionService: complete | Delegates native boards to the atomic tournament checkpoint; ordinary lifecycle activation cannot run |
| postDraftFinalizeArtifacts: finalization and completion repair | Ordinary artifacts remain skipped; repair delegates to the tournament checkpoint |
| AuctionEngine: last sale | Sale commits before checkpoint validation; valid boards complete without season activation. A failed checkpoint remains recoverable without repeating the sale |
| draft/order PATCH | 409 before mutation |
| draft/keepers POST; keepers/remove POST; keepers/config PATCH | 409 before mutation |
| draft/devy/config PATCH; draft/c2c/config PATCH | 409 before mutation |
| settings/draft PATCH; draft/settings PATCH | 409 before mutation |
| draft-lottery/run POST; draft/lottery/run POST | 409 before lottery/config writes |
| fill-empty-slots POST handler | 409 before AI roster/seat creation |

Files in the API rows are beneath app/api/leagues/[leagueId]. Authorized GET requests retain read access. Guard failures do not remove or rewrite the native marker, change draft picks, unlock waivers, create a redraft season, or change the accepted rules.

## Still required before launch

- Tournament board completion is implemented and fixture validation passed. Existing completed sessions require a matching versioned board receipt; manually marked completed sessions are refused. No ordinary roster/season materialization runs. Real database certification remains required.
- Full opening-league NFL/NBA snake and auction service simulations now cover completion, refresh, controls and rollback. Extend to the entire multi-league tournament, subsequent drafts/cuts and real database/provider staging before launch.
- Finish the wider mutation inventory: player trades/proposals, roster/team/member edits, league reset/delete/import, scoring/waiver/lineup settings, keeper materialization and direct redraft finalizers. A caller that bypasses the guarded orchestrator requires its own review.
- Manual tournament picks now validate frozen session/order/clock and refuse forced, traded-pick and specialty overrides. Continue the wider auction/session-mutation review before launch.
- Add database/provider staging contention tests and certify the readiness transition. Launch remains disabled until these pass.
- Implement live scoring, NBA caps/IR/lineup/trade enforcement, corrections, standings/cuts/reseeding and later tournament drafts.

No migrations, production writes or deployments were performed for this audit batch. Checkpoint success cannot enable launch.

Validation for this batch: 121 tests across six files and expanded scoped TypeScript passed. Full-service NFL/NBA draft completion, real Postgres contention, provider and physical-device certification remain pending.

Completion batch verification: 166 tests across six files and expanded scoped TypeScript passed. Four complete opening-league simulations exercised NFL/NBA snake and auction service paths, including catalog recovery and controls. New fixture checks cover receipt rollback/idempotency/CAS races, manual override refusal, roster and board tampering and auction payment reconciliation. This does not certify all tournament leagues/stages, actual providers, real Postgres contention or devices.

October 13 commissioner-review batch (isolated C: worktree): direct finalizeRosterAssignments and syncCompletedDraftToRedraftSeason now refuse native markers. Auction initialization, nomination, bids and settlement check frozen session rules. Main's ordinary archive behavior was retained during three-way integration; native nomination/bid archive writes share their CAS transaction. Owner readiness review is read-only and bounded to one league per request, and cannot unlock launch. Remaining wider league/roster/team/member/trade/settings/reset/import paths are still release gates.

Review/isolation verification: 164 distinct tests across ten files passed, including the focused race correction and finalizer guards. Phone/desktop component checks passed with no overflow, missing images or browser errors. Expanded TypeScript has 18 unchanged dependency/client diagnostics reproduced by the separate baseline config; these remain a release gate.

October 13 roster-preparation batch: ordinary persistRosterLineupWithEngine and roster/save reject tournament markers regardless of bypass flags. applyTradeAssetsInTransaction rejects native tournament assets using its transaction's league settings. appendPickToRosterDraftSnapshot skips native tournament writes, preventing a late full-JSON update from overwriting prepared lineups. The dedicated owner prepare_rosters command validates the draft receipt and locks, claims the session version, saves all starter/bench assignments with JSON/ownership predicates and writes a roster-hash receipt atomically. Repeat requests verify rather than overwrite. No RedraftSeason or live activation is created. Validation: 144 distinct tests across seven files and responsive component checks passed; expanded TypeScript remains blocked by 18 baseline dependency/client diagnostics. Remaining redraft trade, waiver, league/team/member/reset/import and other direct writers still need review before live activation.


### Weekly projection policy boundary
The internal seasonWeeklyProjection policy reads caller-supplied normalized trusted evidence only and performs no writes. There is no new public score/finalize API. Its eligibility output cannot authorize launch, cuts, transactions or bracket advancement. Remaining boundaries include authenticated ledger ingestion, verified locked-lineup persistence, atomic score revisions and durable finalization receipts.


### Opening scoring persistence (locked setup only)
Internal capture/ingest services check completed draft and prepared roster integrity inside their transaction. Deterministic audit receipt IDs plus draft-session version claims prevent duplicate or competing writes. Immutable game snapshots use server timestamps; late captures and game rebinding are refused. DB readback validates checksums and revision links. No public ingest route, provider fetch under a lock, active-season transition, standings mutation or finalization commit was introduced. Provider identity/scoring/coverage attestations and postponed-game reconciliation remain trusted-adapter prerequisites. Real Postgres contention and storage-performance validation are still pending.


### Owner weekly finalization boundary
The scoring API accepts only review or finalize for one frozen opening league/week. The session actor is the owner; ownership and binding are rechecked inside the transaction. Finalize must name the current reviewed ledger revision/digest and pass correction/coverage/score checks. Session CAS and a deterministic user-attributed setup-only receipt are atomic. New corrections require re-review. No ingest, arbitrary score input, roster mutation, live-season activation, standings write or advancement is exposed.


### Finalized standings read boundary
Owner-only standings use a read-only RepeatableRead transaction with current frozen-field ownership checks. Only newest ledger revisions with matching setup finalization receipts contribute. Drift, corrections, missing weeks and unprepared leagues cannot retain old totals as final. Client scores and actor fields are rejected; no provider calls, roster writes, official seeds or advancement occur. Unknown wins stop tiebreaker evaluation; they are not fabricated. The 15-second bounded full-field read needs real Postgres query/isolation certification before rollout.


### Fantasy matchup schedule and outcomes
Internal scheduler capture requires completed/prepared frozen setup, exact roster coverage and a server timestamp before period start; late publication and immutable pairing rebinding fail closed. Public endpoints do not accept opponents, wins or score evidence. Weekly owner finalization saves derived outcome receipts in the same transaction as its score checkpoint, with one session version claim. Retries verify linkage; score corrections invalidate old win credits. Standings verify pairing, ledger and finalization digests and fresh derivation before exposing records. Outcome drift preserves independently valid points but blocks win-based tiebreakers. No runtime activation or advancement was added.


### Commissioner matchup publication boundary
Private preview/publish API uses session ownership and rechecks current frozen context inside the transaction. Pairing suggestions are generated server-side; the browser supplies only league/week and the exact preview digest. Publication uses immutable matchup receipts and version CAS, with a second deadline check after the claim. Existing schedules are displayed rather than rebound. Same-token retries can recover after the deadline without creating a new schedule. No arbitrary pairings, actor/source/timestamp fields, score input, imported-league writes or activation are exposed.


### Internal stat-derived scoring boundary
No public ingest route. The internal adapter reads frozen rules and verified scoped identity registries inside the scoring transaction, validates captured game timing, derives fantasy points from explicit stats and saves raw evidence/provenance with the existing ledger/session CAS. Current identity records are checked again before review/finalization. Source/identity changes and conflicting raw stat revisions are refused; identical score revisions are compacted. Full default NBA RI coverage and real NFL per-game facts remain blocked, as detailed in TOURNAMENT_SCORING_FEED_GAPS.md. No runtime activation or provider I/O under locks.
