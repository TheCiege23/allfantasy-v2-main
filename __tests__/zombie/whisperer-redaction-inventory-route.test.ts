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
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: vi.fn(async () => ({ id: 'zl-1', sport: 'NFL', currentWeek: 3, isPaid: false })) },
    roster: { findFirst: vi.fn(async () => ({ id: 'roster-2' })) },
    zombieLeagueTeam: { findUnique: vi.fn(async () => ({ status: 'Survivor', items: [] })) },
    zombieWeeklyResolution: { findUnique: vi.fn(async () => null) },
    zombieChimmyAction: { findMany: vi.fn(async () => []) },
    whispererRecord: { findUnique: vi.fn(async () => ({ userId: W_USER, ambushesRemaining: 2 })) },
    zombieBashingEvent: { findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: vi.fn() }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: vi.fn(async () => ({})) }))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.resolveWhispererViewer }))

const IDENTITY = { rosterIds: new Set([W_ROSTER]), userIds: new Set([W_USER]) }

async function get() {
  const { GET } = await import('@/app/api/zombie/inventory/route')
  const res = await GET(new Request('http://localhost/api/zombie/inventory?leagueId=league-1'))
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('GET /api/zombie/inventory — Whisperer secrecy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-2' } })
  })

  it('does not tell a member of a secret league who the Whisperer is', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.whispererUserId).toBeNull()
    expect(res.body.isWhisperer).toBe(false)
    expect(res.text).not.toContain(W_USER)
  })

  it('names the Whisperer to a viewer who may see it', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await get()
    expect(res.body.whispererUserId).toBe(W_USER)
  })
})
