import '@testing-library/jest-dom';

/**
 * jsdom does not implement ResizeObserver. cmdk (components/ui/command.tsx,
 * used by any command-palette-style UI) observes its list's size to manage
 * scroll-into-view for the highlighted item, so any test that mounts a
 * <Command> throws "ResizeObserver is not defined" without this stub.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver ??= ResizeObserverStub

/** jsdom also does not implement scrollIntoView, which cmdk calls when the highlighted item changes. */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

/**
 * Default env for Vitest so route handlers that read process.env do not 500
 * when keys are unset locally/CI. Uses `??=` so real env wins.
 */
/*
 * The AI spend guard (lib/ai/aiSpendGuard.ts) is OFF BY DEFAULT BY DESIGN — an unset
 * variable means "do not spend". That is right in production and wrong in a test run:
 * every provider boundary throws AiSpendDisabledError, and because its httpStatus is
 * 402 the failures read as `expected 402 to be 200` in routes that are fully mocked and
 * never touch a provider at all.
 *
 * It went unnoticed because vitest has never run in CI. The guard was rolled out across
 * ~37 boundaries on 2026-08-28 and took 8 test files red with it in one afternoon; the
 * ratchet only caught them because the suite was finally run locally.
 *
 * ⚠ WHY THIS IS SAFE, AND THE ONE CASE WHERE IT IS NOT. The provider keys defaulted
 * below are mock strings, so an enabled switch cannot buy anything with them. The
 * residual risk is a developer with a REAL key exported in their shell — `??=` lets real
 * env win — running a test that forgets to mock its provider. Narrow (vitest does not
 * load .env into process.env, so the key must be exported deliberately) but not zero.
 * If that ever bites, pin the keys below with `=` instead of `??=`: a test run has no
 * business using real credentials.
 *
 * `??=` rather than `=` so a suite that deliberately manages this variable still wins —
 * __tests__/ai/ai-spend-guard.test.ts deletes it in beforeEach to test the guard itself.
 */
process.env.AI_FEATURES_ENABLED ??= "true"

process.env.NEXTAUTH_SECRET ??= "test-nextauth-secret-for-vitest"
process.env.LEAGUE_AUTH_ENCRYPTION_KEY ??= "test-league-auth-encryption-key-for-vitest-min32"
process.env.OPENAI_API_KEY ??= "sk-mock-openai"
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= process.env.OPENAI_API_KEY
process.env.ANTHROPIC_API_KEY ??= "sk-ant-mock"
process.env.STRIPE_SECRET_KEY ??= "sk_test_mock"
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_mock"
