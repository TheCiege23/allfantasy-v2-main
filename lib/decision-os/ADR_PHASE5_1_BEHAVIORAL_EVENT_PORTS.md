# ADR_PHASE5_1_BEHAVIORAL_EVENT_PORTS.md

## Status
Accepted — 2026-06-30

## Context

Phase 5.0 established the canonical behavioral event taxonomy, discriminated union, and facts
interfaces. This phase implements the read-only data-access ports that turn persisted app rows
into `BehavioralEvent[]`, and the pure assembler that aggregates them into `ManagerBehavioralFacts`
and `LeagueBehavioralFacts`.

Architecture Freeze is active. This phase is additive only:
- No Stage 1 slice modifications
- No schema changes
- No writes anywhere in the behavioral module

---

## Sources Audited

| Source Table | Event Types Emitted | Actor Field | Timestamp |
|---|---|---|---|
| `WaiverClaim` | `waiver_claim_created`, `waiver_claim_processed` | `userId` (nullable AppUser.id) | `createdAt` / `processedAt` |
| `AfLeagueTrade` | `trade_created`, `trade_accepted`, `trade_rejected` | `proposedByUserId` (required) | `createdAt` / `acceptedAt` / `rejectedAt` |
| `AfRosterMoveHistory` | `lineup_saved` | `actorUserId` (nullable) | `createdAt` |
| `DraftSession` | `draft_started` | none (system event) | `createdAt` |
| `DraftPick` | `draft_pick_made` | `ownerUserId` (nullable) | `pickedAt ?? createdAt` |

### Sources Not Available in Phase 5.1

| Event Type | Why Not Available |
|---|---|
| `lineup_viewed` | Not persisted; UI-only action |
| `commissioner_action` | No dedicated commissioner action log; `AfRosterMoveHistory.source='commissioner'` captures roster overrides but not the generic hub action taxonomy |
| `rules_changed` | League settings changes are not individually audited in a table |
| `league_opened` | Not persisted; engagement-only |
| `live_scoring_opened` | Not persisted; engagement-only |
| `recap_viewed` | Not persisted; engagement-only |

These event types are defined in Phase 5.0 and will be populated when the corresponding DB
records exist (future work).

---

## Architecture Decisions

### D1 — Provider-blindness (P1)
All five source tables are native AllFantasy tables (no Sleeper/ESPN field in their schemas).
Provider identity is never present in the event shape. `provenance.provider` is always `null`
for Phase 5.1 events. `derivedFrom` carries the source table name for debugging only.

### D2 — Honest null, no fabrication (P2)
- `managerId` is `null` when the source row has no actor `userId`. Completeness degrades −20.
- `addPlayerName` / `dropPlayerName` in `waiver_claim_created` are `null` (WaiverClaim stores
  only player IDs, not names). Each is counted as one missing metadata field (−10 each).
- `DraftPick.playerId` is nullable in the schema; when null, `draft_pick_made.metadata.playerId`
  is null (−10 missing field).
- `waiver_claim_processed.outcome` is derived from `WaiverClaim.status`: `'awarded'` when
  `status === 'awarded'`, else `'denied'`. No external lookup.
- `lineup_saved.slotChanges` is 0 and `startedPlayerIds`/`benchedPlayerIds` are `[]` because
  `AfRosterMoveHistory` does not store per-slot detail. One missing field counted (−10).
- `trade_accepted.managerId` and `trade_rejected.managerId` are `null` because
  `AfLeagueTrade` stores the receiver only as `receiverRosterId`, not as a `userId`.
  `actorConfidence: 'inferred'` for accepted events; `'unknown'` for rejected.

### D3 — No AI (P3)
All events flow from deterministic DB records. No LLM generates or annotates events.

### D4 — Completeness formula applied per event source
All Phase 5.1 sources have `timestampConfidence: 'exact'` (system-generated createdAt/processedAt).
The `hasProvider: false` deduction (−10) applies to all events since all sources are native.

| Event | managerId? | Missing fields | Base completeness |
|---|---|---|---|
| `waiver_claim_created` (with userId) | yes | 2 (names) | 70 |
| `waiver_claim_created` (no userId) | no | 2 (names) | 50 |
| `waiver_claim_processed` (with userId) | yes | 0 | 90 |
| `trade_created` | yes (always) | 0 | 90 |
| `trade_accepted` | no | 0 | 70 |
| `trade_rejected` | no | 0 | 70 |
| `lineup_saved` (with actorUserId) | yes | 1 (slot detail) | 80 |
| `lineup_saved` (no actorUserId) | no | 1 (slot detail) | 60 |
| `draft_started` | no (system) | 0 | 70 |
| `draft_pick_made` (with ownerUserId, playerId) | yes | 0 | 90 |
| `draft_pick_made` (with ownerUserId, no playerId) | yes | 1 | 80 |

### D5 — eventId determinism
All event IDs follow `{prefix}_{sourceRowId}` patterns to ensure idempotency:
- `wc_created_{WaiverClaim.id}`
- `wc_processed_{WaiverClaim.id}`
- `trade_created_{AfLeagueTrade.id}`
- `trade_accepted_{AfLeagueTrade.id}`
- `trade_rejected_{AfLeagueTrade.id}`
- `lineup_saved_{AfRosterMoveHistory.id}`
- `draft_started_{DraftSession.id}`
- `draft_pick_{DraftPick.id}`

### D6 — DraftSession pre-draft guard
`draft_started` is only emitted when `DraftSession.status !== 'pre_draft'`. A session that was
created but never started should not emit a start event.

### D7 — Row limit guard
Each port loader caps at 500 rows (`take: MAX_ROWS`) per call. This prevents accidental full-table
scans on large leagues. Callers can pass a `since` date to further narrow the window.

---

## Files

| File | Role |
|---|---|
| `lib/decision-os/behavioral/port.ts` | Raw row interfaces + Prisma read-only loaders |
| `lib/decision-os/behavioral/mappers.ts` | Pure row → `BehavioralEvent` mappers (no IO) |
| `lib/decision-os/behavioral/assemble.ts` | Pure `BehavioralEvent[]` → facts aggregation |
| `lib/decision-os/behavioral/index.ts` | Barrel re-export (updated to include 5.1 exports) |
| `__tests__/decision-os/behavioral-event-ports.test.ts` | Full suite |

---

## Non-Goals

- No cutover, no UI, no AI
- No writes to any table
- No Stage 1 slice modification
- No player-name lookup (would require join to SportsPlayer — deferred to Phase 5.2)
- No engagement events (no DB record exists yet)
- No commissioner action enumeration (source table not available)
