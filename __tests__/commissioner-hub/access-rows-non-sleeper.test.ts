import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildCommissionerAccessRows } from '@/lib/core-app/commissionerHub'

const view = (rows: ReturnType<typeof buildCommissionerAccessRows>) => rows.map((r) => [r.handle, r.role, r.basis, r.isYou])

/**
 * 🛑 The hub's "Who can run this league" panel listed only teams with `isCommissioner` /
 * `isCoCommissioner` set, and only the Sleeper, ESPN and Yahoo adapters ever set those. So on every
 * MFL, Fleaflicker and Fantrax league the commissioner reading the panel was told nobody runs it.
 */
describe('buildCommissionerAccessRows — no platform flags', () => {
  const unflagged = [
    { ownerName: 'Guap', teamName: 'Team G', claimedByUserId: 'me' },
    { ownerName: 'Other', teamName: 'Team O', claimedByUserId: 'u2' },
  ]

  it('lists the viewer when no team carries a commissioner flag (MFL / Fleaflicker / Fantrax)', () => {
    expect(buildCommissionerAccessRows(unflagged, 'me', 'commissioner')).toEqual([
      { handle: 'Guap', initials: expect.any(String), role: 'commissioner', isYou: true, basis: 'allfantasy' },
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

  it('lists the owner, not a second copy of them, when the owner is the one viewing', () => {
    expect(view(buildCommissionerAccessRows(unflagged, 'me', 'commissioner', { ownerUserId: 'me' }))).toEqual([['Guap', 'commissioner', 'allfantasy', true]])
  })
})

/*
 * 🛑 Where the platform published a commissioner, the flags used to be the WHOLE answer — so the
 * AllFantasy owner, whom `getLeagueRole` makes head commissioner "regardless of imported Sleeper
 * flags", was missing from the panel of the hub they were running. Seen 2026-10-01: Layes23 imported
 * "EFL Dynasty League" and ran its hub; the panel named only Altoidman, Sleeper's commissioner.
 */
describe('buildCommissionerAccessRows — imported league with platform flags', () => {
  const efl = [
    { ownerName: 'Layes23', teamName: 'Dortmund', claimedByUserId: 'layes' },
    { ownerName: 'Altoidman', teamName: 'Sunderland', claimedByUserId: null, isCommissioner: true },
    { ownerName: 'Co', teamName: 'Team C', claimedByUserId: 'u3', isCoCommissioner: true },
  ]

  it('lists the importer running it here beside the platform commissioner, and says which is which', () => {
    expect(view(buildCommissionerAccessRows(efl, 'layes', 'commissioner', { ownerUserId: 'layes' }))).toEqual([
      ['Layes23', 'commissioner', 'allfantasy', true],
      ['Altoidman', 'commissioner', 'platform', false],
      ['Co', 'co_commissioner', 'platform', false],
    ])
  })

  it('still lists the owner when someone else is viewing', () => {
    const rows = buildCommissionerAccessRows(efl, 'u3', 'co_commissioner', { ownerUserId: 'layes' })
    expect(view(rows)).toEqual([
      ['Layes23', 'commissioner', 'allfantasy', false],
      ['Altoidman', 'commissioner', 'platform', false],
      ['Co', 'co_commissioner', 'platform', true],
    ])
  })

  it('shows one row, "both", when the owner is also the platform commissioner', () => {
    const own = [{ ownerName: 'Boss', claimedByUserId: 'boss', isCommissioner: true }, { ownerName: 'Guap', claimedByUserId: 'me' }]
    expect(view(buildCommissionerAccessRows(own, 'boss', 'commissioner', { ownerUserId: 'boss' }))).toEqual([['Boss', 'commissioner', 'both', true]])
  })

  it('names an owner who has claimed no team without guessing who they are', () => {
    const rows = buildCommissionerAccessRows(efl, 'u3', 'co_commissioner', { ownerUserId: 'someone-else' })
    expect(rows[0]).toMatchObject({ handle: 'League owner', basis: 'allfantasy', isYou: false })
  })

  it('without the league owner it behaves as before: the flags, viewer not added if already listed', () => {
    expect(view(buildCommissionerAccessRows(efl, 'u3', 'co_commissioner'))).toEqual([
      ['Altoidman', 'commissioner', 'platform', false],
      ['Co', 'co_commissioner', 'platform', true],
    ])
  })
})

describe('buildCommissionerAccessRows — native league', () => {
  it('has one authority, so every row is AllFantasy and the owner is not repeated', () => {
    const teams = [{ ownerName: 'Owner', claimedByUserId: 'o', isCommissioner: true }, { ownerName: 'Co', claimedByUserId: 'c', isCoCommissioner: true }]
    expect(view(buildCommissionerAccessRows(teams, 'o', 'commissioner', { ownerUserId: 'o', native: true }))).toEqual([
      ['Owner', 'commissioner', 'allfantasy', true],
      ['Co', 'co_commissioner', 'allfantasy', false],
    ])
  })
})
