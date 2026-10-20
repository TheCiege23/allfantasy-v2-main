import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The weighted lottery as a rookie-draft order: run once per rookie draft, stored and audited, and
 * never consulted for a league that has not chosen it.
 */

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  eligibility: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  run: vi.fn(),
  logAction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.leagueFindUnique } } }))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({ checkDynastyLotteryEligibility: m.eligibility }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: m.getConfig,
  setDraftOrderModeAndLotteryConfig: m.setConfig,
}))
vi.mock('@/lib/draft-lottery/WeightedDraftLotteryEngine', () => ({ runWeightedLottery: m.run }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.logAction }))

import {
  ensureRookieDraftLottery,
  isLotteryResultForNextDraft,
  rookieDraftLotterySeed,
} from '@/lib/draft-lottery/rookieDraftLottery'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG } from '@/lib/draft-lottery/types'

const order = (ids: string[]) => ids.map((rosterId, i) => ({ slot: i + 1, rosterId, displayName: rosterId }))
const result = (ids: string[], runAt: string, seed = 'old') => ({
  lotteryDraws: [],
  fallbackOrder: [],
  slotOrder: order(ids),
  seed,
  runAt,
  configSnapshot: {},
  oddsSnapshot: [],
})

const previousDraftEndedAt = new Date('2026-09-05T03:00:00Z')
const input = { leagueId: 'L1', season: 2027, previousDraftEndedAt, actorUserId: 'system:week-roller' }

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue({ dynastyConfig: { rookiePickOrderMethod: 'weighted_lottery' } })
  m.eligibility.mockResolvedValue({ eligible: true, reason: '', currentSeason: 2026, isStartupLeague: false })
  m.getConfig.mockResolvedValue({ draftOrderMode: 'weighted_lottery', lotteryConfig: { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG }, lotteryLastResult: null })
  m.setConfig.mockResolvedValue(undefined)
  m.logAction.mockResolvedValue({ id: 'a' })
  m.run.mockImplementation(async (_l: string, _c: unknown, seed: string) => result(['R-d', 'R-b', 'R-a', 'R-c'], '2027-05-01T12:00:00.000Z', seed))
})

describe('lottery off: untouched', () => {
  it('a league that has not chosen the lottery gets nothing, and nothing is run or read', async () => {
    m.leagueFindUnique.mockResolvedValue({ dynastyConfig: { rookiePickOrderMethod: 'max_pf' } })
    expect(await ensureRookieDraftLottery(input)).toBeNull()
    expect(m.run).not.toHaveBeenCalled()
    expect(m.getConfig).not.toHaveBeenCalled()
    expect(m.setConfig).not.toHaveBeenCalled()
  })

  it('a startup (year-1) league is refused by the existing guard', async () => {
    m.eligibility.mockResolvedValue({ eligible: false, reason: 'startup', currentSeason: 2026, isStartupLeague: true })
    expect(await ensureRookieDraftLottery(input)).toBeNull()
    expect(m.run).not.toHaveBeenCalled()
  })
})

describe('lottery on', () => {
  it('runs once when there is no draw for this draft, stores it and audits it', async () => {
    const out = await ensureRookieDraftLottery(input)
    expect(out).toEqual({ slotOrder: order(['R-d', 'R-b', 'R-a', 'R-c']), ranNow: true, seed: 'L1:rookie-draft:2027' })
    expect(m.run).toHaveBeenCalledWith('L1', expect.objectContaining({ enabled: true, randomSeed: 'L1:rookie-draft:2027' }), 'L1:rookie-draft:2027')
    expect(m.setConfig).toHaveBeenCalledWith('L1', expect.objectContaining({
      draftOrderMode: 'weighted_lottery',
      lotteryLastSeed: 'L1:rookie-draft:2027',
      lotteryLastResult: expect.objectContaining({ seed: 'L1:rookie-draft:2027' }),
    }))
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'L1',
      actionType: 'draft_lottery_run',
      afterState: expect.objectContaining({ season: 2027, seed: 'L1:rookie-draft:2027' }),
    }))
  })

  it('reuses a draw made after the previous draft finished (the commissioner\'s, or an earlier attempt\'s)', async () => {
    m.getConfig.mockResolvedValue({
      draftOrderMode: 'weighted_lottery',
      lotteryConfig: DEFAULT_WEIGHTED_LOTTERY_CONFIG,
      lotteryLastResult: result(['R-c', 'R-a', 'R-b', 'R-d'], '2027-03-01T00:00:00.000Z', 'commish-seed'),
    })
    const out = await ensureRookieDraftLottery(input)
    expect(out).toEqual({ slotOrder: order(['R-c', 'R-a', 'R-b', 'R-d']), ranNow: false, seed: 'commish-seed' })
    expect(m.run).not.toHaveBeenCalled()
    expect(m.setConfig).not.toHaveBeenCalled()
  })

  it('does NOT reuse last year\'s draw — it was for the draft that has since finished', async () => {
    m.getConfig.mockResolvedValue({
      draftOrderMode: 'weighted_lottery',
      lotteryConfig: DEFAULT_WEIGHTED_LOTTERY_CONFIG,
      lotteryLastResult: result(['R-c', 'R-a', 'R-b', 'R-d'], '2026-08-01T00:00:00.000Z'),
    })
    const out = await ensureRookieDraftLottery(input)
    expect(out?.ranNow).toBe(true)
    expect(m.run).toHaveBeenCalledTimes(1)
  })

  it('an engine with nothing to draw from yields null (the caller falls back to worst-to-first)', async () => {
    m.run.mockResolvedValue(null)
    expect(await ensureRookieDraftLottery(input)).toBeNull()
    expect(m.setConfig).not.toHaveBeenCalled()
  })
})

describe('freshness rule', () => {
  it('is drawn on or after the previous draft ended', () => {
    expect(isLotteryResultForNextDraft(result(['a'], '2026-09-05T03:00:00.000Z'), previousDraftEndedAt)).toBe(true)
    expect(isLotteryResultForNextDraft(result(['a'], '2026-09-05T02:59:59.000Z'), previousDraftEndedAt)).toBe(false)
    expect(isLotteryResultForNextDraft(result(['a'], 'not a date'), previousDraftEndedAt)).toBe(false)
    expect(isLotteryResultForNextDraft(result([], '2027-01-01T00:00:00.000Z'), previousDraftEndedAt)).toBe(false)
    expect(isLotteryResultForNextDraft(null, previousDraftEndedAt)).toBe(false)
  })

  it('the seed names the league and the season it orders', () => {
    expect(rookieDraftLotterySeed('L9', 2028)).toBe('L9:rookie-draft:2028')
  })
})
