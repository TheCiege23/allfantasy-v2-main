// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  chimmy: vi.fn(),
  autocoach: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => ({ week: 5 })) }))
vi.mock('@/lib/core-app/decisionReceipts', () => ({
  resolveChimmyAdviceOutcomes: m.chimmy,
  getAutoCoachReceipts: m.autocoach,
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
