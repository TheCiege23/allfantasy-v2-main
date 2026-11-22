import { getPrimaryChimmyEntry } from '@/lib/ai-product-layer'

/**
 * TopBarUtilityResolver — which top bar utilities to show and in what order.
 * Used for documentation and consistent ordering (notifications, messages, AI chat, search, language, admin, profile).
 */

type TopBarUtilityId =
  | "search"
  | "wallet"
  | "messages"
  | "notifications"
  | "settings"
  | "ai_chat"
  | "language"
  | "admin"
  | "profile"

export interface TopBarUtilitySpec {
  id: TopBarUtilityId
  /** When false, hide (e.g. admin only when isAdmin). */
  visible: boolean
  /** Optional href for link-style utility. */
  href?: string
  /** Title/tooltip. */
  title: string
}

/**
 * Resolve top bar utilities for display. Order matches GlobalTopNav.
 */
export function getTopBarUtilities(opts: {
  isAuthenticated: boolean
  isAdmin: boolean
  hasSearch?: boolean
}): TopBarUtilitySpec[] {
  const { isAuthenticated, isAdmin, hasSearch = true } = opts
  if (!isAuthenticated) {
    return []
  }
  const chimmy = getPrimaryChimmyEntry({ source: "top_bar" })
  const list: TopBarUtilitySpec[] = [
    { id: "search", visible: !!hasSearch, title: "Search" },
    { id: "wallet", visible: true, title: "Wallet" },
    { id: "messages", visible: true, href: "/messages", title: "Messages" },
    { id: "notifications", visible: true, title: "Notifications" },
    { id: "settings", visible: true, href: "/settings", title: "Settings" },
    { id: "ai_chat", visible: true, href: chimmy.href, title: chimmy.label },
    { id: "language", visible: true, title: "Language" },
    { id: "admin", visible: isAdmin, href: "/admin", title: "Admin" },
    { id: "profile", visible: true, href: "/profile", title: "Profile" },
  ]
  return list.filter((u) => u.visible)
}
