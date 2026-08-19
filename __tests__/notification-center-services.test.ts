import { describe, expect, it } from "vitest"
import {
  getNotificationDestination,
  getNotificationsEndpoint,
  getNotificationsReadAllEndpoint,
  getNotificationReadEndpoint,
  getTopBarUtilities,
  getUnreadBadgeCount,
  getUnreadCount,
  groupNotifications,
  NOTIFICATION_GROUP_ORDER,
  NOTIFICATIONS_READ_ALL_ENDPOINT,
} from "@/lib/notification-center"
import type { PlatformNotification } from "@/types/platform-shared"

function makeNotification(overrides: Partial<PlatformNotification> = {}): PlatformNotification {
  return {
    id: "n-1",
    type: "notification",
    title: "Notification",
    body: null,
    product: "app",
    read: false,
    createdAt: new Date().toISOString(),
    meta: {},
    ...overrides,
  }
}

describe("notification center services", () => {
  it("groups notifications by recency and keeps newest first in each group", () => {
    // Use a fixed noon reference to avoid midnight-flakiness
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString()
    const yesterday = new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString()
    const older = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const groups = groupNotifications([
      makeNotification({ id: "earlier", createdAt: older }),
      makeNotification({ id: "today-older", createdAt: threeHoursAgo }),
      makeNotification({ id: "today-newer", createdAt: oneHourAgo }),
      makeNotification({ id: "yesterday", createdAt: yesterday }),
    ], now)

    expect(NOTIFICATION_GROUP_ORDER).toEqual(["today", "yesterday", "earlier"])
    expect(groups.today.map((item) => item.id)).toEqual(["today-newer", "today-older"])
    expect(groups.yesterday.map((item) => item.id)).toEqual(["yesterday"])
    expect(groups.earlier.map((item) => item.id)).toEqual(["earlier"])
  })

  it("resolves unread counts and capped unread badge", () => {
    const notifications = [
      makeNotification({ id: "r1", read: true }),
      makeNotification({ id: "u1", read: false }),
      makeNotification({ id: "u2", read: false }),
    ]
    expect(getUnreadCount(notifications)).toBe(2)
    expect(getUnreadBadgeCount(notifications, 9)).toBe(2)
    expect(getUnreadBadgeCount(new Array(12).fill(0).map((_, i) => makeNotification({ id: `u-${i}` })), 9)).toBe("9+")
  })

  it("resolves top bar utility order and settings shortcut visibility", () => {
    const guest = getTopBarUtilities({ isAuthenticated: false, isAdmin: false })
    expect(guest.map((utility) => utility.id)).toEqual([])

    const authenticated = getTopBarUtilities({
      isAuthenticated: true,
      isAdmin: true,
      hasSearch: true,
    })
    expect(authenticated.map((utility) => utility.id)).toEqual([
      "search",
      "wallet",
      "messages",
      "notifications",
      "settings",
      "ai_chat",
      "language",
      "admin",
      "profile",
    ])
  })

  it("resolves notification destinations with sport-aware context", () => {
    const league = getNotificationDestination(
      makeNotification({
        type: "league_invite",
        meta: { leagueId: "league-123", sport: "nba" },
      })
    )
    expect(league).toEqual({ href: "/league/league-123?sport=NBA", label: "Open league" })

    const draft = getNotificationDestination(
      makeNotification({
        type: "draft_on_the_clock",
        meta: { leagueId: "league-123", sport: "ncaaf" },
      })
    )
    expect(draft).toEqual({ href: "/league/league-123/draft?sport=NCAAF", label: "Open draft" })

    const blockedDeepLink = getNotificationDestination(
      makeNotification({
        product: "bracket",
        meta: { actionHref: "//malicious.example/test", actionLabel: "Open", sport: "soccer" },
      })
    )
    expect(blockedDeepLink).toEqual({ href: "/brackets?sport=SOCCER", label: "Open" })

    const mention = getNotificationDestination(
      makeNotification({
        type: "mention",
        meta: { chatThreadId: "thread-123", messageId: "msg-456" },
      })
    )
    expect(mention).toEqual({
      href: "/messages?thread=thread-123&message=msg-456",
      label: "Open chat",
    })
  })

  it("builds read endpoints and clamps list limit", () => {
    expect(getNotificationReadEndpoint("a/b c")).toBe("/api/shared/notifications/a%2Fb%20c/read")
    expect(getNotificationsEndpoint(0)).toBe("/api/shared/notifications?limit=1")
    expect(getNotificationsEndpoint(250)).toBe("/api/shared/notifications?limit=100")
    expect(getNotificationsEndpoint(25, { leagueId: "league-1" })).toBe(
      "/api/shared/notifications?limit=25&leagueId=league-1"
    )
    expect(NOTIFICATIONS_READ_ALL_ENDPOINT).toBe("/api/shared/notifications/read-all")
    expect(getNotificationsReadAllEndpoint({ leagueId: "league/1" })).toBe(
      "/api/shared/notifications/read-all?leagueId=league%2F1"
    )
  })
})
