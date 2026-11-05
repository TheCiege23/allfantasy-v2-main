import { describe, expect, it } from 'vitest'
import { splitThreadsByRecency } from '@/components/core-app/comms/threadSections'

/** Huddles split into "This week" and "Earlier" so finished matchup rooms stop burying the live one. */
const NOW = new Date('2026-11-05T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

describe('splitThreadsByRecency', () => {
  it('keeps anything active this week, or unread, in "this week", in the server order', () => {
    const threads = [
      { id: 'a', lastMessageAt: daysAgo(1), unreadCount: 0 },
      { id: 'b', lastMessageAt: daysAgo(20), unreadCount: 2 }, // old but unread
      { id: 'c', lastMessageAt: daysAgo(9), unreadCount: 0 },
      { id: 'd', lastMessageAt: daysAgo(30), unreadCount: 0, context: { lastMessageCreatedAt: daysAgo(3) } },
    ]
    const { recent, earlier } = splitThreadsByRecency(threads, NOW)
    expect(recent.map((t) => t.id)).toEqual(['a', 'b', 'd'])
    expect(earlier.map((t) => t.id)).toEqual(['c'])
  })

  it('files an unparseable date as earlier rather than throwing', () => {
    expect(splitThreadsByRecency([{ id: 'x', lastMessageAt: 'nope', unreadCount: 0 }], NOW).earlier).toHaveLength(1)
  })
})
