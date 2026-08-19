# G26 Decision Recommendations Premium Experience

Readiness remains unchanged:

- NFL Engine: 93%
- Overall Platform: 90%

## Implementation Summary

G26 adds a customer-facing Recommended Moves card using the premium Decision OS card architecture established by G24 League Pulse and reused by G25 Manager DNA.

This phase does not change recommendation algorithms, ranking logic, provider logic, Stage 1 soak behavior, backend routes, or league behavior. The new adapter only consumes existing Phase 6.4 recommendation outputs and existing presentation recommendation outputs.

## Reused Modules

- Phase 6.4 recommendation output:
  - `lib/decision-os/phase6/recommendations/types.ts`
- Existing recommendation presentation builder:
  - `lib/decision-os/presentation/recommendations.ts`
- Existing presentation contracts:
  - `lib/decision-os/presentation/types.ts`
- G24/G25 premium card pattern:
  - `components/decision-os/LeaguePulseCard.tsx`
  - `components/decision-os/ManagerDnaCard.tsx`

## Files Added Or Updated

- `lib/decision-os/recommendations.ts`
- `components/decision-os/DecisionRecommendationsCard.tsx`
- `app/dashboard/DashboardContent.tsx`
- `app/league/[leagueId]/tabs/LeagueTab.tsx`
- `app/commissioner-hub/CommissionerHubPageClient.tsx`
- `__tests__/decision-recommendations-premium.test.tsx`

## UI Surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Dashboard | Integrated | Reads recommendation output from existing dashboard payload when available; otherwise shows insufficient-data state. |
| League Home | Integrated | Shows a graceful insufficient-data state until the league shell receives recommendation output. |
| Commissioner Hub | Integrated | Uses the shared card without converting commissioner health strings into fake Phase 6.4 recommendations. |
| Team Page | Deferred | Team tab does not currently receive a Phase 6.4 recommendation set. |

## Customer Copy Boundary

The card intentionally avoids:

- internal recommendation IDs
- internal manager IDs
- internal league IDs
- backend terminology
- derivation jargon
- Decision OS terminology

It displays:

- Top three recommendations
- Priority
- Expected impact
- Difficulty
- Evidence
- Suggested action
- Confidence
- Completion status when available

## Screenshots Checklist

G26B restored local Playwright readiness on port 3101 and browser-proved the dashboard surface.

- Dashboard Recommended Moves card: verified by `e2e/unified-dashboard-click-audit.spec.ts`
- League Home Recommended Moves card: integrated, but no always-on League Home browser spec currently asserts this card
- Commissioner Hub Recommended Moves card: integrated, but no always-on Commissioner Hub browser spec currently asserts this card
- Mobile stacked layout: dashboard smoke verified no horizontal overflow
- Light mode and dark mode readability: covered by theme tokens and existing readability tests

## Test Coverage

Passed:

- `npx vitest run __tests__/manager-dna-decision-os.test.tsx __tests__/decision-recommendations-premium.test.tsx`
  - 2 files passed
  - 6 tests passed
- `npx playwright test e2e/unified-dashboard-click-audit.spec.ts --project=chromium --reporter=line --workers=1`
  - 1 test passed
  - Verified `decision-recommendations-card-dashboard`, evidence/confidence rendering, layout stability, and no raw internal IDs on the dashboard
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

- No general always-on League Home or Commissioner Hub browser spec currently verifies the Recommended Moves card. Existing integrations remain unit-tested and parse-checked.
- Meta CAPI placeholder and teardown socket logs appeared during browser runs, but they did not fail the smoke suite.
