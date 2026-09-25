import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildCommissionerAccessRows } from '@/lib/core-app/commissionerHub'

/**
 * 🛑 The hub's "Who can run this league" panel listed only teams with `isCommissioner` /
 * `isCoCommissioner` set, and only the Sleeper, ESPN and Yahoo adapters ever set those. So on every
 * MFL, Fleaflicker and Fantrax league the commissioner reading the panel was told nobody runs it.
 */
describe('buildCommissionerAccessRows', () => {
  const unflagged = [
    { ownerName: 'Guap', teamName: 'Team G', claimedByUserId: 'me' },
    { ownerName: 'Other', teamName: 'Team O', claimedByUserId: 'u2' },
  ]

  it('lists the viewer when no team carries a commissioner flag (MFL / Fleaflicker / Fantrax)', () => {
    expect(buildCommissionerAccessRows(unflagged, 'me', 'commissioner')).toEqual([
      { handle: 'Guap', initials: expect.any(String), role: 'commissioner', isYou: true },
    ])
  })

  it('keeps a co-commissioner a co-commissioner', () => {
    expect(buildCommissionerAccessRows(unflagged, 'me', 'co_commissioner')[0]?.role).toBe('co_commissioner')
  })

  it('says "You" when the viewer has claimed no team', () => {
    expect(buildCommissionerAccessRows(unflagged, 'nobody', 'commissioner')[0]).toMatchObject({ handle: 'You', isYou: true })
  })

  it('never invents a row for someone the gate did not admit', () => {
    expect(buildCommissionerAccessRows(unflagged, 'me', 'member')).toEqual([])
    expect(buildCommissionerAccessRows(unflagged, 'me', null)).toEqual([])
  })

  it('where any flag exists, the flags are the whole answer (Sleeper/ESPN/Yahoo unchanged)', () => {
    const flagged = [
      { ownerName: 'Co', claimedByUserId: 'u3', isCoCommissioner: true },
      { ownerName: 'Boss', claimedByUserId: 'u2', isCommissioner: true },
      { ownerName: 'Guap', claimedByUserId: 'me' },
    ]
    const rows = buildCommissionerAccessRows(flagged, 'me', 'commissioner')
    expect(rows.map((r) => [r.handle, r.role, r.isYou])).toEqual([
      ['Boss', 'commissioner', false],
      ['Co', 'co_commissioner', false],
    ])
  })
})
