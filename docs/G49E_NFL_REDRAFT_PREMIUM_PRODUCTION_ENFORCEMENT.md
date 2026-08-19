# G49E NFL Redraft Premium Production Enforcement

## Purpose

G49E makes the NFL Redraft premium service route production-safe while preserving the G49 facts-only boundary.

The route now resolves premium access on the server, enforces league membership, applies commissioner-only checks for commissioner-facing services, and feeds the premium resolver from canonical AllFantasy redraft state where available.

## Production Evidence Source Flow

`POST /api/redraft/premium-services` now loads production evidence through:

```text
authenticated request
  -> canonical request validation
  -> server access boundary
  -> server entitlement snapshot
  -> production canonical redraft state
  -> G48 evidence packet builders
  -> G49C evidence resolver
  -> G49 product response shape
```

The production source uses existing canonical AllFantasy state:

- redraft season
- redraft roster
- redraft roster players
- redraft matchups
- waiver claims
- trade proposals
- redraft draft state

When canonical state is unavailable, it returns safe missing/fallback evidence rather than inventing data.

## Auth And Membership Boundary

The route uses the existing application boundary where available:

- `getServerSession(authOptions)` for authenticated user context
- `assertLeagueMemberWithCode` for league membership
- `isElevatedCommissioner` for commissioner-only service access

Commissioner-only services are:

- Commissioner Digest
- Trade Review with commissioner variant

If the boundary cannot be evaluated, the route returns a safe `auth_boundary_unavailable` error. G49E does not introduce a new auth system.

## Entitlement Enforcement

Tier decisions are server-authoritative.

Client-supplied `requestedTier` and `entitlement` fields are stripped before the final product contract is built. The server injects the entitlement snapshot from the existing `EntitlementResolver`.

The client may render locked states from the response, but it no longer controls access decisions.

## UI Placement Completion

G49E completes production placement for:

- Draft Room / Draft Prep through the existing draft tab shell
- Player card contexts through a reusable `NflRedraftPremiumPlayerCardShells` wrapper

The player-card wrapper accepts only canonical identifier-shaped values and drops unsafe provider-style IDs before calling the premium service contract.

## Facts-Only Boundary

G49E still excludes:

- start/sit recommendations
- waiver recommendations
- trade recommendations
- collusion conclusions
- AI explanations
- LLM summaries
- generated announcements
- raw provider payloads
- provider-specific IDs in UI
- Stripe or checkout work

Premium route responses continue to expose the stable G49C/G49D shape: service name, required tier, access status, canonical IDs, evidence packet IDs, warnings, resolver status, and evidence counts.

## Known Limitations

The production evidence source intentionally uses only canonical data already present in the repo. Some evidence domains may return empty or missing/fallback states until later milestones add richer production persistence for provider-backed packets.

The auth boundary depends on the existing session, membership, commissioner, and entitlement helpers. G49E isolates this dependency so it can be swapped or expanded without changing the route contract.

## Remaining G49F/G50 Work

Later milestones should add richer production evidence persistence, broader packet backfill, UI polish for paid product packaging, operational monitoring, and any explicitly scoped recommendation or OS work. Those are intentionally outside G49E.
