// @vitest-environment node
/**
 * The home dashboard loader (getDash34Data) and foreign roster ids.
 *
 * 🛑 A Fleaflicker/MFL/Fantrax/Yahoo roster holds the PROVIDER's ids, short numbers in Sleeper's
 * range. '6038' below is a real Sleeper id in the fake catalog, owned by "Wrong Player" who is Out.
 * Reading the Fleaflicker roster as Sleeper ids puts a stranger's injury into your brief.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({
  loadLatestPlayerValueSnapshots: vi.fn(async () => []),
}))

const { db, rows } = vi.hoisted(() => ({
  db: { platform: 'fleaflicker', guillotine: false },
  rows: (list: unknown[]) => ({ findMany: vi.fn(async () => list) }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineRosterState: rows([]),
    guillotineElimination: rows([]),
    leagueTeam: rows([
      { leagueId: 'L1', id: 'T1', teamName: 'Mine', ownerName: 'me', platformUserId: 'p1', externalId: '1', isCommissioner: false, isCoCommissioner: false },
    ]),
    sportsGame: rows([]),
    roster: rows([{ id: 'R1', leagueId: 'L1', playerData: { players: ['6038', '6039'], starters: ['6038'] } }]),
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        where.sleeperId.in.includes('6038')
          ? [{ sleeperId: '6038', name: 'Wrong Player', position: 'WR', team: 'NYJ', sport: 'NFL', imageUrl: null }]
          : [],
      ),
    },
    sportsInjury: rows([
      { playerName: 'Wrong Player', status: 'Out', description: 'Hamstring', date: new Date(), position: 'WR', team: 'NYJ' },
    ]),
    league: { findMany: vi.fn(async () => [{ id: 'L1', platform: db.platform, guillotineMode: db.guillotine }]) },
    weeklyMatchup: rows([]),
  },
}))

import { prisma } from '@/lib/prisma'
import { getDash34Data } from '@/lib/core-app/dash34'

// `platform` is deliberately absent from the caller's row: the loader must learn it from League.
const LEAGUE = { id: 'L1', name: 'League', sport: 'NFL', status: 'in_season', hasUnifiedRecord: true, lastSyncedAt: null }

beforeEach(() => {
  vi.clearAllMocks()
  db.guillotine = false
})

describe('getDash34Data — foreign roster ids', () => {
  it('🛑 never names a stranger from a Fleaflicker roster', { timeout: 60_000 }, async () => {
    db.platform = 'fleaflicker'
    const result = await getDash34Data('u1', [LEAGUE], new Date())
    expect(JSON.stringify(result)).not.toContain('Wrong Player')
    expect(prisma.sportsPlayer.findMany).not.toHaveBeenCalled()
  })

  it('CONTROL: the same roster in a Sleeper league IS named', { timeout: 60_000 }, async () => {
    db.platform = 'sleeper'
    const result = await getDash34Data('u1', [LEAGUE], new Date())
    expect(prisma.sportsPlayer.findMany).toHaveBeenCalled()
    expect(JSON.stringify(result)).toContain('Wrong Player')
  })

  /*
   * The stripped roster is empty because we cannot read it, not because the team was chopped.
   * A guillotine league must not be told to "check elimination" on that account.
   */
  it('a Fleaflicker guillotine roster read as empty is NOT reported as eliminated', { timeout: 60_000 }, async () => {
    db.platform = 'fleaflicker'
    db.guillotine = true
    const result = await getDash34Data('u1', [LEAGUE], new Date())
    expect(JSON.stringify(result)).not.toContain('CHECK ELIMINATION')
  })

  it('CONTROL: a Sleeper guillotine roster that IS empty still is', { timeout: 60_000 }, async () => {
    db.platform = 'sleeper'
    db.guillotine = true
    vi.mocked(prisma.roster.findMany).mockResolvedValueOnce([{ id: 'R1', leagueId: 'L1', playerData: { players: [], starters: [] } }] as never)
    const result = await getDash34Data('u1', [LEAGUE], new Date())
    expect(JSON.stringify(result)).toContain('CHECK ELIMINATION')
  })
})
