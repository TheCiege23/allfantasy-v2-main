# G25 Manager DNA Premium Experience

Readiness remains unchanged:

- NFL Engine: 93%
- Overall Platform: 90%

## Implementation Summary

G25 adds a customer-facing Manager DNA presentation slice using the premium card pattern established by G24 League Pulse.

This phase does not change Manager DNA algorithms, classifiers, provider logic, Stage 1 soak behavior, or backend routes. The new adapter only consumes existing Phase 6.2 Manager DNA outputs and converts them into customer-safe presentation data.

## Reused Modules

- Phase 6.2 Manager DNA profile output:
  - `lib/decision-os/phase6/dna/types.ts`
- Existing presentation card output:
  - `lib/decision-os/presentation/types.ts`
- G24 visual pattern:
  - `components/decision-os/LeaguePulseCard.tsx`

## Files Added Or Updated

- `lib/decision-os/manager-dna.ts`
- `components/decision-os/ManagerDnaCard.tsx`
- `app/dashboard/DashboardContent.tsx`
- `app/league/[leagueId]/tabs/LeagueTab.tsx`
- `app/commissioner-hub/CommissionerHubPageClient.tsx`
- `__tests__/manager-dna-decision-os.test.tsx`

## UI Surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Dashboard | Integrated | Reads Manager DNA from existing dashboard payload when available; otherwise shows insufficient-data state. |
| League Home | Integrated | Shows a graceful insufficient-data state until the league shell receives a Manager DNA payload. |
| Commissioner Hub | Integrated | Shows the shared card without adding commissioner-only classification logic. |
| Team Page | Deferred | Team tab does not currently receive a Manager DNA output. Adding an empty card there would add noise to the roster workflow. |

## Customer Copy Boundary

The card intentionally avoids:

- internal manager IDs
- internal league IDs
- backend terminology
- classifier jargon
- Decision OS terminology

It displays:

- Primary Manager Identity
- Decision Style
- Transaction Style
- Risk Tendency
- Engagement Reliability
- Confidence
- Supporting Evidence
- Top Traits
- Recommended Coaching Focus

## Screenshots Checklist

G26B restored local Playwright readiness on port 3101 and browser-proved the dashboard surface.

- Dashboard Manager DNA card: verified by `e2e/unified-dashboard-click-audit.spec.ts`
- League Home Manager DNA card: integrated, but no always-on League Home browser spec currently asserts this card
- Commissioner Hub Manager DNA card: integrated, but no always-on Commissioner Hub browser spec currently asserts this card
- Mobile stacked layout: dashboard smoke verified no horizontal overflow
- Light mode and dark mode readability: covered by theme tokens and existing readability tests

## Test Coverage

Passed:

- `npx vitest run __tests__/manager-dna-decision-os.test.tsx __tests__/decision-recommendations-premium.test.tsx`
  - 2 files passed
  - 6 tests passed
- `npx playwright test e2e/unified-dashboard-click-audit.spec.ts --project=chromium --reporter=line --workers=1`
  - 1 test passed
  - Verified `manager-dna-card-dashboard`, evidence/confidence rendering, layout stability, and no raw internal IDs on the dashboard
- `npx playwright test e2e/landing-page-click-audit.spec.ts e2e/draft-room-click-audit.spec.ts --project=chromium --reporter=line --workers=1`
  - 10 tests passed
  - Confirmed no landing or draft-room browser harness regression
- Targeted parse checks for the G25/G26 adapters, cards, tests, and touched surfaces.

## G26B Runtime Readiness Fix

Root cause:

- Playwright was invoking `npx next dev` directly from `playwright.config.ts`.
- That bypassed the repo's Next dev cache cleaner and left the browser harness vulnerable to stale `.next-playwright-3101` cache/process state, which made `http://127.0.0.1:3101/api/auth/csrf` unavailable before tests reached the dashboard.

Fix:

- Playwright now starts through `scripts/playwright-dev-server.cjs`.
- The helper sets explicit port/auth/dist-dir runtime values, runs `scripts/clean-next-dev.cjs`, and starts the local Next binary with the active Node runtime.

## Known Blockers

- No general always-on League Home or Commissioner Hub browser spec currently verifies the Manager DNA card. Existing integrations remain unit-tested and parse-checked.
- Meta CAPI placeholder and teardown socket logs appeared during browser runs, but they did not fail the smoke suite.
