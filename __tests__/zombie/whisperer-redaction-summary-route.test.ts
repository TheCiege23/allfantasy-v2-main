// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const W_ROSTER = 'roster-w-91'
const W_USER = 'user-whisperer-91'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveWhispererViewer: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => 'roster-2'),
}))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({
  isZombieLeague: vi.fn(async () => true),
  getZombieLeagueConfig: vi.fn(async () => ({
    whispererSelection: 'random',
    infectionLossToWhisperer: true,
    infectionLossToZombie: true,
    serumReviveCount: 1,
    zombieTradeBlocked: true,
  })),
}))
vi.mock('@/lib/zombie/ZombieOwnerStatusService', () => ({
  getWhispererRosterId: vi.fn(async () => W_ROSTER),
  getAllStatuses: vi.fn(async () => [
    { rosterId: W_ROSTER, status: 'Whisperer' },
    { rosterId: 'roster-2', status: 'Survivor' },
    { rosterId: 'roster-3', status: 'Zombie' },
  ]),
}))
vi.mock('@/lib/zombie/ZombieWeeklyBoardService', () => ({
  getWeeklyBoardData: vi.fn(async () => ({ survivors: ['roster-2'], zombies: ['roster-3'], movementWatch: [] })),
}))
vi.mock('@/lib/zombie/ZombieSerumEngine', () => ({ getSerumBalance: vi.fn(async () => 0) }))
vi.mock('@/lib/zombie/ZombieAmbushEngine', () => ({ getAmbushBalance: vi.fn(async () => 0) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ zombieLeague: { universeId: null } })) },
    roster: { findMany: vi.fn(async () => [{ id: W_ROSTER }, { id: 'roster-2' }, { id: 'roster-3' }]) },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { id: 'lt-1', teamName: 'Team Nine', ownerName: null },
        { id: 'lt-2', teamName: 'Team Two', ownerName: null },
        { id: 'lt-3', teamName: 'Team Three', ownerName: null },
      ]),
    },
    zombieResourceLedger: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.resolveWhispererViewer }))

const IDENTITY = { rosterIds: new Set([W_ROSTER]), userIds: new Set([W_USER]) }

async function get() {
  const { GET } = await import('@/app/api/leagues/[leagueId]/zombie/summary/route')
  const res = await GET(new Request('http://localhost/api/leagues/league-1/zombie/summary?week=3'), {
    params: Promise.resolve({ leagueId: 'league-1' }),
  })
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('GET /api/leagues/[leagueId]/zombie/summary — Whisperer secrecy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-2' } })
  })

  it('does not identify the Whisperer to a member of a secret league, by id, status or elimination', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.whispererRosterId).toBeNull()
    expect(res.body.whispererHidden).toBe(true)
    expect(res.text).not.toMatch(/"status":"Whisperer"/)
    expect(res.body.survivors).toContain(W_ROSTER)
    expect(res.body.zombies).not.toContain(W_ROSTER)
  })

  it('names the Whisperer to a viewer who may see it', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await get()
    expect(res.body.whispererRosterId).toBe(W_ROSTER)
    expect(res.body.whispererHidden).toBe(false)
  })
})
