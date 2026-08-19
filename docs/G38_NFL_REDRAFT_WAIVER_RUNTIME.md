# G38 NFL Redraft Waiver Runtime

## Scope

G38 completes the playable waiver runtime for AF NFL Redraft leagues. It does not build Decision OS, Commissioner Intelligence, Manager Intelligence, or downstream recommendation consumers.

## Architecture

- Pure runtime: `lib/waiver-runtime/canonicalNflRedraftWaiverRuntime.ts`
- Persistence bridge: `lib/waiver-runtime/resolveNflRedraftWaiverRuntime.ts`
- API surface and manual processor: `app/api/redraft/waiver-runtime/route.ts`
- League tab readout: `app/league/[leagueId]/tabs/redraft/WaiverCenter.tsx`
- Browser proof harness: `app/e2e/g38-nfl-redraft-waiver-runtime/page.tsx`

The runtime reads canonical league waiver rules from G33 and roster capacity/lineup context from the redraft roster rules introduced in G35.

## Canonical Waiver Rules

The runtime resolves:

- waiver mode: FAAB, rolling, reverse standings, standard, or FCFS
- FAAB budget and minimum bid
- processing schedule metadata
- waiver priority behavior
- claim and free agency open state
- active roster capacity
- roster move lock state

No provider stats, player rankings, or recommendation results are fabricated.

## Claim Submission

The canonical API supports:

- submit claim
- submit conditional claim groups
- edit pending claim
- cancel pending claim
- duplicate pending claim prevention
- roster-full/drop-required validation
- locked drop validation
- FAAB validation

Pending claim visibility is scoped to the manager unless a commissioner requests league scope.

## Processing

Processing is deterministic:

- FAAB leagues sort by conditional rank, highest bid, waiver priority, timestamp, then claim id.
- Priority leagues sort by conditional rank, waiver priority, timestamp, then claim id.
- Winning claims add the player to the roster bench.
- Drops are applied atomically with the add.
- Failed claims record a denial reason.
- Rolling priority moves the winning roster to the back for non-FAAB modes.
- FAAB deductions are applied to the winning roster.
- Transaction rows are recorded for wins, failures, skips, free agent adds, submits, edits, and cancels.

## Conditional Claims

The pure runtime supports explicit `conditionalGroupId` and `conditionalRank`.

For existing persistence, G38 stores conditional metadata in `RedraftLeagueTransaction.metadata` on submit/edit rows because `RedraftWaiverClaim` does not currently have a metadata column. The resolver rehydrates pending claim group/rank from those transaction records.

## Free Agency

When free agency is open under canonical rules, the runtime supports immediate add/drop:

- validates roster capacity
- validates optional drop player
- blocks locked drops unless commissioner override is used
- applies add/drop immediately
- writes transaction history
- emits roster and waiver events

## Events

G38 adds canonical events for:

- `waiver.period.opened`
- `waiver.period.closed`
- `waiver.claim.submitted`
- `waiver.claim.edited`
- `waiver.claim.cancelled`
- `waiver.processing.started`
- `waiver.claim.won`
- `waiver.claim.failed`
- `waiver.faab.deducted`
- `waiver.priority.updated`
- `waiver.free_agent.added`
- `waiver.processed`
- `waiver.transaction.recorded`
- `commissioner.waiver_override`
- roster add/drop events from the roster runtime catalog

These events are clean integration points for future external systems, but no downstream OS consumer is built in this milestone.

## Commissioner Functionality

Commissioners can process waivers through the canonical API and use commissioner override mode for waiver/free-agent actions. Overrides are audited through event records and best-effort admin audit rows.

## Known Limitations

- Existing `RedraftWaiverClaim` has no dedicated metadata field, so conditional claim metadata is stored in related transaction metadata.
- Browser proof uses a deterministic harness instead of authenticated seeded league data.
- Full repo typecheck remains risky because of unrelated dirty state and known global failures; G38 uses targeted parse/lint checks.
