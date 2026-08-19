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
process.env.NEXTAUTH_SECRET ??= "test-nextauth-secret-for-vitest"
process.env.LEAGUE_AUTH_ENCRYPTION_KEY ??= "test-league-auth-encryption-key-for-vitest-min32"
process.env.OPENAI_API_KEY ??= "sk-mock-openai"
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= process.env.OPENAI_API_KEY
process.env.ANTHROPIC_API_KEY ??= "sk-ant-mock"
process.env.STRIPE_SECRET_KEY ??= "sk_test_mock"
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_mock"
