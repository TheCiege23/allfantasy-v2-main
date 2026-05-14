/**
 * NotificationRouteResolver — resolve destination href from notification meta.
 * Used for notification card click and "Open league" / "Open chat" links.
 */

import type { PlatformNotification } from "@/types/platform-shared"
import { getDeepLinkRedirect } from "@/lib/routing"
import { isSupportedSport } from "@/lib/sport-scope"

export interface NotificationDestination {
  href: string
  label: string
}

function resolveMetaSport(meta: Record<string, unknown>): string | null {
  const sport = meta.sport
  if (typeof sport !== "string") return null
  const normalized = sport.trim().toUpperCase()
  return isSupportedSport(normalized) ? normalized : null
}

function withSportContext(href: string, sport: string | null): string {
  if (!sport) return href
  const separator = href.includes("?") ? "&" : "?"
  return `${href}${separator}sport=${encodeURIComponent(sport)}`
}

function getProductFallbackHref(
  product: PlatformNotification["product"],
  sport: string | null
): string {
  if (product === "bracket") return withSportContext("/brackets", sport)
  if (product === "legacy") return withSportContext("/af-legacy", sport)
  if (product === "app") return withSportContext("/dashboard", sport)
  return withSportContext("/dashboard", sport)
}

/**
 * Resolve primary destination for a notification (e.g. league page, chat thread, bracket).
 * Engagement notifications (daily_digest, league_reminder, ai_insight, weekly_recap) use meta.actionHref for deep linking.
 */
export function getNotificationDestination(n: PlatformNotification): NotificationDestination | null {
  const meta = (n.meta ?? {}) as Record<string, unknown>
  const sport = resolveMetaSport(meta)
  const actionHref = meta.actionHref as string | undefined
  const actionLabel = meta.actionLabel as string | undefined
  if (actionHref && typeof actionHref === "string") {
    return {
      href: getDeepLinkRedirect(actionHref, getProductFallbackHref(n.product, sport)),
      label: actionLabel ?? "Open",
    }
  }

  const leagueId = meta.leagueId as string | undefined
  const chatThreadId = meta.chatThreadId as string | undefined
  const messageId = meta.messageId as string | undefined
  const tournamentId = meta.tournamentId as string | undefined
  const bracketEntryId = meta.bracketEntryId as string | undefined
  const chatHref = chatThreadId
    ? `/messages?thread=${encodeURIComponent(chatThreadId)}${messageId ? `&message=${encodeURIComponent(messageId)}` : ""}`
    : null

  if (leagueId && n.type?.startsWith("draft_")) {
    return {
      href: withSportContext(`/league/${leagueId}/draft`, sport),
      label: (meta.actionLabel as string) ?? "Open draft",
    }
  }
  if (leagueId && chatThreadId) {
    return { href: chatHref!, label: "Open chat" }
  }
  if (chatThreadId) {
    return { href: chatHref!, label: "Open chat" }
  }
  if (leagueId) {
    // Bracket pools live at /brackets/leagues/[id], not /league/[id]
    if (n.product === "bracket") {
      return {
        href: `/brackets/leagues/${leagueId}`,
        label: "Open pool",
      }
    }
    return {
      href: withSportContext(`/league/${leagueId}`, sport),
      label: "Open league",
    }
  }
  if (tournamentId && bracketEntryId) {
    return {
      href: withSportContext(`/bracket/${tournamentId}/entry/${bracketEntryId}`, sport),
      label: "Open bracket",
    }
  }
  if (tournamentId) {
    return {
      href: withSportContext(`/brackets/tournament/${tournamentId}`, sport),
      label: "Open bracket",
    }
  }
  if (n.product === "bracket") {
    return { href: withSportContext("/brackets", sport), label: "Open brackets" }
  }
  if (n.product === "legacy") {
    return { href: withSportContext("/af-legacy", sport), label: "Open Legacy" }
  }
  return { href: withSportContext("/dashboard", sport), label: "Go to dashboard" }
}
