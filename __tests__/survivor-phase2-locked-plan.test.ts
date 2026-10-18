// @vitest-environment node
/**
 * A tribe plan the commissioner locked before the draft (handoff §5.4) is what post-draft setup
 * assigns from — commissioner_manual with the plan's mapping — and a plan that no longer fits the
 * cast falls back to the league's default mode instead of blocking Survivor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  assign: vi.fn(),
  status: vi.fn(),
  league: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({
  withSurvivorSetupTransaction: (_id: string, work: (db: unknown) => unknown) => work({ league: { findUnique: m.league } }),
}))
vi.mock('@/lib/survivor/survivorTribeProvisioning', () => ({ assignSurvivorTribes: m.assign, getTribeAssignmentStatus: m.status }))
vi.mock('@/lib/survivor/survivorDraftParticipants', () => ({ prepareSurvivorDraftParticipants: vi.fn() }))
vi.mock('@/lib/survivor/reconcileSurvivorDraftPlan', () => ({ reconcileSurvivorDraftPlan: vi.fn() }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: vi.fn() }))
vi.mock('@/lib/survivor/survivorIdolProvisioning', () => ({ seedSurvivorIdols: vi.fn(), getIdolSeedStatus: vi.fn() }))
vi.mock('@/lib/survivor/survivorAnnouncementService', () => ({ postSurvivorIntroAnnouncement: vi.fn() }))

import { initializeSurvivorPhase2 } from '@/lib/survivor/survivorPhase2Init'

const mapping = { u1: 0, u2: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  // Not a native league, so no draft-session gate: straight to the tribe step.
  m.league.mockResolvedValue({ platform: 'sleeper', settings: { survivorTribePlan: { mode: 'manual', seed: 1, mapping, lockedAt: '2026-10-18T00:00:00Z' } } })
  m.assign.mockResolvedValue({ ok: false, status: 422, code: 'manual_invalid', error: 'nope' })
  m.status.mockResolvedValue({ assigned: false, tribeCount: 0, memberCount: 0 })
})

describe('initializeSurvivorPhase2 + locked tribe plan', () => {
  it('assigns from the locked mapping first, then falls back to the default mode if it no longer fits', async () => {
    await initializeSurvivorPhase2('lg', {})
    expect(m.assign).toHaveBeenCalledTimes(2)
    expect(m.assign.mock.calls[0][1]).toMatchObject({ mode: 'commissioner_manual', manualMapping: mapping })
    expect(m.assign.mock.calls[1][1]).toMatchObject({ manualMapping: null })
    expect(m.assign.mock.calls[1][1].mode).not.toBe('commissioner_manual')
  })

  it('an explicit caller mode still wins over the plan', async () => {
    await initializeSurvivorPhase2('lg', { mode: 'random', seed: 3 })
    expect(m.assign).toHaveBeenCalledTimes(1)
    expect(m.assign.mock.calls[0][1]).toMatchObject({ mode: 'random', manualMapping: null })
  })
})
