import { beforeEach, describe, it, expect, vi } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
const provider = vi.hoisted(() => ({ fetch: vi.fn(), parse: vi.fn() }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: provider.fetch }))
vi.mock('@/lib/sports-data/riSeasonSchedule', () => ({ parseRiScheduleSeason: provider.parse }))
import { verifySeasonCalendar, seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
beforeEach(() => vi.resetAllMocks())
describe('server schedule verification', () => {
  it.each([{ error: 'no token' }, { notModified: true }, { unsupported: true }])('refuses unavailable provider responses', async flags => {
    provider.fetch.mockResolvedValue({ rows: [], ...flags })
    await expect(verifySeasonCalendar(completeConfig())).rejects.toThrow('fresh season schedule')
  })
  it('blocks malformed rows rather than certifying parser truncation', async () => {
    provider.fetch.mockResolvedValue({ rows: [{}, {}] })
    provider.parse.mockReturnValue([])
    await expect(verifySeasonCalendar(completeConfig())).rejects.toThrow('malformed')
  })
  it('uses a server-derived season and returns stable evidence hashes across check times', async () => {
    const config = completeConfig()
    const games = Array.from({ length: 1200 }, (_, i) => ({ gameId: 'g-' + i, startTime: new Date(Date.parse(config.rules.calendar.periods[i % 24]!.startsAt) + 3600000).toISOString(), seasonType: 'regular', status: 'scheduled', replacedBy: null }))
    provider.fetch.mockResolvedValue({ rows: games })
    provider.parse.mockReturnValue(games)
    const first = await verifySeasonCalendar(config)
    const next = await verifySeasonCalendar(config)
    expect(first.ready).toBe(true)
    expect(first.digest).toBe(next.digest)
    expect(provider.fetch).toHaveBeenCalledWith('schedule_season', { sport: 'NBA', season: 2026, timeoutMs: 15000 })
    config.rules.weights[0]!.points++
    expect((await verifySeasonCalendar(config)).digest).not.toBe(first.digest)
  })
  it('canonicalizes object order but preserves meaningful array order', () => {
    expect(seasonContractHash({ a: 1, b: { c: 2 } })).toBe(seasonContractHash({ b: { c: 2 }, a: 1 }))
    expect(seasonContractHash([1, 2])).not.toBe(seasonContractHash([2, 1]))
  })
})
