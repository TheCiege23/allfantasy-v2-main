import { describe, expect, it, vi } from 'vitest'
import { currentNcaabSeasonYear, makeEspnNcaabRosterSnapshot, storeEspnNcaabRosterSnapshot } from '@/lib/espn/ncaabRosterSnapshot'
const now = new Date('2026-10-30T12:00:00Z')
const athlete = { id: '123', fullName: 'College Player', jersey: '5', position: 'G', headshotUrl: null }
const make = (overrides: Record<string, unknown> = {}) => makeEspnNcaabRosterSnapshot({ seasonYear: 2027, teamId: '150', school: 'Duke', athletes: [athlete], now, ...overrides })
describe('ESPN college basketball roster snapshots', () => {
  it('uses the season ending year across the calendar boundary', () => {
    expect(currentNcaabSeasonYear(now)).toBe(2027)
    expect(currentNcaabSeasonYear(new Date('2027-03-01T00:00:00Z'))).toBe(2027)
  })
  it('keeps the provider ID, team and roster observation together', async () => {
    const snapshot = make()!
    const upsert = vi.fn(async () => ({}))
    await storeEspnNcaabRosterSnapshot({ sportsDataCache: { upsert } } as never, snapshot)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { cacheKey: 'espn:ncaab:roster:2027:150' }, create: expect.objectContaining({ data: snapshot }) }))
  })
  it.each([
    { seasonYear: 2026 }, { seasonYear: null }, { rejectedCount: 1 }, { athletes: [] }, { school: '' }, { teamId: 'bad' },
    { athletes: [athlete, athlete] }, { athletes: [{ ...athlete, id: 'bad' }] },
  ])('rejects incomplete or ambiguous roster evidence %#', (change) => expect(make(change)).toBeNull())
})
