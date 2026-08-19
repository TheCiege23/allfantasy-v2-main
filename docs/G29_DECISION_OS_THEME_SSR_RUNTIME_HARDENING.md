# G29 Decision OS Theme/SSR Runtime Hardening

Status: complete

Readiness remains unchanged:
- NFL Engine: 93%
- Overall Platform: 90%

## Audit Findings

- `app/layout.tsx` resolves `af_mode` from server cookies and writes the effective value to `<html data-mode>`.
- The root layout remains free of pre-hydration localStorage theme mutation scripts, matching the existing root-layout test contract.
- `ThemeProvider` initializes from the server-rendered document mode and only reconciles stored preferences after mount.
- The G28 dark-mode gap came from the proof harness, not a product route: the spec installed a persistent init script that rewrote `af_mode=light` on every new document.
- Authenticated users also have a profile theme preference; browser proof must keep profile, cookie, and localStorage aligned to model a real customer mode change.
- The preference sync layer now distinguishes "no local theme is stored" from an explicit `light` preference, so an empty localStorage value does not masquerade as a customer choice.
- `LeagueShellClient` still mounts the League Shell directly from its client boundary, so the authenticated League Home route is not a client-only blank shell.
- The Meta bootstrap remains guarded against missing script parents.

## Proof Added

- Updated `e2e/decision-os-league-home-proof.spec.ts` so theme setup persists the authenticated profile preference, writes the SSR cookie for the next request, and avoids manually setting `document.documentElement.dataset.mode` after navigation.
- The proof now inspects the returned HTML for `<html data-mode="dark">` before asserting the hydrated DOM state.
- Authenticated proof covers:
  - `/league/[leagueId]?view=league`
  - `/dashboard`
  - `/commissioner-hub`
  - League Home mobile layout in dark mode
  - Decision OS League Home cards
  - Commissioner Hub Decision OS cards
  - No captured hydration/root-layout crash signatures

## Verification

- Targeted lint/parse:
  `cmd /c npx eslint e2e/decision-os-league-home-proof.spec.ts app/layout.tsx app/league/[leagueId]/LeagueShellClient.tsx app/league/[leagueId]/LeagueShell.tsx`
- Relevant Vitest:
  `cmd /c npx vitest run __tests__/root-language-provider-layout.test.tsx __tests__/decision-recommendations-premium.test.tsx __tests__/manager-dna-decision-os.test.tsx __tests__/league-pulse-decision-os.test.tsx __tests__/decision-os/dashboard-intelligence-pipeline.test.ts`
- Browser proof:
  `$env:PLAYWRIGHT_PORT='3345'; $env:AF_NEXT_DIST_DIR='.next-playwright-g29d'; cmd /c npx playwright test e2e/decision-os-league-home-proof.spec.ts --project=chromium --reporter=line`

## Remaining Gaps

- The proof is Chromium-only local Playwright coverage.
- The authenticated Dashboard route is proven for SSR dark-mode/runtime stability; Decision OS card rendering remains covered on League Home and Commissioner Hub because the current authenticated Dashboard surface does not expose the same Decision OS card test IDs.
- Meta CAPI placeholder-pixel API noise and occasional dev-server Fast Refresh reload warnings may still appear in local logs, but they are not root-layout or hydration crashes.
- No readiness increase was taken.
