import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSleeperUser, getUserLeagues } from '@/lib/sleeper-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Sleeper import response metadata', () => {
  it('preserves 429 retry-after metadata for strict user lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': '7' },
        }),
      ),
    )

    await expect(getSleeperUser('manager', { strict: true })).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7_000,
    })
  })

  it('preserves provider status for league discovery instead of returning an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 })),
    )

    await expect(getUserLeagues('user', 'nfl', '2026')).rejects.toMatchObject({
      status: 503,
    })
  })
})
