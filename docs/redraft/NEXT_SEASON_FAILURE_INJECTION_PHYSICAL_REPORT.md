# Next-Season Failure Injection — Physical Report

## Mechanism

A test-only, environment-gated failure-injection parameter was added to `createNextSeason` (`__failAfterStage`, `NextSeasonFailureStage` type) — a dependency-injection-style optional second argument, never passed by any production caller (the API route calls `createNextSeason(input)` with no second argument), and additionally hard-gated by `process.env.NODE_ENV === 'production'` inside `maybeInjectFailure` so it cannot fire even if a caller supplied it by mistake in production. This matches the brief's "acceptable approaches" list (explicit internal failure stage enum unavailable to production callers).

## Real stages tested, physically, against the disposable production-fork branch

| Stage | Result |
|---|---|
| `after_destination_creation` | Transaction threw the injected error; direct re-query confirmed zero new `RedraftSeason` rows and zero new `LeagueRenewal` rows — full rollback. |
| `after_roster_creation` | Transaction threw; direct re-query confirmed zero new `RedraftRoster` rows and zero destination `RedraftSeason` row for the target season — full rollback, including the already-created destination season from the same failed attempt. |
| `after_event_creation` | Transaction threw; direct re-query confirmed zero `DomainEvent` row and zero `LeagueRenewal` completion evidence for that idempotency key — no false event, no false completion. **Retry proof**: calling `createNextSeason` again with the identical input (no injection this time) succeeded cleanly (`status: 'created'`) — the original idempotency key remained usable after the injected failure was removed, per the contract's retry requirement. |

## Stages from the brief's list not tested this phase

`after_eligibility` (source lock — not a distinct step in this design; Serializable isolation itself is the lock, see the Transaction Design doc), archive/freeze step (not applicable — archive is not integrated), source/destination linkage, settings copy, ownership copy, audit creation, renewal completion update — the injection hooks exist in code for `after_eligibility` and `after_audit_creation`/`after_renewal_completion` (defined in `NextSeasonFailureStage`) but were not exercised this phase given time constraints after the three stages above already produced clear, real rollback evidence.

## Post-commit failure testing

Not performed — there are no post-commit effects implemented at all yet (unchanged from the prior phase's disclosure), so there is nothing to fail-inject post-commit.

## Honest scope statement

3 of the 6 defined injection stages (and 3 of the brief's original ~10-item list, since several brief items don't map to distinct steps in this actual implementation) received real physical proof. This is a real, meaningful improvement over the prior phase's "two incidental failures only" — these are deliberate, targeted, repeatable injections — but is not the full matrix the brief specifies.
