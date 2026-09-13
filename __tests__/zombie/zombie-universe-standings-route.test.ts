// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  access: vi.fn(),
  standings: vi.fn(),
  movement: vi.fn(),
  viewer: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/zombie/zombieUniverseAccess', () => ({ resolveZombieUniverseAccess: hm.access }))
vi.mock('@/lib/zombie/ZombieUniverseStandingsService', () => ({ getUniverseStandings: hm.standings }))
vi.mock('@/lib/zombie/ZombieMovementEngine', () => ({ getMovementProjections: hm.movement }))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.viewer }))
// Modules the overwritten (Whisperer-route) file imports, so the pre-fix run fails on assertions.
vi.mock('@/lib/prisma', () => ({ prisma: { zombieLeague: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: vi.fn() }))
vi.mock('@/lib/zombie/whispererEngine', () => ({ applyAmbush: vi.fn(), selectWhisperer: vi.fn() }))

const ROWS = [
  { leagueId: 'league-a', rosterId: 'roster-w', levelId: 'lvl-1', levelName: 'Alpha', status: 'Whisperer', totalPoints: 120.5, pointsPerWeek: [], winnings: 10, serums: 1, weapons: 0, weekKilled: null, killedByRosterId: null },
  { leagueId: 'league-a', rosterId: 'roster-2', levelId: 'lvl-1', levelName: 'Alpha', status: 'Zombie', totalPoints: 88, pointsPerWeek: [], winnings: 0, serums: 0, weapons: 1, weekKilled: 2, killedByRosterId: 'roster-w' },
]
const MOVEMENT = [{ rosterId: 'roster-2', leagueId: 'league-a', currentLevelId: 'lvl-1', projectedLevelId: 'lvl-2', reason: 'relegation' }]
const MEMBER = { exists: true, isOwner: false, isMember: true }

async function get(userId: string | null, query = '?season=2026') {
  hm.getServerSession.mockResolvedValue(userId ? { user: { id: userId } } : null)
  const { GET } = await import('@/app/api/zombie-universe/[universeId]/standings/route')
  const res = await GET(new Request(`http://localhost/api/zombie-universe/uni-1/standings${query}`), {
    params: Promise.resolve({ universeId: 'uni-1' }),
  })
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('GET /api/zombie-universe/[universeId]/standings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.access.mockResolvedValue(MEMBER)
    hm.standings.mockResolvedValue(ROWS)
    hm.movement.mockResolvedValue(MOVEMENT)
    hm.viewer.mockResolvedValue({ canSee: false, identity: { rosterIds: new Set(['roster-w']), userIds: new Set(['user-w']) } })
  })

  it('returns the shape ZombieUniverseStandingsClient reads', async () => {
    const res = await get('user-member')
    expect(res.status).toBe(200)
    expect(hm.standings).toHaveBeenCalledWith('uni-1', 2026)
    expect(Array.isArray(res.body.standings)).toBe(true)
    expect(Array.isArray(res.body.movementProjections)).toBe(true)
    for (const row of res.body.standings) {
      expect(typeof row.leagueId).toBe('string')
      expect(typeof row.rosterId).toBe('string')
      expect(typeof row.levelId).toBe('string')
      expect(typeof row.levelName).toBe('string')
      expect(typeof row.status).toBe('string')
      expect(typeof row.totalPoints).toBe('number')
      expect(typeof row.winnings).toBe('number')
      expect(typeof row.serums).toBe('number')
      expect(typeof row.weapons).toBe('number')
      expect(row).toHaveProperty('weekKilled')
    }
    expect(res.body.movementProjections[0]).toMatchObject({ rosterId: 'roster-2', reason: 'relegation', projectedLevelId: 'lvl-2' })
  })

  it('disguises a secret league Whisperer for a member', async () => {
    const res = await get('user-member')
    expect(res.text).not.toMatch(/"status":"Whisperer"/)
    expect(res.body.standings[1].killedByRosterId).toBeNull()
  })

  it('shows every Whisperer to the universe owner', async () => {
    hm.access.mockResolvedValue({ exists: true, isOwner: true, isMember: true })
    const res = await get('user-owner')
    expect(res.text).toMatch(/"status":"Whisperer"/)
    expect(hm.viewer).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    expect((await get(null)).status).toBe(401)
  })

  it('refuses a user outside the universe', async () => {
    hm.access.mockResolvedValue({ exists: true, isOwner: false, isMember: false })
    const res = await get('user-outsider')
    expect(res.status).toBe(403)
    expect(hm.standings).not.toHaveBeenCalled()
  })

  it('reports an unknown universe', async () => {
    hm.access.mockResolvedValue({ exists: false, isOwner: false, isMember: false })
    expect((await get('user-member')).status).toBe(404)
  })

  it('ignores a malformed season rather than querying with NaN', async () => {
    await get('user-member', '?season=soon')
    expect(hm.standings).toHaveBeenCalledWith('uni-1', undefined)
  })
})
