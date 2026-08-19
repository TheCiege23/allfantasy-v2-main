/**
 * AF_GATE0 §3.1 / §6 — username → user resolve. A repeat import of a known username resolves
 * from the cached LegacyUser without re-hitting the Sleeper API (abuse/scrape protection), and
 * an unknown username resolves to null (→ the route's clear 404 state, not a spinner).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, getSleeperUserMock } = vi.hoisted(() => {
  const getSleeperUserMock = vi.fn()
  const prismaMock = {
    legacyUser: {
      findUnique: vi.fn(async ({ where }: { where: { sleeperUsername?: string } }) =>
        where?.sleeperUsername === 'theghost'
          ? {
              id: 'legacy-1',
              sleeperUsername: 'theghost',
              sleeperUserId: 'sl-1',
              displayName: 'The Ghost',
              avatar: null,
              avatarUrl: null,
            }
          : null,
      ),
    },
  }
  return { prismaMock, getSleeperUserMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/sleeper-client', () => ({ getSleeperUser: getSleeperUserMock }))

import { resolveOrCreateLegacyUser } from '@/lib/legacy-user-resolver'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveOrCreateLegacyUser — username → user', () => {
  it('resolves a known username from cache and normalizes input (no Sleeper API call)', async () => {
    const resolved = await resolveOrCreateLegacyUser('  TheGhost ')
    expect(resolved).toMatchObject({
      id: 'legacy-1',
      sleeperUsername: 'theghost',
      sleeperUserId: 'sl-1',
      isNew: false,
    })
    // The cache hit must short-circuit before any Sleeper network call (§3.1).
    expect(getSleeperUserMock).not.toHaveBeenCalled()
  })

  it('resolves an unknown username to null (→ clear "not found" state)', async () => {
    getSleeperUserMock.mockResolvedValueOnce(null)
    const resolved = await resolveOrCreateLegacyUser('nobody-here')
    expect(resolved).toBeNull()
  })
})
