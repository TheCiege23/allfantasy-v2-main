/**
 * A rivalry storyline is one row per pair (2026-10-05).
 *
 * `ensureDramaEvent` matched an existing row by its headline, so any headline change — a tier
 * moving from Emerging to Heated, or naming the teams where roster numbers were — wrote a second
 * row for the same two managers, and the scheduled refresh never runs with `replace` to clear the
 * first. A rivalry row is now matched by its manager pair: the newest is rewritten in place, older
 * versions of the same pair are removed, and every other drama type keeps the headline match.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  detect: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
}))

vi.mock('@/lib/drama-engine/DramaEventDetector', () => ({ detectDramaEvents: m.detect }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dramaEvent: { findMany: m.findMany, findFirst: m.findFirst, update: m.update, create: m.create, deleteMany: m.deleteMany },
    dramaTimelineRecord: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  },
}))

import { pairIdentity, runLeagueDramaEngine } from '@/lib/drama-engine/LeagueDramaEngine'

const named = {
  dramaType: 'RIVALRY_CLASH',
  headline: 'Hoovi vs rexy40: Heated rivalry',
  summary: 'Head-to-head tension (score 44/100).',
  relatedManagerIds: ['13', '9'],
  relatedTeamIds: [],
  signal: { intensityFactor: 0.44, rivalryScore: 44 },
}

beforeEach(() => {
  vi.clearAllMocks()
  m.update.mockImplementation(({ where }) => Promise.resolve({ id: where.id }))
  m.create.mockResolvedValue({ id: 'new-row' })
  m.findFirst.mockResolvedValue(null)
})

const run = () => runLeagueDramaEngine({ leagueId: 'league-1', sport: 'NFL', season: 2026 })

describe('rivalry drama events are identified by their pair', () => {
  it('🛑 rewrites the newest row for the pair, removes its older versions, creates nothing', async () => {
    m.detect.mockResolvedValue([named])
    m.findMany
      // the rows for this league, season and type, newest first
      .mockResolvedValueOnce([
        { id: 'row-ids-headline', relatedManagerIds: ['13', '9'] }, // "13 vs 9: Heated rivalry"
        { id: 'row-other-pair', relatedManagerIds: ['13', '4'] },
        { id: 'row-old-tier', relatedManagerIds: ['9', '13'] }, // "9 vs 13: Emerging rivalry", same pair
      ])
      .mockResolvedValue([{ id: 'row-ids-headline' }]) // the timeline ordering read

    const result = await run()

    expect(m.update).toHaveBeenCalledTimes(1)
    expect(m.update.mock.calls[0][0].where).toEqual({ id: 'row-ids-headline' })
    expect(m.update.mock.calls[0][0].data.headline).toBe('Hoovi vs rexy40: Heated rivalry')
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['row-old-tier'] } } })
    expect(m.create).not.toHaveBeenCalled()
    expect(m.findFirst).not.toHaveBeenCalled() // the headline match is never consulted for a pair
    expect(result).toMatchObject({ created: 0, updated: 1 })
  })

  it('creates a row for a pair it has not seen', async () => {
    m.detect.mockResolvedValue([named])
    m.findMany.mockResolvedValueOnce([{ id: 'row-other-pair', relatedManagerIds: ['13', '4'] }]).mockResolvedValue([])
    await run()
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.create.mock.calls[0][0].data.headline).toBe('Hoovi vs rexy40: Heated rivalry')
    expect(m.deleteMany).not.toHaveBeenCalled()
  })

  it('leaves every other drama type on the headline match', async () => {
    m.detect.mockResolvedValue([{ ...named, dramaType: 'MAJOR_UPSET', headline: 'Major upset in week 4: Hoovi vs rexy40', relatedManagerIds: ['13', '9'] }])
    m.findMany.mockResolvedValue([])
    m.findFirst.mockResolvedValue({ id: 'upset-row' })
    await run()
    expect(m.findFirst.mock.calls[0][0].where.headline).toBe('Major upset in week 4: Hoovi vs rexy40')
    expect(m.update.mock.calls[0][0].where).toEqual({ id: 'upset-row' })
    expect(m.deleteMany).not.toHaveBeenCalled()
  })

  it('a pair is order-free and exactly two', () => {
    expect(pairIdentity(['13', '9'])).toBe(pairIdentity(['9', '13']))
    expect(pairIdentity(['13'])).toBeNull()
    expect(pairIdentity(['1', '2', '3'])).toBeNull()
  })
})
