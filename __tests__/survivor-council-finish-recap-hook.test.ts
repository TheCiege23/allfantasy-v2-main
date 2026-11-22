// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ verdict: vi.fn(), resolve: vi.fn(), recap: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/survivor/survivorVoteTallyService', () => ({ publishCouncilVerdictIfComplete: h.verdict }))
vi.mock('@/lib/survivor/survivorEliminationService', () => ({ resolveElimination: h.resolve }))
vi.mock('@/lib/survivor/episodeRecap', () => ({ postSurvivorEpisodeRecap: h.recap }))

import { finishCouncilReadIfComplete } from '@/lib/survivor/survivorCouncilReadFinish'

const resolved = (alreadyResolved: boolean) => ({ ok: true, alreadyResolved, outcome: 'removed_to_waivers', eliminatedUserId: 'u', removedFromChats: 0, pendingRelease: false, pendingExile: false })

beforeEach(() => {
  vi.clearAllMocks()
  h.verdict.mockResolvedValue({ ok: true, complete: true, published: true, isTie: false, eliminatedUserId: 'u' })
  h.recap.mockResolvedValue('posted')
})

describe('finishCouncilReadIfComplete → episode recap', () => {
  it('recaps once, on the call that resolved the elimination', async () => {
    h.resolve.mockResolvedValueOnce(resolved(false)).mockResolvedValueOnce(resolved(true))
    await finishCouncilReadIfComplete('L', 'C1')
    await finishCouncilReadIfComplete('L', 'C1')
    expect(h.recap).toHaveBeenCalledTimes(1)
    expect(h.recap).toHaveBeenCalledWith({ leagueId: 'L', councilId: 'C1', outcome: 'removed_to_waivers' })
  })

  it('a tie or an unfinished read recaps nothing', async () => {
    h.verdict.mockResolvedValueOnce({ ok: true, complete: false })
    await finishCouncilReadIfComplete('L', 'C1')
    h.verdict.mockResolvedValueOnce({ ok: true, complete: true, published: true, isTie: true, eliminatedUserId: null })
    await finishCouncilReadIfComplete('L', 'C1')
    expect(h.recap).not.toHaveBeenCalled()
  })

  it('a failing recap never fails the elimination', async () => {
    h.resolve.mockResolvedValue(resolved(false))
    h.recap.mockRejectedValue(new Error('model down'))
    const r = await finishCouncilReadIfComplete('L', 'C1')
    expect(r).toMatchObject({ ok: true, complete: true, elimination: { ok: true } })
  })
})
