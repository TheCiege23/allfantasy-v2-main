/**
 * Rivalry rows a run did not reach get their teams named too (2026-10-06).
 *
 * The detector writes only a league's top four rivalries per run, so after the naming fix a row for a
 * pair outside the top four kept "11 vs 17: Heated rivalry". Measured live: 31 such rows in the 18
 * leagues refreshed so far, beside correctly named ones. The engine now renames them with the same
 * resolver the detector uses — and leaves a row alone when a side does not resolve.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  detect: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  leagueFindUnique: vi.fn(),
}))

vi.mock('@/lib/drama-engine/DramaEventDetector', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/drama-engine/DramaEventDetector')>()
  return { ...real, detectDramaEvents: m.detect }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dramaEvent: { findMany: m.findMany, findFirst: vi.fn().mockResolvedValue(null), update: m.update, create: vi.fn(), deleteMany: vi.fn() },
    dramaTimelineRecord: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    league: { findUnique: m.leagueFindUnique },
  },
}))

import { runLeagueDramaEngine } from '@/lib/drama-engine/LeagueDramaEngine'

beforeEach(() => {
  vi.clearAllMocks()
  m.detect.mockResolvedValue([]) // a run that reaches no rivalry at all
  m.update.mockImplementation(({ where }) => Promise.resolve({ id: where.id }))
  m.leagueFindUnique.mockResolvedValue({
    teams: [
      { id: 'lt-11', externalId: '11', teamName: 'Hoovi', ownerName: 'o11' },
      { id: 'lt-17', externalId: '17', teamName: '  ', ownerName: 'rexy_owner' },
      { id: 'lt-6', externalId: '6', teamName: 'TE nation', ownerName: 'o6' },
    ],
  })
})

const run = () => runLeagueDramaEngine({ leagueId: 'league-1', sport: 'NFL', season: 2026 })

describe('rivalry rows outside the run are renamed', () => {
  it('🛑 names both teams, falling back to the owner, and keeps the tier', async () => {
    m.findMany
      .mockResolvedValueOnce([
        { id: 'r1', headline: '11 vs 17: Heated rivalry' },
        { id: 'r2', headline: '6 vs 11: Emerging rivalry' },
      ])
      .mockResolvedValue([])
    await run()
    expect(m.update.mock.calls.map((c) => [c[0].where.id, c[0].data.headline])).toEqual([
      ['r1', 'Hoovi vs rexy_owner: Heated rivalry'],
      ['r2', 'TE nation vs Hoovi: Emerging rivalry'],
    ])
  })

  it('leaves a row alone when a side does not resolve, and never touches a named row', async () => {
    m.findMany
      .mockResolvedValueOnce([
        { id: 'r1', headline: '11 vs 99: Heated rivalry' }, // 99 is not a team in this league
        { id: 'r2', headline: 'Hoovi vs TE nation: Emerging rivalry' },
      ])
      .mockResolvedValue([])
    await run()
    expect(m.update).not.toHaveBeenCalled()
  })

  it('reads the league’s teams only when there is a numbered row to rename', async () => {
    m.findMany.mockResolvedValueOnce([{ id: 'r2', headline: 'Hoovi vs TE nation: Emerging rivalry' }]).mockResolvedValue([])
    await run()
    expect(m.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('skips the rows this run itself just wrote', async () => {
    m.detect.mockResolvedValue([
      { dramaType: 'MAJOR_UPSET', headline: 'Major upset in week 4: Hoovi vs TE nation', summary: 's', relatedManagerIds: [], relatedTeamIds: [] },
    ])
    // ensureDramaEvent (non-rivalry) creates via findFirst → create; give the create an id that the rename read then sees.
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.dramaEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'fresh' })
    m.findMany.mockResolvedValueOnce([{ id: 'fresh', headline: '11 vs 17: Heated rivalry' }]).mockResolvedValue([])
    await run()
    expect(m.update).not.toHaveBeenCalled()
  })
})
