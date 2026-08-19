# Sports Data Identity Resolution (Fantasy OS Phase 5)

`lib/sports-data-gateway/resolution.ts`. Canonical ids are **never** replaced by provider ids. Resolution is
deterministic and outcome-explicit; players are **never merged on display name alone**.

## Outcomes (`ResolutionStatus`)
- `resolved` — an exact **certified** `(provider, providerId)` mapping, OR exactly **one** candidate corroborated
  by stable signals (sport + team/position/birthDate).
- `ambiguous` — multiple candidates → **quarantined**, not merged.
- `unresolved` — name-only evidence, or zero corroborated candidates → **quarantined**; never invents a canonical id.
- `conflicting` — reserved for future certified-mapping contradictions.

## Evidence hierarchy
1. Certified provider-id mapping (strongest, always trusted).
2. Sport + team + position (+ birthDate when available).
3. Name is **never** sufficient by itself.

## Integration seam
`MappingSource` is injected, so the resolver fronts the existing player-identity infrastructure
(`PlayerIdentityMap` / `lib/shared-services/player-identity`, `SportsPlayer.sleeperId`) without duplicating it.
Ambiguous/unresolved records are surfaced (quarantine) for later certification — not silently dropped or merged.

## Proven
The real Sleeper validation resolved 1 certified player → `canon-verified-1` and left 7 uncertified players
**unresolved (quarantined)** rather than fabricating canonical ids — the correct, honest behavior.
