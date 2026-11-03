import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ session: vi.fn(), allowed: vi.fn(), commissioner: vi.fn(), eligible: vi.fn(), tournament: vi.fn(), config: vi.fn(), save: vi.fn(), run: vi.fn(), league: vi.fn(), draft: vi.fn(), update: vi.fn(), audit: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: m.allowed }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: m.commissioner }))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({ checkDynastyLotteryEligibility: m.eligible }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: m.tournament, SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({ getDraftOrderModeAndLotteryConfig: m.config, setDraftOrderModeAndLotteryConfig: m.save }))
vi.mock('@/lib/draft-lottery/WeightedDraftLotteryEngine', () => ({ runWeightedLottery: m.run }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, draftSession: { findFirst: m.draft, update: m.update } } }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.audit }))

import { POST } from '@/app/api/leagues/[leagueId]/draft-lottery/run/route'

const result = { seed: 'seed', runAt: '2026-10-31T12:00:00Z', lotteryDraws: [{ pickSlot: 1, rosterId: 'a', displayName: 'Alpha', originalOrder: 2 }], slotOrder: [{ slot: 1, rosterId: 'a', displayName: 'Alpha' }], oddsSnapshot: [{ rosterId: 'a', oddsPercent: 25, weight: 1 }] }
const request = () => ({ json: async () => ({ confirm: true, seed: 'seed' }) }) as never
const context = { params: Promise.resolve({ leagueId: 'league' }) }

beforeEach(() => {
  vi.resetAllMocks()
  m.session.mockResolvedValue({ user: { id: 'commissioner' } })
  m.allowed.mockResolvedValue(true); m.commissioner.mockResolvedValue(true); m.eligible.mockResolvedValue({ eligible: true }); m.tournament.mockResolvedValue(false)
  m.config.mockResolvedValue({ lotteryConfig: {} }); m.run.mockResolvedValue(result); m.save.mockResolvedValue(undefined)
  m.league.mockResolvedValue({ season: 2026 }); m.draft.mockResolvedValue({ id: 'draft', status: 'pre_draft' }); m.update.mockResolvedValue({}); m.audit.mockResolvedValue({ id: 'audit' })
})

describe('manual weighted lottery history', () => {
  it('records the actual result after saving the order, without inventing a target season', async () => {
    expect((await POST(request(), context)).status).toBe(200)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'league', userId: 'commissioner', actionType: 'draft_lottery_run', afterState: expect.objectContaining({ trigger: 'commissioner', slotOrder: result.slotOrder, oddsSnapshot: result.oddsSnapshot }) }))
    expect(m.audit.mock.calls[0]![0].afterState).not.toHaveProperty('season')
    expect(m.update.mock.invocationCallOrder[0]).toBeLessThan(m.audit.mock.invocationCallOrder[0]!)
  })
  it('does not write a draw for someone without commissioner access', async () => {
    m.commissioner.mockResolvedValue(false)
    expect((await POST(request(), context)).status).toBe(403)
    expect(m.run).not.toHaveBeenCalled()
    expect(m.audit).not.toHaveBeenCalled()
  })
})
