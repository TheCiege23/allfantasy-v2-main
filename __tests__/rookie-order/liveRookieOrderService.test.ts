import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLeagueFindUnique, mockLeagueUpdate, mockLoad, mockEvaluate } = vi.hoisted(() => ({
  mockLeagueFindUnique: vi.fn(),
  mockLeagueUpdate: vi.fn(),
  mockLoad: vi.fn(),
  mockEvaluate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mockLeagueFindUnique, update: mockLeagueUpdate } } }))
vi.mock('@/lib/rookie-order/loadRookieOrderInput', () => ({ loadRookieOrderInput: mockLoad }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = mockEvaluate
  },
}))

import {
  readLiveRookieOrderSettings,
  refreshLiveRookieOrder,
  resolveLiveRookieDraftSlots,
} from '@/lib/rookie-order/liveRookieOrderService'

const t = (id: string, seed: number | null, maxPf: number) => ({
  teamId: id, name: id.toUpperCase(), wins: 7, losses: 7, ties: 0, pointsFor: 1500, maxPf, playoffSeed: seed,
})
const finalSeason = {
  source: 'imported',
  season: 2026,
  input: {
    teams: [t('n1', null, 1300), t('a', 1, 1800), t('b', 2, 1700)],
    regularSeasonComplete: true,
    playoffGames: [{ round: 1, kind: 'championship', teamA: 'a', teamB: 'b', winner: 'b' }],
  },
  rosterIdForTeam: new Map([['n1', 'r-n1'], ['a', 'r-a'], ['b', 'r-b']]),
  notes: [],
}
const liveOn = (extra: Record<string, unknown> = {}) => ({ rookie_draft_order: { mode: 'worst_to_first', live: { enabled: true, enabledForSeason: 2026, ...extra } } })

beforeEach(() => {
  vi.clearAllMocks()
  mockLeagueUpdate.mockResolvedValue({})
})

describe('readLiveRookieOrderSettings', () => {
  it('defaults to the spec defaults and ignores unknown values', () => {
    const s = readLiveRookieOrderSettings({ rookie_draft_order: { live: { config: { nonPlayoff: 'coin_flip' } } } })
    expect(s).toEqual({
      enabled: false,
      config: { nonPlayoff: 'reverse_max_pf', playoff: 'finish_then_seed', withinRound: 'worse_seed' },
      enabledForSeason: null,
      finalOrder: null,
    })
  })
})

describe('refreshLiveRookieOrder', () => {
  it('saves the final order when automation is on and the title game is decided', async () => {
    mockLeagueFindUnique.mockResolvedValue({ userId: 'commish', settings: liveOn() })
    mockLoad.mockResolvedValue(finalSeason)
    mockEvaluate.mockResolvedValue({ allowed: true })

    const view = await refreshLiveRookieOrder('L1')

    expect(view?.result.phase).toBe('final')
    expect(view?.draftSeason).toBe(2027)
    expect(mockLeagueUpdate).toHaveBeenCalledTimes(1)
    const saved = mockLeagueUpdate.mock.calls[0][0].data.settings.rookie_draft_order
    expect(saved.mode).toBe('worst_to_first') // older keys kept
    expect(saved.live.finalOrder.slots.map((s: { rosterId: string }) => s.rosterId)).toEqual(['r-n1', 'r-a', 'r-b'])
  })

  it('keeps running for the season it was turned on in after the plan lapses', async () => {
    mockLeagueFindUnique.mockResolvedValue({ userId: 'commish', settings: liveOn() })
    mockLoad.mockResolvedValue(finalSeason)
    mockEvaluate.mockResolvedValue({ allowed: false })

    const view = await refreshLiveRookieOrder('L1')
    expect(view?.automationActive).toBe(true)
    expect(mockLeagueUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not automate a later season once the plan has lapsed', async () => {
    mockLeagueFindUnique.mockResolvedValue({ userId: 'commish', settings: liveOn({ enabledForSeason: 2025 }) })
    mockLoad.mockResolvedValue(finalSeason)
    mockEvaluate.mockResolvedValue({ allowed: false })

    const view = await refreshLiveRookieOrder('L1')
    expect(view?.automationActive).toBe(false)
    expect(mockLeagueUpdate).not.toHaveBeenCalled()
  })

  it('never saves a preview computed with other settings', async () => {
    mockLeagueFindUnique.mockResolvedValue({ userId: 'commish', settings: liveOn() })
    mockLoad.mockResolvedValue(finalSeason)

    await refreshLiveRookieOrder('L1', { entitled: true, config: { nonPlayoff: 'reverse_record', playoff: 'finish_then_seed', withinRound: 'worse_seed' } })
    expect(mockLeagueUpdate).not.toHaveBeenCalled()
  })
})

describe('resolveLiveRookieDraftSlots', () => {
  const saved = { basedOnSeason: 2026, savedAt: 'x', slots: [{ slot: 1, teamId: 'n1', rosterId: 'r-n1', name: 'N1' }, { slot: 2, teamId: 'a', rosterId: 'r-a', name: 'A' }] }

  it('seats the saved order for the draft after that season', async () => {
    mockLeagueFindUnique.mockResolvedValue({ season: 2027, settings: liveOn({ finalOrder: saved }) })
    expect(await resolveLiveRookieDraftSlots('L1')).toEqual([
      { slot: 1, rosterId: 'r-n1', displayName: 'N1' },
      { slot: 2, rosterId: 'r-a', displayName: 'A' },
    ])
  })

  it('ignores a stale order and an order with an unmatched roster', async () => {
    mockLeagueFindUnique.mockResolvedValue({ season: 2029, settings: liveOn({ finalOrder: saved }) })
    expect(await resolveLiveRookieDraftSlots('L1')).toBeNull()

    const unmatched = { ...saved, slots: [{ slot: 1, teamId: 'n1', rosterId: null, name: 'N1' }] }
    mockLeagueFindUnique.mockResolvedValue({ season: 2027, settings: liveOn({ finalOrder: unmatched }) })
    expect(await resolveLiveRookieDraftSlots('L1')).toBeNull()
  })

  it('does nothing when automation is off', async () => {
    mockLeagueFindUnique.mockResolvedValue({ season: 2027, settings: { rookie_draft_order: { live: { enabled: false, finalOrder: saved } } } })
    expect(await resolveLiveRookieDraftSlots('L1')).toBeNull()
    expect(mockLoad).not.toHaveBeenCalled()
  })
})
