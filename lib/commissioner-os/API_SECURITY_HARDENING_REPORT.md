# API Security Hardening Report — Phase L2

Commercial Readiness / Phase L2. Implements the one concrete fix
identified by `API_AUTHENTICATION_AUDIT.md`: the Decision OS Intelligence
API's dev-mode test-key fallback (`gate.ts`) is now rejected specifically
in Production, closing the permissive path an external commercial
licensee's Production traffic must never be able to use. No architecture
was introduced, no endpoint was added, and no transport/adapter boundary
was touched.

## Every File Changed

| File | Change |
|---|---|
| `lib/decision-os/behavioral/api/gate.ts` | Added `isProductionEnvironment()` (reads `process.env.VERCEL_ENV === 'production'`). Changed the `test`-env tier-resolution branch: an unregistered test key now returns `401 UNAUTHORIZED` when `isProductionEnvironment()` is true; the existing `'basic'`-tier dev-mode fallback is otherwise unchanged. The `live`-env branch (already strict in every environment) is untouched. Updated the file's own header doc comment to describe the new behavior. |
| `__tests__/decision-os/intelligence-api-routes.test.ts` | Added a new `"auth — Production environment hardening (Phase L1)"` describe block, 7 tests (see Regression Evidence). No existing test in this file was modified or removed. |

No other file was touched. In particular: `lib/commissioner-os/adapter/transport/` (the transport layer), `lib/commissioner-os/adapter/` (the adapter layer), `lib/commissioner-os/liveModeAccess.ts` and every Phase L1 file, every route file under `app/api/v1/intelligence/`, every resolver/contract file, and anything under NFL Redraft are all unmodified.

## Security Rationale

`gate.ts`'s own pre-existing doc comment already named this exact
trade-off explicitly: unregistered test keys resolve to `'basic'` tier
as "dev mode — local integration testing." That is a reasonable,
intentional convenience for local/Preview work, and was safe throughout
this entire engagement only because Production has never had
`DECISION_OS_INTELLIGENCE_API_ENABLED` set at all. The moment a real
commercial licensee is issued Production credentials — the explicit goal
of this Commercial Readiness phase — this fallback would let *any*
correctly-formatted `afk_test_*` key, registered or not, reach `basic`-tier
data in Production. That is precisely the shape of gap a security review
for licensing must close before it can ever be exercised for real,
regardless of how far away that day is. Fixing it now, while the API is
still disabled in Production, costs nothing operationally and removes an
entire class of "we'll remember to fix this later" risk.

The fix is scoped as narrowly as possible: it changes behavior in exactly
one environment (`VERCEL_ENV === 'production'`), for exactly one case
(an unregistered `test`-env key), leaving every other input to the gate
— valid registered keys of either kind, malformed keys, missing keys,
the disabled-API state — completely untouched in every environment.

## Regression Evidence

### New tests (7), all passing
```
✓ unknown test key is rejected (401) when VERCEL_ENV=production
✓ unknown live key is still rejected (401) when VERCEL_ENV=production — unaffected, already strict
✓ a registered test key still resolves its mapped tier in production — hardening only removes the fallback, not registered keys
✓ a registered live key still resolves its mapped tier in production
✓ the dev-mode fallback still works when VERCEL_ENV=preview — Preview is unaffected
✓ the dev-mode fallback still works when VERCEL_ENV=development — Development is unaffected
✓ the dev-mode fallback still works when VERCEL_ENV is entirely unset (local dev) — unchanged from before this hardening
```

### Full decision-os suite (local `.env` pollution removed for a clean signal — see below)
```
npx vitest run __tests__/decision-os
 Test Files  13 passed (13)
      Tests  703 passed (703)
```

### Full commissioner-os + decision-os suite together
```
npx vitest run commissioner-os decision-os
 Test Files  45 passed (45)
      Tests  1102 passed (1102)
```
This includes every Phase L1 admin-only-live-mode test
(`commissioner-os-live-mode-access.test.ts`, 6 tests;
`commissioner-os-data-mode-indicator.test.tsx`, 4 tests; the analytics
and Mission Control admin-gating blocks, 7 tests) — all still passing,
confirming task 7 ("confirm admin-only live mode continues working") is
satisfied and this phase introduced zero regressions anywhere in
Commissioner OS.

### A pre-existing, unrelated local artifact — disclosed, not hidden
Running the full suite *with* this worktree's local `.env` present
reproduces exactly 8 failures, all in the pre-existing "disabled state"
describe blocks (e.g. `"disabled state — feature flag not set > platform
handler returns 503"`). This is the same, already-documented artifact
from earlier in this engagement: this worktree's own local `.env` sets
`DECISION_OS_INTELLIGENCE_API_ENABLED="true"`, which leaks into
`vitest run`'s `process.env` and makes tests asserting the API's
*disabled* state find it unexpectedly enabled. Confirmed by moving `.env`
aside and re-running: all 703 decision-os tests (and all 1102 across both
suites) pass with it removed, then `.env` was restored immediately and
verified intact. **None of the 8 pre-existing failures involve this
phase's change** — they are the identical "disabled state" tests that
have carried this same artifact since well before this phase began.

### Typecheck
`npx tsc --noEmit -p tsconfig.json` — reproduces the same pre-existing
~3,300-line baseline (unrelated, documented in session memory). Zero
errors reference `gate.ts` or the updated test file.

## Rollback Plan

This is a pure code change with no data or env var component, so rollback
is simple in every case:

1. **Revert the commit.** `git revert <commit>` restores `gate.ts` to its
   prior, unconditional dev-mode fallback (identical to the behavior this
   engagement has run on throughout). No env var, database row, or
   deployed configuration needs to change alongside it.
2. **No env var rollback needed.** This change reads `VERCEL_ENV`, a
   value Vercel provides automatically — nothing was added, removed, or
   reconfigured in Vercel's project settings.
3. **No data migration to reverse** — `gate.ts` remains a pure function; it
   still reads only `process.env`.
4. **Blast radius of a rollback is exactly one behavior**: if reverted,
   an unregistered `afk_test_*` key would once again resolve to `'basic'`
   tier even in Production — reproducing the exact gap this phase closes.
   Since `DECISION_OS_INTELLIGENCE_API_ENABLED` remains unset in
   Production today, a rollback would not have any live effect until that
   separate flag is also enabled — the same layered-safety property
   documented throughout this engagement.

## Remaining Licensing Risks

Carried forward from `API_AUTHENTICATION_AUDIT.md`, unchanged by this
phase (out of scope for its specific tasks, not overlooked):

1. **No audit logging of authentication attempts** at the gate level —
   `gate.ts` is a documented "pure" function with no IO. A failed or
   successful authentication attempt against the Decision OS Intelligence
   API produces no log line anywhere today. Recommend a single structured
   log call (success and failure) before any external licensee holds a
   real key.
2. **Rate limiting is modeled, not enforced** — `RATE_LIMITS_BY_TIER`
   exists in `contracts.ts` but nothing in the codebase reads it or
   throttles requests. Unchanged from the Executive Licensing Readiness
   Report's own finding; a materially larger addition than this phase's
   scope permits.
3. **The session-forwarding fallback in the transport layer remains in
   place** (`X-Commissioner-User-Id` in `resolveDecisionOSAuthHeaders()`)
   — confirmed inert (nothing reads it) and left untouched per the
   explicit instruction not to change transport boundaries this phase.
   Should the Decision OS API ever start reading this header in the
   future, it would need its own independent security review at that
   time.

None of these three block today's deployment of this specific fix — they
are pre-existing, already-disclosed conditions that remain true whether
or not this phase's change ships, and none of them are made worse by it.
