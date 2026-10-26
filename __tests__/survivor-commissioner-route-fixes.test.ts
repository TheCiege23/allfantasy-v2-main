// @vitest-environment node
/**
 * /api/survivor/commissioner: removing a manager clears only the ballots that involve them (it used
 * to wipe every vote in the open council), and an early merge waits for the open council.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    survivorTribalCouncil: { findFirst: vi.fn() },
    survivorVote: { deleteMany: vi.fn() },
    survivorIdol: { updateMany: vi.fn() },
    roster: { findFirst: vi.fn() },
    survivorPlayer: { updateMany: vi.fn() },
    survivorCommissionerAction: { create: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
  },
  advance: vi.fn(),
  recommend: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: async () => undefined }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: h.advance }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/tribeEngine', () => ({ rebalanceTribes: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/redraft/voidPendingTradesForElimination', () => ({ voidPendingRedraftTradesForRoster: vi.fn(async () => undefined) }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: h.recommend }))

import { POST } from '@/app/api/survivor/commissioner/route'

const post = (body: object) => POST(new Request('https://example.test/api/survivor/commissioner', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', ...body }) }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'council-1' })
  h.db.roster.findFirst.mockResolvedValue({ id: 'roster-1' })
  h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 6, activeCouncilId: null, mergeTriggeredAt: null })
  h.recommend.mockResolvedValue({ triggered: false })
})

describe('remove_player', () => {
  it('deletes only the removed manager’s own ballot and ballots naming them, then checks tribe balance', async () => {
    const res = await post({ action: 'remove_player', userId: 'quitter', reason: 'Left' })
    expect(res.status).toBe(200)
    expect(h.db.survivorVote.deleteMany).toHaveBeenCalledWith({ where: { councilId: 'council-1', OR: [{ voterUserId: 'quitter' }, { targetUserId: 'quitter' }] } })
    expect(h.recommend).toHaveBeenCalledWith('L1', 6)
  })
})

describe('force_phase merge', () => {
  it('refuses while a council is open, and once the merge has happened', async () => {
    h.db.survivorGameState.findUnique.mockResolvedValue({ activeCouncilId: 'open', mergeTriggeredAt: null })
    expect((await post({ action: 'force_phase', toPhase: 'merge' })).status).toBe(409)
    h.db.survivorGameState.findUnique.mockResolvedValue({ activeCouncilId: null, mergeTriggeredAt: new Date() })
    expect((await post({ action: 'force_phase', toPhase: 'merge' })).status).toBe(409)
    expect(h.advance).not.toHaveBeenCalled()
  })

  it('starts the merge between councils', async () => {
    h.db.survivorGameState.findUnique.mockResolvedValue({ activeCouncilId: null, mergeTriggeredAt: null })
    expect((await post({ action: 'force_phase', toPhase: 'merge', notes: 'early' })).status).toBe(200)
    expect(h.advance).toHaveBeenCalledWith('L1', 'commissioner', 'commish', { toPhase: 'merge', notes: 'early' })
  })
})
