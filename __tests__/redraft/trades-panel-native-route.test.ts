/**
 * Regression lock for the NFL redraft Trades UI wiring bug: `/api/league/trades-panel` hardcoded
 * `activeTrades: []` for every native (non-Sleeper) league regardless of what existed in
 * `AfLeagueTrade` — so the redraft Trades tab's "Active Trades" list, and any accept/reject/
 * cancel/commissioner-review controls built on top of it, could never reflect a real trade.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const findFirstLeague = vi.fn()
const findFirstRoster = vi.fn()
const findManyRoster = vi.fn()
const findManyAppUser = vi.fn()
const listAfLeagueTrades = vi.fn()
const isElevatedCommissioner = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...args: unknown[]) => findFirstLeague(...args) },
    roster: {
      findFirst: (...args: unknown[]) => findFirstRoster(...args),
      findMany: (...args: unknown[]) => findManyRoster(...args),
    },
    appUser: { findMany: (...args: unknown[]) => findManyAppUser(...args) },
    tradeBlockEntry: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({
  listAfLeagueTrades: (...args: unknown[]) => listAfLeagueTrades(...args),
}))
vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: (...args: unknown[]) => isElevatedCommissioner(...args),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/league/trades-panel/route'

function makeRequest(leagueId: string): NextRequest {
  return new NextRequest(`http://localhost/api/league/trades-panel?leagueId=${leagueId}`)
}

describe('GET /api/league/trades-panel — native league real trade data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: 'user-receiver' } })
    findFirstLeague.mockResolvedValue({ id: 'league-1', platform: 'native', platformLeagueId: null, name: 'Test League' })
    findFirstRoster.mockResolvedValue({ id: 'roster-receiver' })
    isElevatedCommissioner.mockResolvedValue(false)
  })

  it('returns real pending AfLeagueTrade rows for a native league, not a hardcoded empty array', async () => {
    listAfLeagueTrades.mockResolvedValue([
      {
        id: 'trade-1',
        status: 'pending',
        proposerRosterId: 'roster-proposer',
        receiverRosterId: 'roster-receiver',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        items: [
          { id: 'item-1', fromRosterId: 'roster-proposer', toRosterId: 'roster-receiver', itemReference: 'p1', metadata: { playerName: 'Player One', position: 'RB' } },
          { id: 'item-2', fromRosterId: 'roster-receiver', toRosterId: 'roster-proposer', itemReference: 'p2', metadata: { playerName: 'Player Two', position: 'WR' } },
        ],
      },
    ])
    findManyRoster.mockResolvedValue([
      { id: 'roster-proposer', platformUserId: 'user-proposer' },
      { id: 'roster-receiver', platformUserId: 'user-receiver' },
    ])
    findManyAppUser.mockResolvedValue([
      { id: 'user-proposer', displayName: 'Proposer FC', username: 'proposer' },
      { id: 'user-receiver', displayName: 'Receiver FC', username: 'receiver' },
    ])

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { activeTrades: Array<Record<string, unknown>>; activeCount: number; source: string }

    expect(body.source).toBe('native')
    expect(body.activeCount).toBe(1)
    expect(body.activeTrades).toHaveLength(1)
    const trade = body.activeTrades[0]
    expect(trade.id).toBe('trade-1')
    expect(trade.status).toBe('pending')
    expect(trade.direction).toBe('incoming')
    expect(trade.viewerIsReceiver).toBe(true)
    expect(trade.viewerIsProposer).toBe(false)
    expect(trade.partnerName).toBe('Proposer FC')
    expect((trade.received as Array<{ label: string }>)[0].label).toBe('Player One')
    expect((trade.sent as Array<{ label: string }>)[0].label).toBe('Player Two')
  })

  it('regression guard: still returns an empty, well-formed response when there are no active trades', async () => {
    listAfLeagueTrades.mockResolvedValue([])

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { activeTrades: unknown[]; activeCount: number; source: string }

    expect(body.source).toBe('native')
    expect(body.activeTrades).toEqual([])
    expect(body.activeCount).toBe(0)
  })

  it('excludes terminal-status trades (processed/rejected/cancelled) from the active list', async () => {
    listAfLeagueTrades.mockResolvedValue([
      {
        id: 'trade-done',
        status: 'processed',
        proposerRosterId: 'roster-proposer',
        receiverRosterId: 'roster-receiver',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        items: [],
      },
    ])
    findManyRoster.mockResolvedValue([])
    findManyAppUser.mockResolvedValue([])

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { activeTrades: unknown[]; activeCount: number }
    expect(body.activeTrades).toEqual([])
    expect(body.activeCount).toBe(0)
  })
})
