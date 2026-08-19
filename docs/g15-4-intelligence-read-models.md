# G15.4 — Intelligence Read Models + Score Retention Strategy

**Status:** complete. Backend Commissioner Intelligence read models + query service +
feature-gate boundary, plus the score.updated retention decision. Builds on G15.1–G15.3b.

No Commissioner Hub UI, Story Engine, Chimmy, or external SDK — backend only. The read
models are **disposable** (rebuildable from `domain_events`); no business behavior depends
on them.

---

## 1. Read models

All sport- and concept-agnostic (derived from normalized DomainEvents).

| Model | Table | Backs |
|---|---|---|
| League activity rollup | `intelligence_league_snapshot` (1/league) | League Activity Summary + League Health Snapshot |
| Manager activity rollup | `intelligence_manager_snapshot` (1/league+manager) | Manager Activity Snapshot |
| Idempotency ledger | `intelligence_processed_event` | exactly-once incremental apply |

**League snapshot fields:** `totalEvents`, per-category counts (`tradeCount`, `waiverCount`,
`lineupCount`, `draftCount`, `scoringCount`, `governanceCount`, `lifecycleCount`,
`otherCount`), `openTradeProposals`, `firstEventAt`/`lastActivityAt`, and per-category
`lastXAt`. **Manager snapshot:** `totalActions` + `tradeActions`/`waiverActions`/
`lineupActions`/`otherActions` + `lastActiveAt`.

**Commissioner Action Items** are **derived at query time** from the two snapshots (no extra
projection) so they're always fresh: `no_activity`, `pending_trades`, `stale_league`,
`inactive_managers`.

Migration `20260627040000_add_intelligence_read_models` (additive, idempotent).

---

## 2. Projection lifecycle

`lib/intelligence/projections/snapshotProjection.ts` — a relay `EventConsumer`
(`createIntelligenceSnapshotConsumer(prisma)`), wired into `scripts/run-outbox-relay.ts`
alongside the audit feed.

Per event, inside one transaction:
1. `INSERT` into `intelligence_processed_event` (`skipDuplicates`). If `count === 0` the event
   was already processed → **no-op** (idempotent under at-least-once delivery).
2. Upsert the league snapshot — `totalEvents`/category count via **atomic increments** (no
   read-modify-write races between relay workers); `openTradeProposals += delta`; `lastXAt`.
3. Upsert the manager snapshot when the event has a user/commissioner actor.

Categorization (`categorize(type)`) and `tradeProposalDelta(type)` are pure + unit-tested.
`lastActivityAt` is set to the event's `occurredAt` (relay drains oldest-first, so roughly
monotonic — acceptable for a snapshot).

---

## 3. Rebuild strategy

`rebuildIntelligenceSnapshots(prisma)`: clears both snapshots **and** this projection's rows
in `intelligence_processed_event`, then replays every `domain_event` (oldest first, cursor by
`id`) through `applyIntelligenceEvent`. Safe to run any time; it is the recovery path after a
bug fix or schema change. (Clears globally — coordinate on shared environments; run serially.)

---

## 4. Internal Intelligence Query Service

`lib/intelligence/IntelligenceQueryService.ts` (backend only):
- `getLeagueActivitySummary(leagueId, principal?)`
- `getLeagueHealthSnapshot(leagueId, principal?)` — health score from recency + active-manager
  ratio; status `healthy|cooling|stale|unknown`.
- `getManagerActivitySnapshot(leagueId, userId, principal?)`
- `getCommissionerActionItems(leagueId, principal?)` — derived items.

Pure helpers `computeHealth` + `deriveActionItems` are exported + unit-tested.

---

## 5. Feature-gate boundary (defined, not enforced in UI)

`lib/intelligence/featureGate.ts` — `IFeatureGate.decide(principal, feature)` →
`allow | deny | upgrade_required`. Feature keys: `commissioner_intelligence.{activity_summary,
health_snapshot, manager_activity, action_items}`. The Query Service applies the gate at every
method (throws `IntelligenceAccessError` on non-allow). **G15.4 default `AllowAllFeatureGate`**
→ nothing is gated yet. A later phase injects a Stripe-entitlement-backed gate and flips
features to premium **at this boundary** (no UI/code scatter).

---

## 6. Score retention / coalescing — DECISION

**Decision: keep raw per-player `competition.score.updated` DEFERRED. Use coalesced scoring
activity instead.**

- **Coalesced signal (implemented):** the already-wired, low-volume
  `competition.matchup.updated` (emitted **only when a matchup score actually changes**) +
  `competition.matchup.finalized` + `competition.standings.updated` feed the league snapshot's
  **`scoringCount` / `lastScoringAt`**. Commissioners get a "scoring is live / last updated"
  pulse **without** per-player event volume.
- **Why raw per-player is still unsafe to wire:** `domain_events` is an **append-only,
  permanent** log. Per-player-per-sync `score.updated` (potentially millions/season at scale)
  would grow it unbounded regardless of the relay draining the outbox.

**Exact requirement before wiring per-player `score.updated`:**
1. A dedicated **coalesced aggregate store** updated **in place** per `(matchup|roster, period)`
   (UPSERT, not append) — e.g. `live_score_aggregate` with current points + last-updated — so
   live-scoring reads are O(1) and storage is bounded by active matchups, not by tick count.
2. A **retention/archival policy** on `domain_events` (time-partitioning + cold archive) so the
   permanent log is bounded.
3. Sampling/coalescing on emit (e.g. emit at most one `score.updated` per player per N seconds,
   or only on meaningful deltas).
4. Replay/rebuild semantics defined for the aggregate (it is derived; rebuild from the latest
   stat snapshot, not by replaying every tick).

Until those exist, per-player scoring stays out of the event log; the coalesced matchup-level
signal serves intelligence + the existing live-scoring SSE pipeline serves the live UI.

---

## 7. Tests
- Pure unit: `categorize`/`tradeProposalDelta` (`snapshot-projection.test.ts`); `computeHealth`/
  `deriveActionItems` (`query-service.test.ts`).
- DB integration (opt-in `RUN_EVENT_DB_IT=1`, serial): incremental + **idempotent** apply,
  query-service DTOs, **rebuild** (`intelligence-db.integration.test.ts`).
- Staging E2E: harness → relay (audit + intelligence consumers) → audit feed (13) + league
  snapshots populated; cleaned up. Engine harness **PASS 32 / FAIL 0** (no behavior change).

---

## 8. Remaining risks
1. **`intelligence_processed_event` grows ~1 row/event** (dedup ledger) — add retention/pruning
   with the `domain_events` retention work.
2. **`lastActivityAt` assumes ~ordered delivery** — minor inaccuracy if events arrive far out of
   order; rebuild corrects it.
3. **Manager identity = actor.id** — only events carrying a user/commissioner actor populate
   manager snapshots (engine/system events don't). Broaden actor attribution in producers later
   if richer per-manager coverage is needed.
4. **Relay runner must import the projection directly**, not via `@/lib/intelligence` (the barrel
   re-exports `server-only`-tainted modules that throw under tsx). Done + commented.
5. **Score retention** (§6) is designed but per-player scoring remains deferred until the
   aggregate store + retention policy exist.
6. **Prod migrations:** `20260627020000`/`030000`/`040000` are applied on **staging only**; prod
   has only the G15.1 tables. Apply via normal `migrate deploy` before running the relay/queries
   in prod.
