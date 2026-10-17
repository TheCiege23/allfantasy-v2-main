// @vitest-environment node
/**
 * The status write is keyed on (sport, externalId, SOURCE). An externalId is only unique per
 * feed — production 2026-10-12: NFL `2135` is a backfill "Josh Allen QB BUF" row AND
 * rolling_insights' Josh Hines-Allen. `updateMany` on the id alone wrote one man's injury
 * status onto both rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const ROWS = [
  { sport: 'NFL', externalId: '2135', source: 'rolling_insights', name: 'Josh Hines-Allen', position: 'DL', team: 'JAX', sleeperId: null, fetchedAt: new Date('2026-10-10T09:15:02Z'), status: null },
  { sport: 'NFL', externalId: '2135', source: 'backfill', name: 'Josh Allen', position: 'QB', team: 'BUF', sleeperId: null, fetchedAt: new Date('2026-04-25T23:49:36Z'), status: null },
  { sport: 'NFL', externalId: '6503', source: 'rolling_insights', name: 'DeVonta Smith', position: 'WR', team: 'PHI', sleeperId: '7525', fetchedAt: new Date('2026-10-10T09:15:02Z'), status: null },
  { sport: 'NFL', externalId: '6503', source: 'backfill', name: 'DeVonta Smith', position: 'WR', team: 'PHI', sleeperId: null, fetchedAt: new Date('2026-04-25T23:49:36Z'), status: null },
]

const m = vi.hoisted(() => ({
  official: vi.fn(),
  sleeper: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/autocoach/AutoCoachEngine', () => ({
  isSwapEligibleStatus: (s: string) => /^out$/i.test(s.trim()),
  normalizeStatusToken: (s: string) => s.toUpperCase().replace(/\s+/g, '_'),
}))
vi.mock('@/lib/autocoach/status-sources/OfficialApiAdapter', () => ({ fetchOfficialStatuses: m.official }))
vi.mock('@/lib/autocoach/status-sources/SleeperStatusAdapter', () => ({ fetchSleeperStatuses: m.sleeper }))
vi.mock('@/lib/autocoach/status-sources/XGrokAdapter', () => ({ searchXForInjuryNews: async () => [] }))
vi.mock('@/lib/autocoach/status-sources/NewsApiAdapter', () => ({ fetchInjuryNewsArticles: async () => [] }))
vi.mock('@/lib/autocoach/status-sources/BleacherReportAdapter', () => ({ fetchBleacherReportInjuries: async () => [] }))

const matches = (row: AnyArgs, where: AnyArgs) =>
  Object.entries(where).every(([k, v]) => (v && typeof v === 'object' ? true : row[k] === v))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: async ({ where }: AnyArgs) => ROWS.filter((r) => matches(r, where)),
      findFirst: async ({ where }: AnyArgs) => ROWS.find((r) => matches(r, where)) ?? null,
      updateMany: m.updateMany,
    },
    playerStatusEvent: { findFirst: async () => null, create: m.eventCreate },
  },
}))

import { aggregatePlayerStatuses } from '@/lib/autocoach/PlayerStatusAggregator'

const official = (playerId: string, playerName: string) => ({ playerId, playerName, sport: 'NFL', status: 'Out', teamAbbrev: null, gameDate: null })

beforeEach(() => {
  vi.clearAllMocks()
  m.sleeper.mockResolvedValue(new Map())
  m.eventCreate.mockImplementation(async () => ({ id: 'ev1' }))
})

describe('aggregatePlayerStatuses — the status write names one row', () => {
  it('refuses an id whose rows are different men rather than writing to both', async () => {
    m.official.mockResolvedValue([official('2135', 'Josh Hines-Allen')])
    const out = await aggregatePlayerStatuses('NFL', '2026-10-12')
    expect(out).toEqual([])
    expect(m.updateMany).not.toHaveBeenCalled()
  })

  it("scopes the write to the resolved row's source when the rows agree", async () => {
    m.official.mockResolvedValue([official('6503', 'DeVonta Smith')])
    await aggregatePlayerStatuses('NFL', '2026-10-12')
    expect(m.updateMany).toHaveBeenCalledTimes(1)
    expect(m.updateMany.mock.calls[0]![0].where).toEqual({ sport: 'NFL', externalId: '6503', source: 'rolling_insights' })
  })
})
