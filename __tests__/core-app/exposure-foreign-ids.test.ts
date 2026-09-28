// @vitest-environment node
/**
 * Cross-league exposure (Home) and foreign roster ids.
 *
 * 🛑 A Fleaflicker/MFL/Fantrax/Yahoo roster holds the PROVIDER's ids, short numbers in Sleeper's
 * range. '6038' below is a real Sleeper id in the fake catalog, owned by "Wrong Player". Reading
 * the Fleaflicker roster as Sleeper ids tells you a stranger is on your rosters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ platform: 'fleaflicker' }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findMany: vi.fn(async () => [{ leagueId: 'L1', platformUserId: 'me', externalId: '4' }]),
    },
    roster: {
      findMany: vi.fn(async () => [
        { leagueId: 'L1', playerData: { players: ['6038', '6039'], starters: ['6038'] }, league: { platform: db.platform } },
      ]),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        where.sleeperId.in.includes('6038')
          ? [{ sleeperId: '6038', name: 'Wrong Player', position: 'WR', team: 'NYJ' }]
          : [],
      ),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { getCrossLeagueExposure } from '@/lib/core-app/dash3aPanels'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCrossLeagueExposure — foreign roster ids', () => {
  it('🛑 never names a stranger from a Fleaflicker roster', async () => {
    db.platform = 'fleaflicker'
    const panel = await getCrossLeagueExposure('u1', ['L1'])
    expect(JSON.stringify(panel)).not.toContain('Wrong Player')
    expect(panel.available).toBe(false)
    expect(prisma.sportsPlayer.findMany).not.toHaveBeenCalled()
  })

  it('CONTROL: the same roster in a Sleeper league IS named', async () => {
    db.platform = 'sleeper'
    const panel = await getCrossLeagueExposure('u1', ['L1'])
    expect(panel.available).toBe(true)
    if (!panel.available) return
    expect(panel.data.rows.map((r) => r.name)).toContain('Wrong Player')
  })
})
