# Canonical Sports Contracts (Fantasy OS Phase 5)

Defined in `lib/sports-data-gateway/contracts.ts`. Provider-independent; provider fields are transformed inside
adapters and never leak past this boundary. Every record carries `SourceProvenance`; every gateway response
carries `SportsDataContext`.

- **CanonicalPlayer** — `canonicalPlayerId`, `sport`, `providerIds`, name fields, `position`/`positions`,
  `teamId`, `status`, `injuryStatus`, `active`, `metadata`, `source`. Adapters emit `unresolved:<provider>:<id>`
  until resolution assigns the canonical id.
- **CanonicalTeam** — ids, name/abbr/city/conference/division, `logoUrl`, `source`.
- **CanonicalGame** — season, `weekOrRound`, home/away team ids, `scheduledStart`, `status`, `venue`, `score`, `source`.
- **CanonicalPlayerAvailability** — designation, practice status, injury description, expected availability, `source`.
- **CanonicalStatLine** — `season`, `period`, `stats` map, `source`.
- **CanonicalProjection** — `projectedStats`, `projectedFantasyPoints`, `modelOrProviderVersion`, `source`.

## Provenance (`SourceProvenance`)
`primaryProvider`, `providerRecordId`, `fetchedAt`, `sourceUpdatedAt`, `snapshotVersion`, and optional
**field-level** `fields: { [field]: { provider, fetchedAt } }` when a record blends providers (critical for
injuries/news/projections/status/team-assignment/position-eligibility/schedules/live-scores).

## Freshness (`SportsDataContext`)
`generatedAt`, `lastSuccessfulSyncAt`, `sourceProviders`, `snapshotVersions`, `freshnessStatus`
(current/delayed/partial/unavailable), `limitations`. **Separate from truth labels.**

## Events (`SportsDataEvent<T>`)
`eventId` (deterministic for dedup), `eventType`, `sport`, `entityId`, `occurredAt`, `observedAt`,
`sourceProvider`, `snapshotVersion`, `payload`.
