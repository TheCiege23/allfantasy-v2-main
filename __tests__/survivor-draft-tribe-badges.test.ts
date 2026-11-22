// @vitest-environment node
/**
 * The draft room shows each seat's tribe once tribes are locked before the draft: the session
 * snapshot's slot entries carry a badge keyed by roster, unless the plan hides it (showOnBoard).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ league: { findUnique: vi.fn() }, survivorTribe: { findMany: vi.fn() }, survivorGuillotineLeague: { findUnique: vi.fn() } }))
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

/*
 * Survivor Guilly forms its starting tribes in period 0; random and manager-choice formation can
 * finish before the draft. Its engine stores ids only, so the board uses the league page's own
 * tribe identity (`sgTribeArt`): Vela, Koa, … with their buff colours and symbols.
 */
describe('Survivor Guilly tribes', () => {
  const sgLeague = () => {
    db.league.findUnique.mockReset()
    db.league.findUnique.mockResolvedValueOnce({ survivorMode: false, leagueVariant: 'survivor_guillotine' })
  }

  it('stamps each seat with its formed tribe, named and coloured as the league page shows it', async () => {
    sgLeague()
    db.survivorGuillotineLeague.findUnique.mockResolvedValue({
      tribes: [{ rosterId: 'r1', tribeId: 'tribe-0' }, { rosterId: 'r2', tribeId: 'tribe-1', captain: true }, { rosterId: 'r3', tribeId: 'tribe-0' }],
    })
    const out = await attachSurvivorTribeBadges('lg', slotOrder)
    expect(out.map(e => e.tribe?.name)).toEqual(['Vela', 'Koa', 'Vela'])
    expect(out[0].tribe).toEqual({
      id: 'tribe-0', name: 'Vela', colorHex: '#7b6cf0',
      markUrl: '/specialty/survguil/tribes/sym-star.svg', crestUrl: '/specialty/survguil/tribes/buff-purple.svg',
    })
    expect(out[1].tribe?.colorHex).toBe('#3bb3b8')
    // Never the classic Survivor tables.
    expect(db.survivorTribe.findMany).not.toHaveBeenCalled()
  })

  it('no tribes formed yet, or malformed rows: the board is untouched', async () => {
    sgLeague()
    db.survivorGuillotineLeague.findUnique.mockResolvedValue({ tribes: [] })
    expect(await attachSurvivorTribeBadges('lg', slotOrder)).toBe(slotOrder)
    sgLeague()
    db.survivorGuillotineLeague.findUnique.mockResolvedValue({ tribes: [{ rosterId: 'r1' }, 'junk', null] })
    expect(await attachSurvivorTribeBadges('lg', slotOrder)).toBe(slotOrder)
    sgLeague()
    db.survivorGuillotineLeague.findUnique.mockResolvedValue(null)
    expect(await attachSurvivorTribeBadges('lg', slotOrder)).toBe(slotOrder)
  })

  it('a seat not in any tribe keeps no badge', async () => {
    sgLeague()
    db.survivorGuillotineLeague.findUnique.mockResolvedValue({ tribes: [{ rosterId: 'r2', tribeId: 'tribe-2' }] })
    const out = await attachSurvivorTribeBadges('lg', slotOrder)
    expect(out.map(e => e.tribe?.name ?? null)).toEqual([null, 'Nalu', null])
  })
})
