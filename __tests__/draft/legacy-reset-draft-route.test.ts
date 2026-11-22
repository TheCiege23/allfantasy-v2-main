// @vitest-environment node
/**
 * /api/league/settings/reset-draft (the settings tab's Reset Draft), 2026-11-15.
 *
 * 🛑 It deleted picks on its own — a completed draft's too — without returning auction budgets, removing NBA college
 * rights, archiving the board or moving the league back. It now resets through resetDraftSession and logs it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  settingsFind: vi.fn(async () => null),
  settingsUpsert: vi.fn(async () => ({})),
  resetDraftSession: vi.fn(),
  logAction: vi.fn(async () => ({ id: 'a' })),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: async () => undefined }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: h.findFirst, update: vi.fn() },
    draftPick: { deleteMany: h.deleteMany },
    leagueSettings: { findUnique: h.settingsFind, upsert: h.settingsUpsert },
  },
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ resetDraftSession: h.resetDraftSession }))
vi.mock('@/server/services/auditService', () => ({ logAction: h.logAction }))

import { POST } from '@/app/api/league/settings/reset-draft/route'

const call = () =>
  POST(new Request('http://x/api/league/settings/reset-draft', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', confirmText: 'RESET DRAFT' }) }) as never)

beforeEach(() => vi.clearAllMocks())

describe('resetting from the settings tab', () => {
  it('resets through resetDraftSession, logs it for the league, and keeps the reset history', async () => {
    h.findFirst.mockResolvedValue({ id: 's1', status: 'in_progress', _count: { picks: 30 } })
    h.resetDraftSession.mockResolvedValue(true)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, clearedPicks: 30 })
    expect(h.resetDraftSession).toHaveBeenCalledWith('L1')
    expect(h.deleteMany).not.toHaveBeenCalled()
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', userId: 'commish', actionType: 'draft_reset' }))
    expect(h.settingsUpsert).toHaveBeenCalled()
  })

  it('REGRESSION: a completed draft is refused, and nothing is deleted', async () => {
    h.findFirst.mockResolvedValue({ id: 's1', status: 'completed', _count: { picks: 180 } })
    const res = await call()
    expect(res.status).toBe(409)
    expect(h.resetDraftSession).not.toHaveBeenCalled()
    expect(h.deleteMany).not.toHaveBeenCalled()
    expect(h.settingsUpsert).not.toHaveBeenCalled()
  })

  it('a reset the engine refuses (a tournament draft) is reported, not recorded', async () => {
    h.findFirst.mockResolvedValue({ id: 's1', status: 'pre_draft', _count: { picks: 0 } })
    h.resetDraftSession.mockResolvedValue(false)
    expect((await call()).status).toBe(409)
    expect(h.logAction).not.toHaveBeenCalled()
  })
})
