# G49G Provider Orchestration Platform

## Purpose

G49G adds a canonical NFL Redraft provider orchestration layer for choosing, health-checking, falling back, and merging provider-backed data before it reaches runtime consumers.

It remains facts-only and canonical-only. It does not build Decision OS, Manager OS, Commissioner OS, AI reasoning, recommendations, automation, workflow engines, provider-specific UI, or raw provider-payload exposure.

## Architecture

The orchestration flow is:

1. A runtime domain asks for a canonical capability such as `player_identity`, `schedule`, `live_stats`, `headshots`, `logos`, `fantasy_valuations`, `weather`, `news`, `standings`, or `league_import`.
2. The provider policy selects an ordered fallback chain for that capability.
3. Provider health and lifecycle state determine the first usable source.
4. Provider results are accepted only as canonical AllFantasy objects.
5. Canonical objects are sanitized before leaving the orchestration boundary.
6. Conflicting canonical fields are merged by policy priority and recorded for audits.

No React component, premium service, evidence packet, or future OS consumer should receive provider payloads or provider-specific IDs from this layer.

## Provider Policy Matrix

The configured G49G policy is:

- Player Identity: Rolling Insights -> API-Sports -> ClearSports -> Canonical Cache
- Schedule: Rolling Insights -> API-Sports -> Canonical Cache
- Live Stats: Rolling Insights -> Canonical Cache -> Runtime
- Standings: Rolling Insights -> API-Sports -> Canonical Cache -> Runtime
- Headshots: TheSportsDB -> API-Sports -> Rolling Insights -> Default Avatar
- Team Logos: TheSportsDB -> API-Sports -> Rolling Insights -> AF Default Logo
- Fantasy Valuations: FantasyCalc -> Internal Historical Models -> Canonical Cache -> Hidden
- Weather: OpenWeather -> Canonical Cache -> Hidden
- News: API-Sports -> Canonical Cache -> Hidden
- League Import: Sleeper -> ESPN

Policies are config-driven so future provider changes can happen at the orchestration boundary instead of in runtime/UI code.

## Provider States

Providers can be:

- `ACTIVE`
- `DEGRADED`
- `FAILED`
- `DISABLED`
- `EXPIRED`
- `UNKNOWN`

`ACTIVE`, `DEGRADED`, and `UNKNOWN` may be selected. `FAILED`, `DISABLED`, and `EXPIRED` are skipped and the fallback chain continues.

`DEGRADED` and `UNKNOWN` selections are marked with warnings. Stale canonical cache may be selected only when the capability policy allows stale cache fallback.

## Canonical Output Boundary

The orchestrator accepts only normalized canonical data from adapters or cache/runtime sources. Before returning data, it removes unsafe fields such as:

- raw payloads
- provider-specific field names
- provider IDs embedded in canonical data
- secrets
- API keys

The orchestration result still includes internal provider-selection metadata for diagnostics, but `canonicalData` remains provider-payload free.

## Conflict Resolution

When multiple canonical providers return overlapping fields, the fallback policy decides field ownership. Earlier providers keep ownership. Later providers can fill missing fields, and conflicting values are recorded in a deterministic `conflicts` list.

This gives audits and future premium features traceability without letting provider data bypass canonical models.

## Cache And Runtime Fallbacks

Canonical cache is treated as a provider in the policy chain. It can be selected when upstream providers are unavailable, including stale selection when a policy explicitly permits it.

Runtime fallback is used only for domains that can safely preserve existing AllFantasy runtime state, such as live stats and standings. Optional domains such as weather, news, and fantasy valuations can hide unavailable fields rather than invent data.

## What Is Intentionally Excluded

G49G does not:

- call real provider APIs
- introduce Redis or new infrastructure
- wire new UI surfaces
- generate advice or recommendations
- build OS agents
- expose raw payloads
- store provider secrets
- invent missing provider data

## Remaining G49H Work

G49H should connect selected canonical adapter calls to this orchestrator where production provider access is ready, add operational dashboards or admin controls if needed, and continue preserving the canonical-only boundary for UI, premium services, and future OS consumers.
