# ADR: Core Plugin Framework

Status: Accepted for architecture scaffolding in G19

Date: 2026-06-30

## Context

AllFantasy has strong Core Engine work for scoring, live scoring, draft, schedule, playoffs, waivers, trades, commissioner controls, and lifecycle. The remaining risk is format drift: Redraft, Dynasty, Keeper, Best Ball, Guillotine, Survivor, Tournament, Big Brother, Zombie, Devy, C2C, and IDP can become separate implementations if core engines branch on league type.

The platform direction is:

- Core Engines own behavior.
- Plugins own rules.
- Core code should resolve a plugin contract instead of branching on `leagueType`.

## Decision

Introduce `lib/plugin-framework` as an architecture-first contract layer.

The framework defines:

- `CoreLeaguePlugin`: a stable plugin descriptor.
- Lifecycle hooks for league creation, draft completion, season start, weekly advancement, playoffs, champion finalization, archive, and rollover.
- Engine contracts for draft, schedule, playoffs, waivers, trades, scoring, commissioner settings, and Decision OS.
- A registry with `registerPlugin(plugin)` and `getPlugin(leagueType)`.
- `RedraftPlugin` as Plugin #1 in mapping form only.

No Core Engine behavior is changed in this ADR.

## Consequences

Positive:

- Future formats can extend engines through contracts instead of engine rewrites.
- The framework gives audits a common vocabulary for "Core vs Plugin".
- Registry lookup is deterministic and testable.
- Redraft can migrate first without blocking current production paths.

Tradeoffs:

- Existing format registries remain in place during migration.
- Some current league-type branches are acceptable until the engine consumer has a plugin-aware adapter.
- The first version is mostly type and architecture scaffolding, not a full plugin runtime.

## Migration Rule

Do not add new core-engine branches such as:

```ts
if (leagueType === 'dynasty') {
  // format behavior
}
```

Prefer:

```ts
const plugin = requirePlugin(leagueType)
await plugin.lifecycle?.onWeekAdvanced?.(context)
```

## Non-Goals

- Do not build Dynasty, Keeper, Best Ball, Guillotine, Survivor, Tournament, Big Brother, Zombie, Devy, C2C, or IDP in G19.
- Do not rewrite Redraft.
- Do not replace the existing format engine, concept preset catalog, or specialty registry yet.
- Do not make browser-visible behavior changes.
