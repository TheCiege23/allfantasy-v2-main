/**
 * Regression guard for the inherited `Playwright (onboarding-activation)` failure.
 *
 * The onboarding-activation spec (`e2e/onboarding-funnel-click-audit.spec.ts`)
 * navigates to the dev-only E2E harness route `/e2e/onboarding-funnel?step=welcome`
 * and asserts `onboarding-step-welcome` / `onboarding-checklist` /
 * `retention-prompt-cards` are visible. Those testIds live in the REAL components,
 * but the harness page that MOUNTS them (`app/e2e/onboarding-funnel/`) was
 * repeatedly deleted by "remove e2e harness stubs" cleanups, 404-ing the route and
 * failing every onboarding spec. This locks the harness (route + client) in place
 * so a future cleanup can't silently re-break the E2E activation path.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const HARNESS_DIR = path.join(process.cwd(), 'app/e2e/onboarding-funnel')

describe('onboarding-activation E2E harness route present', () => {
  it('has the harness page route (/e2e/onboarding-funnel)', () => {
    expect(fs.existsSync(path.join(HARNESS_DIR, 'page.tsx'))).toBe(true)
  })

  it('mounts the real onboarding components that carry the tested testIds', () => {
    const client = fs.readFileSync(
      path.join(HARNESS_DIR, 'E2EOnboardingFunnelHarnessClient.tsx'),
      'utf8',
    )
    // The three components that render onboarding-step-welcome / onboarding-checklist
    // / retention-prompt-cards respectively.
    expect(client).toContain('OnboardingFunnelClient')
    expect(client).toContain('OnboardingChecklist')
    expect(client).toContain('ReturnPromptCards')
    // Drives the funnel step from the ?step= query so the spec can request `welcome`.
    expect(client).toMatch(/initialStep/)
  })
})
