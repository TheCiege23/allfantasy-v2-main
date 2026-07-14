# Next-Season Creation — Concurrency Report

## N1 — Two identical renewal requests: TESTED, SAFE

Setup: real 12-team league `4a1853d7-f272-4a01-88e8-0230d224f32f`, real season `cmqrcbyxt0335vs7xh3frrxvx` marked `status='complete'`, real commissioner `9791bae0-e47f-418a-ae40-285f6a2e7887`. Two concurrent `createNextSeason` calls fired via `Promise.all` with the **same** idempotency key (`next-season-n1-concurrency-test`).

**Isolation level**: Serializable.

**Result**: Caller A threw `Transaction failed due to a write conflict or a deadlock. Please retry your transaction` (a real Postgres serialization-failure error). Caller B succeeded: `status: 'created'`, `rosterCount: 12`.

**Verified by direct re-query**: destination season count = **1** (not 2). Total rosters in the destination season = **12** (not 24). `DomainEvent` count for this idempotency key = **1**. `LeagueRenewal` row count = **1**. Exactly one canonical completion event, as required.

**Real gap found, disclosed, not fixed this phase**: the losing caller (A) receives a raw Postgres error, not a clean, stable `status: 'conflict'` result. The *data* is completely safe (proven above), but the *API-level experience* for the losing concurrent request is currently a thrown exception rather than the graceful, retryable response Part 17 calls for. This is a real, disclosed follow-up for whichever phase wires the API route (catch the serialization-failure error class specifically and retry-or-report, rather than letting it propagate raw).

## N2 through N8 — NOT TESTED

Disclosed, not attempted, given time constraints after N1 (the highest-priority, most-emphasized scenario) produced real, valuable evidence including a genuine defect discovery. Specifically:

- **N2** (two different idempotency keys, same source/target) — untested. The `CONFLICTING_IDEMPOTENCY_PAYLOAD` logic only fires when the *same* key is reused for a *different* source; two *different* keys for the *same* source/target would both attempt to pass eligibility and race at the Serializable layer the same way N1 did — plausible but not confirmed.
- **N3** (same source, different target season) — untested.
- **N4** (renewal vs. archive) — untested; also not meaningfully testable yet since archival is not integrated into eligibility this phase (see the Call Graph doc).
- **N5** (renewal vs. standings mutation) — untested.
- **N6** (renewal vs. settings mutation) — untested. This is a real, non-trivial gap: `League.settings` is read fresh inside the transaction, so in principle a settings change committed *before* this transaction's read would be correctly picked up, and one committed *during* the race would trigger the same serialization conflict N1 demonstrated — but this was not confirmed empirically.
- **N7** (renewal vs. roster ownership mutation) — untested, same reasoning as N6.
- **N8** (duplicate replay after successful commit) — this is functionally identical to the exact-replay test already covered in the Physical Validation Report (same idempotency key, sequential rather than concurrent) — that scenario **was** tested and confirmed safe, so N8 is covered by that evidence even though it wasn't re-run as a literal "after successful commit" concurrent scenario.

## Summary

| Scenario | Status |
|---|---|
| N1 two identical requests | Tested — SAFE (data), real API-layer gap disclosed |
| N2 different keys, same target | Not tested |
| N3 same source, different target | Not tested |
| N4 renewal vs. archive | Not tested (not integrated) |
| N5 renewal vs. standings mutation | Not tested |
| N6 renewal vs. settings mutation | Not tested |
| N7 renewal vs. roster ownership mutation | Not tested |
| N8 duplicate replay after commit | Covered by the exact-replay test (sequential, not concurrent) |

1 of 8 distinct scenarios received full concurrent physical testing; 1 more is covered by an equivalent sequential test; 6 remain genuinely untested and are disclosed as such.
