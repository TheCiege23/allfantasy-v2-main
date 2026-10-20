// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The older play path (Chimmy "I want to use my idol", the official command service) honours the cutoff too. */
const m = vi.hoisted(() => ({
  idol: { findFirst: vi.fn() },
  council: { findUnique: vi.fn() },
  league: { findUnique: vi.fn() },
  eligible: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { survivorIdol: m.idol, survivorTribalCouncil: m.council, league: m.league } }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg' })) }))
vi.mock('@/lib/survivor/SurvivorAuditLog', () => ({ appendSurvivorAudit: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorCouncilEligibility', () => ({ getEligibleRosterIdsForCouncil: m.eligible }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ applyIdolPowerEffect: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorFinaleEngine', () => ({ getFinaleState: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTribalCouncilService', () => ({ getCouncil: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn() }))

import { applyIdolPower } from '@/lib/survivor/SurvivorIdolRegistry'

beforeEach(() => {
  vi.clearAllMocks()
  m.idol.findFirst.mockResolvedValue({ id: 'i1', rosterId: 'r1', status: 'hidden', powerType: 'protect_self' })
  m.council.findUnique.mockResolvedValue({ id: 'c1', closedAt: null, voteDeadlineAt: new Date(Date.now() + 30 * 60_000) })
  m.eligible.mockResolvedValue(['r1'])
})

describe('legacy idol play honours the commissioner play cutoff', () => {
  it('refuses inside the cutoff before checking anything else about the play', async () => {
    m.league.findUnique.mockResolvedValue({ settings: { idolPlayCutoffHours: 1 } })
    expect(await applyIdolPower('L', 'i1', 'r1', { councilId: 'c1' })).toEqual({ ok: false, error: 'Idols must be played at least 1 hour before votes close.' })
    expect(m.eligible).not.toHaveBeenCalled()
  })
  it('with no cutoff, goes on to the usual checks', async () => {
    m.league.findUnique.mockResolvedValue({ settings: {} })
    // Past the cutoff check the play reaches the effect engine, which this test does not model.
    await applyIdolPower('L', 'i1', 'r1', { councilId: 'c1' }).catch(() => null)
    expect(m.eligible).toHaveBeenCalledWith('c1')
  })
})
