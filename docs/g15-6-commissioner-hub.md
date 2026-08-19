# G15.6 — Commissioner Hub Read-Only Surface

**Status:** complete. First read-only Commissioner Hub UI, consuming **only** the G15.5
`/api/v1/intelligence` contracts. UI consumption only — no new intelligence logic, no DB/provider
access from the UI, no writes, no Story/Chimmy/SDK.

---

## 1. UI route / location
- **Route:** `/league/[leagueId]/intelligence` (`app/league/[leagueId]/intelligence/page.tsx`) —
  an additive league subpage (matches the existing `…/downsize`, `…/matchups` pattern; does not
  touch the existing league tab shell, so zero regression risk).
- **Component:** `components/commissioner-intelligence/CommissionerIntelligenceHub.tsx`
  (`'use client'`), styled to the existing AllFantasy dark theme. The page is a thin wrapper
  (`useParams` + a back link).

## 2. Modules built
1. **League Activity Summary** (member) — total events, per-category counts, open trades, last activity.
2. **League Health** (commissioner) — health score, status, active/total managers, days since activity.
3. **Commissioner Action Items** (commissioner) — derived items with severity styling.
4. **League Activity Timeline / Event Audit Feed** (member) — privacy-safe summaries, paginated.

## 3. API contracts consumed (only source of truth)
- `GET /api/v1/intelligence/leagues/{leagueId}/activity`
- `GET /api/v1/intelligence/leagues/{leagueId}/health`
- `GET /api/v1/intelligence/leagues/{leagueId}/action-items`
- `GET /api/v1/intelligence/leagues/{leagueId}/audit-feed?limit&cursor`

Each module fetches independently with its own loading/empty/error/permission state. Response
types are defined **locally** in the client component (mirroring the contract) so the client
bundle never imports the server-only intelligence modules.

## 4. Permission behavior
The UI reflects the API's enforcement (it never makes its own access decision):
- **Member-readable** modules (activity, audit-feed) render for any league member.
- **Commissioner-only** modules (health, action-items) render data only on `200`. On
  **401/403/404** they show a neutral *"Commissioner only."* card; on **402** an *"upgrade
  required"* card. **No hidden data leaks through fallbacks** (the restricted state renders
  instead of, not alongside, the data).
- Empty states: "No activity recorded yet", "Not enough data yet", "All clear — no action items",
  "No events yet". Loading + error states per module.

## 5. Privacy
Only contract DTO fields are rendered (counts, scores, timestamps, summaries). The audit feed
shows the precomputed `summary` label — no raw payload, no chat content, no PII/tokens. A test
asserts the rendered DOM contains no `payload`/token/email text.

## 6. Tests
`__tests__/commissioner-intelligence/hub.test.tsx` (React Testing Library, mocked `fetch`):
full render with data; all empty states; commissioner-only restricted state (no data leak);
upgrade (402) state; audit-feed pagination (Load more appends via cursor); no raw payload/PII.

## 7. Known limitations
- **Not browser-proven yet.** Verified by component tests + typecheck only. A live browser pass
  needs a running app (the documented `next dev` hang on this app), commissioner auth, and a
  relay-populated league. Recommended as a follow-up staging check.
- Read-only — no write actions (by phase scope).
- Not yet linked from the main league navigation (reachable by URL); add a nav entry when the hub
  graduates from preview.
- Read models are **staging-only** in the DB today — prod must run the G15.x migrations + the
  relay before these modules show data in prod.

## 8. Future modules
Story Engine narratives, Chimmy grounding panel, write actions (resolve action items), live
scoring pulse, manager drill-down, trends over time — all over the same API contracts.
