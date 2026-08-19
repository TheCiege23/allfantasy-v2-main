# G15.7 — Commissioner Hub Verification + Navigation Entry

**Status:** complete. Promotes the read-only Commissioner Hub from a hidden route to a
navigable, browser-verified league surface. Verification + safe navigation only — no new
intelligence logic, no write actions, no Story/Chimmy/SDK.

---

## 1. Navigation entry
- **Location:** `app/league/[leagueId]/tabs/LeagueTab.tsx` (the existing "Commissioner Hub"
  league tab) — a labeled link **"League Intelligence"** at the top of the tab, linking to
  `/league/[leagueId]/intelligence`. `data-testid="nav-commissioner-intelligence"`.
- **Why there:** lowest-risk, additive entry inside the existing commissioner surface (no edit to
  the 2,676-line `LeagueShell`). Follows existing conventions (`next/link`, dark-theme card).
- **Security:** the link is shown to all members (the hub has member-readable sections). Access
  control is **enforced by the API**, not the client — commissioner-only cards return 403 from
  `/api/v1/intelligence/*` and the UI renders a neutral "Commissioner only." state. No security
  is hidden behind client-only checks.

## 2. Modules / route (unchanged from G15.6)
`/league/[leagueId]/intelligence` → Activity Summary (member), League Health (commissioner),
Action Items (commissioner), Activity Timeline / Audit Feed (member). Consumes only the
`/api/v1/intelligence` contracts.

## 3. Browser proof
**Spec:** `e2e/commissioner-intelligence-hub.spec.ts` (`RUN_INTEL_HUB=1`), run against a
production `next start` build on the non-prod **staging** DB (`ALLOW_E2E_SEED=1`).

Flow: register/login (commissioner) → self-seed a commissioner league (real finalize path emits
events) → `POST /api/e2e/run-relay` drains the outbox through the audit-feed + intelligence
consumers → open `/league/[id]/intelligence` → assert.

Assertions: hub renders; all four modules visible; commissioner-only cards (health, action-items)
are **NOT** access-restricted for the owner; activity + audit-feed render content; **no**
`payload`/`passwordHash`/`server-only`/`PrismaClient` text leaks.

### Results — PASSED (2026-06-27)
Run against a fresh production `next start` build (`BUILD_ID rAXum24uGYP3hgBRdl0TY`) on the Neon
**staging** DB (`ep-winter-salad`, non-prod), `ALLOW_E2E_SEED=1`, port 3101.

- **`1 passed (36.3s)`**, exit 0. Trace:
  `test-results/commissioner-intelligence--7fda6…-chromium/trace.zip`.
- Flow executed: register/login → self-seed commissioner league → `POST /api/e2e/run-relay`
  (drained the outbox, `summary.dispatched > 0`) → opened `/league/[id]/intelligence`.
- Verified in-browser: hub rendered; **all four modules visible**; the commissioner-only cards
  (health, action-items) showed **no** `state-restricted` (owner has access); **activity-content**
  and **audit-feed-content** rendered (seed emitted 4 events → 1 league snapshot + 4 audit
  entries); **no** `payload`/`passwordHash`/`server-only`/`PrismaClient` text on the page.
- Cleanup: seeded league removed by `afterAll` (0 `G8 DST Verify%` remaining); the run's event +
  read-model rows cleaned (staging back to 0). Staging server stopped.

> Note: not yet captured as a PNG screenshot — the Playwright trace (`--trace on`) contains the
> per-step DOM snapshots; open with `npx playwright show-trace <path>`. The passing assertions are
> the authoritative written proof.

## 4. Permission behavior (verified)
- Member: activity + audit-feed render with data; commissioner cards would render "Commissioner
  only" (403 from API). Covered by the G15.6 RTL test + enforced server-side.
- Commissioner (owner): all four modules render (browser proof).
- 401/402/403/404 → clean UI states (RTL `hub.test.tsx`).

## 5. Known limitations
- Hub is read-only; not yet linked from the global app nav (only from the Commissioner Hub tab).
- Health/action-items richness depends on **manager** snapshots, which require user/commissioner-
  actor events; engine/system events populate league activity + audit feed but not per-manager
  rows (so a freshly seeded league may show "Not enough data yet" on health — a valid clean state).
- Read models are **staging-only** in the DB; prod must run the G15.x migrations + the relay.

## 6. Production deploy checklist
1. Apply migrations on prod (direct host): `20260627010000` (event foundation) ·
   `…020000` (projections) · `…030000` (outbox claim) · `…040000` (intelligence read models);
   then `prisma migrate resolve --applied …` for each.
2. Run the relay as a worker/cron on prod (`scripts/run-outbox-relay.ts`, single-node until the
   distributed bus lands) so read models populate.
3. Confirm `/api/v1/intelligence/*` returns data + the nav link reaches the hub.
4. (Optional) enable the entitlement-backed feature gate to make commissioner intelligence
   premium — the 402 "upgrade" UI path is already wired.
5. The e2e routes (`/api/e2e/*`) stay disabled in prod (no `ALLOW_E2E_SEED`).
