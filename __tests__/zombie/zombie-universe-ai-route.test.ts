// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  access: vi.fn(),
  buildContext: vi.fn(),
  generate: vi.fn(),
  viewer: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    async assertUserHasFeature() {}
  },
  isFeatureGateAccessError: () => false,
}))
vi.mock('@/lib/zombie/zombieUniverseAccess', () => ({ resolveZombieUniverseAccess: hm.access }))
vi.mock('@/lib/zombie/ai/ZombieAIContext', () => ({ buildZombieUniverseAIContext: hm.buildContext }))
vi.mock('@/lib/zombie/ai/ZombieAIService', () => ({ generateZombieUniverseAI: hm.generate }))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.viewer }))
// Modules the overwritten (Whisperer-route) file imports, so the pre-fix run fails on assertions.
vi.mock('@/lib/prisma', () => ({ prisma: { zombieLeague: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: vi.fn() }))
vi.mock('@/lib/zombie/whispererEngine', () => ({ applyAmbush: vi.fn(), selectWhisperer: vi.fn() }))

function context() {
  return {
    universeId: 'uni-1',
    sport: 'NFL',
    standings: [
      { leagueId: 'league-a', rosterId: 'roster-w', levelName: 'Alpha', status: 'Whisperer', totalPoints: 120, winnings: 10, serums: 1, weapons: 0, weekKilled: null },
      { leagueId: 'league-a', rosterId: 'roster-2', levelName: 'Alpha', status: 'Zombie', totalPoints: 88, winnings: 0, serums: 0, weapons: 1, weekKilled: 2 },
    ],
    movementProjections: [{ rosterId: 'roster-2', leagueId: 'league-a', reason: 'relegation', projectedLevelId: 'lvl-2' }],
    rosterDisplayNames: { 'roster-w': 'roster-w', 'roster-2': 'roster-2' },
  }
}

async function post(body: Record<string, unknown> = { type: 'promotion_relegation_outlook' }) {
  const { POST } = await import('@/app/api/zombie-universe/[universeId]/ai/route')
  const req = new Request('http://localhost/api/zombie-universe/uni-1/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await POST(req as never, { params: Promise.resolve({ universeId: 'uni-1' }) })
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('POST /api/zombie-universe/[universeId]/ai', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-member' } })
    hm.access.mockResolvedValue({ exists: true, isOwner: false, isMember: true })
    hm.buildContext.mockImplementation(async () => context())
    hm.generate.mockResolvedValue({ narrative: 'Alpha tier is tightening.', model: 'test-model' })
    hm.viewer.mockResolvedValue({ canSee: false, identity: { rosterIds: new Set(['roster-w']), userIds: new Set() } })
  })

  it('returns the shape ZombieUniverseAIPanel reads', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(typeof res.body.narrative).toBe('string')
    expect(Array.isArray(res.body.deterministic.standings)).toBe(true)
    expect(Array.isArray(res.body.deterministic.movementProjections)).toBe(true)
    expect(typeof res.body.deterministic.rosterDisplayNames).toBe('object')
    for (const row of res.body.deterministic.standings) {
      expect(typeof row.levelName).toBe('string')
      expect(typeof row.rosterId).toBe('string')
      expect(typeof row.status).toBe('string')
      expect(typeof row.totalPoints).toBe('number')
    }
    expect(res.body.deterministic.movementProjections[0]).toMatchObject({ rosterId: 'roster-2', reason: 'relegation' })
    expect(res.body.type).toBe('promotion_relegation_outlook')
  })

  it('keeps a secret league Whisperer out of the model context and the response', async () => {
    const res = await post()
    const modelStandings = hm.generate.mock.calls[0][0].standings
    expect(JSON.stringify(modelStandings)).not.toContain('Whisperer')
    expect(res.text).not.toMatch(/"status":"Whisperer"/)
  })

  it('refuses a user outside the universe before building context', async () => {
    hm.access.mockResolvedValue({ exists: true, isOwner: false, isMember: false })
    const res = await post()
    expect(res.status).toBe(403)
    expect(hm.buildContext).not.toHaveBeenCalled()
  })

  it('rejects an unknown AI type', async () => {
    const res = await post({ type: 'not_a_type' })
    expect(res.status).toBe(400)
    expect(hm.generate).not.toHaveBeenCalled()
  })
})
