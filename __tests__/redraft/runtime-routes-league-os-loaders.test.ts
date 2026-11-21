import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * League OS Kernel axis (2026-11-21 code re-score): the trade, waiver and live-scoring screens' GET routes read the
 * league ruleset through League OS — they hand the resolver League OS's `loadRules` and report League OS's outcomes.
 */

const h = vi.hoisted(() => {
  const loadRules = vi.fn()
  const outcomes = [{ key: 'league-1', outcome: 'hit' }]
  return {
    loadRules,
    outcomes,
    createLeagueOsLoaders: vi.fn(() => ({ loadRules, drainOutcomes: () => outcomes })),
    emitFeedOutcomes: vi.fn(),
    trade: vi.fn(async () => ({ ok: true, state: {} })),
    waiver: vi.fn(async () => ({ ok: true, state: { claims: [], transactions: [], rosters: [] } })),
    scoring: vi.fn(async () => ({ ok: true, state: {} })),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: vi.fn(async () => ({ ok: true })),
  assertLeagueCommissioner: vi.fn(async () => ({ ok: false, status: 403 })),
}))
vi.mock('@/lib/decision-os/league-os', () => ({ createLeagueOsLoaders: h.createLeagueOsLoaders }))
vi.mock('@/lib/decision-os/core/parity', () => ({ emitFeedOutcomes: h.emitFeedOutcomes }))
vi.mock('@/lib/trade-runtime', () => ({
  resolveNflRedraftTradeRuntime: h.trade,
  createNflRedraftTradeProposal: vi.fn(),
  actOnNflRedraftTradeProposal: vi.fn(),
  castNflRedraftTradeVote: vi.fn(),
}))
vi.mock('@/lib/waiver-runtime', () => ({
  resolveNflRedraftWaiverRuntime: h.waiver,
  processNflRedraftWaiverWindow: vi.fn(),
  submitNflRedraftWaiverClaim: vi.fn(),
  editNflRedraftWaiverClaim: vi.fn(),
  cancelNflRedraftWaiverClaim: vi.fn(),
  addNflRedraftFreeAgent: vi.fn(),
}))
vi.mock('@/lib/scoring-runtime', () => ({
  resolveNflRedraftLiveScoringRuntime: h.scoring,
  ingestNflRedraftStatPayload: vi.fn(),
  applyNflRedraftStatCorrectionToSeason: vi.fn(),
  persistNflRedraftLiveScoringWeek: vi.fn(),
}))

const routes = [
  ['trade-runtime', () => import('@/app/api/redraft/trade-runtime/route'), h.trade],
  ['waiver-runtime', () => import('@/app/api/redraft/waiver-runtime/route'), h.waiver],
  ['live-scoring', () => import('@/app/api/redraft/live-scoring/route'), h.scoring],
] as const

beforeEach(() => {
  h.emitFeedOutcomes.mockClear()
  h.createLeagueOsLoaders.mockClear()
})

describe.each(routes)('GET /api/redraft/%s', (name, load, resolver) => {
  it('hands the resolver League OS\'s loader and reports League OS\'s outcomes', async () => {
    const { GET } = await load()
    const res = await GET(createMockNextRequest(`http://localhost/api/redraft/${name}?leagueId=league-1`) as never)
    expect(res.status).toBe(200)
    expect(h.createLeagueOsLoaders).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenLastCalledWith(expect.objectContaining({ leagueId: 'league-1' }), { loadRules: h.loadRules })
    expect(h.emitFeedOutcomes).toHaveBeenCalledWith('league', h.outcomes)
  })
})
