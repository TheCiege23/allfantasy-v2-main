# Fantasy OS — Security & Data Boundary Summary (Phase V6.0)

**Audience:** an enterprise technical reviewer / security architect evaluating Fantasy OS for a pilot.
**Purpose:** a concise, accurate description of how data flows, where responsibilities sit, and what the
presentation layer can and cannot do. Backed by the Phase V4.0 Architecture Review (codebase-verified).

---

## 1. Layered data flow

```
Provider (Sleeper / ESPN / Yahoo / MFL)
        │  import + sync (provider-specific, isolated to the connection layer)
        ▼
Provider-agnostic internal data model  ──────────────┐
        │                                             │
        ▼                                             │  (no provider terms past this line)
Decision OS  (intelligence engine — frozen, shared)   │
   produces snapshots: league health, league          │
   analytics, manager command center, recommendations │
        │  snapshot TYPES only                         │
        ▼                                             ▼
Executive Visualization layer  (presentation only)   White-label config (frontend, brand-keyed)
   renders snapshots → 7 Operating Systems             product name / theme / features
        │
        ▼
Browser (the customer's branded hubs)
```

Every arrow is one-directional. The presentation layer depends on Decision OS **types**; nothing in
Decision OS or the provider layer depends on the presentation layer (verified by grep in V4.0).

## 2. Provider abstraction

- Provider-specific logic is **confined to the connection/import/sync layer**. Downstream, data is
  represented in a provider-agnostic model.
- The executive layer contains **zero provider imports and renders zero provider strings** (source-scanned
  and test-enforced across all executive-viz files, V4.0/V5.0). A reviewer sees the same executive
  experience regardless of which provider supplied the underlying league.
- Consequence for security review: the executive surface cannot leak provider identifiers, credentials, or
  provider-specific fields — it never receives them.

## 3. User-data boundaries

- The executive layer performs **no data fetching, persistence, or mutation of its own** — no
  `fetch`/database/resolver/engine calls exist in it (V4.0). It receives already-computed snapshots and
  renders them. It cannot write user data.
- Data a user sees is **scoped to leagues they belong to / manage**. The manager surface shows every
  league the authenticated user plays in; the commissioner surface applies a commissioner filter.
- **No cross-customer aggregation** is present in the licensed executive layer. (A separate, gated
  analytics/knowledge-graph capability exists elsewhere in the platform and is not part of the licensed
  Fantasy OS executive surface.)
- **No fabricated data:** where a data contract is unavailable, the UI renders an honest "not available"
  state rather than sample or inferred values (a certified truthfulness guarantee, V2.x–V4.0).

## 4. Responsibility split

| Concern | Owner | Notes |
| --- | --- | --- |
| Provider auth, import, sync | Connection layer | Only place provider specifics exist |
| Data normalization | Internal data model | Provider-agnostic representation |
| Intelligence: health, analytics, recommendations | **Decision OS** (frozen, shared) | Produces snapshots; holds all business logic |
| Rendering, hierarchy, decision framing | **Executive Visualization layer** | Type-only dependency on Decision OS; no logic, no I/O |
| Branding, theme, feature visibility | White-label config (frontend) | Env-selected per deployment; no backend tenancy |

## 5. What the presentation layer *cannot* do (by construction)

- It cannot call a provider, a database, or an internal API directly.
- It cannot mutate or persist user data.
- It cannot render provider identifiers or product-name leakage onto the executive surface (test-enforced).
- It cannot fabricate metrics — unavailable contracts degrade to honest empty states.

## 6. Deployment / isolation posture for a pilot

- A pilot can run against a **dedicated non-production database**, isolating pilot data from production
  (mirrors the Phase E live-validation setup).
- Branding is **static frontend configuration** — no per-tenant backend records, so there is no shared
  tenant store to reason about for a single-brand pilot deployment.
- The executive layer adds **no new network egress**: it renders server-provided snapshots; it does not
  open outbound connections of its own.

## 7. Summary for a technical reviewer

Fantasy OS separates *intelligence* (Decision OS, frozen and shared) from *presentation* (the executive
layer, which is inert with respect to I/O and provider specifics). Provider details are isolated to the
connection layer and never reach the executive surface. The presentation layer cannot read, write, or
fabricate data; it renders scoped, provider-agnostic snapshots and degrades honestly when a data contract
is absent. This structure is not a convention — it is verified at the import level and enforced by tests
(Architecture Review V4.0, White-Label V5.0).
