import { describe, it, expect } from 'vitest'
import { mergeActivityItems } from '@/lib/activity/merge'
import type { ActivityFeedItem } from '@/lib/activity/types'

function item(partial: Partial<ActivityFeedItem> & { id: string; timestamp: string }): ActivityFeedItem {
  return {
    type: 'message',
    userId: '',
    userName: 'League',
    avatarUrl: null,
    description: partial.id,
    leagueId: null,
    leagueName: null,
    ...partial,
  }
}

describe('mergeActivityItems — cross-source League Buzz aggregation (§8)', () => {
  it('merges multiple sources and sorts newest-first', () => {
    const sleeper = [
      item({ id: 's1', timestamp: '2026-07-10T10:00:00.000Z', source: 'sleeper', type: 'trade' }),
      item({ id: 's2', timestamp: '2026-07-12T10:00:00.000Z', source: 'sleeper', type: 'waiver' }),
    ]
    const native = [item({ id: 'n1', timestamp: '2026-07-11T10:00:00.000Z', source: 'native', type: 'announcement' })]
    const injury = [item({ id: 'i1', timestamp: '2026-07-13T10:00:00.000Z', source: 'injury', type: 'injury' })]

    const merged = mergeActivityItems([sleeper, native, injury], 50)

    expect(merged.map((m) => m.id)).toEqual(['i1', 's2', 'n1', 's1'])
    // Real provenance is preserved (never rewritten/fabricated).
    expect(merged.map((m) => m.source)).toEqual(['injury', 'sleeper', 'native', 'sleeper'])
  })

  it('returns an honest empty feed when every source is empty', () => {
    expect(mergeActivityItems([[], [], []], 50)).toEqual([])
    expect(mergeActivityItems([], 50)).toEqual([])
  })

  it('de-dupes by id so two sources can never double-count the same event', () => {
    const a = [item({ id: 'dup', timestamp: '2026-07-12T10:00:00.000Z', source: 'native' })]
    const b = [item({ id: 'dup', timestamp: '2026-07-12T10:00:00.000Z', source: 'sleeper' })]
    const merged = mergeActivityItems([a, b], 50)
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('native') // first source wins
  })

  it('caps the merged feed at the requested limit (newest kept)', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      item({ id: `m${i}`, timestamp: `2026-07-${String(10 + i).padStart(2, '0')}T10:00:00.000Z` }),
    )
    const merged = mergeActivityItems([many], 3)
    expect(merged).toHaveLength(3)
    // Newest three (m9, m8, m7) survive the cap.
    expect(merged.map((m) => m.id)).toEqual(['m9', 'm8', 'm7'])
  })
})
