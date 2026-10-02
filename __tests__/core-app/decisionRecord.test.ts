// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  chimmy: vi.fn(),
  autocoach: vi.fn(),
  trades: vi.fn(),
  waivers: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => ({ week: 5 })) }))
vi.mock('@/lib/core-app/decisionReceipts', () => ({
  resolveChimmyAdviceOutcomes: m.chimmy,
  getAutoCoachReceipts: m.autocoach,
  getTradeReceipts: m.trades,
  getWaiverReceipts: m.waivers,
}))

import { getDecisionRecord } from '@/lib/core-app/decisionRecord'

const LEAGUES = [{ id: 'L1', name: 'Alpha', platform: 'sleeper', platformLeagueId: 'sl1', season: 2026 }]
const call = (season: number, followed: 'yes' | 'no' = 'yes') => ({
  id: `L1:${season}:3:a:b`,
  leagueId: 'L1',
  leagueName: 'Alpha',
  season,
  week: 3,
  slot: 'FLEX',
  recommended: { name: 'A', points: 20 },
  instead: { name: 'B', points: 10 },
  followed,
  call: 'right' as const,
  href: '#',
})

beforeEach(() => {
  m.chimmy.mockReset()
  m.autocoach.mockReset()
  // No Sleeper id / no adds: the receipts' own "nothing to read".
  m.trades.mockReset().mockResolvedValue(null)
  m.waivers.mockReset().mockResolvedValue(null)
})

describe('getDecisionRecord — your moves', () => {
  it('reads every trade and add (no five-row cap), this season only, with your Sleeper id', async () => {
    m.chimmy.mockResolvedValue({ advice: [], startSits: [], adds: [] })
    m.autocoach.mockResolvedValue(null)
    const t = (season: string, netPoints: number) => ({ id: `t${season}${netPoints}`, season, netPoints, outcome: 'ahead' })
    m.trades.mockResolvedValue({ trades: [t('2026', 20), t('2025', 99)], tooEarly: 1, uncoveredLeagues: 0 })
    m.waivers.mockResolvedValue({
      waivers: [{ id: 'w1', season: 2026, points: 30, starts: 2 }, { id: 'w0', season: 2025, points: 80, starts: 5 }],
      tooEarly: 0,
      unscored: 0,
    })

    const r = await getDecisionRecord({ userId: 'u1', leagues: LEAGUES, season: 2026, ownerSleeperId: 'sl-u1' })
    expect(m.trades).toHaveBeenCalledWith(expect.objectContaining({ ownerSleeperId: 'sl-u1', limit: Number.POSITIVE_INFINITY }))
    expect(m.waivers).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', limit: Number.POSITIVE_INFINITY }))
    expect(r?.trades).toMatchObject({ called: 1, netPoints: 20, tooEarly: 1 })
    expect(r?.waivers).toMatchObject({ scored: 1, points: 30, starts: 2 })
  })

  it('undefined when the trade or waiver read FAILS — never a record that silently lost a section', async () => {
    m.chimmy.mockResolvedValue({ advice: [], startSits: [call(2026)], adds: [] })
    m.autocoach.mockResolvedValue(null)
    m.trades.mockRejectedValue(new Error('cache down'))
    expect(await getDecisionRecord({ userId: 'u1', leagues: LEAGUES, season: 2026, ownerSleeperId: 'sl-u1' })).toBeUndefined()

    m.trades.mockResolvedValue(null)
    m.waivers.mockRejectedValue(new Error('dw down'))
    expect(await getDecisionRecord({ userId: 'u1', leagues: LEAGUES, season: 2026 })).toBeUndefined()
  })
})

describe('getDecisionRecord', () => {
  it('a record: this season only, through the receipts resolvers with the season window', async () => {
    m.chimmy.mockResolvedValue({ advice: [], startSits: [call(2026), call(2025)], adds: [] })
    m.autocoach.mockResolvedValue({ autocoach: [], pending: 0, unscored: 0, unreadable: 0 })
    const r = await getDecisionRecord({ userId: 'u1', leagues: LEAGUES, season: 2026 })
    expect(r).toMatchObject({ season: 2026, calls: { total: 1 }, followed: { count: 1, netPoints: 10 } })
    expect(m.chimmy).toHaveBeenCalledWith(expect.objectContaining({ since: new Date('2026-08-01T00:00:00Z'), currentWeek: 5 }))
    expect(m.autocoach).toHaveBeenCalledWith(expect.objectContaining({ since: new Date('2026-08-01T00:00:00Z'), limit: Number.POSITIVE_INFINITY }))
  })

  it('null: read fine, nothing resolved — the "start one" card', async () => {
    m.chimmy.mockResolvedValue({ advice: [], startSits: [], adds: [] })
    m.autocoach.mockResolvedValue(null) // no Sleeper leagues / no swaps
    expect(await getDecisionRecord({ userId: 'u1', leagues: LEAGUES, season: 2026 })).toBeNull()
  })

  it('undefined: a read FAILED — no card, never half a record or the "start one" card', async () => {
    m.chimmy.mockResolvedValue({ advice: [], startSits: [call(2026)], adds: [] })
    m.autocoach.mockRejectedValue(new Error('db down'))
    expect(await getDecisionRecord({ userId: 'u1', leagues: LEAGUES, season: 2026 })).toBeUndefined()

    m.chimmy.mockRejectedValue(new Error('db down'))
    m.autocoach.mockResolvedValue({ autocoach: [call(2026)], pending: 0, unscored: 0, unreadable: 0 })
    expect(await getDecisionRecord({ userId: 'u1', leagues: LEAGUES, season: 2026 })).toBeUndefined()
  })
})
