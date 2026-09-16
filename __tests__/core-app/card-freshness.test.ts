import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { earliestInstant, freshnessStamp, latestInstant, leagueDataFreshness, relativeAge } from '@/lib/core-app/cardFreshness'
import { formatAgo } from '@/lib/core-app/dash34'

// dash34 is imported only for its pure formatter; its database client is never called.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const NOW = new Date('2026-09-16T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('freshnessStamp', () => {
  it('stamps the DATA’s time, labelled relative to now, and never substitutes now for a missing time', () => {
    const stamp = freshnessStamp('League data', ago(7 * 60_000), NOW, { staleRule: 'roster' })
    expect(stamp).toMatchObject({ source: 'League data', label: '7 min ago', stale: false })
    expect(stamp.asOf).toBe(ago(7 * 60_000).toISOString())

    const never = freshnessStamp('League data', null, NOW, { staleRule: 'roster' })
    expect(never).toMatchObject({ asOf: null, label: null, stale: true, missingLabel: 'not read yet' })
  })

  it('warns on an old READ, but not on an old EVENT — last week’s score is not stale data', () => {
    expect(freshnessStamp('League data', ago(5 * 86_400_000), NOW, { staleRule: 'roster' }).stale).toBe(true)
    expect(freshnessStamp('Scores', ago(5 * 86_400_000), NOW).stale).toBe(false)
  })

  it('says "none yet", without a warning, where an absent time means nothing has happened', () => {
    expect(freshnessStamp('Scores', undefined, NOW, { missing: 'none-yet' })).toMatchObject({
      stale: false,
      missingLabel: 'none yet',
    })
  })

  it('treats an unparseable time as absent', () => {
    expect(freshnessStamp('Scores', 'garbage', NOW).asOf).toBeNull()
  })
})

describe('relativeAge / latestInstant', () => {
  it('says an age exactly the way the injury rows beside it do (dash34 formatAgo)', () => {
    const now = NOW.getTime()
    for (const ms of [0, 59_999, 60_000, 30 * 60_000, 3_599_999, 3_600_000, 23 * 3_600_000, 86_400_000, 6 * 86_400_000, 7 * 86_400_000, 34 * 86_400_000, 40 * 86_400_000, 400 * 86_400_000]) {
      expect(relativeAge(now - ms, now), `${ms}ms`).toBe(formatAgo(ms))
    }
  })

  it('reads like a person would say it, and never negative', () => {
    const now = NOW.getTime()
    expect(relativeAge(now - 20_000, now)).toBe('just now')
    expect(relativeAge(now + 60_000, now)).toBe('just now')
    expect(relativeAge(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeAge(now - 2 * 86_400_000, now)).toBe('2d ago')
  })

  it('summarises league data by its OLDEST sync, counting never-synced providers and ignoring natives', () => {
    const out = leagueDataFreshness([
      { platform: 'sleeper', lastSyncedAt: ago(60_000) },
      { platform: 'espn', lastSyncedAt: ago(3 * 86_400_000).toISOString() },
      { platform: 'yahoo', lastSyncedAt: null },
      { platform: 'manual', lastSyncedAt: null },
    ])
    expect(out).toEqual({ oldestAt: ago(3 * 86_400_000).toISOString(), neverSynced: 1, syncable: 3 })
    expect(leagueDataFreshness([{ platform: 'allfantasy', lastSyncedAt: null }])).toEqual({ oldestAt: null, neverSynced: 0, syncable: 0 })
    expect(earliestInstant([ago(5), 'x', ago(50)])?.toISOString()).toBe(ago(50).toISOString())
  })

  it('finds the newest valid instant among mixed input', () => {
    const newest = latestInstant([null, 'nope', ago(60_000).toISOString(), ago(5_000), undefined])
    expect(newest?.toISOString()).toBe(ago(5_000).toISOString())
    expect(latestInstant([null, 'x'])).toBeNull()
  })
})
