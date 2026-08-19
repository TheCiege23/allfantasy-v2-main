# G15.5 — Commissioner Intelligence API Layer

**Status:** complete. Backend API only — stable versioned contracts over the G15.4 Intelligence
Query Service. No Commissioner Hub UI, Story Engine, Chimmy, or external SDK package yet (these
consume these contracts in later phases).

The Intelligence Query Service is the **only** data source; handlers never touch
provider/feature/raw tables. Responses are privacy-safe (no chat content, PII, tokens, or raw
payload dumps).

---

## 1. API contract

Base: `/api/v1/intelligence/leagues/{leagueId}`. All `GET`. Envelope: `{ "data": … }` (plus
`{ "meta": … }` for paginated responses). Errors: `{ "error": "<code>" }` with an HTTP status.

| Route | Access | Response `data` |
|---|---|---|
| `GET …/activity` | member | `LeagueActivitySummary` — totals, per-category counts, openTradeProposals, first/last activity |
| `GET …/health` | **commissioner** | `LeagueHealthSnapshot` — healthScore, status, active/total managers, daysSinceLastActivity |
| `GET …/managers/{managerId}` | self **or** commissioner | `ManagerActivitySnapshot` — lastActiveAt, action counts |
| `GET …/action-items` | **commissioner** | `CommissionerActionItem[]` — derived (`pending_trades`, `stale_league`, `inactive_managers`, `no_activity`) |
| `GET …/audit-feed?limit&cursor` | member | `AuditFeedItem[]` + `meta.nextCursor` — privacy-safe activity timeline |

### Response examples
```jsonc
// GET …/activity
{ "data": { "leagueId": "lg_1", "sport": "NFL", "leagueConcept": "redraft",
  "totalEvents": 142, "openTradeProposals": 1, "lastActivityAt": "2026-06-27T18:00:00.000Z",
  "counts": { "trade": 9, "waiver": 31, "lineup": 40, "draft": 12, "scoring": 48,
    "governance": 1, "lifecycle": 1, "other": 0 } } }

// GET …/health  (commissioner)
{ "data": { "leagueId": "lg_1", "healthScore": 80, "status": "healthy",
  "totalManagers": 12, "activeManagers": 11, "daysSinceLastActivity": 1, "openTradeProposals": 1 } }

// GET …/audit-feed?limit=2
{ "data": [
    { "eventId": "…", "type": "competition.champion.crowned", "summary": "Champion crowned",
      "occurredAt": "2026-06-27T…", "actorType": "system", "sport": "NFL", "leagueConcept": "redraft" }
  ],
  "meta": { "nextCursor": "ckv…" } }

// errors
401 { "error": "unauthorized" }   403 { "error": "forbidden" }   404 { "error": "not_found" }
402 { "error": "feature_unavailable", "feature": "…", "decision": "upgrade_required" }
```

---

## 2. Permission model

Reuses the safest existing helpers (`lib/league/league-access.ts`):
- **member-readable** (`assertLeagueMember`): `activity`, `audit-feed`, own `managers/{self}`.
- **commissioner-only** (`assertLeagueCommissioner`): `health`, `action-items`, another
  manager's `managers/{other}`.
- `managers/{managerId}`: a member may read **their own** snapshot; reading **another** manager
  requires commissioner.

Status mapping: unauthenticated → **401**; league missing → **404**; member/commissioner check
fails → **403**.

Handlers (`lib/intelligence/api/handlers.ts`) take injected deps (`getUserId`, `assertMember`,
`assertCommissioner`, `service`) so they're unit-tested without Next/DB. Routes are thin wrappers
that supply real deps via `lib/intelligence/api/deps.ts`.

---

## 3. Feature-gate model

The Query Service applies `IFeatureGate.decide(principal, feature)` on every method. **Default
`AllowAllFeatureGate`** → nothing gated in G15.5. Denials surface at the API boundary:
`upgrade_required` → **402**, `deny` → **403** (`{ error: "feature_unavailable", feature, decision }`).
A later phase injects a Stripe-entitlement gate and flips features to premium **without changing
route contracts** (the route/handler/DTO shapes are stable).

---

## 4. Privacy guarantees
- Audit-feed items expose only `{ eventId, type, summary, occurredAt, actorType, sport, leagueConcept }`
  — the `summary` is a label (no payload content), and no raw payload/subjects are returned.
- Snapshots return counts/timestamps/health only. No chat content, no provider tokens, no PII
  beyond league-internal `managerKey` (the user id) on commissioner/self endpoints.

---

## 5. Future external licensing notes
- The same versioned contract is intended to power external SDK/white-label widgets later.
  Keeping it behind `/api/v1/` + a stable envelope means the external surface = the internal
  surface (dogfooding), so it never drifts.
- External access will add an **API-key/OAuth** auth adapter in `deps.getUserId`/access checks
  and a `tenantId` scope, plus rate limiting — without changing handlers or DTOs.
- Pagination uses an opaque `cursor` (audit-feed) so the underlying ordering can evolve.

---

## 6. Tests
`__tests__/intelligence/api-handlers.test.ts`: success per route; 401 unauthenticated; 404
missing league; 403 non-member / non-commissioner; commissioner-only enforcement; self-vs-other
manager; feature-gate deny→403 / upgrade→402; empty-state 200; audit-feed pagination
(`nextCursor`) + `parseAuditFeedQuery` clamping. Query-service audit-feed pagination is covered
by the G15.4 DB integration patterns.

## 7. Remaining risks
1. Route handlers are unit-tested via injected deps (no live Next route execution test) — the
   thin route wrappers + `deps.ts` are exercised in staging, not in unit tests.
2. Feature gate is allow-all by design now; real entitlement enforcement is a later phase.
3. Audit-feed cursor is the read-model row id (opaque); stable as long as the projection isn't
   rebuilt mid-pagination (rare; documented).
4. Prod migrations for the read models must be applied before these routes return data in prod
   (staging-only today).
