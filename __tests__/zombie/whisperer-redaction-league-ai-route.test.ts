// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const W_ROSTER = 'roster-w-91'
const W_USER = 'user-whisperer-91'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveWhispererViewer: vi.fn(),
  buildZombieAIContext: vi.fn(),
  generateZombieAI: vi.fn(),
  buildAiCacheKey: vi.fn(),
  getLeagueRole: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    async assertUserHasFeature() {}
  },
  isFeatureGateAccessError: () => false,
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ isZombieLeague: vi.fn(async () => true) }))
vi.mock('@/lib/zombie/ai/ZombieAIContext', () => ({ buildZombieAIContext: hm.buildZombieAIContext }))
vi.mock('@/lib/zombie/ai/ZombieAIService', () => ({
  buildZombieAiCacheContextSummary: (ctx: { whispererRosterId: string | null; statuses: unknown }) => ({
    whispererRosterId: ctx.whispererRosterId,
    statuses: ctx.statuses,
  }),
  generateZombieAI: hm.generateZombieAI,
}))
vi.mock('@/lib/zombie/ZombieHordeSitOutEngine', () => ({
  getZombieHordeSitOutStateForWeek: vi.fn(async () => ({ pending: [], accepted: [], declined: [], myPending: null })),
}))
vi.mock('@/lib/ai-result-cache', () => ({
  buildAiCacheKey: hm.buildAiCacheKey,
  createSmokeAiResult: vi.fn(),
  isAiResultCacheSmokeProviderEnabled: () => false,
  readAiResultCache: vi.fn(async () => null),
  writeAiResultCache: vi.fn(async () => undefined),
}))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.resolveWhispererViewer }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: hm.getLeagueRole }))

const IDENTITY = { rosterIds: new Set([W_ROSTER]), userIds: new Set([W_USER]) }

function context() {
  return {
    leagueId: 'league-1',
    sport: 'NFL',
    week: 3,
    config: { whispererSelection: 'random', infectionLossToWhisperer: true, infectionLossToZombie: true, serumReviveCount: 1, zombieTradeBlocked: true },
    whispererRosterId: W_ROSTER,
    survivors: ['roster-2'],
    zombies: ['roster-3'],
    statuses: [
      { rosterId: W_ROSTER, status: 'Whisperer' },
      { rosterId: 'roster-2', status: 'Survivor' },
      { rosterId: 'roster-3', status: 'Zombie' },
    ],
    movementWatch: [],
    rosterDisplayNames: { [W_ROSTER]: 'Team Nine', 'roster-2': 'Team Two', 'roster-3': 'Team Three' },
    myRosterId: 'roster-2',
    myResources: { serums: 0, weapons: 0, ambush: 0 },
    winningsByRoster: {},
    serumBalanceByRoster: {},
    weaponBalanceByRoster: {},
    chompinBlockCandidates: [],
    collusionFlags: [{ rosterIdA: 'roster-2', rosterIdB: 'roster-3', flagType: 'trade_ring' }],
    dangerousDropFlags: [{ rosterId: 'roster-3', playerId: 'player-9', estimatedValue: 42, threshold: 30 }],
    historicalContext: null,
  }
}

async function post(type = 'weekly_zombie_recap') {
  const { POST } = await import('@/app/api/leagues/[leagueId]/zombie/ai/route')
  const req = new Request('http://localhost/api/leagues/league-1/zombie/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, week: 3 }),
  })
  const res = await POST(req as never, { params: Promise.resolve({ leagueId: 'league-1' }) })
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('POST /api/leagues/[leagueId]/zombie/ai — Whisperer secrecy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-2' } })
    hm.buildZombieAIContext.mockImplementation(async () => context())
    hm.generateZombieAI.mockResolvedValue({ narrative: 'ok', model: 'test-model' })
    hm.buildAiCacheKey.mockImplementation((_feature: string, inputs: unknown) => ({ resultKey: 'k', inputHash: JSON.stringify(inputs) }))
    hm.getLeagueRole.mockResolvedValue('member')
  })

  it('keeps the Whisperer out of the response, the cache key and the model context for a secret-league member', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: false, identity: IDENTITY })
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.body.deterministic.whispererRosterId).toBeNull()
    expect(res.body.deterministic.whispererHidden).toBe(true)
    expect(res.body.deterministic.survivors).toContain(W_ROSTER)

    const modelContext = hm.generateZombieAI.mock.calls[0][0]
    expect(modelContext.whispererRosterId).toBeNull()
    expect(JSON.stringify(modelContext.statuses)).not.toContain('Whisperer')

    const cacheInputs = JSON.stringify(hm.buildAiCacheKey.mock.calls[0][1])
    expect(cacheInputs).not.toContain('Whisperer')
    expect(cacheInputs).not.toContain(`"whispererRosterId":"${W_ROSTER}"`)
  })

  it('gives the model and the response the Whisperer for a viewer who may see it', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await post()
    expect(res.body.deterministic.whispererRosterId).toBe(W_ROSTER)
    expect(hm.generateZombieAI.mock.calls[0][0].whispererRosterId).toBe(W_ROSTER)
  })

  it('keeps collusion and dangerous-drop flags away from a member, in the response and the model context', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.body.deterministic.collusionFlags).toEqual([])
    expect(res.body.deterministic.dangerousDropFlags).toEqual([])
    expect(hm.generateZombieAI.mock.calls[0][0].collusionFlags).toEqual([])
    expect(hm.generateZombieAI.mock.calls[0][0].dangerousDropFlags).toEqual([])
    expect(res.text).not.toContain('trade_ring')
  })

  it('refuses the commissioner review summary to a member before building context', async () => {
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await post('commissioner_review_summary')
    expect(res.status).toBe(403)
    expect(hm.buildZombieAIContext).not.toHaveBeenCalled()
    expect(hm.generateZombieAI).not.toHaveBeenCalled()
  })

  it.each(['commissioner', 'co_commissioner'])('gives the flags and the review summary to a %s', async (role) => {
    hm.getLeagueRole.mockResolvedValue(role)
    hm.resolveWhispererViewer.mockResolvedValue({ canSee: true, identity: IDENTITY })
    const res = await post('commissioner_review_summary')
    expect(res.status).toBe(200)
    expect(res.body.deterministic.collusionFlags).toHaveLength(1)
    expect(hm.generateZombieAI.mock.calls[0][0].dangerousDropFlags).toHaveLength(1)
  })
})
