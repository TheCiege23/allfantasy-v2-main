/**
 * ConversationListResolver — filter and sort threads for DM vs group list.
 */

import type { PlatformChatThread } from "@/types/platform-shared"

type ConversationType = "dm" | "group"

function filterThreadsByType(
  threads: PlatformChatThread[],
  type: ConversationType
): PlatformChatThread[] {
  return threads.filter((t) => t.threadType === type)
}

export function getDMThreads(threads: PlatformChatThread[]): PlatformChatThread[] {
  return threads.filter((thread) => {
    if (thread.threadType === "dm") return true
    const context = (thread.context || {}) as Record<string, unknown>
    return thread.threadType === "ai" && context.showInDmList === true
  })
}

export function getGroupThreads(threads: PlatformChatThread[]): PlatformChatThread[] {
  return filterThreadsByType(threads, "group")
}

export function sortThreadsByLastMessage(threads: PlatformChatThread[]): PlatformChatThread[] {
  return [...threads].sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  )
}

export function getConversationDisplayTitle(thread: PlatformChatThread): string {
  const title = thread.title?.trim()
  if (title) return title
  const context = (thread.context || {}) as Record<string, unknown>
  const otherDisplayName =
    typeof context.otherDisplayName === "string" && context.otherDisplayName.trim().length > 0
      ? context.otherDisplayName
      : null
  const otherUsername =
    typeof context.otherUsername === "string" && context.otherUsername.trim().length > 0
      ? context.otherUsername
      : null
  if (thread.threadType === "dm") {
    return otherDisplayName || (otherUsername ? `@${otherUsername}` : "Direct message")
  }
  if (thread.threadType === "ai") {
    return title || "Chimmy AI"
  }
  return "Group chat"
}

export function getConversationPreview(thread: PlatformChatThread): string {
  const context = (thread.context || {}) as Record<string, unknown>
  const preview =
    typeof context.lastMessagePreview === "string" && context.lastMessagePreview.trim().length > 0
      ? context.lastMessagePreview
      : null
  return preview || "No messages yet"
}
