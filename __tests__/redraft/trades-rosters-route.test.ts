/**
 * Regression lock for the new member-gated roster-listing endpoint that powers the native trade
 * proposal UI. `/api/league/roster?userId=` only lets the league owner view another manager's
 * roster, which would silently block a regular member from building a trade with a teammate who
 * isn't the commissioner. This endpoint is gated by `assertLeagueMember` instead — the same check
 * every other trade action route already uses — since roster composition isn't sensitive within a
 * league (it's already visible on the Matchups tab).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const assertLeagueMember = vi.fn()
const findManyRoster = vi.fn()
const getNormalizedPlayerData = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: { roster: { findMany: (...args: unknown[]) => findManyRoster(...args) } },
}))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: (...args: unknown[]) => assertLeagueMember(...args),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({
  getNormalizedPlayerData: (...args: unknown[]) => getNormalizedPlayerData(...args),
}))

import { GET } from '@/app/api/leagues/[leagueId]/trades/rosters/route'

function ctx(leagueId: string) {
  return { params: Promise.resolve({ leagueId }) }
}

describe('GET /api/leagues/[leagueId]/trades/rosters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: 'user-a' } })
  })

  it('rejects a non-member (403), matching every other trade route\'s access gate', async () => {
    assertLeagueMember.mockResolvedValue({ ok: false, status: 403 })
    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    expect(res.status).toBe(403)
  })

  it('returns every roster in the league (not just the owner\'s) for a real league member', async () => {
    assertLeagueMember.mockResolvedValue({ ok: true, league: {} })
    findManyRoster.mockResolvedValue([
      { id: 'roster-a', platformUserId: 'user-a', playerData: { players: ['p1', 'p2'] } },
      { id: 'roster-b', platformUserId: 'user-b', playerData: { players: ['p3'] } },
    ])
    getNormalizedPlayerData.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === 'user-a') {
        return [
          { unified: {}, display: {} } as never, // enrichment lookup is best-effort; id mapping below covers the assertion
        ]
      }
      return []
    })

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const body = (await res.json()) as { rosters: Array<{ rosterId: string; platformUserId: string; players: Array<{ id: string }> }> }

    expect(res.status).toBe(200)
    expect(body.rosters).toHaveLength(2)
    expect(body.rosters.map((r) => r.rosterId)).toEqual(['roster-a', 'roster-b'])
    expect(body.rosters[0].players.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(body.rosters[1].players.map((p) => p.id)).toEqual(['p3'])
  })

  it('falls back to raw player ids as the name when enrichment fails (matches the placeholder convention used elsewhere)', async () => {
    assertLeagueMember.mockResolvedValue({ ok: true, league: {} })
    findManyRoster.mockResolvedValue([{ id: 'roster-a', platformUserId: 'user-a', playerData: { players: ['synthetic-id-1'] } }])
    getNormalizedPlayerData.mockRejectedValue(new Error('provider down'))

    const res = await GET(new Request('http://localhost/api/leagues/league-1/trades/rosters') as never, ctx('league-1'))
    const body = (await res.json()) as { rosters: Array<{ players: Array<{ id: string; name: string }> }> }
    expect(body.rosters[0].players).toEqual([{ id: 'synthetic-id-1', name: 'synthetic-id-1', position: null }])
  })
})
