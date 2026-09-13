/**
 * `/api/league/trades-panel` → `executedTrades`: the list the commissioner's Reverse control is built on.
 *
 * Before this, executed trades never reached the Trades tab at all — the native branch filtered
 * `AfLeagueTrade` to non-terminal statuses, so a reversal endpoint existed with nothing on screen to point
 * it at. What is pinned: commissioner-only on the SERVER, native write authority only, and the existing
 * `activeTrades` list left exactly as it was.
 *
 * The mocks mirror `__tests__/redraft/trades-panel-native-route.test.ts`, whose census guard documents
 * why every model the route touches has to be present.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const findFirstLeague = vi.fn()
const findFirstRoster = vi.fn()
const findManyRoster = vi.fn()
const findManyAppUser = vi.fn()
const listAfLeagueTrades = vi.fn()
const isElevatedCommissioner = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...a: unknown[]) => findFirstLeague(...a) },
    roster: {
      findFirst: (...a: unknown[]) => findFirstRoster(...a),
      findMany: (...a: unknown[]) => findManyRoster(...a),
    },
    appUser: { findMany: (...a: unknown[]) => findManyAppUser(...a) },
    tradeBlockEntry: { findMany: vi.fn().mockResolvedValue([]) },
    tradeDraft: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn(), upsert: vi.fn() },
    userProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    leagueTeam: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({
  listAfLeagueTrades: (...a: unknown[]) => listAfLeagueTrades(...a),
}))
vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: (...a: unknown[]) => isElevatedCommissioner(...a),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/league/trades-panel/route'

const PROCESSED = {
  id: 't-done',
  status: 'processed',
  proposerRosterId: 'r1',
  receiverRosterId: 'r2',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  processedAt: new Date('2026-09-03T00:00:00Z'),
  items: [
    { id: 'i1', fromRosterId: 'r1', toRosterId: 'r2', itemReference: 'p1', metadata: { playerName: 'CeeDee Lamb' } },
    { id: 'i2', fromRosterId: 'r2', toRosterId: 'r1', itemReference: 'p2', metadata: { playerName: 'Bijan Robinson' } },
  ],
}
const PENDING = { ...PROCESSED, id: 't-open', status: 'pending', processedAt: null }

async function panel(platform = 'manual') {
  findFirstLeague.mockResolvedValue({ id: 'l-1', platform, platformLeagueId: null, name: 'L', sport: 'NFL' })
  const res = await GET(new NextRequest('http://localhost/api/league/trades-panel?leagueId=l-1'))
  return { status: res.status, body: await res.json() }
}

describe('trades-panel executedTrades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: 'u-commish' } })
    findFirstRoster.mockResolvedValue({ id: 'r9' })
    findManyRoster.mockResolvedValue([
      { id: 'r1', platformUserId: 'u1' },
      { id: 'r2', platformUserId: 'u2' },
    ])
    findManyAppUser.mockResolvedValue([
      { id: 'u1', displayName: 'Cold Takes FC', username: 'cold' },
      { id: 'u2', displayName: 'Thunderbolts', username: 'bolts' },
    ])
    listAfLeagueTrades.mockImplementation(async (_l: string, opts?: { status?: string }) =>
      opts?.status === 'processed' ? [PROCESSED] : [PENDING, PROCESSED],
    )
    isElevatedCommissioner.mockResolvedValue(true)
  })

  it('gives a commissioner the executed trades, with both sides named', async () => {
    const { status, body } = await panel()
    expect(status).toBe(200)
    expect(body.executedTrades).toHaveLength(1)
    expect(body.executedTrades[0]).toMatchObject({
      id: 't-done',
      status: 'processed',
      proposerName: 'Cold Takes FC',
      receiverName: 'Thunderbolts',
      executedAt: '2026-09-03T00:00:00.000Z',
      viewerIsCommissioner: true,
    })
    expect(body.executedTrades[0].sent.map((a: { label: string }) => a.label)).toEqual(['CeeDee Lamb'])
    expect(body.executedTrades[0].received.map((a: { label: string }) => a.label)).toEqual(['Bijan Robinson'])
  })

  it('🛑 gives a non-commissioner no executed trades, and does not even ask for them', async () => {
    isElevatedCommissioner.mockResolvedValue(false)
    const { body } = await panel()
    expect(body.executedTrades).toEqual([])
    expect(listAfLeagueTrades.mock.calls.some((c) => c[1]?.status === 'processed')).toBe(false)
  })

  it('leaves activeTrades exactly as it was — a processed trade is not "active"', async () => {
    const { body } = await panel()
    expect(body.activeTrades.map((t: { id: string }) => t.id)).toEqual(['t-open'])
  })

  it('🛑 returns no executed trades on a league AllFantasy does not natively write to', async () => {
    // On an imported (shadow) league the trade happened on the provider; there is nothing to undo here.
    const { body } = await panel('espn')
    expect(body.executedTrades).toEqual([])
  })
})
