# G15.11 — Live Relay + Chimmy Commissioner Grounding Verification

**Status:** complete (verification + operational enablement only). Proves the full
production-ready loop end-to-end: domain events → outbox → **relay** → audit feed + intelligence
snapshots → Query Service → privacy-safe **Chimmy commissioner grounding**, with correct intent
gating. No new architecture, write actions, Story Engine, or Hub UI changes. The relay is run
**run-once / manual** only — **no permanent worker started** (per standing instruction).

---

## 1. What was proven

A single end-to-end proof script, [`scripts/g15-11-live-proof.ts`](../scripts/g15-11-live-proof.ts),
seeds a **real commissioner league via the canonical pipeline** (which emits real domain events
through the G15.2 instrumentation), runs the **real relay** (`OutboxRelay` + `PrismaOutboxStore` +
`createPrismaAuditFeedConsumer` + `createIntelligenceSnapshotConsumer`), then verifies the read
models and the grounding produced from them — and cleans up everything afterward.

It refuses to run against the production host (guards on the prod Neon host id).

### Relay mode used
Conservative, single worker, run-once drain: `workerId=g15-11-proof`, `batchSize=25`,
`maxRetries=5`, `claimTimeoutMs=60000`, `dryRun=false`. `relay.run()` drains until empty, then
exits. **No long-running/permanent worker.**

### Verification environment
**Staging** Neon DB (`ep-winter-salad-…`, NOT prod). Production cannot be safely seeded with a real
league (no `ALLOW_E2E_SEED`, and seeding would write real rows), so per the G15.11 instruction the
live proof was performed in staging and the production remainder is documented in §4.

### Results (all 16 checks ✅, script exit 0 → `G15_11_LIVE_PROOF_OK`)

| Stage | Result |
|---|---|
| Before counts | domainEvents 0 / outbox 0 / auditFeed 0 / leagueSnapshots 0 |
| Seed emitted events | outbox **pending=3** |
| Relay drain | **dispatched=3, dead-lettered=0**; second batch fetched=0 (empty) |
| Outbox final status | no `dead`, no `pending`, no `retry` |
| Audit feed (for league) | **3 rows** |
| League snapshot | present, **totalEvents=3** |
| Query Service activity | **totalEvents=3** (real data) |
| Commissioner grounding | **status=ok**, text present (>50 chars) |
| Privacy — no owner/user id | ✅ (owner id not present anywhere in grounding) |
| Privacy — no payload/secret tokens | ✅ (`payload`/`passwordHash`/`sk_live`/`whsec_` absent) |
| Grounding cautious framing | ✅ ("non-accusatory" directive present) |
| Intent — commissioner Qs match | ✅ (4/4) |
| Intent — ordinary Qs do NOT match | ✅ ("Should I start Josh or Patrick?", matchup projection → no grounding) |
| After cleanup counts | domainEvents 0 / outbox 0 / auditFeed 0 / leagueSnapshots 0 |

Grounding text sample (privacy-safe, derived from relay-populated data):
```
COMMISSIONER INTELLIGENCE (read-only, derived from recorded in-app activity only). Use cautious,
non-accusatory language. Do NOT allege collusion, tanking, or bad faith — describe
engagement/activity as observations, not accusations. Frame inactivity as "appears inactive based
on recorded activity".
- health score: 60/100 (cooling)
- active managers: 0/0
```

## 2. Live Chimmy grounding pass-through

The chat-route wiring (G15.10) is proven at two levels:
- **Data path (this phase, live):** the grounding text Chimmy would receive is produced from
  **real relay-populated** read models, is privacy-safe, and **only attaches** for commissioner
  intent (`detectCommissionerIntelligenceIntent`) — ordinary fantasy questions return no grounding,
  so the chat is byte-for-byte unchanged for normal use.
- **Wiring path:** `resolve-chimmy-grounding.test.ts` (gating/never-throws) +
  `chimmy-pipeline-wiring.test.ts` (route invokes the resolver in both paths;
  `buildForwardedRequest` appends grounding while preserving existing fields; the Anthropic pipeline
  carries it on `UserContext` and emits the `## COMMISSIONER INTELLIGENCE` prompt section).

The only step not exercised here is the **external LLM round-trip producing a chat answer that
cites the grounding** — that requires the deployed app + a real Anthropic/Chimmy call (cost +
external service). It is a documented manual smoke step (§3), not a code gap: the grounding is
verified to reach the prompt/forwarded payload.

## 3. Production live smoke (manual, when ready)
With the relay enabled in prod and at least one real commissioner league with recorded activity:
1. Run the relay once: `node --import tsx scripts/run-outbox-relay.ts --once --batch-size 50`. Confirm `dispatched>0`, `deadLettered=0`.
2. `npm run status:g15` → audit feed + league snapshot counts > 0, `deadLettered=0`.
3. Open `/league/<id>/intelligence` as the commissioner → Hub shows the real activity/health/audit data (UI + v1 API unchanged since the G15.7 browser proof).
4. In Chimmy, as the commissioner, ask "Give me a commissioner summary of my league" → answer reflects the grounded counts/health, cautiously framed.
5. As a non-commissioner (or an ordinary question), confirm **no** commissioner data leaks.

## 4. Production remainder
- **Schema/migrations:** already live in prod (all 7 tables, `claimedBy`/`claimedAt`, 4 migrations recorded, 0 rows, 0 dead-letter — confirmed read-only via `npm run status:g15`).
- **Relay enablement:** not yet running in prod. Start **manual/run-once** first (§3 step 1), watch `status:g15`, then promote to a scheduled/long-running worker only on explicit instruction. **No permanent worker started in this phase.**
- **Live LLM chat smoke:** §3 steps 4–5, manual, on the deployed app.

## 5. Monitoring queries
- `npm run status:g15` (`node scripts/g15-prod-status.cjs`) — tables/columns/migrations/counts/`deadLettered`/`lastDispatchedAt` (read-only; safe against prod).
- Dead-letter watch: `SELECT status, count(*) FROM event_outbox GROUP BY status;` — any `dead` rows → investigate before promoting the relay.

## 6. Tests
- `__tests__/intelligence` + `__tests__/events`: **90 passed, 10 skipped** (the 10 are DB integration tests gated behind `RUN_EVENT_DB_IT=1`).
- Live end-to-end staging proof: `scripts/g15-11-live-proof.ts` → `G15_11_LIVE_PROOF_OK` (16/16).

## 7. Boundaries honored
No Story Engine, no write/commissioner actions, no new UI, no event-architecture changes, no Redis
adapter, no permanent relay worker, no destructive cleanup of real data, no production seeding. All
additive + never-throw; staging-only writes, fully torn down.
