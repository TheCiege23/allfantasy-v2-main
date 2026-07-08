# Commissioner Intelligence — Snapshot Seed Runbook (non-prod)

**Purpose:** prepare a non-prod demo league with the precomputed data the Commissioner
Intelligence Hub reads. Honest by design — where a one-command seed does **not** exist, this
documents the real path instead of inventing one.

**Safety:** read-only audit + non-prod only. Do not run against prod/staging without explicit
approval. No live DB was accessed writing this runbook.

---

## How the data is actually produced

The Commissioner hub does **not** read a hand-seedable table. Its data is a **projection of
`DomainEvent`s** (AllFantasy's behavioral event store). The pipeline:

```
DomainEvent (native league activity)
   → createIntelligenceSnapshotConsumer(prisma)   [lib/intelligence/projections/snapshotProjection.ts]
        → IntelligenceLeagueSnapshot  (activity counts, health inputs, open-trade counts)
        → IntelligenceManagerSnapshot (per-manager activity)
   → createPrismaAuditFeedConsumer(prisma)         → audit-feed read model
```

- **Live projection:** `createIntelligenceSnapshotConsumer` runs inside the **outbox relay**
  (`scripts/run-outbox-relay.ts`) and the E2E drain route (`app/api/e2e/run-relay/route.ts`).
  As events land in the outbox, they are projected into the snapshot + audit feed.
- **Full rebuild (backfill):** `rebuildIntelligenceSnapshots(prisma)` re-projects **all**
  `DomainEvent`s from scratch. ⚠️ It **deletes all** `IntelligenceLeagueSnapshot` /
  `IntelligenceManagerSnapshot` rows and the projection's processed-event markers first, then
  rebuilds — it is a **global** rebuild, not a per-league seed. Non-prod only.

Module → source, once snapshots exist:

| Module | Reads |
| --- | --- |
| League Activity | `IntelligenceLeagueSnapshot` counts |
| League Health | deterministic health snapshot (derived from the same snapshot) |
| Action Items | `deriveActionItems()` over the league snapshot + manager rows |
| League Stories | deterministic narrative over recorded activity (no LLM) |
| Audit Feed | the audit-feed read model (same events) |

---

## Seed path (non-prod demo league)

**Prerequisite: the league must have native `DomainEvent`s.** This is the load-bearing point —
see the [blocker](#the-load-bearing-blocker) below.

1. **Ensure events exist.** Either use a league with real in-app activity (trades / waivers /
   lineup sets / draft), or generate activity in the app for the demo league so `DomainEvent`
   rows accrue.
2. **Project events → snapshots.** Two options:
   - **Relay (targeted, non-destructive):** run the outbox relay so pending events are consumed:
     `npx tsx scripts/run-outbox-relay.ts` (wires the audit-feed + intelligence consumers).
   - **Full rebuild (non-prod only, destructive-then-rebuild):** call
     `rebuildIntelligenceSnapshots(prisma)` to rebuild every league's snapshot from all events.
3. **Verify.** Load `/league/<leagueId>/intelligence` as a commissioner, or use the read-only
   Manager-style helper pattern / the existing harnesses below.

### Existing harnesses to reference (do not reinvent)

- `scripts/g15-11-live-proof.ts` — wires the audit-feed + intelligence consumers, drains the
  outbox in a small batch, and verifies the full loop end-to-end against a real league. Closest
  thing to a "seed + verify" harness.
- `scripts/decision-os-intelligence-api-smoke.ts` — exercises the Intelligence API handlers with
  registered API keys + the real data provider against seeded leagues (e.g. a league with 3
  waiver claims, a draft-session league, and the imported "KBI Smoke Black").
- `app/api/e2e/run-relay/route.ts` — E2E-only endpoint to drain the outbox once through both
  consumers.

---

## The load-bearing blocker

**An imported Sleeper league has ~0 native `DomainEvent`s.** The imported "KBI Smoke Black" league
is described in the smoke script as *"0 native events, sparse."* The Commissioner hub is fed by
**native AllFantasy behavioral events**, not by the imported provider history. So:

> A freshly-imported Sleeper league will render **mostly empty** Commissioner Intelligence until
> real in-app activity (trades/waivers/lineups) generates `DomainEvent`s.

To demo Commissioner Intelligence **with data**, use a non-prod league that has genuine native
activity (like the smoke script's event-bearing leagues), not an import-only league. This is the
single biggest demo prerequisite — do not paper over it.

There is **no** single-command "seed one demo league's commissioner snapshot" script today. The
honest path is: *events first, then relay/rebuild.* A small per-league seed helper (emit a handful
of representative `DomainEvent`s for a demo league, then relay) is a reasonable future addition but
was **not** built in this phase (no new contracts / no DB access).

---

## Verification checklist (once seeded, in an approved non-prod env)

- [ ] `IntelligenceLeagueSnapshot` row exists for the demo league (activity totals > 0).
- [ ] `/activity` renders counts; `/audit-feed` renders a timeline.
- [ ] As **commissioner**: `/health` renders a score; `/action-items` renders alerts or "all clear".
- [ ] Stories preview renders member types (and commissioner-only types for a commissioner).
- [ ] No writes occurred beyond the relay's own projection upserts (which are the intended,
      idempotent projection — not user-data mutations).
