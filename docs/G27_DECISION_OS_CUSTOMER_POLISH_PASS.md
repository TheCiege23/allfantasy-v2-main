# G27 Decision OS Customer Polish Pass

Status: complete

Readiness remains unchanged:
- NFL Engine: 93%
- Overall Platform: 90%

## Scope Audited

- Dashboard Decision OS cards
- Manager DNA card
- Recommended Moves card
- League Pulse card
- Evidence rows and confidence indicators
- Empty and loading states
- Mobile layout
- Light and dark mode behavior
- Language compatibility of customer-facing copy
- Commissioner-facing value framing

## Customer Polish Completed

- Added shared Decision OS card primitives for badges, confidence labels, updated stamps, trust notes, why panels, evidence grids, insufficient-data callouts, and grounded empty states.
- Reworked Manager DNA, Recommended Moves, and League Pulse card hierarchy around customer-facing explanations, evidence coverage, and deterministic confidence language.
- Replaced backend-facing wording such as derivation-chain language with "Decision path" and "Why am I seeing this?" framing.
- Improved commissioner-facing copy so Decision OS explains league-care value without inventing activity, AI results, or live data.
- Tightened mobile grid behavior, metric wrapping, and card spacing so dense evidence blocks do not overflow.
- Improved dashboard intelligence loading and error states to state that cards are only shown from grounded signals.

## Data Integrity Notes

- No new engine was added.
- No fake stats, confidence, AI results, or live data were introduced.
- Evidence rows remain deterministic and source-limited.
- Insufficient evidence states stay quiet instead of fabricating recommendations.

## Verification

- Unit tests: `cmd /c npx vitest run __tests__/decision-recommendations-premium.test.tsx __tests__/manager-dna-decision-os.test.tsx __tests__/league-pulse-decision-os.test.tsx`
- Snapshot update: `cmd /c npx vitest run __tests__/manager-dna-decision-os.test.tsx -u`
- Targeted parse/lint check: `cmd /c npx eslint components/decision-os/DecisionOsCardPrimitives.tsx components/decision-os/DecisionRecommendationsCard.tsx components/decision-os/ManagerDnaCard.tsx components/decision-os/LeaguePulseCard.tsx lib/decision-os/league-pulse.ts app/dashboard/components/DashboardIntelligenceRail.tsx __tests__/decision-recommendations-premium.test.tsx __tests__/manager-dna-decision-os.test.tsx __tests__/league-pulse-decision-os.test.tsx`
- Browser proof: `$env:PLAYWRIGHT_PORT='3317'; $env:AF_NEXT_DIST_DIR='.next-playwright-g27'; cmd /c npx playwright test e2e/unified-dashboard-click-audit.spec.ts --project=chromium --reporter=line`

## Typecheck Status

- `cmd /c npx tsc --noEmit --pretty false` exhausted the default Node heap.
- `cmd /c npm run typecheck` remained blocked by pre-existing syntax errors in `app/league/[leagueId]/LeagueShell.tsx` around lines 1584 and 2249.
- A targeted ESLint parse/lint check for the affected Decision OS files passed.

## Browser Coverage Gaps

- Playwright covered the dashboard Decision OS cards in light mode, dark mode, and mobile layout.
- Playwright covered commissioner Decision OS framing on `/commissioner-hub`.
- It did not cover a fully authenticated production-data `/league/[leagueId]` session or every live data state.
- The proof run emitted noisy local Meta CAPI placeholder-pixel logs, but the Decision OS browser assertions passed.
