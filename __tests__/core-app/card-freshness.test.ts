import { describe, expect, it } from 'vitest'
import { freshnessStamp, latestInstant, relativeAge } from '@/lib/core-app/cardFreshness'

const NOW = new Date('2026-09-16T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('freshnessStamp', () => {
  it('stamps the DATA’s time, labelled relative to now, and never substitutes now for a missing time', () => {
    const stamp = freshnessStamp('League data', ago(7 * 60_000), NOW, { staleRule: 'roster' })
    expect(stamp).toMatchObject({ source: 'League data', label: '7m ago', stale: false })
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
  it('reads like a person would say it, and never negative', () => {
    const now = NOW.getTime()
    expect(relativeAge(now - 20_000, now)).toBe('just now')
    expect(relativeAge(now + 60_000, now)).toBe('just now')
    expect(relativeAge(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeAge(now - 2 * 86_400_000, now)).toBe('2d ago')
  })

  it('finds the newest valid instant among mixed input', () => {
    const newest = latestInstant([null, 'nope', ago(60_000).toISOString(), ago(5_000), undefined])
    expect(newest?.toISOString()).toBe(ago(5_000).toISOString())
    expect(latestInstant([null, 'x'])).toBeNull()
  })
})
