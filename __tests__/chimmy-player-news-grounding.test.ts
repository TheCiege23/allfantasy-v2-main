import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ newsFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { playerNewsRecord: { findMany: mocks.newsFindMany } },
}))

import { buildPlayerNewsContext } from '@/lib/chimmy/playerNewsGrounding'

const NOW = new Date('2026-08-25T12:00:00.000Z')

function rosters(names: string[]) {
  return [
    {
      userId: 'u1',
      teamName: 'My Team',
      starters: names.map((playerName) => ({
        playerId: playerName,
        playerName,
        position: 'WR',
        team: 'JAX',
        injuryStatus: null,
        adp: null,
        projectedPoints: 12,
        isStarter: true,
      })),
      bench: [],
    },
  ] as never
}

function news(playerName: string, headline: string, impact = 'high') {
  return {
    playerName,
    team: 'JAX',
    headline,
    impact,
    fantasyRelevant: true,
    publishedAt: new Date('2026-08-24T12:00:00.000Z'),
    source: 'rotowire',
  }
}

describe('buildPlayerNewsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.newsFindMany.mockResolvedValue([news('Brian Thomas Jr.', 'Limited in practice Thursday')])
  })

  it('surfaces dated news for players on the roster', async () => {
    const out = await buildPlayerNewsContext({ rosters: rosters(['Brian Thomas Jr.']), sport: 'nfl', now: NOW })

    expect(out).toContain('RECENT NEWS')
    expect(out).toContain('Brian Thomas Jr.')
    expect(out).toContain('Limited in practice Thursday')
    expect(out).toContain('2026-08-24')
  })

  /*
   * The core guard: a headline beside a number is not a reason the number moved.
   */
  it('forbids turning news into a causal claim about a projection', async () => {
    const out = await buildPlayerNewsContext({ rosters: rosters(['Brian Thomas Jr.']), sport: 'nfl', now: NOW })

    expect(out).toMatch(/do NOT say a projection "dropped because of"/i)
    expect(out).toMatch(/do NOT quantify an effect/i)
    expect(out).toContain('CONTEXT, not a recalculation')
  })

  it('only looks back a bounded window', async () => {
    await buildPlayerNewsContext({ rosters: rosters(['Brian Thomas Jr.']), sport: 'nfl', now: NOW })

    const since = mocks.newsFindMany.mock.calls[0][0].where.publishedAt.gte as Date
    const days = (NOW.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)
    expect(days).toBe(14)
  })

  it('scopes the lookup to the sport', async () => {
    await buildPlayerNewsContext({ rosters: rosters(['Brian Thomas Jr.']), sport: 'nfl', now: NOW })
    expect(mocks.newsFindMany.mock.calls[0][0].where.sport).toMatchObject({ equals: 'nfl' })
  })

  it('includes players named in the question as well as the roster', async () => {
    await buildPlayerNewsContext({
      rosters: rosters(['Brian Thomas Jr.']),
      extraNames: ['Jahmyr Gibbs'],
      sport: 'nfl',
      now: NOW,
    })

    expect(mocks.newsFindMany.mock.calls[0][0].where.playerName.in).toEqual(
      expect.arrayContaining(['Brian Thomas Jr.', 'Jahmyr Gibbs']),
    )
  })

  it('returns null when there is no roster and nobody was named', async () => {
    expect(await buildPlayerNewsContext({ rosters: null, sport: 'nfl', now: NOW })).toBeNull()
    expect(mocks.newsFindMany).not.toHaveBeenCalled()
  })

  it('returns null rather than an empty section when nothing is recent', async () => {
    mocks.newsFindMany.mockResolvedValue([])
    expect(
      await buildPlayerNewsContext({ rosters: rosters(['Brian Thomas Jr.']), sport: 'nfl', now: NOW }),
    ).toBeNull()
  })

  it('survives a failing lookup', async () => {
    mocks.newsFindMany.mockRejectedValue(new Error('connection lost'))
    expect(
      await buildPlayerNewsContext({ rosters: rosters(['Brian Thomas Jr.']), sport: 'nfl', now: NOW }),
    ).toBeNull()
  })
})
