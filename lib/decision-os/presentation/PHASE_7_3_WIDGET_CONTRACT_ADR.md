# ADR: Phase 7.3 — Widget Contract Foundation

**Status:** ACCEPTED  
**Date:** 2026-07-01  
**Author:** Decision OS  
**Version:** WIDGET_CONTRACT_VERSION = '7.3.0'

---

## Context

Phase 7.0 built widget **data assemblers** — pure functions that take intelligence cards and
produce layout-neutral content bundles (CompactWidget, SidebarWidget, etc.).

Phase 7.2 proved the Intelligence API can serve IPM shapes via `?view=presentation`.

Before building any widget runtime (React components, SDK bundles, embed scripts), the system
needs a layer that answers:

- **Is this widget configuration valid?** (mode × entityType × tenant × tier)
- **Which API call does this widget need?** (endpoint, params, required scopes, view)
- **Which sections can this tier/mode render?** (deterministic section filter)
- **What does the widget emit when something goes wrong?** (degraded state contract)
- **What telemetry events does the widget produce?** (impression, interaction, error)
- **What layout constraints does each mode carry?** (responsive hints)
- **What privacy restrictions apply?** (event counts, identifier anonymization)

Without these contracts, every widget runtime will implement these rules independently —
creating the same N-implementation problem Phase 7.0 solved for presentation logic.

---

## Decision

Introduce `widget-contracts.ts` as the single authoritative contract for widget
configuration, validation, API mapping, section filtering, telemetry, degraded states,
layout hints, and privacy restrictions.

### Architecture position

```
Phase 7.2 Intelligence API  (?view=presentation)
    │
    ▼
Phase 7.3 Widget Contract Foundation     ◄── this module
    │  validateWidgetConfig()
    │  mapWidgetModeToApiCall()
    │  resolveAllowedSections()
    │  filterSectionsByTier()
    │  buildWidgetDegradedState()
    │  buildWidgetTelemetryEvent()
    │
    ▼
Widget Runtime (Phase 7.4 — React SDK)  [not built here]
    │
    ▼
Embed Surface (commissioner hub, white-label, hosted embed)
```

Every widget runtime MUST:
1. Call `validateWidgetConfig()` before rendering
2. Call `mapWidgetModeToApiCall()` to determine the API request
3. Call `resolveAllowedSections()` to know which sections to render
4. Call `filterSectionsByTier()` if the API key tier is known at render time
5. Emit `buildWidgetTelemetryEvent()` events for impression and error
6. Render `buildWidgetDegradedState()` output when data is unavailable

---

## Section Definitions

```
health_score         — League/manager health score + bar
retention_card       — Retention risk + at-risk manager list
commissioner_workload — Commissioner workload level + items
recommendations      — Recommendation cards (filtered by tier)
metrics_grid         — KPI metric cards (engagement, retention, etc.)
archetype_label      — League archetype classification badge
benchmark_comparison — Platform percentile ranks + radar
behavioral_patterns  — Manager behavioral sequence signals
dna_identity         — Manager identity archetype card
activity_heatmap     — Platform-level activity heatmap
intervention_list    — Platform intervention opportunities
company_intelligence — Company/licensee intelligence card
badges               — Entity badge chips
graphs               — Chart/graph models
```

## Section × Mode allowed matrix

| Section | compact | sidebar | full_dashboard | popup | commissioner | manager | mobile | partner |
|---------|---------|---------|----------------|-------|--------------|---------|--------|---------|
| health_score | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | inner |
| retention_card | | ✓ | ✓ | | ✓ | | | inner |
| commissioner_workload | | | ✓ | | ✓ | | | inner |
| recommendations | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | inner |
| metrics_grid | | ✓ | ✓ | | ✓ | ✓ | | inner |
| archetype_label | | | ✓ | | ✓ | | | inner |
| benchmark_comparison | | | ✓ | | | | | inner |
| behavioral_patterns | | | ✓ | | | ✓ | | inner |
| dna_identity | | | ✓ | | | ✓ | | inner |
| activity_heatmap | | | ✓ | | | | | |
| intervention_list | | | ✓ | | | | | |
| company_intelligence | | | ✓ | | | | | |
| badges | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | inner |
| graphs | | | ✓ | | ✓ | ✓ | | inner |

## Section × Tier gate (minimum tier to render section)

| Section | Minimum tier |
|---------|-------------|
| health_score | basic |
| retention_card | commissioner |
| commissioner_workload | commissioner |
| recommendations | commissioner (commissioner-tier recs) or manager (manager-tier) |
| metrics_grid | commissioner or manager |
| archetype_label | commissioner |
| benchmark_comparison | platform |
| behavioral_patterns | manager |
| dna_identity | manager |
| activity_heatmap | platform |
| intervention_list | platform |
| company_intelligence | platform |
| badges | basic |
| graphs | commissioner |

---

## API Call Mapping

| Widget mode | Endpoint | Required scope |
|------------|----------|----------------|
| compact (league) | /api/v1/intelligence/league | intelligence:league:read |
| compact (manager) | /api/v1/intelligence/manager | intelligence:manager:read |
| compact (platform) | /api/v1/intelligence/platform | intelligence:platform:basic |
| sidebar | /api/v1/intelligence/league | intelligence:league:read |
| full_dashboard | /api/v1/intelligence/league + /platform | intelligence:league:read |
| popup | /api/v1/intelligence/league | intelligence:league:read |
| commissioner | /api/v1/intelligence/league | intelligence:league:read |
| manager | /api/v1/intelligence/manager | intelligence:manager:read |
| mobile | entityType-dependent | basic scope |
| partner | inner mode's call | inner mode's scope |

All calls use `?view=presentation`.

---

## Constraints (all must hold)

| Constraint | Rule |
|-----------|------|
| Deterministic | Same config → same validation result, same section list, same API call |
| No runtime I/O | All helpers are pure functions |
| No internal leakage | No internal Decision OS field names in output |
| No CSS/Tailwind | Layout hints use pixels only; theme is semantic ColorToken names |
| No React | No JSX, no hooks, no component refs |
| No frontend deps | Zero imports from UI framework packages |
| Architecture Freeze | No changes to Phase 7.0 widget assemblers or types |
| Backward compatible | Additive only; existing widget data shapes unchanged |
| API key never surfaced | tenantId hashed in telemetry; apiKey stripped from all outputs |

---

## Rejected Alternatives

### Option A — Embed validation in route handlers
Route handlers already have scope gating. But they don't know the widget's display context
(mode, layout, sections). Contract validation belongs at the widget boundary, not the API.

### Option B — Ship validation as SDK runtime logic only
SDK consumers would need to duplicate validation. Central contracts prevent divergence.

### Option C — Include layout hints in Phase 7.0 widget types
Phase 7.0 is content-only (data) by design. Layout hints are operational metadata for the
runtime, not content for the data bundle. Mixing them would violate Phase 7.0's constraint
of no frontend assumptions.

---

## Files Created

| File | Purpose |
|------|---------|
| `presentation/widget-contracts.ts` | NEW — all types + 6 pure helper functions |
| `presentation/PHASE_7_3_WIDGET_CONTRACT_ADR.md` | NEW — this document |
| `__tests__/decision-os/phase7/widget-contract-foundation.test.ts` | NEW — test suite |
