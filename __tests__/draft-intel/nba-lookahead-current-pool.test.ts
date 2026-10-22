// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ pool: vi.fn(), generic: vi.fn(), snapshot: vi.fn(), recommend: vi.fn(), seen: vi.fn(), warm: vi.fn() }))
vi.mock('@/lib/agents/anthropic-pipeline', () => ({ isAnthropicPipelineAvailable: () => false, runDraftLookaheadAgent: vi.fn() }))
vi.mock('@/lib/draft-room', () => ({ getRosterSlotLabelsForLeagueDraft: async () => ['UTIL', 'UTIL'] }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ getWarmDraftPoolSnapshotFast: h.warm }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: h.pool }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: h.generic }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: async () => 'r1' }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: h.snapshot }))
vi.mock('@/lib/post-draft', () => ({ buildDeterministicPostDraftRecap: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: async () => ({ id: 'nba', sport: 'NBA', name: 'NBA Redraft', isDynasty: false }) } } }))
vi.mock('@/lib/draft-helper/RecommendationEngine', () => ({ computeDraftRecommendation: h.recommend }))
import { generateDraftIntelStateForUser } from '@/lib/draft-intelligence/DraftLookaheadService'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DRAFT_INTEL_AI_ENABLED', 'false')
  h.warm.mockResolvedValue({ warm: false })
  h.recommend.mockImplementation(({ available }: any) => { h.seen(available.map((p: any) => ({ name: p.name, adp: p.adp }))); return { recommendation: available[0] ? { player: available[0], reason: 'Verified pool choice' } : null } })
  h.snapshot.mockResolvedValue({ id: 'draft', status: 'pre_draft', currentPick: { overall: 1 }, teamCount: 2, rounds: 2,
    draftType: 'snake', thirdRoundReversal: false, picks: [], tradedPicks: [],
    slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'Owner' }, { slot: 2, rosterId: 'r2', displayName: 'Friend' }],
  })
  h.pool.mockResolvedValue({ entries: [
    { name: 'Nikola Jokic', position: 'C', team: 'DEN', playerId: '114', adp: 1.34 },
    { name: 'Bam Adebayo', position: 'C', team: 'MIA', playerId: '115', adp: null },
  ] })
  h.generic.mockResolvedValue([{ full_name: 'A.J. Hammons', position: 'C', external_source_id: '563' }])
})
afterEach(() => vi.unstubAllEnvs())
describe('NBA draft intel consumes the same pool as the live board', () => {
  it('uses verified names and real ADP without calling the historical generic pool', async () => {
    const state = await generateDraftIntelStateForUser({ leagueId: 'nba', userId: 'owner', trigger: 'manual' })
    expect(h.pool).toHaveBeenCalledWith('nba', { limit: 500 })
    expect(h.generic).not.toHaveBeenCalled()
    expect(state?.queue.map(p => p.playerName)).toEqual(['Nikola Jokic', 'Bam Adebayo'])
    expect(h.seen.mock.calls[0][0][0].adp).toBe(1.34)
    expect(h.seen.mock.calls[0][0][1].adp).toBeNull()
  })
  it('does not tell the first manager they are on the clock before the commissioner starts', async () => {
    const state = await generateDraftIntelStateForUser({ leagueId: 'nba', userId: 'owner', trigger: 'manual' })
    expect(state?.status).toBe('active')
    expect(state?.headline).not.toMatch(/on the clock/i)

  })
  it('does not show an on-clock prompt while the draft is paused', async () => {
    h.snapshot.mockResolvedValue({ ...(await h.snapshot()), status: 'paused' })
    const state = await generateDraftIntelStateForUser({ leagueId: 'nba', userId: 'owner', trigger: 'manual' })
    expect(state?.status).toBe('active')
    expect(state?.headline).toMatch(/paused/i)
  })
  it('still reports on-clock after the draft starts', async () => {
    h.snapshot.mockResolvedValue({ ...(await h.snapshot()), status: 'in_progress' })
    expect((await generateDraftIntelStateForUser({ leagueId: 'nba', userId: 'owner', trigger: 'manual' }))?.status).toBe('on_clock')
  })
  it('reuses the live board snapshot instead of rebuilding it for each intelligence refresh', async () => {
    h.warm.mockResolvedValue({ warm: true, payload: { sport: 'NBA', entries: (await h.pool()).entries } })
    h.pool.mockClear()
    const state = await generateDraftIntelStateForUser({ leagueId: 'nba', userId: 'owner', trigger: 'manual' })
    expect(state?.queue[0].playerName).toBe('Nikola Jokic')
    expect(h.pool).not.toHaveBeenCalled()
    expect(h.generic).not.toHaveBeenCalled()
  })
  it('does not fall back to retired profiles when canonical readiness fails', async () => {
    h.pool.mockRejectedValue(new Error('Current NBA roster unavailable'))
    await expect(generateDraftIntelStateForUser({ leagueId: 'nba', userId: 'owner', trigger: 'manual' })).rejects.toThrow('Current NBA roster unavailable')
    expect(h.generic).not.toHaveBeenCalled()
  })
})
