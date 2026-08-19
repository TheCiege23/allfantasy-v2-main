# G49B NFL Redraft Premium Service API Contracts

## Purpose

G49B exposes the G49A premium service foundation through product-facing API/service contracts for AF Pro, AF Commissioner, AF Supreme, and AF War Room.

This milestone prepares premium UI and API consumers to read deterministic facts-only packets. It does not create Decision OS, Manager OS, Commissioner OS, LLM reasoning, final advice, payment flows, or Stripe changes.

## API And Service Contract Shape

The service contract lives in:

- `lib/redraft-premium/nflRedraftPremiumApiContracts.ts`

The API route lives at:

- `POST /api/redraft/premium-services`

Accepted request fields are canonical identifiers only:

- `serviceType` or `serviceId`
- `serviceVariant`
- `leagueId`
- `teamId`
- `managerId`
- `matchupId`
- `playerId`
- `week`
- `season`
- `requestedTier`
- optional existing entitlement status/plans

Provider IDs, evidence packet arrays, raw provider payloads, and generic payload objects are rejected at the boundary.

Returned packets include:

- service name
- required tier
- access status
- canonical IDs
- evidence packet IDs
- freshness status and counts
- stale data warnings
- fallback warnings
- missing data warnings
- eligible surfaces
- factual category labels
- unavailable-data messages

The route currently returns the contract shape with no backing evidence resolver. Library callers can pass canonical G48 evidence packets as an internal dependency. G49C can wire a production resolver without changing the public request shape.

## Tier Behavior

| Tier | Service contracts |
| --- | --- |
| `FREE` | Basic Runtime Facts |
| `AF_PRO` | Manager Brief, Matchup Prep, Waiver Report basic, Trade Review basic, Draft Prep |
| `AF_COMMISSIONER` | Commissioner Digest, Trade Review commissioner view |
| `AF_SUPREME` | AF Pro + AF Commissioner contracts, advanced variants |
| `AF_WAR_ROOM` | War Room Service |

Existing entitlement helpers are reused only for deterministic plan/status mapping. No payment provider integration is added.

## Entitlement Boundary

G49B maps existing subscription plan IDs and active/grace status to the G49A tier contract:

- `pro` -> `AF_PRO`
- `commissioner` -> `AF_COMMISSIONER`
- `supreme` -> `AF_SUPREME`
- `war_room` -> `AF_WAR_ROOM`
- expired, missing, or inactive status -> `FREE`

The contract can also accept an explicit `requestedTier` for tests and server-side callers that already resolved entitlement.

## Intentionally Excluded

G49B does not return:

- start/sit advice
- waiver priority advice
- trade advice
- collusion conclusions
- AI explanations
- generated announcements
- natural-language LLM summaries
- raw provider payloads
- provider-specific player IDs

## Consumer Subscription Support

Premium consumers can call the contract to determine:

- whether a service is allowed for the current tier
- which tier is required
- which canonical IDs are in scope
- which evidence packets support the service
- which data is stale, missing, fallback-derived, or unavailable

This lets UI shells render locks, warnings, and product packaging before recommendation or OS layers exist.

## OS Licensing Protection

The contract is deliberately facts-only:

```text
G48 evidence packets
  -> G49A service summary
  -> G49B product packet
```

Any Decision OS, Manager OS, Commissioner OS, or recommendation layer must consume these packets later and add reasoning in its own scoped milestone. G49B does not weaken that licensing boundary.

## Remaining G49C Work

G49C should wire a production evidence resolver for the route, add authenticated league/member checks if this becomes user-facing, and connect premium UI surfaces to the contract. Final advice and OS reasoning should remain outside G49C unless explicitly scoped.
