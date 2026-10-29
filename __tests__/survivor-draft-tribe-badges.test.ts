// @vitest-environment node
/**
 * The draft room shows each seat's tribe once tribes are locked before the draft: the session
 * snapshot's slot entries carry a badge keyed by roster, unless the plan hides it (showOnBoard).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ league: { findUnique: vi.fn() }, survivorTribe: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { attachSurvivorTribeBadges } from '@/lib/survivor/survivorDraftTribeBadges'

const slotOrder = [
  { slot: 1, rosterId: 'r1', displayName: 'Ana' },
  { slot: 2, rosterId: 'r2', displayName: 'Ben' },
  { slot: 3, rosterId: 'r3', displayName: 'Cy' },
]
const tribes = [
  { id: 't0', name: 'Tribe Wolves', colorHex: '#ff0000', catalogId: null, primaryColor: null, secondaryColor: null, logoUrl: 'https://blob/w.png', members: [{ rosterId: 'r1' }, { rosterId: 'r3' }] },
  { id: 't1', name: 'Tribe Hawks', colorHex: null, catalogId: null, primaryColor: '#00ff00', secondaryColor: null, logoUrl: null, members: [{ rosterId: 'r2' }] },
]

beforeEach(() => {
  vi.resetAllMocks()
  db.league.findUnique
    .mockResolvedValueOnce({ survivorMode: true, leagueVariant: 'survivor' })
    .mockResolvedValueOnce({ sport: 'NBA', settings: { survivorTribePlan: { mode: 'random', seed: 1, mapping: {}, showOnBoard: true, lockedAt: 'x' } } })
  db.survivorTribe.findMany.mockResolvedValue(tribes)
})

describe('attachSurvivorTribeBadges', () => {
  it('stamps each seat with its tribe by roster id', async () => {
    const out = await attachSurvivorTribeBadges('lg', slotOrder)
    expect(out.map(e => e.tribe?.name)).toEqual(['Tribe Wolves', 'Tribe Hawks', 'Tribe Wolves'])
    expect(out[0].tribe).toMatchObject({ id: 't0', colorHex: '#ff0000', markUrl: 'https://blob/w.png', crestUrl: 'https://blob/w.png' })
    expect(out[1].tribe).toMatchObject({ id: 't1', colorHex: '#00ff00', markUrl: null })
    expect(db.survivorTribe.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'lg', isActive: true, isMerged: false } }))
  })

  it('leaves non-Survivor leagues untouched after one read', async () => {
    db.league.findUnique.mockReset().mockResolvedValueOnce({ survivorMode: false, leagueVariant: 'redraft' })
    const out = await attachSurvivorTribeBadges('lg', slotOrder)
    expect(out).toBe(slotOrder)
    expect(db.survivorTribe.findMany).not.toHaveBeenCalled()
  })

  it('honours the plan that keeps tribes off the board', async () => {
    db.league.findUnique.mockReset()
      .mockResolvedValueOnce({ survivorMode: true, leagueVariant: 'survivor' })
      .mockResolvedValueOnce({ sport: 'NBA', settings: { survivorTribePlan: { mode: 'random', seed: 1, mapping: {}, showOnBoard: false, lockedAt: 'x' } } })
    expect(await attachSurvivorTribeBadges('lg', slotOrder)).toBe(slotOrder)
    expect(db.survivorTribe.findMany).not.toHaveBeenCalled()
  })

  it('is a no-op before any tribe exists', async () => {
    db.survivorTribe.findMany.mockResolvedValue([])
    expect(await attachSurvivorTribeBadges('lg', slotOrder)).toBe(slotOrder)
  })
})
