// @vitest-environment node
/**
 * Guards the unread count on /core/notifications.
 *
 * 🛑 THE BUG THIS PINS SHIPPED, AND WAS FOUND IN A SCREENSHOT. The loader reads
 * the newest 60 stored rows (`take: 60`). The screen used to count unread INSIDE
 * that window and print the result as a flat statement — so an account whose
 * newest 60 were read, with older unread rows behind them, was told "Nothing is
 * waiting on you" while the nav badge beside it read 55. The badge was right: it
 * is an uncapped count({ userId, readAt: null }) on the same table.
 *
 * So `unread` must come from a COUNT, never from `rest`. The tell in production
 * was that the "All" chip read exactly 60 — the cap, wearing the appearance of a
 * total.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const findMany = vi.fn()
const count = vi.fn()
const discordFindFirst = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformNotification: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
    discordLeagueChannel: { findFirst: (...a: unknown[]) => discordFindFirst(...a) },
  },
}))

import { getNotificationsCenter } from '@/lib/core-app/notificationsCenter'

/** 60 stored rows, every one already read — the production shape. */
const sixtyAllRead = Array.from({ length: 60 }, (_, i) => ({
  id: `n${i}`,
  type: 'draft',
  title: 'Draft resumed',
  body: 'The draft has resumed.',
  severity: 'info',
  createdAt: new Date('2026-06-24T00:00:00Z'),
  readAt: new Date('2026-06-25T00:00:00Z'),
  leagueId: null,
  league: null,
}))

const NOW = new Date('2026-08-31T00:00:00Z')

describe('getNotificationsCenter unread total', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discordFindFirst.mockResolvedValue(null)
  })

  it('reports unread from the database, not from the 60-row window', async () => {
    findMany.mockResolvedValue(sixtyAllRead)
    count.mockResolvedValueOnce(55).mockResolvedValueOnce(215)

    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: NOW })

    // The window says zero unread. The account says 55. The screen used to print
    // the window's answer, which is the entire defect.
    expect(data.rest.filter((r) => !r.read)).toHaveLength(0)
    expect(data.unread).toBe(55)
  })

  it('reports how many rows exist beyond the window, so the page can say so', async () => {
    findMany.mockResolvedValue(sixtyAllRead)
    count.mockResolvedValueOnce(55).mockResolvedValueOnce(215)

    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: NOW })

    expect(data.listed).toBe(60)
    expect(data.olderNotListed).toBe(155)
  })

  it('reports nothing truncated when the account fits inside the window', async () => {
    findMany.mockResolvedValue(sixtyAllRead.slice(0, 3))
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(3)

    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: NOW })

    expect(data.olderNotListed).toBe(0)
    expect(data.unread).toBe(0)
  })

  it('falls back to the windowed figure rather than 0 when the count fails', async () => {
    findMany.mockResolvedValue([{ ...sixtyAllRead[0], readAt: null }, ...sixtyAllRead.slice(1)])
    // A failed count must not be reported as "nothing is waiting" — that is the
    // exact false statement being fixed. Too low still beats confidently wrong.
    count.mockRejectedValue(new Error('db down'))

    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: NOW })

    expect(data.unread).toBe(1)
  })

  it('scopes the count to the league when the feed is scoped', async () => {
    findMany.mockResolvedValue([])
    count.mockResolvedValue(0)

    await getNotificationsCenter({ userId: 'u1', issues: [], now: NOW, leagueId: 'L1' })

    // An unscoped count under a scoped feed would print the whole account's
    // unread beneath one league's rows — the same mismatch, moved.
    expect(count.mock.calls.length).toBeGreaterThan(0)
    for (const call of count.mock.calls) {
      expect((call[0] as { where: { leagueId?: string } }).where.leagueId).toBe('L1')
    }
  })
})
