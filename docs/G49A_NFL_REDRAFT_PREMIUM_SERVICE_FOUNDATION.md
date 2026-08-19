# G49A NFL Redraft Premium Service Foundation

## Purpose

G49A creates the facts-only service foundation for paid AllFantasy NFL Redraft features:

- AF Pro
- AF Commissioner
- AF Supreme
- AF War Room

This milestone does not create Decision OS, Manager OS, Commissioner OS, LLM reasoning, recommendations, payment integration, or automation. It defines deterministic service contracts that consume canonical AllFantasy runtime context and G48 provider evidence packets.

## Architecture

The data path remains:

```text
Provider payload
  -> G45 provider foundation
  -> G46A-G47B canonical player/game/live models
  -> G48 evidence packets
  -> G49A premium service summaries
```

No service accepts raw provider payloads. No service exposes provider-specific IDs. Service outputs include only canonical IDs, evidence packet IDs, freshness/fallback/missing status, supported surfaces, tier requirements, and factual action category labels.

## Service Boundaries

G49A defines contracts for:

- Basic Runtime Facts
- War Room Service
- Commissioner Digest Service
- Manager Brief Service
- Matchup Prep Service
- Waiver Report Service
- Trade Review Service
- Draft Prep Service

These services can identify relevant canonical players, teams, matchups, games, evidence packets, stale data, missing data, fallback records, provider domains, and affected surfaces. They cannot decide what a manager should do.

Excluded from G49A:

- start/sit recommendations
- waiver priority recommendations
- trade recommendations
- collusion conclusions
- generated announcements
- LLM explanations or summaries
- AI/OS routing
- payment provider integration
- raw provider payload exposure

## Tier Mapping

| Tier | Access |
| --- | --- |
| `FREE` | Basic Runtime Facts |
| `AF_PRO` | Manager Brief, Matchup Prep, Waiver Report basic, Trade Review basic, Draft Prep basic |
| `AF_COMMISSIONER` | Commissioner Digest, Trade Review commissioner view |
| `AF_SUPREME` | AF Pro + AF Commissioner services, advanced service variants |
| `AF_WAR_ROOM` | War Room Service with live Sunday/injury/weather/scoring context aggregation |

The model is intentionally a service contract. It does not create billing, checkout, entitlement storage, or subscription mutation flows.

## OS Licensing Protection

The boundary keeps licensed OS work separate:

- G48 evidence packets are facts.
- G49A summaries are structured service inputs/outputs.
- Future OS layers may consume those summaries, but must add reasoning in their own licensed scope.

This prevents premium service plumbing from becoming hidden Decision OS, Manager OS, or Commissioner OS logic.

## Remaining G49B Work

G49B can safely build on this foundation by adding product-specific packaging and route contracts. It should still avoid final recommendations until the scoped recommendation/OS milestone and should continue consuming canonical evidence summaries instead of provider payloads.
