// @vitest-environment node
/**
 * Muting from a Core notification row (user decision, 2026-09-14).
 *
 * 🛑 THE SAVE MUST TOUCH ONE LEAGUE AND NOTHING ELSE. The profile route merges
 * notificationPreferences one level deep, so the patch is `{ leagues: { [id]: entry } }`.
 * These tests drive the real edit through the REAL server merge and read the result back
 * through the REAL resolver and league rule, because a hand-built expectation proves only
 * that the test agrees with itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { categoryFromMeta, rowMuteEdit } from '@/lib/core-app/notificationMutes'
import { getNotificationsCenter } from '@/lib/core-app/notificationsCenter'
import { mergeNotificationPreferences } from '@/lib/notification-settings/mergeNotificationPreferences'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import type { NotificationPreferences } from '@/lib/notification-settings/types'

const allowed = (stored: Record<string, unknown>, category: 'injury_alerts' | 'trade_proposals', leagueId: string) =>
  isCategoryAllowedForLeague(
    resolveNotificationPreferences(stored as NotificationPreferences),
    category,
    leagueId,
  )

describe('categoryFromMeta', () => {
  it('reads the category the dispatcher stamped', () => {
    expect(categoryFromMeta({ notificationCategory: 'trade_proposals', leagueId: 'L1' })).toBe('trade_proposals')
  })

  it('refuses anything that is not a real category, so no row offers a mute that does nothing', () => {
    expect(categoryFromMeta({ notificationCategory: 'WAIVER_CLAIM_WON' })).toBeNull()
    expect(categoryFromMeta({})).toBeNull()
    expect(categoryFromMeta(null)).toBeNull()
    expect(categoryFromMeta(['trade_proposals'])).toBeNull()
  })
})

describe('rowMuteEdit builds a one-league patch and its exact undo', () => {
  const saved: NotificationPreferences = {
    leagues: { L1: { mutedCategories: ['chat_mentions'] }, L2: { enabled: false } },
  }

  it('muting a category keeps that league’s other mutes and names no other league', () => {
    const { patch, undo } = rowMuteEdit(saved, 'L1', { kind: 'category', category: 'injury_alerts' })
    expect(Object.keys(patch.leagues)).toEqual(['L1'])
    expect(patch.leagues.L1.mutedCategories?.sort()).toEqual(['chat_mentions', 'injury_alerts'])
    expect(undo).toEqual({ leagues: { L1: { mutedCategories: ['chat_mentions'] } } })
  })

  it('muting the league keeps its category mutes, so an undo of a later unmute is not lossy', () => {
    const { patch } = rowMuteEdit(saved, 'L1', { kind: 'league' })
    expect(patch).toEqual({ leagues: { L1: { mutedCategories: ['chat_mentions'], enabled: false } } })
  })

  it('🛑 undo of a league with no prior entry is {} (follow global), never a deleted key', () => {
    const { undo } = rowMuteEdit(null, 'L9', { kind: 'league' })
    expect(undo).toEqual({ leagues: { L9: {} } })
  })
})

describe('🛑 through the real merge: one league changes, everything else survives', () => {
  const stored: Record<string, unknown> = {
    globalEnabled: true,
    categories: { injury_alerts: { enabled: true, inApp: true, email: true, sms: false } },
    quietHours: { startHour: 22, endHour: 7, enabled: true },
    leagues: { L1: {}, L2: { enabled: false } },
    // A key another feature keeps in the same column.
    dashboardToggles: { showRail: true },
  }

  it('mutes the category for that league only, then undo restores it', () => {
    const { patch, undo } = rowMuteEdit(stored as NotificationPreferences, 'L1', {
      kind: 'category',
      category: 'injury_alerts',
    })
    const muted = mergeNotificationPreferences(stored, patch)

    expect(allowed(muted, 'injury_alerts', 'L1')).toBe(false)
    expect(allowed(muted, 'trade_proposals', 'L1')).toBe(true)
    expect(allowed(muted, 'injury_alerts', 'L3')).toBe(true)
    // Untouched: the other league's mute, the category switches, quiet hours, other features.
    expect((muted.leagues as Record<string, unknown>).L2).toEqual({ enabled: false })
    expect(muted.categories).toEqual(stored.categories)
    expect(muted.quietHours).toEqual(stored.quietHours)
    expect(muted.dashboardToggles).toEqual({ showRail: true })

    const restored = mergeNotificationPreferences(muted, undo)
    expect(allowed(restored, 'injury_alerts', 'L1')).toBe(true)
    expect((restored.leagues as Record<string, unknown>).L2).toEqual({ enabled: false })
  })

  it('mutes a whole league and undo gives it back', () => {
    const { patch, undo } = rowMuteEdit(stored as NotificationPreferences, 'L1', { kind: 'league' })
    const muted = mergeNotificationPreferences(stored, patch)
    expect(allowed(muted, 'trade_proposals', 'L1')).toBe(false)
    expect(allowed(muted, 'trade_proposals', 'L3')).toBe(true)
    expect(allowed(mergeNotificationPreferences(muted, undo), 'trade_proposals', 'L1')).toBe(true)
  })
})

describe('the loader gives each stored row its category', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discordFindFirst.mockResolvedValue(null)
    count.mockResolvedValue(0)
  })

  const row = (over: Record<string, unknown>) => ({
    id: 'n1',
    type: 'trade_offer',
    title: 'Trade offer',
    body: 'An offer is waiting.',
    severity: 'medium',
    createdAt: new Date('2026-09-14T00:00:00Z'),
    readAt: null,
    leagueId: 'L1',
    league: { name: 'Dynasty', platform: 'sleeper' },
    meta: null,
    ...over,
  })

  it('reads meta.notificationCategory, and asks the database for meta', async () => {
    findMany.mockResolvedValue([
      row({ id: 'a', meta: { notificationCategory: 'trade_proposals' } }),
      row({ id: 'b', meta: { chimmyAlert: true } }),
    ])
    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: new Date('2026-09-14T01:00:00Z') })

    expect((findMany.mock.calls[0][0] as { select: Record<string, unknown> }).select.meta).toBe(true)
    expect(data.rest.find((r) => r.id === 'a')?.category).toBe('trade_proposals')
    expect(data.rest.find((r) => r.id === 'b')?.category).toBeNull()
  })
})
