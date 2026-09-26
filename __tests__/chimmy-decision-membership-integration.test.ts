import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ membership: vi.fn(), league: vi.fn(), waiver: vi.fn() }))
// Keep the real snapshot loader in the graph so its user/league argument order is exercised.
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league } } }))
vi.mock('@/lib/chimmy/lineupScenarioGrounding', () => ({ buildStartSitScenario: vi.fn(), buildWaiverScenario: h.waiver }))
vi.mock('@/lib/chimmy/tradeScenarioGrounding', () => ({ buildTradeScenario: vi.fn() }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: vi.fn(), singleSwapCall: vi.fn() }))
vi.mock('@/lib/chimmy/tradeTargetVerdict', () => ({ buildTradeTargetVerdict: vi.fn() }))
vi.mock('@/lib/chimmy/tradeFinderGrounding', () => ({ buildTradeFinder: vi.fn(), readTradeFinderPosition: vi.fn() }))

import { prepareChimmyDecisionAnswer } from '@/lib/chimmy/decisionAnswerService'

beforeEach(() => {
  vi.resetAllMocks()
  h.membership.mockImplementation(async (leagueId: string, userId: string) =>
    leagueId === 'league-1' && userId === 'user-1' ? { ok: true } : { ok: false, reason: 'not_member' })
  h.league.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'league-1' ? { id: 'league-1', name: 'My league', sport: 'nfl' } : null)
  h.waiver.mockResolvedValue(null)
})

it('an authorized user reaches the waiver engine through the real snapshot loader', async () => {
  const result = await prepareChimmyDecisionAnswer({ question: 'How much FAAB should I bid?', leagueId: 'league-1', userId: 'user-1' })
  expect(result).toMatchObject({ leagueId: 'league-1', status: 'needs_data', gap: { code: 'decision_inputs_required' } })
  expect(h.membership).toHaveBeenCalledWith('league-1', 'user-1')
  expect(h.waiver).toHaveBeenCalledWith({ message: 'How much FAAB should I bid?', leagueId: 'league-1', userId: 'user-1', engineClaims: null })
})

it('a different user never reaches the snapshot or engine for that league', async () => {
  const result = await prepareChimmyDecisionAnswer({ question: 'How much FAAB should I bid?', leagueId: 'league-1', userId: 'intruder' })
  expect(result).toMatchObject({ leagueId: null, status: 'needs_data', gap: { code: 'league_unavailable' } })
  expect(h.league).not.toHaveBeenCalled()
  expect(h.waiver).not.toHaveBeenCalled()
})
