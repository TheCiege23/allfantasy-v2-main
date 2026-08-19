# G28 League Home + Commissioner Hub Decision OS Proof Gap

Status: complete

Readiness remains unchanged:
- NFL Engine: 93%
- Overall Platform: 90%

## Audit Findings

- League Home renders Decision OS cards from `app/league/[leagueId]/tabs/LeagueTab.tsx`.
- The authenticated League Home proof was missing because prior browser coverage stopped at dashboard and unauthenticated/demo Commissioner Hub states.
- Existing auth setup uses `e2e/helpers/auth-flow.ts` to register and sign in through the real NextAuth credentials flow.
- The tracked canonical E2E helper `lib/e2e/seedG8League.ts` can create and clean up a real commissioner-owned NFL redraft league.
- The existing `/api/e2e/seed-g8-league` route was present in the local dirty tree but untracked, so G28 added a scoped proof route instead of depending on that ambient file.
- `LeagueShell.tsx` had two raw JSX arrow tokens that blocked parse checks; only those syntax tokens were fixed.
- The League Home dynamic wrapper stayed blank under browser proof, so `LeagueShellClient` now mounts the client shell directly from its explicit client boundary.
- The after-interactive Meta pixel bootstrap had an unguarded `parentNode` insert that crashed the League Shell in browser proof; it now mirrors the guarded immediate bootstrap fallback.

## Proof Added

- Added `POST/DELETE /api/e2e/decision-os-proof-league`, gated by session plus `x-allfantasy-e2e: 1`, to seed and clean up a scoped E2E league from deterministic fixture inputs.
- Added `e2e/decision-os-league-home-proof.spec.ts`.
- The spec proves authenticated `/league/[leagueId]` League Home Decision OS surfaces for:
  - League Pulse visibility
  - Manager DNA visibility
  - Recommended Moves visibility
  - Confidence display
  - Evidence display
  - "Why am I seeing this?" framing
  - Light and dark rendered states
  - Mobile no-horizontal-overflow behavior
- The same proof verifies Commissioner Hub Decision OS framing, including Commissioner use copy and evidence-limited Recommended Moves empty state.

## Verification

- Targeted lint/parse:
  `cmd /c npx eslint app/league/[leagueId]/LeagueShellClient.tsx app/league/[leagueId]/LeagueShell.tsx app/layout.tsx app/api/e2e/decision-os-proof-league/route.ts e2e/decision-os-league-home-proof.spec.ts`
- Relevant Vitest:
  `cmd /c npx vitest run __tests__/decision-recommendations-premium.test.tsx __tests__/manager-dna-decision-os.test.tsx __tests__/league-pulse-decision-os.test.tsx __tests__/decision-os/dashboard-intelligence-pipeline.test.ts`
- Browser proof:
  `$env:PLAYWRIGHT_PORT='3341'; $env:AF_NEXT_DIST_DIR='.next-playwright-g28m'; cmd /c npx playwright test e2e/decision-os-league-home-proof.spec.ts --project=chromium --reporter=line`

## Typecheck Status

- `cmd /c npm run typecheck` did not complete within the 180-second local command timeout.
- The previous `LeagueShell.tsx` syntax blocker is fixed and the touched files pass targeted ESLint parse/lint.

## Remaining Gaps

- Dark mode was proven by applying the client `data-mode="dark"` state after authenticated navigation; the local SSR cookie path continued to render `data-mode="light"` during this proof.
- The proof uses scoped E2E seed data, not production data.
- No readiness increase was taken.
- Meta CAPI still emits noisy placeholder-pixel API errors in local proof logs, but those no longer crash the League Home browser proof.
