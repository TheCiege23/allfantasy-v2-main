// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ league: vi.fn(), update: vi.fn(), user: vi.fn(), plan: vi.fn(), add: vi.fn(), audit: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const tx = { $queryRaw: vi.fn(), league: { findUnique: h.league, update: h.update } }
  return { prisma: { ...tx, appUser: { findUnique: h.user }, leagueAuditLog: { create: h.audit }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }
})
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: h.plan }))
vi.mock('@/lib/score-adjustments/scoreAdjustmentService', () => ({ addScoreAdjustment: h.add }))

import { applyStatCorrections } from '@/lib/stat-corrections/applyStatCorrections'
import { setExtendedCorrections } from '@/lib/stat-corrections/statCorrectionService'

const review = {
  changes: [{ rosterId: 'H', playerId: 'p', playerName: 'P', position: 'RB', before: 13, after: 9.5, delta: -3.5 }],
  matchups: [{ matchupId: 'M1', home: { rosterId: 'H', before: 100, after: 96.5 }, away: { rosterId: 'A', before: 98, after: 98 }, resultFlipped: true }],
  unchecked: 0,
  fingerprint: 'f',
}
const plainLeague = { leagueVariant: 'redraft', guillotineMode: false, userId: 'owner' }

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ settings: {}, userId: 'owner' })
  h.audit.mockResolvedValue({})
  h.add.mockResolvedValue({ ok: true })
  h.user.mockResolvedValue({ email: 'o@x.test', username: 'o' })
})

describe('applyStatCorrections', () => {
  it('applies the owed change as a score adjustment recorded under the system actor', async () => {
    expect(await applyStatCorrections({ leagueId: 'L', seasonStatus: 'in_season', league: plainLeague, week: 3, review })).toEqual({ applied: 1 })
    expect(h.add).toHaveBeenCalledWith('L', 'owner', { matchupId: 'M1', rosterId: 'H', points: -3.5, reason: 'Stat correction, week 3' }, { systemActor: 'system:stat-corrections' })
    expect(h.audit.mock.calls[0]![0].data).toMatchObject({ actionType: 'stat_correction_applied', userId: null })
  })

  it('refuses an elimination league and a season in the playoffs, writing nothing', async () => {
    expect(await applyStatCorrections({ leagueId: 'L', seasonStatus: 'in_season', league: { ...plainLeague, leagueVariant: 'guillotine' }, week: 3, review })).toEqual({ applied: 0, refused: 'elimination_format' })
    expect(await applyStatCorrections({ leagueId: 'L', seasonStatus: 'playoffs', league: plainLeague, week: 3, review })).toEqual({ applied: 0, refused: 'playoffs' })
    expect(h.add).not.toHaveBeenCalled()
  })
})

describe('setExtendedCorrections', () => {
  it('turning it on needs the owner\'s AF Commissioner', async () => {
    h.plan.mockResolvedValue(false)
    expect(await setExtendedCorrections('L', true)).toMatchObject({ ok: false, status: 402 })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('on with the plan saves the key; off is always allowed and removes it', async () => {
    h.plan.mockResolvedValue(true)
    expect(await setExtendedCorrections('L', true)).toEqual({ ok: true, enabled: true })
    expect(h.update.mock.calls[0]![0].data.settings).toEqual({ stat_corrections_extended: true })
    h.plan.mockResolvedValue(false)
    h.league.mockResolvedValue({ settings: { stat_corrections_extended: true, other: 1 }, userId: 'owner' })
    expect(await setExtendedCorrections('L', false)).toEqual({ ok: true, enabled: false })
    expect(h.update.mock.calls[1]![0].data.settings).toEqual({ other: 1 })
  })
})
