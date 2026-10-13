/**
 * The Stat Corrections screen reads one ledger written by two writers: the official-correction check
 * (players with names, matchups) and the commish's own correction (a player id and points only, named
 * from the league's roster rows). Members may read it; strangers may not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ member: true, role: 'member' as string | null }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ platform: 'allfantasy', sport: 'NFL', settings: { stat_correction_days: 2 } })) },
    leagueEvent: {
      findMany: vi.fn(async () => [
        {
          id: 'e2',
          createdAt: new Date('2026-10-15T00:00:00Z'),
          payload: { source: 'commish', week: 5, reason: 'scorer change', corrections: [{ playerId: 'w1', pointsBefore: 5, pointsAfter: 9 }] },
        },
        {
          id: 'e1',
          createdAt: new Date('2026-10-14T00:00:00Z'),
          payload: {
            source: 'official',
            week: 6,
            corrections: [{ playerId: 'wr', playerName: 'Wade WR', teamName: 'Aces', pointsBefore: 40, pointsAfter: 43 }],
            matchups: [{ homeTeam: 'Aces', awayTeam: 'Bee', before: { home: 100, away: 101 }, after: { home: 103, away: 101 }, resultFlipped: true }],
          },
        },
      ]),
    },
    redraftRosterPlayer: { findMany: vi.fn(async () => [{ playerId: 'w1', playerName: 'Will WR' }]) },
  },
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => (h.member ? { ok: true } : { ok: false, status: 403 })) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => h.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
}))

import { GET } from '@/app/api/leagues/[leagueId]/stat-corrections/handler'

const ctx = { params: { leagueId: 'L1' } }
const get = () => GET(new Request('http://localhost/x') as never, ctx)

beforeEach(() => {
  h.member = true
  h.role = 'member'
})

describe('GET /stat-corrections', () => {
  it('lists both kinds of correction, names commish ones from the roster, and reports the window', async () => {
    const body = await (await get()).json()
    expect(body).toMatchObject({ supported: true, days: 2, canEdit: false })
    expect(body.corrections.map((c: { id: string }) => c.id)).toEqual(['e2', 'e1'])
    expect(body.corrections[0]).toMatchObject({ source: 'commish', week: 5, reason: 'scorer change', players: [{ playerId: 'w1', playerName: 'Will WR', pointsBefore: 5, pointsAfter: 9 }] })
    expect(body.corrections[1].matchups[0]).toMatchObject({ resultFlipped: true, after: { home: 103, away: 101 } })
  })
  it('a co-commish can edit the window', async () => {
    h.role = 'co_commissioner'
    expect((await (await get()).json()).canEdit).toBe(true)
  })
  it('refuses a non-member', async () => {
    h.member = false
    expect((await get()).status).toBe(403)
  })
})
