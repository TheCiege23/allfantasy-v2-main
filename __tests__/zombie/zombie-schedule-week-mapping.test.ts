// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ games: vi.fn(), fetch: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), ensure: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  sportsGame: { findMany: h.games },
  gameSchedule: { upsert: h.upsert, deleteMany: h.deleteMany },
  $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
} }))
vi.mock('@/lib/workers/api-chain', () => ({ apiChain: { fetch: h.fetch } }))
vi.mock('@/lib/season-week/deriveDailySportSeasonStart', () => ({ ensureDailySportSeasonStart: h.ensure }))

import { resolveImportedGameWeek, runScheduleImporter } from '@/lib/workers/schedule-importer'

beforeEach(() => {
  vi.clearAllMocks()
  h.games.mockResolvedValue([])
  h.upsert.mockResolvedValue({ id: 'stored' })
  h.ensure.mockResolvedValue({ opener: '2026-10-20T00:00:00Z' })
})

describe('provider game to Zombie scoring week', () => {
  it('keeps a verified NFL provider week', () => {
    expect(resolveImportedGameWeek('NFL', 2026, new Date('2026-09-10T20:00:00Z'), 1)).toBe(1)
    expect(resolveImportedGameWeek('NFL', 2026, new Date('2026-09-17T20:00:00Z'), undefined, 2)).toBe(2)
  })

  it.each([
    ['NBA', '2026-10-20T23:00:00Z', '2026-10-27T23:00:00Z'],
    ['NHL', '2026-09-29T23:00:00Z', '2026-10-06T23:00:00Z'],
    ['MLB', '2026-03-25T23:00:00Z', '2026-04-01T23:00:00Z'],
  ])('maps %s games into full seven-day periods', (sport, first, second) => {
    expect(resolveImportedGameWeek(sport, 2026, new Date(first), 500)).toBe(1)
    expect(resolveImportedGameWeek(sport, 2026, new Date(second), 500)).toBe(2)
  })

  it('maps a date-only NBA game without inventing a lineup lock', async () => {
    h.fetch.mockResolvedValue({ data: [{ id: 'nba-1', homeTeam: 'BOS', awayTeam: 'NYK', date: '2026-10-20' }] })
    await runScheduleImporter({ sports: ['NBA'], season: 2026 })
    expect(h.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ weekOrRound: { in: [0, 500] } }),
    }))
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ weekOrRound: 1, startTime: null }),
    }))
  })

  it('does not turn preseason or unknown dates into a playable week', () => {
    expect(resolveImportedGameWeek('NHL', 2026, new Date('2026-09-26T23:00:00Z'), 500)).toBe(0)
    expect(resolveImportedGameWeek('NBA', 2027, new Date('2027-10-20T23:00:00Z'), 500)).toBe(0)
  })
})
