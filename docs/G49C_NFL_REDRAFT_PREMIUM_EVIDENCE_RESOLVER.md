# G49C NFL Redraft Premium Evidence Resolver

## Purpose

G49C wires a canonical evidence resolver behind the NFL Redraft premium service contract and hardens `POST /api/redraft/premium-services` for production-safe facts-only use.

The route still returns service packets only. It does not create Decision OS, Manager OS, Commissioner OS, LLM reasoning, recommendations, generated announcements, War Room UI, or payment/Stripe changes.

## Resolver Flow

The resolver lives in:

- `lib/redraft-premium/nflRedraftPremiumEvidenceResolver.ts`

Flow:

```text
canonical request IDs
  -> service-specific evidence type selection
  -> G48 canonical evidence packet filtering
  -> request-context surface evidence when enough canonical scope exists
  -> G49B product packet
```

The resolver selects only G48 packet types allowed by the requested G49A service. It filters by canonical league, team, player, and matchup IDs when packet IDs are present. It never reads raw provider payloads and never returns evidence facts directly to the API consumer.

## Route Hardening Rules

The route now applies:

- strict documented-field validation
- canonical-ID-only validation
- provider ID and provider payload key rejection
- unknown service rejection
- invalid tier rejection
- positive integer validation for week and season
- safe JSON parse errors
- stable success/error response shape
- resolver status and evidence count reporting

Responses include:

- service name
- required tier
- access status
- canonical IDs
- evidence packet IDs
- freshness warnings
- stale data warnings
- fallback warnings
- missing data warnings
- eligible surfaces
- factual category labels
- unavailable-data messages
- resolver status
- evidence counts

## Entitlement And Auth Boundary

G49C reuses existing subscription helpers for deterministic entitlement-to-tier mapping. It does not add Stripe or mutate entitlements.

The route does not yet perform authenticated database-backed league membership enforcement because the production evidence source is not wired in this milestone. Instead, the contract exposes access denial deterministically and documents the auth hook boundary for G49D. The route does not bypass entitlement checks: denied requests return `accessStatus.allowed: false` and do not produce advice or OS outputs.

G49D should add authenticated user, league membership, and entitlement-source resolution when the route becomes connected to production league data.

## Service-Specific Evidence Selection

The resolver supports:

- War Room Service: projection, injury, news, schedule, weather, live stats, fantasy scoring, stat correction, roster, and matchup context
- Commissioner Digest Service: roster, matchup, trade, fantasy scoring, stat correction, schedule, and weather context
- Manager Brief Service: identity, metadata/media, projection, injury, news, ranking/ADP, schedule, weather, live stats, fantasy scoring, and roster context
- Matchup Prep Service: projection, injury, schedule, weather, live stats, fantasy scoring, and matchup context
- Waiver Report Service: identity, metadata/media, projection, injury, news, ranking/ADP, schedule, weather, and waiver context
- Trade Review Service: identity, metadata/media, projection, injury, news, ranking/ADP, schedule, weather, and trade context
- Draft Prep Service: identity, metadata/media, projection, injury, news, ranking/ADP, schedule, weather, and draft context
- Basic Runtime Facts: identity, metadata/media, schedule, weather, live stats, fantasy scoring, roster, and matchup context

When no matching external canonical evidence exists, the resolver reports `empty`. When it can only build request-context evidence from canonical IDs, it reports `partial`.

## Intentionally Excluded

G49C excludes:

- start/sit recommendations
- waiver recommendations
- trade recommendations
- collusion conclusions
- AI explanations
- natural-language summaries
- raw provider payloads
- provider-specific player IDs
- War Room UI
- Stripe/payment work

## Remaining G49D Work

G49D should connect the resolver to production canonical evidence sources, add authenticated league membership enforcement, resolve entitlements server-side, and wire premium UI shells to the hardened contract while keeping recommendation and OS reasoning in a later explicit milestone.
