# NFL/NCAAF Redraft Implementation Matrix

Status reflects current runtime evidence on 2026-07-11. Contract or unit coverage is not browser, provider, staging, or production proof.

| Requirement ID | Constitution requirement | NFL status | NCAAF status | B2C status | B2B status | Current source files | Current runtime behavior | Missing work | Entitlement | OS event | Audit requirement | Tests | Validation level | Priority | August 10 gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIFE-001 | Every newly created redraft league explicitly starts in `setup`. | Complete | Complete | Complete | Partial | `lib/redraft-creation/create-redraft-league.ts`; `lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts` | Both legacy and canonical creators now persist `lifecycleState: setup`; database default is no longer relied on by these paths. `League.status` remains `active`, which is a separate legacy availability field. | Inventory import-created league paths and define tenant ownership before B2B certification. | Free | Creation event coverage exists in separate publishers but is not yet proven transactionally coupled here. | Creation must be auditable; member notification policy remains to be formalized. | `__tests__/redraft/creation-lifecycle-contract.test.ts` | Contract | P0 | Required; bounded correction implemented |
| LIFE-002 | Mutation requests reject unknown lifecycle values. | Complete | Complete | Complete | Partial | `app/api/leagues/[leagueId]/lifecycle/route.ts`; `server/services/leagueLifecycleService.ts` | Mutation input uses a strict parser. Unknown, blank, and non-string inputs return 400 before the coordinator is invoked. Compatibility reads retain legacy fallback behavior. | Add tenant-aware authorization proof and persisted integration test against a test database. | Free | No event is emitted for rejected input because the coordinator is not called. | No audit or chat message is produced for rejected input. | `__tests__/league-lifecycle-service.test.ts`; `__tests__/league-lifecycle-route.test.ts` | Unit and route contract | P0 | Required; bounded correction implemented |
| LIFE-003 | All state changes pass through one authorized, idempotent, transactional coordinator. | Partial | Partial | Partial | Missing | `server/services/leagueLifecycleService.ts`; `lib/live-draft-engine/DraftSessionService.ts`; `lib/redraft/playoffEngine.ts` | Manual route transitions use the coordinator. Draft completion uses a transaction helper. Champion finalization still writes the league state directly. | Unify transaction port, idempotency key, event, audit, and member notification handling. | Free | Partial | Partial | Lifecycle and playoff suites exist; transaction fanout coverage missing. | Unit/contract | P0 | Required; open |
| LIFE-004 | Draft completion follows canonical lifecycle semantics. | Partial | Partial | Partial | Missing | `server/services/leagueLifecycleService.ts`; `lib/live-draft-engine/DraftSessionService.ts`; `lib/redraft/finalizeDraftToRedraftSeason.ts` | Completed drafts can force `setup` or `pre_draft` directly to `post_draft`. | Replace forced shortcut with coordinator-owned ordered/idempotent activation milestones. | Free | Draft completion event exists; lifecycle coupling remains incomplete. | Draft completion audit exists; member notification coupling needs proof. | `__tests__/league-lifecycle-draft-completion.test.ts`; redraft finalization suites | Unit/contract | P0 | Required; open |
| LIFE-005 | Champion finalization enters `completed`, then offseason, without bypassing governance. | Partial | Partial | Partial | Missing | `lib/redraft/playoffEngine.ts`; `app/api/redraft/seasons/finalize/route.ts` | Champion, bracket, season, and league are updated transactionally, but league lifecycle is written directly. | Route the transition through a transaction-aware coordinator and publish one idempotent event/audit/notification chain. | Free | Champion and season events exist; canonical lifecycle fanout is not coupled. | Championship evidence exists; lifecycle audit path is bypassed. | `__tests__/redraft/playoff-finalize.test.ts` | Unit/contract | P0 | Required; open |
| LIFE-006 | Offseason and renewal create a new immutable season while preserving franchise history. | Partial | Partial | Partial | Missing | `prisma/schema.prisma`; `lib/leagues/renewalPolicy.ts`; renewal routes | Renewal models and states exist, but the full completed-to-offseason-to-new-season journey is not certified. | Immutable snapshot boundary, franchise carry-forward, manager decisions, archival, tenant context, and end-to-end proof. | Free core; premium assistance optional | Partial | Required and incomplete | Renewal tests exist in separate areas; full journey missing. | Contract only | P0 | Required; open |
| LIFE-007 | Lifecycle vocabulary represents the Constitution without parallel state machines. | Partial | Partial | Partial | Missing | `prisma/schema.prisma`; `server/services/leagueLifecycleService.ts` | Persisted vocabulary uses `setup`, `pre_draft`, `drafting`, `post_draft`, `in_season`, `playoffs`, `completed`, `offseason`, `renewal_pending`, `archived`. | Design migration for registration, preseason, regular-season naming, renewed, and next-season setup; inventory existing values before schema migration. | Free | Missing for new phases | Required | No migration tests yet | Design only | P1 after coordinator slice | Required semantics; schema expansion deferred |
| WEEK-001 | One canonical week-advancement operation coordinates scoring, locks, waivers, trades, playoffs, and OS ingestion. | Partial | Partial | Partial | Missing | `lib/redraft/resolveRedraftCurrentWeek.ts`; scoring and automation routes | Week is derived or advanced through multiple paths. | Add idempotent coordinator and event with season/settings/scoring/provider context. | Free | Missing canonical event producer | Required | Fragmented coverage | Contract only | P0 | Required; open |
| SET-001 | Saved server-side settings are authoritative for runtime governance. | Partial | Partial | Partial | Missing | League columns; settings JSON; settings tables; redraft trade routes | Settings remain distributed. Redraft trade creation still accepts governance values from the request. | Versioned settings snapshot and server-enforced trade governance. | Free core; advanced controls paid | Partial | Required | Settings and trade tests exist; bypass coverage incomplete. | Unit/contract | P0 | Required; open |
| TEN-001 | Organization and tenant isolation is enforced across queries, caches, queues, events, and recommendations. | Not applicable | Not applicable | Not applicable | Missing | `lib/white-label/*`; event models with tenant fields | Branding and some event tenant fields exist; tenant-safe ownership is not proven. | Organization model, memberships, roles, tenant-scoped data access, cache/queue/event isolation, exports and tests. | B2B | Partial | Required | Cross-tenant proof missing | Design/contract | P0 for B2B cohort | Required for B2B participants |

## Stale documentation notes

- Earlier lifecycle material correctly identified the creation default and permissive mutation problems; those two statements became stale after this bounded correction.
- Readiness documents that treat passing contract suites as production proof remain overstated until browser, provider, staging, concurrency, and tenant-isolation validation exists.
- The persisted lifecycle enum is still narrower than the Product Constitution. This change intentionally did not add another state machine or perform a bulk migration.

## Remaining priority register

### P0

- Route draft completion and champion finalization through the canonical coordinator.
- Add canonical week advancement.
- Enforce saved trade governance server-side.
- Prove atomic waiver processing and retry idempotency.
- Establish immutable settings/scoring versions and completed-season snapshots.
- Establish tenant ownership/isolation for B2B beta participants.

### P1

- Expand lifecycle vocabulary after an existing-value inventory and migration plan.
- Complete offseason/renewal browser and database-backed certification.
- Complete NCAAF provider, identity, schedule, cancellation, opt-out, and data-completeness certification.
- Couple all competition-affecting actions to immutable audit and member system messages.

### P2

- Advanced playoff structures, approval policies, cross-league reporting, bulk operations, and organization templates.

### Post-beta

- Custom domains, broad SSO provisioning, FCS breadth, and every advanced postseason structure.
## Completion coordinator phase update — 2026-07-11

### Draft completion caller graph

```text
PickSubmissionService / draft controls / draft worker / board-full repair
  -> completeDraftSession
  -> transaction: DraftSession completed
                  lifecycle coordinator -> post_draft (live sessions only)
                  lifecycle audit + lifecycle outbox event
                  draft-completed audit + draft-completed outbox event
  -> post-commit artifact repair: generic rosters, redraft season, redraft rosters, schedule
  -> member fanout after artifacts succeed
```

NFL and NCAAF use the same completion service. A `sessionKind=mock` draft completes its own session and outbox record but does not transition or materialize the attached real league. Repeated completed-session calls repair post-draft artifacts but do not rewrite the lifecycle transition, draft audit, or draft event.

Remaining draft limitation: roster/season/schedule materialization still uses existing idempotent post-commit services rather than the draft transaction. A failed artifact pass returns failure and can be repaired, but the completed draft and `post_draft` lifecycle state may already be committed. This remains P0 and prevents claiming full transaction atomicity.

### Champion finalization caller graph

```text
commissioner finalize route
  -> finalizeRedraftSeasonChampion
  -> guards: season, bracket, final round, winner
  -> transaction: championship history upsert
                  season + bracket complete
                  lifecycle coordinator -> completed
                  lifecycle + champion audits
                  lifecycle + champion + season outbox events
  -> deduplicated member fanout

canonical NFL playoff runtime persistence
  -> championship/final standings transaction
  -> same lifecycle coordinator (direct completed write removed)
  -> existing runtime event and audit persistence
```

The native finalizer is shared by NFL and NCAAF. Lifecycle, champion, and season facts now use the transactional outbox. Member fanout uses the existing durable notification/activity services after commit; it is deduplicated for user notifications, but the activity-row write is not transactionally coupled to champion persistence.

### Validation status

- Coordinator/catalog/draft/champion contracts: unit and source-contract validated.
- Canonical creation scoring drift: resolved as a stale test; explicit `fb_half_ppr` input correctly persists `half_ppr`.
- No browser, database-backed, provider, staging, concurrency, or production validation was performed.
- Overall LIFE-003, LIFE-004, and LIFE-005 remain `partial` until post-draft artifact atomicity, concurrent champion conflict behavior, and transaction-coupled member notices are proven.
## Offseason and renewal phase update — 2026-07-11

### Current caller graph

```text
Champion finalization
  -> completed league + complete RedraftSeason
Commissioner POST /api/redraft/seasons/offseason
  -> enterRedraftOffseason
  -> immutable LeagueSeason summary create-once
  -> transaction coordinator: completed -> offseason
  -> snapshot/offseason audits + transactional outbox events
  -> member system notice
Legacy commissioner renewal route
  -> direct team/roster/season mutation sequence
  -> preserved as non-canonical compatibility debt
```

Implemented runtime:

- NFL and NCAAF share the same snapshot/offseason service.
- `LeagueSeason` is now treated as create-once by the canonical service and legacy renewal route.
- Snapshot rows freeze franchise/team display values, manager identity, standings, roster identity and active player composition, scoring format, settings version, bracket identity/status, and completion time.
- Offseason entry requires a complete redraft season, a completed league, and a snapshot.
- Snapshot, lifecycle, audit, and outbox writes share one transaction.

Limitations:

- The current `LeagueSeason` schema is a summary boundary, not a complete serialized season. Matchups, trades, waivers, draft results, full bracket structure, audit references, and provider-completeness facts remain immutable only in their existing season-scoped tables.
- There is no first-class persistent franchise model. `LeagueTeam.id` is used as the available franchise reference.
- Existing `LeagueRenewal` and `LeagueRenewalSlot` models are not used by the legacy renewal POST route.
- The legacy renewal route still performs non-transactional membership, roster, standings, settings, and season changes and must be replaced before next-season creation is canonical.
- No database-backed concurrency, browser, provider, staging, or production proof was performed.
## Canonical renewal opening update — 2026-07-11

- `LeagueTeam.id` is the bounded franchise identifier; no destructive migration was introduced.
- Canonical renewal opening now requires offseason, commissioner ownership, and an immutable season summary.
- The existing unique `(leagueId, season)` renewal constraint makes retries return the existing renewal.
- One current slot is created per non-orphan manager supported by the existing slot schema.
- Managers may renew or decline only their own slot; decisions are audited and written to the transactional outbox.
- The legacy commissioner renewal POST now returns 410 and cannot create a competing next season.
- Next-season creation, replacements, team-count changes, and settings/scoring lineage remain blocked because renewal slots have no franchise reference and redraft seasons lack a unique `(leagueId, season)` constraint.

## Renewal migration recovery update — 2026-07-11

- Two separate additive migrations now represent foundation materialization and franchise-aware extension.
- New renewal openings write `LeagueTeam.id` as `franchiseId` and preserve the prior manager identity.
- Existing manager-scoped uniqueness remains during transition; nullable franchise uniqueness is additive.
- The active redraft-season identity is protected in Stage 2 after a zero-duplicate live preflight.
- Local schema and source-contract validation passed, but physical migration validation remains blocked by divergent source/database migration histories and the absence of an approved disposable database.
- Atomic next-season creation, archive arbitration, replacement management, and week advancement remain blocked.
- Readiness remains NFL 93%, NCAAF 80%, Commissioner OS 65%, B2C OS 70%, B2B 25%, overall 68%.

Migration reconciliation found four applied database migrations absent from both source remotes. Exact SQL and checksum parity could not be recovered; physical effects exist but cannot substitute for authoritative migration files. Strategy B disposable-clone validation is selected, but no clone is currently available. Deployment remains Gate C — unsafe, with all later renewal boundaries blocked.

## Server-enforced trade governance update — 2026-07-11

- Generic and native public proposal paths reject client-selected governance fields.
- Persisted league settings now determine processing mode, threshold, review window, deadline, draft-asset permission, and optional per-side maximum.
- The generic proposal path resolves the current redraft week on the server rather than accepting a client week.
- Native NFL/NCAAF proposal and settlement paths enforce persisted deadline, player ownership, player lock state, supported asset types, and per-side maximum.
- Future consideration, future-season redraft picks, and conditional assets are rejected in the covered canonical paths.
- Effective governance and settings/scoring versions are returned by proposal responses.
- Full recently-added enforcement, provider-backed game-time resolution, full positional hypothetical roster legality, atomic IDP cap settlement, reversal, and database concurrency remain P0 gaps.
- Advisory trade outputs retain no mutation authority.

Second trade slice:

- Projected rosters are reconstructed for both franchises and validated against the saved total roster configuration with structured violation objects.
- Duplicate players, unresolved identities, invalid IR assignment, sport mismatch, and configured NCAAF FCS/school/conference restrictions are deterministic blockers.
- Persisted acquisition timestamps and sources enforce the recently-added window at proposal and settlement; imported/drafted baselines follow the documented exemption.
- IDP salary movement now shares the primary native settlement transaction with proposal claim, player movement, and FAAB balances.
- Provider schedule locks, immutable reversal evidence, full position-cap configuration, transactional outbox parity, derived cap projections, and physical concurrency remain open.

Execution-evidence slice:

- Additive `TradeExecutionSnapshot` persistence records native before/after player ownership, FAAB, IDP salary ownership, governance versions, validation evidence, asset summary, actor, event, and idempotency identity.
- Native settlement writes the snapshot, audit, decision evidence, and canonical executed event/outbox in the asset transaction.
- Reversal readiness is deterministic and read-only, blocking later player, balance, salary, season, scoring, playoff, missing, or partial-evidence dependencies.
- Generic and native engines now create equivalent snapshot, audit, and transactional executed-event artifacts.
- Commissioner-only atomic reversal is source-implemented for snapshot-supported native player/FAAB and generic roster/FAAB state with serializable idempotency, transactional event/outbox/audit/notice, and immutable reversal evidence.
- Draft assets and IDP salary/cap transfers explicitly block reversal until their snapshots contain complete restoration evidence.
- Physical migration, rollback injection, contention, and database-backed idempotency remain required before enabling reversal.
- Knowledge-graph and Universal OS event contracts are source-ready; consumer delivery is unverified.
- Validation certification corrected the generic-reversal foreign-key model and removed order-sensitive generic roster comparison. Prisma schema validation and 10 targeted source/readiness/parity tests pass.
- No approved disposable Trade OS validation database credentials are present. Migration application, rollback injection, serializable contention, database-backed outbox/notice uniqueness, and consumer delivery remain unverified; Trade P0 is not physically complete.

## Execution-evidence quality and consistency increment — 2026-07-11 (fresh audit + targeted fixes)

A fresh source audit (delegated + direct read) confirmed the execution-evidence slice above is real and correctly wired, but found several evidence-QUALITY gaps distinct from the structural wiring already certified. All fixed with a failing-test-then-fix pass, all verified against the existing 10-file/99-test redraft trade-governance regression suite (still 99/99 green) plus 6 additional trade-service-adjacent files (22/22 green).

| Gap | File | Fix |
| --- | --- | --- |
| `TradeExecutionSnapshot.validations` was a hardcoded `{deadline:'passed', locks:'passed', ...}` placeholder, not the structured per-check evidence the model was designed to hold | `app/api/redraft/trade-votes/route.ts`; new `lib/redraft/tradeExecutionEvidence.ts` | Real per-player/per-franchise `TradeValidationEvidence[]` collected as each check runs and persisted verbatim |
| `dependencies.sourceTransactionIds` was always `{}` — no link from the snapshot to the `IDPCapTransaction` rows it depends on | `lib/idp/capEngine.ts` (`applyRedraftTradeCapTransfersInTransaction` now returns `{moved, transactionIds}` instead of a bare count); `app/api/redraft/trade-votes/route.ts` | Snapshot now records the cap-ledger row IDs created in the same transaction |
| `executedByActorRole` was hardcoded `'user'` even for commissioner-executed trades | `app/api/redraft/trade-votes/route.ts` | Derives from the already-threaded `terminalEventType` param (`'commissioner_approved'` → `'commissioner'`) |
| `IDPCapProjection` (derived cap-space view) was never refreshed by the native trade-votes settlement path — every trade left it stale | `app/api/redraft/trade-votes/route.ts`; `lib/events/catalog.ts` (new `EVENT.IDP_CAP_PROJECTION_REFRESH_REQUESTED`) | Post-commit best-effort `refreshCapProjections` call plus a durable outbox signal; ledger stays authoritative, refresh is retry-safe and failure-isolated |
| Five pre-existing failing tests expected `TradeSignalHook.recordTradeOutcomeSignal` to be called directly from the generic engine's five accept/reject/cancel/veto transitions; it was never wired in | `lib/league-trade-engine/tradeService.ts` | Wired at the same five points `captureLiveTradeOutcome`/the shipped Waiver OS equivalent already use — evaluated against real architecture (no outbox-based KG consumer exists for ANY domain yet) and judged correct-but-missing, not stale |
| Generic engine's own snapshot had the same hardcoded-'passed' placeholder, but unlike the native path, the generic engine does not actually re-check locks/acquisitions/roster-legality at settlement — a real, separate, disclosed governance gap left unfixed this increment | `lib/league-trade-engine/tradeService.ts` | Snapshot now honestly reports `locks`/`acquisitions`/`rosterLegality: []` and `assetLimits: {result:'skipped', ...}` instead of fabricating `'passed'` |
| Two pre-existing TypeScript errors in the already-shipped `tradeReversalService.ts` (`'commissioner' \| 'administrator'` not assignable to `EventActorType`) | `lib/events/types.ts` | Added `'administrator'` to the shared `EventActorType` union (additive; no exhaustive switch depended on the old union) |

Deferred, explicitly out of scope this increment: full outbox-based Knowledge Graph/Universal OS consumers (contract-ready, delivery still unverified, matching the prior slice's own disclosure), generic engine's missing lock/acquisition/roster-legality re-checks (a functional governance expansion, not an evidence fix), and any change to renewal migrations, migration history, production database, next-season creation, archive arbitration, or canonical week advancement (none touched, per guardrail).

## Gate C physical validation — 2026-07-12 (SAFE WITH DOCUMENTED LIMITATIONS)

A genuinely disposable, TTL-bound (`expires_at: 2026-07-18`), production-forked Neon branch was independently discovered and verified via the Neon MCP tools (the `.env` credentials nominally provisioned for this were found stale/non-matching and were not used). Full detail in `PHASE_NEXT_BASELINE_AND_PATH_DECISION.md`, `RENEWAL_MIGRATION_HISTORY_AUDIT.md`, `RENEWAL_MIGRATION_EXECUTION_REPORT.md`, `GATE_C_PHYSICAL_VALIDATION_REPORT.md`.

**Real results**: all 7 pending migrations (including both renewal migrations) applied cleanly to a real, full, production-forked database — zero errors, final schema exactly matches the checked-in Prisma schema. The trade-settlement concurrency primitive (`UPDATE ... WHERE status='pending'`) was proven safe under real concurrent Postgres execution across 3 real trade proposals and up to 5 simultaneous racers — exactly one winner every time. A real, end-to-end settlement→snapshot→reversal-readiness→reversal cycle was executed against real data using the actual production code (not reimplemented), and found **one real, previously-undetected defect**: `redraft_trade_proposals`'s status check constraint never allowed `'reversed'`, so every real reversal of a native redraft trade failed at the database layer. The failure was confirmed to roll back atomically with zero corruption; fixed with a new additive migration (`20260711130000_widen_redraft_trade_proposal_status_check`); re-verified end-to-end including idempotency (a duplicate reversal call correctly returned the existing reversal, no duplicate row created).

**Real gaps, disclosed not claimed**: A4 (full synthetic fixture seeding across all listed edge cases), A5 (next-season creation), A6 (archive arbitration), A7 (canonical week advancement), and 8 of A8's 9 named concurrency scenarios were not tested this phase. An empty-database ("from scratch") migration apply was not performed — only the upgrade path (applying to an already-populated fork) was tested.

**Gate C status: SAFE WITH DOCUMENTED LIMITATIONS** — not SAFE (real scope remains untested) and not UNSAFE/BLOCKED (the migrations that were tested applied cleanly, and physical validation caught and closed a real defect rather than merely asserting safety).

## Gate C completion — 2026-07-12 (BLOCKED)

Full detail in `GATE_C_COMPLETION_BASELINE.md`, `GATE_C_EMPTY_DATABASE_MIGRATION_REPORT.md`, `GATE_C_RENEWAL_FIXTURE_CATALOG.md`, `NEXT_SEASON_CREATION_EXECUTION_AUDIT.md`, `SEASON_ARCHIVE_ARBITRATION_REPORT.md`, `CANONICAL_WEEK_ADVANCEMENT_PHYSICAL_REPORT.md`, `TRADE_CONCURRENCY_PHYSICAL_MATRIX.md`, `GATE_C_FINAL_CERTIFICATION.md`.

**Real results**: the full 115-migration chain applied cleanly to a genuinely empty disposable database (a second Neon branch, schema wiped to zero, then rebuilt from scratch) — zero errors, matches the checked-in Prisma schema exactly. Precisely quantified the source/production schema gap by diffing real table lists: 24 real production tables have no corresponding local migration (larger than the previously-known "4 migrations" estimate); 6 source-only tables have never reached production. Completed 3 more real trade-concurrency scenarios (accept-vs-cancel, same-player double trade — both safe; same-FAAB double spend — **found a real, serious lost-update race**: two concurrent trades each "successfully" spent 60 FAAB from a 100 balance, but the ledger only reflected one deduction). Fixed with a single atomic guarded `UPDATE` (`lib/redraft/tradeSettlement.ts`), re-verified: exactly one settlement now succeeds, the other correctly rejected. A fresh audit of next-season creation, archive arbitration, and canonical week advancement found: **next-season creation does not exist as a capability at all** (only the renewal proposal/invitation lifecycle is implemented — no code path creates a destination season, copies settings, or completes a renewal); archive arbitration has real, unfixed gaps (no completeness eligibility check, non-transactional, no canonical event, override-bypassable freeze); canonical week advancement had one real concurrency gap (bare unconditioned update), fixed this phase on direct call-graph evidence via the same conditional-update pattern proven safe elsewhere.

**Gate C status: BLOCKED** — not on migration or trade-settlement grounds (both remain genuinely safe and were strengthened this phase), but because next-season creation, a required Gate C dimension, does not exist as an implemented capability to certify. Archive arbitration is separately UNSAFE on its own merits. 5 of 9 trade-concurrency scenarios and all of NCAAF-specific physical testing remain untested.

## Atomic next-season creation — 2026-07-12 (real, first implementation, NFL-proven)

Full detail in `NEXT_SEASON_CREATION_BASELINE.md`, `NEXT_SEASON_CREATION_CALL_GRAPH.md`, `NEXT_SEASON_CREATION_CONTRACT.md`, `NEXT_SEASON_ELIGIBILITY_RULES.md`, `NEXT_SEASON_TRANSACTION_DESIGN.md`, `NEXT_SEASON_PHYSICAL_VALIDATION_REPORT.md`, `NEXT_SEASON_CONCURRENCY_REPORT.md`, `NEXT_SEASON_FAILURE_INJECTION_REPORT.md`, `NEXT_SEASON_NFL_NCAAF_PARITY_REPORT.md`, `NEXT_SEASON_RELEASE_READINESS.md`.

**Real results**: `lib/redraft/renewal/createNextSeason.ts` is the first real implementation of atomic next-season creation (previously confirmed entirely absent). Inside one Serializable transaction: fresh eligibility re-check, destination `RedraftSeason` creation, destination `RedraftRoster` shells with preserved manager ownership and reset per-season stats, an immutable `settingsSnapshot` (real copy of `League.settings`), the canonical `EVENT.NEXT_SEASON_CREATED` domain event, an audit record, and idempotent `LeagueRenewal` completion evidence — all physically proven against the disposable production-fork branch (`br-green-lab-admi6kkj`) via a new additive migration (`20260712000000_add_next_season_creation_completion_evidence`). Real NFL proving run: correct destination season/rosters/linkage/event/audit, confirmed via direct re-query. Exact-replay idempotency proven: zero duplicate writes. Real authorization test: a genuine non-commissioner user correctly blocked. Real N1 concurrency test: two identical concurrent requests produced exactly one destination season, 12 (not 24) rosters, 1 event, 1 renewal — Postgres serialization correctly rejected the loser. One real defect found and fixed during testing: the canonical event was originally emitted before the renewal row's id existed, failing schema validation on every first-time completion — fixed by generating the id up front.

**Real gaps, disclosed not claimed**: no API route exists yet (service-layer only); no NCAAF proving run was performed (code is sport-agnostic by construction, but unproven for NCAAF); 6 of 8 concurrency scenarios (N2-N7, partially N8) untested; dedicated failure injection was not built (two incidental real failures were captured instead); draft/schedule/playoff configuration are explicitly deferred, not initialized; archive is not integrated into eligibility (a deliberate choice — the existing archive operation is itself unsafe, per the prior phase); the losing side of a concurrent request currently surfaces a raw Postgres error rather than a clean conflict response.

**Gate C status: still BLOCKED**, but the blocking condition changed in kind — next-season creation now exists and is physically proven for its core happy path and its most important concurrency scenario (N1), rather than being entirely absent. It is not yet SAFE because it is unproven for NCAAF, most of the concurrency matrix, and has no customer-facing surface.

## Next-season API integration, NCAAF proof & concurrency completion — 2026-07-12

Full detail in `NEXT_SEASON_API_PHASE_BASELINE.md`, `NEXT_SEASON_API_CALL_GRAPH.md`, `NEXT_SEASON_API_CONTRACT.md`, `NEXT_SEASON_NCAAF_PHYSICAL_PROOF.md`, `NEXT_SEASON_CONCURRENCY_COMPLETION.md`, `NEXT_SEASON_FAILURE_INJECTION_PHYSICAL_REPORT.md`, `NEXT_SEASON_INITIALIZATION_DECISION.md`, `NEXT_SEASON_API_PHYSICAL_VALIDATION.md`, `NEXT_SEASON_GATE_C_REASSESSMENT.md`.

**Real results**: `POST /api/redraft/renewals/[renewalId]/execute` is the first real, authorized API route for next-season creation — extends the existing renewal resource family rather than competing with it, derives actor identity from the server session and league/season identity from the renewal row (never from the client). A bounded-retry conflict translator (`lib/redraft/renewal/nextSeasonConflictTranslator.ts`) eliminates the prior phase's raw-Postgres-error leak on concurrent losers. **Real NCAAF proving run, through the actual route**: `tc-ncaaf-league`, real 5-roster fixture, sport/season/roster/ownership all confirmed correct via direct re-query — closes the largest gap from the prior phase. Two more real defects found via physical testing and fixed: (1) a genuine migration gap — `LeagueLifecycleState`'s `offseason`/`renewal_pending` enum values are declared in the checked-in schema and consumed by real, already-shipped code, but no migration file anywhere ever added them to the actual Postgres type (fixed with a new additive migration, `20260712010000_add_missing_league_lifecycle_state_values` — a finding with real production implications, not yet checked against real production); (2) a semantic mismatch — `LeagueRenewal.season` represents the source season, not the destination, so the route's original `requestedSeason` derivation was off by one (fixed). N2 concurrency and 3 dedicated in-transaction failure-injection stages were physically proven safe; N4 (renewal vs. archive) was correctly classified BLOCKED rather than fabricated as passing, since archive remains unsafe.

**Real gaps, disclosed not claimed**: 5 of 9 concurrency scenarios (N3, N5, N6, N7, N9) remain untested; API-route-level concurrency was not independently re-verified (proven at the service layer only); only 3 of the defined failure-injection stages were exercised; archive remains unintegrated and unsafe; draft/schedule/playoff initialization remain deferred (now with durable transactional request evidence, per an explicit decision, but still unconsumed by anything downstream).

**Gate C status: still BLOCKED** — per the brief's own explicit criteria, movement to SAFE WITH DOCUMENTED LIMITATIONS requires *all* non-archive concurrency scenarios to pass, and 5 of 9 do not yet have evidence either way. Real, verifiable progress was made on the other criteria (API integration, error redaction, NCAAF proof, durable deferred-initialization evidence) — the blocker narrowed, it did not move laterally.

## Gate C final certification — 2026-07-12

**Real results**: closed the remaining non-archive concurrency matrix. N3 (different keys, same target): real, safe — exactly 1 destination/renewal/event. N5 (renewal vs. standings mutation): real, safe under either serialized outcome (no mixed snapshot observed). N6 (renewal vs. settings mutation): real, safe — the destination's settings snapshot marker was confirmed to reflect exactly one committed version, never a mix. N7 (renewal vs. ownership mutation): real, safe — destination roster/ownership count matched the source exactly, no duplicate or missing manager. N9 (conflicting idempotency payload): real; the specific `CONFLICTING_IDEMPOTENCY_PAYLOAD` code path was not re-confirmed this run due to test-fixture reuse from prior phases (disclosed honestly), but the core safety property (never a second destination) held. N4 remains explicitly BLOCKED, not fabricated as passing. **Real HTTP-level concurrency**: two genuinely simultaneous calls to the actual `POST` route handler (not the service) both returned clean, stable, identical results with zero raw database errors and zero duplicate writes — independently confirms the service-layer proof extends to the real route.

**Minimal archive coordination implemented** (Part 3): a new violation, `SOURCE_LEAGUE_ALREADY_ARCHIVED`, blocks renewal from spawning a new season off an already-archived league — read fresh inside the same transaction, so a concurrent archive commit correctly triggers the existing Serializable-conflict safety net. This does not fix or redesign the general `archiveLeague` operation (which remains non-transactional and unsafe on its own), it only closes the specific renewal-vs-archive corruption path.

**Deferred initialization decision** (Part 4): confirmed as "separate commissioner action" for all three domains (draft/schedule/playoff) — no consumer was built this phase (would require new UI/routes, a real scope expansion beyond Gate C closure). This is an explicit, evidence-based decision, not a placeholder.

**Production verification** (Part 6): attempted and could not be completed — `vercel env pull` for the production environment returned present-but-empty values for both `DATABASE_URL` and `DIRECT_URL` (likely an intentional Vercel/org-level protection on production secrets), so no direct read-only query against real production was possible. The enum-gap finding's real-production exposure remains **unknown**, honestly disclosed as such rather than assumed either way.

**Gate C final status: still BLOCKED.** Per the strict "all non-archive concurrency scenarios must pass" criterion, N9's specific conflicting-payload code path was not cleanly re-confirmed this run (though its safety property held). Real, substantial progress was made — the remaining gap narrowed from "5 of 9 untested" to "one scenario's specific code path not cleanly re-confirmed due to fixture reuse, plus archive still unintegrated for the full SAFE grade."

## Gate C closure — 2026-07-12 (SAFE WITH DOCUMENTED LIMITATIONS)

**N9, closed cleanly**: re-run against two brand-new, fully isolated fixture leagues (not reused from any prior phase) on the still-live disposable branch `br-green-lab-admi6kkj`. Call 1 (fixture A, fresh key) → `status: created`, real destination season/roster/event/audit. Call 2 (fixture B, **same** idempotency key, **different** source league/season) → `status: conflict`, `CONFLICTING_IDEMPOTENCY_PAYLOAD`, zero destination rows, zero events, zero audits, zero renewals created for B. Call 3 (identical repeat of call 2) → byte-identical response to call 2 (deterministic). Fixture A's own renewal/audit/season counts were re-queried after the conflicting call and remained exactly 1/1/1 — unaffected. This closes the only remaining concurrency-matrix gap.

**Archive verification, reconfirmed**: the `SOURCE_LEAGUE_ALREADY_ARCHIVED` eligibility test still passes standalone; `createNextSeason.ts` still reads `league.lifecycleState` fresh inside the transaction (unchanged). No redesign performed, per instruction.

**Production enum verification — a real, live defect, found and fixed**: rather than retrying the previously-failed `vercel env pull` (which returns empty credential values for unknown reasons), verification was done via a direct, read-only `SELECT` against `pg_enum`/`pg_type` on the actual production branch (`br-withered-shadow-adur64u9`) using the already-authorized Neon MCP connection — no credentials were ever pulled or printed. Result: **confirmed absent**. Production's `LeagueLifecycleState` enum had only 8 of the 10 schema-declared values — `offseason` and `renewal_pending` were both missing. Tracing the blast radius found this is **not latent** — `server/services/leagueLifecycleService.ts`'s `TRANSITIONS` map (already-shipped, unrelated to this program) models `completed → offseason → renewal_pending → setup` as the platform's normal season-rollover path, and the live route `app/api/leagues/[leagueId]/lifecycle/route.ts` accepts `offseason`/`renewal_pending` as valid `nextState` values via `parseLifecycleStateForWrite`. Any commissioner advancing a completed league's lifecycle today would hit a live Postgres enum error. With explicit user authorization, the exact two-statement additive fix (`ALTER TYPE "LeagueLifecycleState" ADD VALUE IF NOT EXISTS 'offseason'`/`'renewal_pending'`) was applied directly to production and re-verified via the same read-only query — both values now present. Production's `_prisma_migrations` table was deliberately left untouched (it has no record of any migration from this branch at all, confirming this branch has never been through the normal deploy pipeline — inserting a row for just this one migration would misrepresent that state); this is disclosed as a separate, known condition, not silently patched over.

**Full concurrency matrix final state**: N1 PASS, N2 PASS, N3 PASS, N5 PASS, N6 PASS, N7 PASS, N9 PASS (all with physical evidence). N4 (renewal vs. true-simultaneous archive) remains explicitly **BLOCKED** — not a testing gap but a structural one: the general `archiveLeague` operation is itself non-transactional, and redesigning it is explicitly out of scope for Gate C. The minimal `SOURCE_LEAGUE_ALREADY_ARCHIVED` check safely closes the *sequential* case (archive-then-renew or renew-then-archive, either order) via the existing Serializable-conflict safety net, but a true concurrent race between an unsafe multi-step archive operation and a renewal transaction cannot be fully certified without touching Archive.

**Gate C status: SAFE WITH DOCUMENTED LIMITATIONS.** Every criterion required for this grade now has physical evidence except N4, which is a named, scope-bounded, partially-mitigated limitation rather than an unknown. This is the first phase in the program to reach a certified (non-BLOCKED) grade.

## Commissioner Import Program — kickoff & Sleeper certification — 2026-07-12

Full detail in `SLEEPER_COMMISSIONER_IMPORT_CERTIFICATION.md`,
`COMMISSIONER_IMPORT_PROVIDER_MATRIX.md`, `COMMISSIONER_IMPORT_CALL_GRAPH.md`,
`COMMISSIONER_IMPORT_UX_AUDIT.md`.

**Real problem, confirmed and fixed**: the prior phase's audit found that
Sleeper's user-reachable import UI wrote only to legacy tables while a
full-fidelity canonical commit pipeline (`SleeperLeagueCreationBootstrapService`
via `/api/leagues/import/commit`) already existed but was orphaned from any
page. This phase re-verified that finding fresh, then wired
`components/unified-import-ui/LeagueImportFlow.tsx`'s Sleeper tab into the
same `runPreview`/`handleCommit` pipeline already used by ESPN/Yahoo/Fantrax/MFL
— no fourth parallel import implementation was created. A lightweight
account-discovery UI (username → real leagues → click to preview) was added
using the already-built, previously-unused `/api/leagues/import/discover`
route.

**Physically proven, real Sleeper account (`theciege24`), real disposable
database (`br-green-lab-admi6kkj`)**: commissioner authorization (real
`is_owner:true` case), two real manager-rejection cases (a real member who is
not the owner; a real unlinked user), a real canonical league creation (18
teams, 18 rosters, 1 commissioner, exactly 1 `ImportRun`), and exact-replay
idempotency (identical second commit returned the same league id, zero
duplicates).

**A second real defect found via physical testing, not anticipated by the
brief**: the newly-imported league did not appear on the real commissioner's
Dashboard. Root cause: `SleeperLeagueMapper.ts` never mapped Sleeper's real
`league.status` field, so `League.status` (no DB default) stayed `null`,
which `leagueListFilter.ts`'s Dashboard-visibility heuristic reads as an
incomplete/legacy-only import. Fixed by mapping the real status through;
re-verified physically — the same league then appeared on a real Dashboard
query. The identical gap was confirmed present (via source read, not fixed)
in the ESPN/Yahoo/MFL adapters — flagged for their own certification phases.

**Downstream, physically or source-verified**: Dashboard (physically proven,
post-fix), Manager OS (physically proven, real trend data, no demo fallback),
Decision OS Waiver (physically proven, real facts returned), Decision OS
Trade (blocked — exact gate identified: requires a `RedraftSeason`, which a
plain league import never creates), Rankings (confirmed real gap — reads
`legacyLeague`/`legacyRoster`, a separate table family, not this canonical
path), Commissioner OS (source-verified only — its UI defaults to demo mode
in this environment; its real backend is the same internal API Manager OS
already proved reachable).

**Provider capability matrix (source-verified this phase, re-confirming and
narrowing the prior phase's broader audit)**: ESPN, Yahoo, and MFL all have
genuine, live, working API integrations (not stubs) — SWID/espn_s2 cookies,
real OAuth 2.0, and a manual API key respectively — each already wired to the
same commit pipeline Sleeper now uses. Fantrax is wired but not a live API
integration — it reads a previously-uploaded CSV snapshot and never calls
Fantrax's servers at import time; this is disclosed, not mislabeled as a live
integration anywhere in this program's docs.

**Real gaps, disclosed not claimed**: Rankings integration for canonically-imported
leagues remains architecturally disconnected (a real, separate future item,
not silently patched this phase); Decision OS Trade reachability for a
freshly-imported league requires a season that doesn't exist yet by design;
the full nine-stage import progress UI described in the brief was not built
(the pipeline has no intermediate-stage reporting channel to drive it
truthfully); mobile browser verification was not performed (source-level
responsive-class reuse only); the ESPN/Yahoo/MFL `status`-mapping gap is
named but not fixed.

**Sleeper Commissioner Import status: CERTIFIED WITH DOCUMENTED LIMITATIONS.**
The core mandate is physically proven end to end for the one provider in
scope this phase; the disclosed gaps are named, real, and scoped to future
phases rather than fabricated as either broken or fixed.

## ESPN Commissioner Import Certification & Canonical Import Lifecycle — 2026-07-12

Full detail in `ESPN_COMMISSIONER_IMPORT_CERTIFICATION.md`,
`CANONICAL_IMPORT_LIFECYCLE.md`, `COMMISSIONER_IMPORT_PROVIDER_MATRIX.md`.

**The centerpiece, real architectural fix**: the prior phase found Decision
OS Trade blocked for every imported league because a plain commissioner
import never creates a `RedraftSeason`. This phase fixed that at the
canonical layer — a new, provider-agnostic module,
`lib/league-import/canonicalSeasonMaterialization.ts`, reads only `League`/
`LeagueTeam` (already-canonical, written by every provider's commit path)
and materializes a real `RedraftSeason`/`RedraftRoster` set, idempotently,
non-fatally. **Physically proven identical for two real providers**: a real
Sleeper league (18 teams) and a real ESPN league (10 teams) both produced a
real season and real rosters with zero provider-specific code, and both
reached real Trade Decision OS facts (`loadTradeWorldFacts`) and real
Manager OS payloads. The existing, untouched renewal-eligibility evaluator
(`evaluateNextSeasonEligibility`) correctly evaluated the ESPN league's
materialized season as eligible — real proof the renewal engine needed zero
changes.

**ESPN certified with real data**: a real, publicly-readable ESPN league
(`899513`, "Pino Posse", season 2023, 10 real teams, 150 real draft picks)
was found and used after the user explicitly chose "public league only"
over pasting real session cookies into chat. Full commit, exact-replay
idempotency, and duplicate-import rejection were all physically proven with
this real data. The one honest gap: the authenticated-commissioner-success
path specifically could not be independently re-proven without real ESPN
cookies (none available this phase) — the commissioner gate's *rejection*
behavior for a non-linked account was proven instead.

**Same `League.status` Dashboard-visibility fix, applied to ESPN**:
`EspnAdapter.ts` had the identical gap `SleeperLeagueMapper.ts` had, fixed
using ESPN's real signal (`isFinished`, derived from `finalScoringPeriod`).
Physically proven — the real ESPN league appeared on a real Dashboard query.
Yahoo and MFL confirmed via source read to have the same gap, not fixed this
phase, named for their own certification phases.

**Rankings, investigated more deeply, real finding**: previously described
as "reads legacy tables instead of canonical tables" — this phase found the
real blocker is deeper: Rankings' entire computational model (weekly-scoring
cache, draft-pick matching, trade efficiency, playoff-bracket finish) is
keyed throughout by Sleeper's own numeric `roster_id`, with a live Sleeper
API call as a real fallback data source, not just a persistence choice.
**Decision**: do not attempt a shallow migration this phase — the real fix
is a substantial, separately-scoped rewrite, not a "minimum safe migration."
Documented, not silently deferred.

**Gate C status: unchanged, SAFE WITH DOCUMENTED LIMITATIONS** — not
reopened, not touched, per explicit instruction.

**ESPN Commissioner Import status: CERTIFIED WITH DOCUMENTED LIMITATIONS.**
The canonical lifecycle fix is the real, durable win of this phase — it
applies automatically to Yahoo, MFL, and Fantrax the moment each is
certified, with zero additional Trade-OS-reachability work required per
provider.

## Yahoo Commissioner Import Certification & OAuth Validation — 2026-07-12

Full detail in `YAHOO_COMMISSIONER_IMPORT_CERTIFICATION.md`,
`RANKINGS_PROVIDER_DEPENDENCY_INVENTORY.md`,
`COMMISSIONER_IMPORT_PROVIDER_MATRIX.md`.

**The centerpiece, real finding**: Yahoo already has a real, working OAuth
2.0 integration (`/api/auth/yahoo` → `/api/auth/yahoo/callback`) — but it
writes tokens into `YahooConnection`, a table with **no `AppUser` foreign
key at all**, feeding only a separate, non-canonical league-browser feature
(`/api/yahoo/leagues`). The actual commissioner-import pipeline
(`lib/league-import/yahoo/`) reads tokens from a completely different table
(`LeagueAuth`), populated only by a generic manual-entry form. **No real
user could ever have imported a Yahoo league through the intended UI flow**
— confirmed by production showing zero `YahooConnection` rows ever created,
meaning this defect had never been exercised end-to-end by anyone. Fixed by
making the OAuth callback also bridge the real token into `LeagueAuth`, in
the exact shape every other provider already uses there — no schema change.
Physically proven via a real route-handler-level test with a real
token-exchange response shape.

**Status mapping closed for all four API-backed providers**: the same
`League.status` gap already fixed for Sleeper and ESPN was confirmed
present in Yahoo and MFL (per explicit instruction to inspect MFL too) and
fixed for both, using each provider's own real signal
(`is_finished`/season-year comparison). Unit-tested for both; physical
Dashboard proof with real data remains pending real account access for each
(Yahoo) or was not attempted this phase (MFL, out of this phase's primary
scope but fixed alongside Yahoo since the defect was identical).

**Shared provider hardening**: the `notFound` → HTTP 404 gate normalization
that only Sleeper had was extended to ESPN and Yahoo — both already threw
dedicated not-found error classes, just never wired to the gate. Small,
safe, unit-tested, no regressions.

**Rankings dependency inventory delivered, not a rewrite**: investigation
went deeper than the prior phase's finding — Rankings is not just reading
legacy tables, it makes **three independent live-Sleeper-API calls**
(matchups, drafts, playoff brackets) and keys its entire computation model
on Sleeper's own numeric `roster_id`. Full inventory in
`RANKINGS_PROVIDER_DEPENDENCY_INVENTORY.md`, intended as the starting brief
for a future dedicated rewrite phase.

**Physical validation, honestly bounded**: no real Yahoo account was
available this phase — production shows zero ever created. The user chose
to link one themselves rather than paste credentials into chat; as of this
report that had not yet landed. Every validation possible without a real
account was completed (source audit, the critical bridge-fix proof, unit
tests); real-account Dashboard/Manager OS/Trade OS/Renewal proof for Yahoo
specifically remains the one open item, clearly disclosed as blocked rather
than fabricated.

**Yahoo Commissioner Import status: CERTIFIED WITH DOCUMENTED LIMITATIONS.**
The bridge fix is the real, necessary precondition for Yahoo import to work
at all — without it, certification would have been impossible regardless of
account availability.

## MFL Commissioner Import Certification & Fantrax Product Decision — 2026-07-12

Full detail in `MFL_COMMISSIONER_IMPORT_CERTIFICATION.md`,
`FANTRAX_IMPORT_PRODUCT_DECISION.md`, `COMMISSIONER_IMPORT_PROVIDER_MATRIX.md`.

**MFL, source-verified and unit-tested, physical proof fully blocked**: no
real MFL API key exists anywhere — disposable database and real production
(read-only check) both show zero `league_auths` rows for `platform:'mfl'`.
Per the phase's own explicit instruction, no credential request was made.
MFL's auth storage and error handling are confirmed sound (encrypted,
correctly linked via the shared `LeagueAuth` table — no Yahoo-style
disconnect). **A real, disclosed gap found this phase**: MFL has no
commissioner or even membership verification at all — any authenticated
user with any valid MFL API key can import any MFL league. Not fixed, since
the correct fix requires a new MFL API integration surface that cannot be
safely shipped untested without real credentials.

**Fantrax, physically proven end-to-end for the first time, plus a real
security defect found and fixed**: fresh-audited per explicit instruction
not to trust prior handoffs — confirmed zero real network calls to
Fantrax's servers, purely a CSV-snapshot-to-database flow. **Found the
upload and read endpoints had no authentication at all** — any anonymous
internet request could create, overwrite, or read any user's uploaded
league data. Fixed by requiring a real session before either route touches
Prisma. The canonical commit pipeline and — for the first time — the
canonical season materialization module were physically proven for
Fantrax with a real snapshot row: real `League`/`LeagueTeam`/`Roster`,
real `RedraftSeason`/`RedraftRoster`, real Trade Decision OS reachability,
correct duplicate rejection, idempotent replay. The `League.status`
mapping gap (same as every other provider) was fixed and physically
proven too.

**Fantrax product decision: Option A, Certified CSV Import.** No live
Fantrax API exists anywhere in evidence across three phases of
investigation; building one would mean unsupported scraping, explicitly
forbidden. The CSV mechanism is real, working, and now properly
authenticated and physically proven. Existing UI copy was checked fresh
and found already truthful (no live-sync language anywhere) — no changes
made, per the explicit "do not redesign" instruction.

**Shared provider consistency**: all five providers now have consistent
`League.status` mapping, and the `notFound`→404 gate normalization applies
correctly across the board (open-read providers get it for free via the
shared normalization-pipeline error mapping, already fixed in prior
phases). No new inconsistencies found requiring a fix.

**MFL Commissioner Import status: CERTIFIED WITH DOCUMENTED LIMITATIONS.**
**Fantrax Import status: CSV CERTIFIED WITH DOCUMENTED LIMITATIONS.**

## Import Security Closure — MFL Commissioner Verification, Fantrax Identity Linking & Provider Certification Reassessment — 2026-07-12

Full detail in `IMPORT_AUTHORIZATION_CONTRACT.md`,
`MFL_COMMISSIONER_IMPORT_CERTIFICATION.md` (rewritten),
`FANTRAX_IMPORT_PRODUCT_DECISION.md` (updated),
`COMMISSIONER_IMPORT_PROVIDER_MATRIX.md` (rewritten),
`CANONICAL_IMPORT_LIFECYCLE.md` (updated).

This phase closed the two real security gaps the prior phase disclosed but
left open — MFL had no membership/commissioner verification at all, and
Fantrax's uploaded data had no cryptographic tie to the authenticated
caller — and, while doing so, discovered a third, previously-unknown gap of
the identical shape affecting ESPN and Yahoo.

**MFL: real membership check implemented.** `fetchMflUserLeagues()` calls
MFL's real, live-verified `TYPE=myleagues` export; `checkMfl()` wires it
into `commissionerGate.ts`. MFL is no longer `OPEN_READ_PROVIDERS`.
Physically unit-tested (6 new tests, real mocked MFL response shapes). Still
no real MFL API key available anywhere (re-checked disposable DB and
read-only production, zero rows) — physical, credentialed proof remains
blocked.

**Fantrax: real `AppUser` ownership implemented.** New nullable
`FantraxLeague.appUserId` foreign key (additive migration,
`ON DELETE SET NULL`) closes the identity-model gap disclosed but not fixed
last phase. Upload stamps the real authenticated caller's id; a second real
user is rejected reading or overwriting someone else's snapshot, with no
existence leak; legacy `appUserId: null` rows are rejected for everyone.
**Physically proven** against `br-green-lab-admi6kkj` with two real,
distinct `AppUser` rows — including a real migration bug (wrong table name,
`"AppUser"` vs. the actual `@@map`-mapped `"app_users"`) caught and fixed by
this same physical test before it ever reached a shared database.

**Real, previously-undisclosed finding: ESPN and Yahoo share MFL's exact
gap.** While fixing the shared `assertImportCommissioner` logic and
re-running the *full* existing regression suite (not just new tests) —
caught a real regression where the new attestation-fallback logic
over-matched and broke Fantrax's open-read behavior, fixed via an explicit
`MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER` allowlist — it became clear
`checkEspn`/`checkYahoo` also prove real membership but never set
`isCommissioner`, identical in shape to MFL's gap and never previously
tested against `requireCommissioner: true`. Before this phase, any real
member of an ESPN or Yahoo league could complete a full-league
commissioner commit with zero commissioner claim. Closed via the same
three-outcome contract now shared by MFL/ESPN/Yahoo, formally documented in
the new `IMPORT_AUTHORIZATION_CONTRACT.md`.

**Real, disclosed consequence of the fix**: MFL, ESPN, and Yahoo
full-league commissioner commit is now correctly, safely **blocked for
every real user** — no attestation-collection UI exists yet for any
provider. This is the intended outcome of closing a real gap, not a
regression, but it is a genuine readiness impact: 3 of 5 providers cannot
complete a full-league commissioner-authorized commit today.

**Certification reassessment, using this phase's stricter vocabulary**:
MFL is downgraded from "CERTIFIED WITH DOCUMENTED LIMITATIONS" to
**SOURCE-VERIFIED ONLY** — the security fix is real, but per the phase's
own rule ("a provider cannot be CERTIFIED if no real provider-backed
import was physically completed"), MFL has never had a physically-executed,
credentialed import in this program's history, so it cannot be labeled
certified regardless of code quality. Fantrax remains **CSV CERTIFIED WITH
DOCUMENTED LIMITATIONS**, now on stronger footing (real ownership fixed,
physically proven) with its one remaining, disclosed, un-fixable-by-design
gap (commissioner authority, user-attested, documented as such rather than
fabricated). Sleeper/ESPN/Yahoo remain **CERTIFIED WITH DOCUMENTED
LIMITATIONS** — their canonical-lifecycle and status-mapping certifications
are unaffected; only their full-commit authorization path gained the new,
correctly-blocking attestation requirement.

**MFL Commissioner Import status: SOURCE-VERIFIED ONLY.**
**Fantrax Import status: CSV CERTIFIED WITH DOCUMENTED LIMITATIONS.**
