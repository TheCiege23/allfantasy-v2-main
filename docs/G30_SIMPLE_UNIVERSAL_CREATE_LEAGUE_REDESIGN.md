# G30 Simple Universal Create League Redesign

## Scope

- Replaced the primary `/create-league` surface with a simple five-step universal wizard:
  Sport, League Basics, Draft, Settings Summary, Review/Create.
- Kept NFL Redraft as the fastest production path while using the existing sport, draft, scoring preset, and catalog registries.
- Moved premium advanced setup into a secondary panel gated by AF Commissioner.
- Added import provider states with a safe Sleeper link and disabled limited/coming-soon providers.
- Added deterministic create metadata for privacy and draft schedule without fabricating imported data or AI results.

## Backend Guardrails

- Redraft team counts now support 2 through 32 in the create-options catalog.
- Premium advanced create settings are rejected server-side unless the creator has AF Commissioner, All-Access, or Supreme in active/grace status.
- Non-entitled users do not persist premium advanced settings through the create payload.

## Browser Proof

Passed:

```text
PLAYWRIGHT_PORT=3110 AF_NEXT_DIST_DIR=.next-playwright-3110 npx playwright test e2e/create-league-g30-simple-flow.spec.ts --project=chromium --reporter=line --workers=1
4 passed
```

Covered:

- NFL Redraft create path with team counts 2 and 32 using deterministic E2E create stubs.
- Post-create navigation to League Home URL.
- Import modal provider states.
- Advanced setup locked for non-commissioner and enabled for AF Commissioner.
- Dark mode from SSR `af_mode=dark` cookie.
- Mobile layout overflow check.
- `af_lang=es` SSR root language compatibility without hydration mismatch or raw i18n keys.

Notes:

- The Playwright dev server still logs existing test-environment noise from NextAuth client session fetches and Meta CAPI placeholder configuration. Page-level console/pageerror assertions passed for the G30 surface.

## Unit Proof

Passed:

```text
npx vitest run __tests__/root-language-provider-layout.test.tsx __tests__/create-league-g30-simple-create.test.ts __tests__/create-league-v2-form-completion.test.ts __tests__/create-league-v2-submit-api-leagues.test.ts __tests__/canonical-league-create-pipeline.test.ts --reporter=dot
5 passed, 58 tests passed
```

Covered:

- 2 through 32 team-count validation.
- NFL Redraft canonical payload with deterministic privacy/draft metadata.
- Locked premium advanced settings rejected without AF Commissioner.
- Premium advanced settings allowed with AF Commissioner.
- Import modal provider-state contract.
- Language provider hydration hardening.

## Typecheck

- Full `npm run typecheck -- --pretty false` did not complete within 120 seconds.
- A temporary narrow `tsc -p` over G30 files still followed imported repo dependencies and failed on existing unrelated type errors outside the G30 files, including legacy implicit `any` rows, auth session augmentation gaps, Prisma circular types, and `web-push` declarations.
- No G30-specific TypeScript errors appeared in the reported failures; targeted Vitest and Playwright proof passed.

## Readiness

- NFL Engine remains 93%.
- Overall Platform remains 90%.
