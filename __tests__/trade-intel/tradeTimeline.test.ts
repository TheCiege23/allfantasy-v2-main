import { describe, expect, it } from 'vitest'
import {
  groupTradeTimelineBySeason,
  tradeSeasonFromIso,
  tradeTimelineSeasons,
} from '@/lib/trade-intel/tradeTimeline'

describe('trade timeline season grouping', () => {
  const rows = [
    { id: 'old', season: '2024', sortKey: 10 },
    { id: 'newer', season: '2026', sortKey: 30 },
    { id: 'newest', season: '2026', sortKey: 40 },
    { id: 'unknown', season: null, sortKey: 50 },
    { id: 'middle', season: '2025', sortKey: 20 },
  ]

  it('lists available years newest first without duplicating them', () => {
    expect(tradeTimelineSeasons(rows)).toEqual(['2026', '2025', '2024'])
  })

  it('groups trades by year, sorts within a year, and puts unknown last', () => {
    const groups = groupTradeTimelineBySeason(rows)
    expect(groups.map((group) => group.season)).toEqual(['2026', '2025', '2024', 'Season unknown'])
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['newest', 'newer'])
  })

  it('derives the season from a valid provider timestamp', () => {
    expect(tradeSeasonFromIso('2025-11-04T19:30:00.000Z')).toBe('2025')
    expect(tradeSeasonFromIso('not-a-date')).toBeNull()
  })
})
