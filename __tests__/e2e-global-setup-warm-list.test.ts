import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * e2e/global-setup.ts warms the dev server's route compiler. A one-test lane that warmed all 33
 * default routes pushed `next dev` past its memory line and restarted it mid-test (retention-
 * engagement, 2026-10-03: 6 of 13 runs restarted, all 6 flaky or failed). `E2E_WARM_ROUTES` lets a
 * lane warm only what it visits. These pin what gets fetched.
 */
import globalSetup from '../e2e/global-setup'

const fetched: string[] = []
const config = { projects: [{ use: { baseURL: 'http://127.0.0.1:3101' } }] } as never

beforeEach(() => {
  fetched.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(String(url).replace('http://127.0.0.1:3101', ''))
    return { status: 200, text: async () => '' }
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('global setup warm list', () => {
  it('warms only the lane’s own routes when E2E_WARM_ROUTES names them', async () => {
    vi.stubEnv('E2E_WARM_ROUTES', '/e2e/engagement-notification-routing, /trade-analyzer,/chimmy,/tools-hub')
    await globalSetup(config)
    expect(fetched.sort()).toEqual(['/chimmy', '/e2e/engagement-notification-routing', '/tools-hub', '/trade-analyzer'])
  })

  it('warms the full default list when the variable is absent', async () => {
    await globalSetup(config)
    expect(fetched.length).toBeGreaterThan(20)
    expect(fetched).toContain('/settings')
    expect(fetched).not.toContain('/chimmy')
  })

  it('ignores anything that is not a same-origin path, and falls back rather than warm nothing', async () => {
    vi.stubEnv('E2E_WARM_ROUTES', 'https://evil.example/x, //evil.example, nope')
    await globalSetup(config)
    expect(fetched.length).toBeGreaterThan(20)
    expect(fetched.some((p) => p.includes('evil'))).toBe(false)
  })
})
