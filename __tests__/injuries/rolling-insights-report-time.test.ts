/**
 * Rolling Insights rows are dated by when their CURRENT report was first seen, not `date_injured`.
 *
 * 🛑 Measured 2026-10-11: 459 of 500 live RI rows read as `stale` because `date` held the day the
 * injury HAPPENED, weeks before today's designation. A stale "Out" is read as last week's news, so
 * Chimmy counted those starters as playing, and a fresh RI "Out" lost the newest-claim comparison
 * to any lagging ESPN row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { upsert, updateMany, findMany, riFetch } = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  riFetch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { upsert, updateMany, findMany } } }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetch }))

import {
  REPORT_SEEN_AT_KEY,
  riReportSeenAt,
  syncRollingInsightsInjuriesToDb,
} from '@/lib/injuries/rollingInsightsInjuries'

const RETURNS = 'Out For Week 6 At Detroit'
const PAYLOAD = {
  data: {
    NFL: [
      {
        team: 'Chicago Bears',
        team_id: 2,
        injuries: [{ injury: 'Ankle', player: 'Rome Odunze', returns: RETURNS, player_id: '8394', date_injured: '2026-9-28' }],
      },
    ],
  },
}

const now = new Date('2026-10-11T18:00:00Z')
const friday = new Date('2026-10-09T20:30:00Z')

describe('riReportSeenAt', () => {
  it('a new report is first seen now — never the injury date', () => {
    expect(riReportSeenAt({ description: RETURNS }, undefined, now)).toEqual(now)
  })

  it('an unchanged report keeps the time it was first seen', () => {
    const prev = { description: RETURNS, date: friday, raw: { [REPORT_SEEN_AT_KEY]: friday.toISOString() } }
    expect(riReportSeenAt({ description: RETURNS }, prev, now)).toEqual(friday)
  })

  it('a changed report is a new report', () => {
    const prev = { description: 'Questionable For Week 6 At Detroit', date: friday, raw: { [REPORT_SEEN_AT_KEY]: friday.toISOString() } }
    expect(riReportSeenAt({ description: RETURNS }, prev, now)).toEqual(now)
  })

  it('a row written before first-seen tracking keeps its stored date rather than inventing "now"', () => {
    const injured = new Date('2026-09-28T00:00:00Z')
    expect(riReportSeenAt({ description: RETURNS }, { description: RETURNS, date: injured, raw: { date_injured: '2026-9-28' } }, now)).toEqual(injured)
  })
})

describe('the sync writes the report time', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    upsert.mockReset().mockResolvedValue({})
    updateMany.mockReset().mockResolvedValue({ count: 0 })
    findMany.mockReset().mockResolvedValue([])
    riFetch.mockReset().mockResolvedValue({ ok: true, payload: PAYLOAD })
  })

  it('stores the first-seen time as `date` and in raw, and keeps date_injured in raw', async () => {
    await syncRollingInsightsInjuriesToDb({ sport: 'NFL' })
    const data = upsert.mock.calls[0][0].create
    expect(data.date).toEqual(now)
    expect(data.raw[REPORT_SEEN_AT_KEY]).toBe(now.toISOString())
    expect(data.raw.date_injured).toBe('2026-9-28')
    vi.useRealTimers()
  })

  it('an unchanged report written on Friday is still dated Friday on Sunday', async () => {
    findMany.mockResolvedValue([{ externalId: '8394', description: RETURNS, date: friday, raw: { [REPORT_SEEN_AT_KEY]: friday.toISOString() } }])
    await syncRollingInsightsInjuriesToDb({ sport: 'NFL' })
    expect(upsert.mock.calls[0][0].update.date).toEqual(friday)
    vi.useRealTimers()
  })
})
