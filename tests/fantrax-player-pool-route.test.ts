import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({ info: vi.fn(), names: vi.fn() }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: vi.fn(async () => ({ ok: true, userId: 'tester' })) }))
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '127.0.0.1', rateLimit: () => ({ success: true }) }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({
  getFantraxLeagueInfo: mock.info,
  getFantraxPlayerIds: mock.names,
  parseFantraxLeagueId: (value: string) => /^[a-z0-9]{16}$/.test(value) ? value : null,
}))

import { GET } from '@/app/api/fantrax/player-pool/route'

const leagueId = 'tau9a8fomvmq84sx'

beforeEach(() => {
  mock.info.mockResolvedValue({ ok: true, data: {
    leagueName: 'Public NFL league',
    playerInfo: {
      p1: { status: 'WW' }, p2: { status: 'WW' }, p3: { status: 'FA' }, p4: { status: 'T' },
    },
  } })
  mock.names.mockResolvedValue({ ok: true, data: {
    p1: { name: 'Quarterback One', team: 'A', position: 'QB' },
    p2: { name: 'Running Back Two', team: 'B', position: 'RB' },
    p3: { name: 'Wideout Three', team: 'C', position: 'WR' },
    p4: { name: 'Rostered Four', team: 'D', position: 'TE' },
  } })
})

describe('Fantrax player pool route', () => {
  it('returns waiver players and full pool counts without claiming a roster', async () => {
    const response = await GET(new NextRequest(`http://localhost/api/fantrax/player-pool?leagueId=${leagueId}&sport=NFL&status=WW&limit=1`))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.counts).toEqual({ waiverWire: 2, freeAgents: 1 })
    expect(data.total).toBe(2)
    expect(data.players).toHaveLength(1)
    expect(data.players[0].status).toBe('WW')
  })

  it('rejects a sport map that does not match the league pool', async () => {
    mock.names.mockResolvedValue({ ok: true, data: { other: { name: 'Other', team: 'X', position: 'C' } } })
    const response = await GET(new NextRequest(`http://localhost/api/fantrax/player-pool?leagueId=${leagueId}&sport=NBA`))
    expect(response.status).toBe(422)
  })
})
