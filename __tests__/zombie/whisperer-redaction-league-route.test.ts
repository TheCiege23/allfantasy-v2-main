// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const W_ROSTER = 'roster-w-91'
const W_USER = 'user-whisperer-91'
const W_NAME = 'Quiet Menace'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveWhispererViewer: vi.fn(),
  zombieLeagueFindUnique: vi.fn(),
}))

function teamRow(overrides: Record<string, unknown>) {
  return {
    id: `t-${String(overrides.rosterId)}`,
    status: 'Survivor',
    isWhisperer: false,
    ambushesRemaining: 0,
    ambushesUsed: 0,
    statusHistory: null,
    killedByRosterId: null,
    killedByUserId: null,
    displayName: 'Team',
    fantasyTeamName: null,
    wins: 1,
    losses: 1,
    pointsFor: 100,
    pointsAgainst: 90,
    ...overrides,
  }
}

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: hm.zombieLeagueFindUnique },
    zombieLeagueConfig: { findUnique: vi.fn(async () => null) },
    roster: { findFirst: vi.fn(async () => ({ id: 'roster-3' })) },
    zombieTeamItem: { findMany: vi.fn(async () => []) },
    zombieCommissionerNotification: { findMany: vi.fn(async () => []) },
    zombieInfectionEvent: {
      findMany: vi.fn(async () => [
        {
          id: 'inf-1',
          infectorUserId: W_USER,
          infectorName: W_NAME,
          infectorStatus: 'Whisperer',
          victimUserId: 'user-2',
          victimName: 'Team Two',
          victimPriorStatus: 'Survivor',
          victimNewStatus: 'Zombie',
        },
      ]),
    },
    zombieBashingEvent: { findMany: vi.fn(async () => []) },
    zombieMaulingEvent: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(async () => 'member') }))
vi.mock('@/lib/zombie/ZombieHordeSitOutEngine', () => ({
  getZombieHordeSitOutStateForWeek: vi.fn(async () => ({ pending: [], accepted: [], declined: [], myPending: null })),
}))
vi.mock('@/lib/zombie/setupEngine', () => ({ createZombieLeague: vi.fn() }))
vi.mock('@/lib/sport-scope', () => ({ normalizeToSupportedSport: (s: string) => s }))
vi.mock('@/lib/zombie/zombie-sport-eligibility', () => ({ isZombieEligibleLeagueSport: () => true }))
vi.mock('@/lib/zombie/zombieBackgroundThemes', () => ({ getRandomZombieTheme: () => 'default' }))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.resolveWhispererViewer }))

const IDENTITY = { rosterIds: new Set([W_ROSTER]), userIds: new Set([W_USER]) }

function leagueRow() {
  return {
    id: 'zl-1',
    leagueId: 'league-1',
    currentWeek: 3,
    whispererIsPublic: false,
    teams: [
      teamRow({ rosterId: W_ROSTER, status: 'Whisperer', isWhisperer: true, ambushesRemaining: 2, ambushesUsed: 1, statusHistory: ['Whisperer'], displayName: 'Team Nine', pointsFor: 300 }),
      teamRow({ rosterId: 'roster-2', status: 'Zombie', killedByRosterId: W_ROSTER, killedByUserId: W_USER, displayName: 'Team Two' }),
      teamRow({ rosterId: 'roster-3', status: 'Survivor', displayName: 'Team Three' }),
    ],
    level: null,
    whispererRecord: { id: 'rec-1', userId: W_USER, displayName: W_NAME, ambushesRemaining: 2, isPubliclyRevealed: true },
    paidConfig: null,
    freeRewardConfig: null,
    weeklyResolutions: [],
    announcements: [],
  }
}

async function get() {
  const { GET } = await import('@/app/api/zombie/league/route')
  const res = await GET(new Request('http://localhost/api/zombie/league?leagueId=league-1'))
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('GET /api/zombie/league — Whisperer secrecy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-3' } })
    hm.zombieLeagueFindUnique.mockResolvedValue(leagueRow())
  })

  it('removes every tell of the Whisperer for a member of a secret league', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.text).not.toContain(W_USER)
    expect(res.text).not.toContain(W_NAME)
    expect(res.text).not.toMatch(/"status":"Whisperer"/)
    expect(res.text).not.toContain('"isWhisperer":true')
    expect(res.text).not.toContain(`"killedByRosterId":"${W_ROSTER}"`)
  })

  it('keeps the shape the league home reads and the real counts', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await get()
    expect(res.body.league.whispererRecord).toMatchObject({ ambushesRemaining: 2, isPubliclyRevealed: false, displayName: null })
    expect(res.body.league.counts.whisperer).toBe(1)
    expect(res.body.league.recentInfections[0]).toMatchObject({ infectorStatus: 'Whisperer', infectorName: 'The Whisperer', infectorUserId: null })
  })

  it('shows the Whisperer to a viewer who may see it', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await get()
    expect(res.text).toContain(W_NAME)
    expect(res.text).toMatch(/"status":"Whisperer"/)
  })
})
