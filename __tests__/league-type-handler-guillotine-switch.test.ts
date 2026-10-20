import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Switching a Guillotine league to Redraft used to rewrite only `leagueType`. `guillotineMode` and
 * `leagueVariant` stayed set, so the league shell kept playing the Guillotine intro and the settings
 * home kept showing Guillotine rows. The PATCH now clears them while the structure is still editable.
 */

const h = vi.hoisted(() => ({
  lockReason: null as string | null,
  row: null as Record<string, unknown> | null,
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: async () => true }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({
  structuralSettingsLockReason: async () => h.lockReason,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: async () => (h.row ? { ...h.row } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        h.row = { ...(h.row ?? {}), ...data }
        return h.row
      },
    },
  },
}))

import { PATCH } from '@/app/api/leagues/[leagueId]/league-type/handler'

const patch = (type: string) =>
  PATCH(
    new Request('http://localhost/api/leagues/L1/league-type', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type }),
    }) as never,
    { params: Promise.resolve({ leagueId: 'L1' }) },
  )

beforeEach(() => {
  h.lockReason = null
  h.row = {
    id: 'L1',
    name: 'Guilly',
    leagueType: 'guillotine',
    leagueVariant: 'guillotine',
    guillotineMode: true,
    isDynasty: false,
    settings: {},
  }
})

describe('league-type PATCH away from Guillotine', () => {
  it('clears guillotineMode and the guillotine variant before the draft', async () => {
    const res = await patch('redraft')
    expect(res.status).toBe(200)
    expect(h.row).toMatchObject({ leagueType: 'redraft', guillotineMode: false, leagueVariant: null })
  })

  it('leaves the flags alone once the structure is locked', async () => {
    h.lockReason = 'after the draft has started'
    const res = await patch('redraft')
    expect(res.status).toBe(200)
    expect(h.row).toMatchObject({ leagueType: 'redraft', guillotineMode: true, leagueVariant: 'guillotine' })
  })

  it('keeps the flags when the new type is still a guillotine format', async () => {
    await patch('survivor_guillotine')
    expect(h.row).toMatchObject({ guillotineMode: true, leagueVariant: 'guillotine' })
  })

  it('does not touch a non-guillotine variant', async () => {
    h.row = { ...h.row, leagueVariant: 'idp' }
    await patch('redraft')
    expect(h.row).toMatchObject({ guillotineMode: false, leagueVariant: 'idp' })
  })
})
