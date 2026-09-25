// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * The e2e dev server runs with the paywall launch pinned far in the future (playwright.config.ts),
 * so the specs — which drive /core as users with no plan — do not start failing on Oct 15.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function serverEnv(): Promise<Record<string, string | undefined>> {
  const config = (await import('../playwright.config')).default as { webServer?: { env?: Record<string, string | undefined> } }
  return config.webServer?.env ?? {}
}

describe('playwright dev server: paywall launch', () => {
  it('is pinned past launch when nothing sets it', async () => {
    vi.stubEnv('AF_PAYWALL_STARTS_AT', undefined as unknown as string)
    const { isPaywallLive } = await import('@/lib/monetization/paywallLaunch')
    const env = await serverEnv()
    expect(env.AF_PAYWALL_STARTS_AT).toBe('2099-01-01T00:00:00.000Z')
    // The pinned value is one the paywall reads as "not yet" — the day after launch included.
    expect(isPaywallLive(new Date('2026-10-16T00:00:00.000Z'), { AF_PAYWALL_STARTS_AT: env.AF_PAYWALL_STARTS_AT })).toBe(false)
  })

  it('a run that sets it on purpose keeps its own value', async () => {
    vi.stubEnv('AF_PAYWALL_STARTS_AT', '2020-01-01T00:00:00.000Z')
    expect((await serverEnv()).AF_PAYWALL_STARTS_AT).toBe('2020-01-01T00:00:00.000Z')
  })
})
