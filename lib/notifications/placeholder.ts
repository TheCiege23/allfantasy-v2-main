import type { PlatformNotification } from "@/types/platform-shared"

/**
 * Placeholder notification service for development and empty states.
 * Use when the real API returns no notifications so the UI can be exercised.
 * Replace or disable in production if you only want real data.
 */
const PLACEHOLDER_NOTIFICATIONS: PlatformNotification[] = [
  {
    id: "placeholder-mention",
    type: "mention",
    title: "You were mentioned",
    body: "Rival GM mentioned you in AllFantasy Dynasty 1 league chat.",
    product: "app",
    severity: "low",
    read: false,
    createdAt: new Date(Date.now() - 120000).toISOString(),
    meta: { leagueId: "lg1", chatThreadId: "thread1" },
  },
  {
    id: "placeholder-trade",
    type: "trade_offer",
    title: "Trade offer received",
    body: "Stacked Contender sent you a trade: their Garrett Wilson for your 2025 1st.",
    product: "app",
    severity: "medium",
    read: false,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    meta: { leagueId: "lg1" },
  },
  {
    id: "placeholder-invite",
    type: "league_invite",
    title: "League invite",
    body: "You're invited to join Bracket Challenge by Commissioner.",
    product: "shared",
    severity: "medium",
    read: true,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    meta: { leagueId: "bracket-1" },
  },
  {
    id: "placeholder-announcement",
    type: "announcement",
    title: "Commissioner announcement",
    body: "Trade deadline is Sunday 11:59 PM ET. No exceptions.",
    product: "app",
    severity: "high",
    read: true,
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    meta: { leagueId: "lg1" },
  },
  {
    id: "placeholder-chat",
    type: "chat_message",
    title: "New league message",
    body: "Rival GM: Who's trading a RB1 for picks?",
    product: "app",
    severity: "low",
    read: true,
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    meta: { leagueId: "lg1", chatThreadId: "thread1" },
  },
]

function getPlaceholderNotifications(): PlatformNotification[] {
  return [...PLACEHOLDER_NOTIFICATIONS]
}

/**
 * Merge placeholder notifications with API results when API returns empty.
 * Only appends placeholders that don't already exist by id in the list.
 */
export function mergeWithPlaceholders(
  fromApi: PlatformNotification[],
  usePlaceholders = true
): PlatformNotification[] {
  if (!usePlaceholders || fromApi.length > 0) return fromApi
  return getPlaceholderNotifications()
}
