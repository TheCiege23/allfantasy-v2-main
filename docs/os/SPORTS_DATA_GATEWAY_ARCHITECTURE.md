# Sports Data Gateway — Architecture (Fantasy OS Phase 5)

The single provider-neutral read path for normalized sports data. Subsystems consume ports backed by the
gateway; they never call provider SDKs/HTTP directly.

```
External sports providers → Provider adapters → Sports Data Gateway →
Canonical contracts → Versioned snapshots + events → Fantasy OS subsystem consumers
```

## Modules (`lib/sports-data-gateway/`)
| File | Responsibility |
|---|---|
| `contracts.ts` | Canonical Player/Team/Game/Availability/StatLine/Projection + `SourceProvenance` + `SportsDataContext` (freshness) + `SportsDataEvent` |
| `capabilities.ts` | `SportsDataCapability`, `ProviderCapabilityDeclaration`, `CapabilityRegistry` (rejects unsupported combos) |
| `adapter.ts` | Uniform `SportsProviderAdapter` interface + `BaseProviderAdapter` (default = structured unsupported error) |
| `providers/sleeper.ts` | Real Sleeper adapter (players/rosters/transactions/draft_data), schema-validated, provenance-tagged |
| `selection.ts` | `ProviderPriorityRule` + deterministic `selectProvider` with **capability-specific** fallback + health skip |
| `resolution.ts` | `ResolutionStatus` + `resolveIdentity` (certified id / single corroborated candidate; never name-only; quarantine ambiguous) |
| `errors.ts` | `ProviderResult`, deterministic `classifyError`, `GatewayError` |
| `schema.ts` | `validateShape`/`validateBatch` — reject drift with a **redacted** path, never full payloads |
| `gateway.ts` | Facade: capability gate → selection/fallback → adapter dispatch → provenance → freshness; **fails closed** |
| `ports.ts` | Subsystem ports (Draft/Trade/Waiver/Lineup) + `GatewayDraftPort` (gateway-backed reference impl) |
| `inventory.ts` | Gate 1 typed provider inventory (from the real audit) |

## Non-negotiables
- **Fail closed** — provider failure/unsupported capability never fabricates data; the caller renders an
  unavailable/insufficient-evidence state.
- **Canonical ids ≠ provider ids** — adapters emit `unresolved:<provider>:<id>`; `resolution.ts` assigns the
  canonical id or quarantines.
- **Provenance everywhere** — every record carries `SourceProvenance`; blended records carry field-level provenance.
- **Freshness ≠ truth label** — `SportsDataContext.freshnessStatus` is separate from the Live/Derived/Preview/Insufficient vocabulary.
- Credentials come from `lib/provider-config.ts` (secret-safe); the gateway never logs/returns secrets.

## Adding a provider
1. Implement a `BaseProviderAdapter` subclass; declare capabilities honestly.
2. Add credential resolution to `provider-config.ts` (never inline secrets).
3. Add `ProviderPriorityRule`s for the (sport, capability) pairs it should serve.
4. Add schema specs + fixtures; add a real minimal validation.
5. Register it with the gateway. No subsystem code changes.
