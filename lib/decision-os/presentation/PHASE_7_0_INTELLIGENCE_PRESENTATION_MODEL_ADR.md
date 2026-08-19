# ADR: Phase 7.0 — Intelligence Presentation Model (IPM)

**Status:** ACCEPTED  
**Date:** 2026-07-01  
**Author:** Decision OS  
**Version:** 7.0.0

---

## Context

Phase 6 Decision Intelligence (6.1–6.6) produces rich, auditable intelligence
covering behavioral patterns, manager identity, league archetypes, platform
benchmarks, recommendations, and company-level signals — 1,735 tests, fully
deterministic and provider-agnostic.

Before Phase 7, every frontend (Commissioner Hub, Import Preview, Widgets, Hosted API)
derived its own presentation logic independently:

- `CommissionerIntelligencePreview.tsx` computes health scores inline from raw payload
- `CommissionerIntelligenceHub.tsx` mirrors API DTO types locally per component
- Future SDK consumers would need to re-implement all severity, color, badge, and
  recommendation presentation logic themselves

This creates **N presentation implementations** for the same intelligence — each
frontend can drift from the others, produce inconsistent color/severity signals, and
carry implicit knowledge that belongs in the intelligence layer.

---

## Decision

Introduce the **Intelligence Presentation Model (IPM)** as the single deterministic
presentation layer between Decision Intelligence and every frontend surface.

### Architecture

```
Decision OS (World / Behavioral / Phase 6)
    │
    ▼
Intelligence Presentation Model  ◄── this module
    │
    ├── Dashboard (Commissioner Hub, Manager Hub)
    ├── Widget Platform (compact, sidebar, popup, partner)
    ├── Hosted API (v1 presentation layer)
    ├── SDK (white-label consumers)
    └── White-label Platform (Sleeper, Yahoo, ESPN, …)
```

Every frontend renders from exactly the same presentation contracts produced here.
No frontend computes intelligence, colors, scores, badges, graphs, or KPIs independently.

---

## Constraints

All IPM code must satisfy every constraint below. Violations require a new ADR.

| Constraint | Rationale |
|---|---|
| Pure functions only — no DB, no IO, no side effects | Same input → same output; testable in isolation |
| No React, CSS, Tailwind, HTML, SVG, browser APIs | IPM is runtime-agnostic; frontends supply their own rendering |
| No UI framework imports | Framework independence |
| No provider-specific logic | Origin-blind; any datasource can feed the IPM |
| No AI generation | Deterministic; auditable at every output field |
| No writes | Read-only projection layer |
| Provenance preserved via `derivation[]` on every output | Full audit trail from signal → presentation |
| Completeness propagated from inputs | Uncertainty is never hidden |
| Uncertainty propagated as explicit `uncertainty[]` arrays | Frontends can show confidence indicators |
| All outputs JSON-serializable | Wire-safe for Hosted API; cacheable |
| All arrays deterministically sorted | Stable frontend rendering without client-side sort |
| Version-stamped (`PRESENTATION_VERSION = '7.0.0'`) | Breaking change detection |

---

## Token Systems

### Color Tokens (`ColorToken`)

Semantic names only — no hex codes, no CSS variables. Frontends resolve via their
own theme system or a `WhiteLabelConfig`. Examples: `'success'`, `'danger'`, `'benchmark_above'`.

### Icon Tokens (`IconToken`)

Semantic icon names — no imports from icon libraries. Frontends resolve to their own
icon components. Examples: `'trophy'`, `'alert_triangle'`, `'ghost'`.

### Severity Tokens (`SeverityToken`)

Deterministic urgency classification: `critical | elevated | standard | advisory | positive`.
Each severity maps to a `SeverityDefinition` with `priority`, `displayColorToken`, `iconToken`,
and `animationToken`. Priority 1 = most urgent.

---

## Output Inventory

| Module | What it produces |
|---|---|
| `tokens.ts` | Score→severity, tier→severity, tier→color mappings |
| `badges.ts` | Per-entity Badge objects from identity/archetype/benchmark signals |
| `graphs.ts` | 16 graph model assemblers (gauge, bar, heatmap, radar, …) |
| `cards.ts` | 10 card model assemblers (health, DNA, archetype, benchmark, …) |
| `recommendations.ts` | Phase 6.4 Recommendation → RecommendationPresentation (adds title, difficulty, estimatedTime, relatedGraph) |
| `widgets.ts` | 8 widget contract assemblers (compact, sidebar, full_dashboard, popup, commissioner, manager, mobile, partner) |
| `api-presentation.ts` | IPM result → Hosted API response shapes |
| `white-label.ts` | Token override layer for licensee design systems |

---

## Privacy

The IPM inherits Phase 6 privacy boundaries:
- **Tier 1** (manager/league/commissioner presentations): entityId present, scoped to caller's tenant
- **Tier 2** (company/platform presentations): aggregate only, no individual IDs in output

No IPM output introduces new PII beyond what Phase 5/6 already carries.

---

## White-Label Layer

White-label configurations are **pure lookup tables** — no provider knowledge, no
data-format logic. Each `WhiteLabelConfig` maps IPM semantic token names to the
licensee's design-system token names. The IPM produces `colorToken: 'success'`;
the licensee config says `'success' → 'sleeper-green'`; the frontend resolves to
the actual CSS value. The IPM itself never resolves tokens.

Named platforms (`WhiteLabelPlatform`): `sleeper | yahoo | espn | fantrax | cbs |
draftkings | fanduel | underdog | default`.

---

## Versioning

`PRESENTATION_VERSION = '7.0.0'`

- **Patch bump** (7.0.x): bug fixes, non-breaking additions to derivation strings
- **Minor bump** (7.x.0): additive new graph types, card types, or badge types
- **Major bump** (x.0.0): breaking changes to existing output shapes — requires all consumers to update

All outputs carry the version string so frontends can detect stale cached responses.

---

## Consequences

**Good:**
- One implementation of all severity/color/badge/graph/widget logic
- Every frontend guaranteed to show consistent signals
- White-label consumers get a complete presentation layer with zero re-implementation
- Full audit trail from intelligence signal → presentation token → frontend display

**Trade-offs:**
- IPM adds a processing step between Phase 6 outputs and frontends
- IPM graph models are data contracts, not rendering libraries — frontends still choose their own charting library
- White-label token resolution happens at the frontend, not in the IPM
