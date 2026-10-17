// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Two write-path bugs in the AutoCoach preference routes, fixed 2026-10-02.
 *
 *  1. `exclude-player` with `exclude: false` filtered the list and then overwrote it with the
 *     unfiltered one, so removing an exclusion saved it again.
 *  2. `PUT /preferences` parsed the body alone, so every field the body omitted was reset to its
 *     schema DEFAULT — sending `{ aggressiveness }` wiped exclusions and position overrides.
 */

const mocks = vi.hoisted(() => ({ stored: {} as Record<string, unknown> }))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'U1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: {
      findUnique: vi.fn(async () => ({ autoCoachPreferences: mocks.stored })),
      update: vi.fn(async ({ data }: { data: { autoCoachPreferences: Record<string, unknown> } }) => {
        mocks.stored = data.autoCoachPreferences
        return { autoCoachPreferences: mocks.stored }
      }),
    },
  },
}))

import { POST as actionPOST } from '@/app/api/user/autocoach/preferences/[action]/route'
import { PUT } from '@/app/api/user/autocoach/preferences/route'

const req = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  mocks.stored = {}
})

describe('exclude-player', () => {
  const call = (body: unknown) =>
    actionPOST(req('/api/user/autocoach/preferences/exclude-player', 'POST', body), {
      params: Promise.resolve({ action: 'exclude-player' }),
    })

  it('adds, and then REMOVES, an exclusion', async () => {
    await call({ playerId: 'p1' })
    await call({ playerId: 'p2' })
    expect(mocks.stored.excludedPlayerIds).toEqual(['p1', 'p2'])

    await call({ playerId: 'p1', exclude: false })
    expect(mocks.stored.excludedPlayerIds).toEqual(['p2'])
  })

  it('does not duplicate an id added twice', async () => {
    await call({ playerId: 'p1' })
    await call({ playerId: 'p1' })
    expect(mocks.stored.excludedPlayerIds).toEqual(['p1'])
  })
})

describe('PUT /api/user/autocoach/preferences', () => {
  it('a partial update keeps every field it did not mention', async () => {
    mocks.stored = { excludedPlayerIds: ['p1'], positionOverrides: { QB: { disabled: true } } }
    const res = await PUT(req('/api/user/autocoach/preferences', 'PUT', { aggressiveness: 'upside' }))
    expect(res.status).toBe(200)
    expect(mocks.stored.aggressiveness).toBe('upside')
    expect(mocks.stored.excludedPlayerIds).toEqual(['p1'])
    expect(mocks.stored.positionOverrides).toEqual({ QB: { disabled: true } })
  })

  it('still rejects an invalid value', async () => {
    const res = await PUT(req('/api/user/autocoach/preferences', 'PUT', { confidenceThreshold: 500 }))
    expect(res.status).toBe(400)
  })
})
