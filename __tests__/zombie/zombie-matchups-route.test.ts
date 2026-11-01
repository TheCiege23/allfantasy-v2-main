// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * GET /api/zombie/matchups used to return raw statuses — naming the Whisperer to every member of a secret
 * league — and to name open seats by a user id. Pins both, plus the engine-true transfer.
 */

const W = 'R-whisperer'
const h = vi.hoisted(() => ({ canSee: false, results: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-me' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/zombie/zombieRules', () => ({
  getZombieRulesForSport: vi.fn(async () => ({ bashingThreshold: 128, maulingThreshold: 211 })),
}))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: vi.fn(async () => ({ infectionLossToZombie: true })) }))
vi.mock('@/lib/zombie/ZombieInfectionEngine', () => ({ loadNativeWeekResults: h.results }))
vi.mock('@/lib/zombie/whispererViewer', () => ({
  resolveWhispererViewer: vi.fn(async () => ({ canSee: h.canSee, identity: { rosterIds: new Set([W]), userIds: new Set() } })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: vi.fn(async () => ({ id: 'z1', season: 2026, sport: 'NBA', currentWeek: 2 })) },
    zombieWeeklyResolution: { findUnique: vi.fn(async () => ({ status: 'complete', settlementSnapshot: null })) },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'R-me', platformUserId: 'user-me', playerData: null, redraftRoster: null },
        { id: W, platformUserId: 'user-w', playerData: null, redraftRoster: null },
        { id: 'R-open', platformUserId: 'open-slot-L1-3', playerData: null, redraftRoster: null },
        { id: 'R-z', platformUserId: 'user-z', playerData: null, redraftRoster: null },
      ]),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { id: 't1', externalId: 'x1', platformUserId: 'user-me', claimedByUserId: 'user-me', teamName: 'Brain Drain', ownerName: '' },
        { id: 't2', externalId: 'x2', platformUserId: 'user-w', claimedByUserId: 'user-w', teamName: 'Quiet Ones', ownerName: '' },
        { id: 't3', externalId: 'x3', platformUserId: 'open-slot-L1-3', claimedByUserId: null, teamName: 'Open Team 3', ownerName: '' },
        { id: 't4', externalId: 'x4', platformUserId: 'user-z', claimedByUserId: 'user-z', teamName: 'Rotters', ownerName: '' },
      ]),
    },
    zombieLeagueTeam: {
      findMany: vi.fn(async () => [
        { rosterId: 'R-me', status: 'Survivor', weekBecameZombie: null, killedByRosterId: null },
        { rosterId: W, status: 'Whisperer', weekBecameZombie: null, killedByRosterId: null },
        { rosterId: 'R-open', status: 'Survivor', weekBecameZombie: null, killedByRosterId: null },
        { rosterId: 'R-z', status: 'Zombie', weekBecameZombie: 1, killedByRosterId: W },
      ]),
    },
  },
}))

import { GET } from '@/app/api/zombie/matchups/route'

const get = async () => {
  const res = await GET(new Request('http://localhost/api/zombie/matchups?leagueId=L1&week=2'))
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

beforeEach(() => {
  h.canSee = false
  h.results.mockResolvedValue([
    { matchupId: 'm1', homeRosterId: 'R-me', awayRosterId: W, homeScore: 1000, awayScore: 990, final: false },
    { matchupId: 'm2', homeRosterId: 'R-open', awayRosterId: 'R-z', homeScore: 1300, awayScore: 1000, final: true },
  ])
})

describe('GET /api/zombie/matchups', () => {
  it('does not name the Whisperer to a member of a secret league', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.text).not.toMatch(/Whisperer/)
    const m1 = res.body.matchups.find((m: { id: string }) => m.id === 'm1')
    expect(m1.away.status).toBe('Survivor')
    // ...and so no infection reads as at stake in my matchup either.
    expect(m1.atRisk).toBeNull()
  })

  it('shows the Whisperer to a viewer who may see it', async () => {
    h.canSee = true
    const m1 = (await get()).body.matchups.find((m: { id: string }) => m.id === 'm1')
    expect(m1.away.status).toBe('Whisperer')
    expect(m1.atRisk).toBe('home')
    expect(m1.mySide).toBe('home')
  })

  it('names every side by its team, an open seat included — never an id', async () => {
    const { body, text } = await get()
    const names = body.matchups.flatMap((m: { home: { name: string }; away: { name: string } }) => [m.home.name, m.away.name])
    expect(names).toEqual(['Brain Drain', 'Quiet Ones', 'Open Team 3', 'Rotters'])
    expect(text).not.toMatch(/user-|open-slot-/)
  })

  it("reports the engine's transfer for a final blowout", async () => {
    const m2 = (await get()).body.matchups.find((m: { id: string }) => m.id === 'm2')
    expect(m2.outcome).toEqual({ kind: 'mauling', final: true })
    expect(m2.transfer).toEqual({ fromRosterId: 'R-z', toRosterId: 'R-open', amount: 500 })
  })
})
