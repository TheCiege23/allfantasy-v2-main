# Import Coordination Decision Matrix (Phase 24)

**Status: final decision. Distributed coordination NOT implemented — evidence does not justify it.**

## Comparison

| Approach | Correctness | Operational complexity | Rollback risk | Infrastructure cost | Failure modes | Operational burden |
|---|---|---|---|---|---|---|
| **Process-local coordinator (current)** | Proven correct within any shared process (Phase 23 measured); unproven-but-bounded across separate instances | None — already shipped | None — one flag, already proven | Zero | Bounded redundant imports if instances don't share state (never unbounded, never customer-facing) | Zero — no new operational surface |
| **Postgres advisory lock** | Correct in principle | Medium — requires verifying Neon's actual pooling mode per environment | Medium — new failure surface (lock acquisition/release) | Zero (reuses existing Neon/Prisma) | Session-scoped locks unreliable under transaction-mode pooling (real friction, not evaluated to be safe on this app's actual connection setup); transaction-scoped locks require an awkward 90-190s-long transaction | Requires connection-mode verification before trusting in production |
| **Database-backed lease** | Correct, cleanest crash-recovery semantics of any DB-backed option | Medium — new table, new claim/release logic | Low once shipped, but requires a schema migration to add | Zero (small table) | Well-understood (atomic `UPDATE...WHERE` claim, TTL-based expiry) | Low once shipped |
| **Redis/distributed mutex** | Correct | High — new managed service | High — new external dependency | Non-zero (new service) | New dependency-availability failure mode | Ongoing (new infra to operate) |
| **Queue serialization** | Correct | High — no existing queue for this workload found | High — new infrastructure | Non-zero | New dependency | Ongoing |
| **Idempotency-key approach** | Does not solve this problem — idempotency keys prevent *duplicate effects from a retried request*, not *duplicate concurrent imports from independent requests*; not a fit for this use case | N/A | N/A | N/A | N/A | N/A |

## Evidence-based recommendation

**Retain the process-local coordinator. Do not implement distributed coordination.**

Per this phase's explicit instruction ("Evaluate only if real deployment evidence justifies it… Do not build distributed coordination unless the evidence demonstrates it is required"): no evidence gathered across Phases 20-24 demonstrates that cross-instance duplicate imports are an actual, material problem in production — only that the theoretical exposure exists and is bounded. Real evidence found:

- The primary goal (customer latency) is 100% solved and does not depend on cross-instance coordination at all.
- The coordinator's own logic is 100% proven correct wherever state is shared.
- The worst-case failure mode if cross-instance sharing never occurs is bounded (at most 1 redundant import per genuinely-concurrent miss per instance, never unbounded, never customer-visible) and further narrowed in practice by the existing 6-hour cron pre-warming (true misses are the rare case, not the common one).
- Every distributed option carries real cost (new infrastructure, new failure modes, schema migration, or genuine connection-pooling friction specific to this app) that the evidence does not justify paying for yet.

If real production telemetry (once the flag is enabled and monitored) later shows cross-instance duplication at a rate that matters operationally (elevated external-provider costs, database write volume, or provider rate-limit pressure attributable to redundant imports), **Option C (database-backed refresh lease)** remains the recommended next step — cleanest failure semantics of the DB-backed options — proposed as its own phase with explicit schema-migration approval requested up front.
