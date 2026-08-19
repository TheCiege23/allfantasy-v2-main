# Sleeper Draft Runtime + Pick Ownership (Fantasy OS Phase 5D-c, Parts 9–11)

`lib/sports-data-gateway/runtime/draftRuntime.ts`. League-scoped, certified, deterministic.

## Contracts
- **CanonicalDraft** — canonical ids, season, `status` (pre_draft/drafting/paused/complete/unknown), rounds/teams, timestamps. (`type` = unknown: Sleeper's `type` is draft order (snake/linear), not startup/rookie — canonical type needs league context, deferred.)
- **CanonicalDraftPick** — canonical pick/draft/league ids, canonical player id (unresolved quarantined), round/pickNumber/draftSlot, drafting/original/final owner roster ids, `identityStatus`.

## Behavior
- Deterministic pick identity (`sleeper:<league>:<draft>:<pick_no>`) + content hash. Stable ordering.
- **Completed drafts are immutable** — if already certified with identical content, the draft is reused from cache and its picks are **not refetched** (no unrestricted historical rediscovery).
- Events: `draft_pick_made` (per new/changed pick), deterministic ids ⇒ rerun = 0 duplicates. (`draft_created`/`draft_started`/`draft_completed`/`draft_paused`/`draft_pick_owner_changed`/`draft_corrected` reserved for status transitions.)
- Unresolved player identity quarantined; certification blocked on schema failure.

## Pick ownership reconciliation (Part 11)
`reconcilePickOwnership` compares draft-snapshot owner, transaction-evidence owner, and current provider owner: agreement → `resolved`; disagreement → **`conflicting`** (never silently overwritten; blocks ownership-dependent recommendations); no evidence → `insufficient_evidence`. History remains auditable.

## Proving run (real, non-prod)
League `1092671852352331776`: run 1 → certified, 1 draft, **40 picks** (2 resolved / 38 quarantined), 40 `draft_pick_made` events; run 2 (rerun) → **0 new events, immutable completed draft reused (1)**. Idempotent.

## Remaining
Live **Draft OS** read wiring (Part 12) + **Trade OS** pick-evidence enrichment (Part 13) into the real call paths (not wired this increment — not claimed); canonical draft `type` classification via league context; `draft_pick_owner_changed` reconciliation events.

## Disable / rollback
Disable via `FANTASY_OS_EXEC_*` gate. Append-only; prior certified draft snapshot preserved.
