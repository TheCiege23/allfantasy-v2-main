import { describe, expect, it, vi } from 'vitest'
import { ingestEspnCollegeBoxes } from '@/lib/espn/ingestNcaabCollegeBoxes'
import { EspnBlockedError } from '@/lib/espn/espnNcaabFetch'
const now = new Date('2026-10-30T12:00:00Z')
const box = (eventId: string) => ({ eventId, status: 'final' as const, complete: true, rejected: 0, players: [{ espnId: '2', teamId: '3', didNotPlay: true, stats: null }] })
describe('ESPN college box ingestion', () => {
  it('caches only complete final results, bounded and deduplicated', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const fetchBox = vi.fn(async (id: string) => id === '2' ? { ...box(id), complete: false } : box(id))
    const result = await ingestEspnCollegeBoxes({ sportsDataCache: { upsert } } as any, { eventIds: ['1', '1', '2', 'bad', '3'], deadlineAt: Date.now() + 10000, maxEvents: 2, now, fetchBox })
    expect(result).toMatchObject({ attempted: 2, stored: 1, rejected: 1, blocked: false })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].where.cacheKey).toBe('espn:ncaab:box:1')
  })
  it('stops the entire pass on an ESPN 403', async () => {
    const upsert = vi.fn()
    const fetchBox = vi.fn(async () => { throw new EspnBlockedError('https://example.invalid/a') })
    const result = await ingestEspnCollegeBoxes({ sportsDataCache: { upsert } } as any, { eventIds: ['1', '2'], deadlineAt: Date.now() + 10000, maxEvents: 2, now, fetchBox })
    expect(result).toMatchObject({ attempted: 1, blocked: true, remaining: 1 })
    expect(fetchBox).toHaveBeenCalledTimes(1)
    expect(upsert).not.toHaveBeenCalled()
  })
})

