/**
 * 🛑 `assembleDiscoveryLeague` priced every roster player from `fantasy_projections WHERE playerId IN
 * <roster ids>` — no platform check, no season/week. That table is keyed on Sleeper ids, so an imported
 * ESPN / Fleaflicker roster was priced on strangers (ESPN 12483 Matthew Stafford -> Sleeper 12483 Jack
 * Bech; Fleaflicker 10888 Cairo Santos -> Jalen Carter), and a player with no row this week was priced on
 * whatever week he last had one. Feeds trade discovery, the package finder and the trade block.
 *
 * The prisma fake EVALUATES the `where` it is given, so a query that asks with raw roster ids, or drops
 * the week, gets the wrong row back — exactly as production did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizedPlayerValue } from '@/lib/trade-value/valueEngine'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  platform: 'espn' as string,
  players: [] as Row[],
  identity: [] as Row[],
  projections: [] as Row[],
  idpBySleeperId: new Map<string, number>(),
  idpAskedWith: [] as string[][],
}))

const fake = vi.hoisted(() => {
  type R = Record<string, unknown>
  function matches(row: R, where: R | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key]
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        const c = cond as R
        if ('in' in c && !(c.in as unknown[]).includes(value)) return false
        if ('not' in c && value === c.not) return false
        return true
      }
      return value === cond
    })
  }
  return {
    findManyOver:
      (rows: () => R[]) =>
      async (args: { where?: R; orderBy?: { fetchedAt?: 'desc' } } = {}) => {
        const out = rows().filter((r) => matches(r, args.where))
        if (args.orderBy?.fetchedAt === 'desc') {
          out.sort((a, b) => (b.fetchedAt as Date).getTime() - (a.fetchedAt as Date).getTime())
        }
        return out
      },
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', sport: 'NFL' })) },
    league: { findUnique: vi.fn(async () => ({ draftPickTrading: false, settings: {}, leagueType: 'redraft', platform: h.platform })) },
    redraftRoster: {
      findMany: vi.fn(async () => [
        {
          id: 'r1', ownerId: 'u1', ownerName: 'A', teamName: 'Alpha',
          wins: 3, losses: 2, ties: 0, pointsFor: 500, playoffSeed: null, faabBalance: 100,
          players: h.players.map((p) => ({ ...p })),
        },
      ]),
    },
    playerIdentityMap: { findMany: fake.findManyOver(() => h.identity) },
    fantasyProjection: { findMany: fake.findManyOver(() => h.projections) },
    redraftTradeProposal: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 6 })),
}))
vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({
  loadLeagueIdpVorp: vi.fn(async (args: { rosterPlayerIds: string[] }) => {
    h.idpAskedWith.push([...args.rosterPlayerIds])
    return { valueBySleeperId: h.idpBySleeperId }
  }),
}))

import { assembleDiscoveryLeague } from '@/lib/trade-discovery/assembleRosters'

const player = (playerId: string, playerName: string, position = 'QB') => ({ playerId, playerName, position, isLocked: false, byeWeek: null })
const proj = (playerId: string, projectedPoints: number, week = 6, fetchedAt = '2026-10-10T00:00:00Z') => ({
  playerId, sport: 'NFL', season: '2026', week, source: 'sleeper', projectedPoints, fetchedAt: new Date(fetchedAt),
})
const priced = (projection: number, position = 'QB') => normalizedPlayerValue({ projection, position, idpValue: null })

async function values() {
  const league = await assembleDiscoveryLeague('L')
  return Object.fromEntries(league!.rosters[0]!.players.map((p) => [p.playerId, p.value]))
}

beforeEach(() => {
  h.platform = 'espn'
  h.players = []
  h.identity = []
  h.projections = []
  h.idpBySleeperId = new Map()
  h.idpAskedWith = []
})

describe('assembleDiscoveryLeague — foreign roster ids are never priced as Sleeper ids', () => {
  it('🛑 ESPN 12483 (Matthew Stafford), unmapped: unpriced, never Sleeper 12483 (Jack Bech)', async () => {
    h.players = [player('12483', 'Matthew Stafford')]
    h.projections = [proj('12483', 4.4)]
    expect((await values())['12483']).toBeNull()
  })

  it('ESPN 12483 mapped through the crosswalk is priced on STAFFORD\'s line', async () => {
    h.players = [player('12483', 'Matthew Stafford')]
    h.identity = [{ sport: 'NFL', espnId: '12483', sleeperId: '4881' }]
    h.projections = [proj('12483', 4.4), proj('4881', 17.2)]
    expect((await values())['12483']).toBe(priced(17.2))
  })

  it('🛑 Fleaflicker 10888 (Cairo Santos), unmapped: unpriced, never Sleeper 10888 (Jalen Carter)', async () => {
    h.platform = 'fleaflicker'
    h.players = [player('10888', 'Cairo Santos', 'K')]
    h.projections = [proj('10888', 0.41)]
    expect((await values())['10888']).toBeNull()
  })

  it('IDP values are asked with, and read back on, the translated Sleeper id', async () => {
    h.players = [player('3054211', 'Espn Linebacker', 'LB')]
    h.identity = [{ sport: 'NFL', espnId: '3054211', sleeperId: '7000' }]
    h.idpBySleeperId = new Map([['3054211', 1], ['7000', 4200]])
    const v = await values()
    expect(h.idpAskedWith).toEqual([['7000']])
    expect(v['3054211']).toBe(normalizedPlayerValue({ projection: null, position: 'LB', idpValue: 4200 }))
  })
})

describe('assembleDiscoveryLeague — only the week the feed currently holds', () => {
  it('🛑 a player with no row this week is unpriced, not priced on a newer-fetched row from another week', async () => {
    h.platform = 'sleeper'
    h.players = [player('6794', 'Justin Jefferson', 'WR'), player('9509', 'Bijan Robinson', 'RB')]
    h.projections = [
      proj('6794', 30, 5, '2026-10-11T00:00:00Z'), // a different week, fetched last
      proj('9509', 15, 6),
      proj('9509', 2, 5, '2026-10-11T00:00:00Z'),
    ]
    const v = await values()
    expect(v['6794']).toBeNull()
    expect(v['9509']).toBe(priced(15, 'RB'))
  })
})
