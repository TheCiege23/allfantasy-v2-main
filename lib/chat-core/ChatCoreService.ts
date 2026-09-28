/**
 * ChatCoreService — unified entry for room list, message source, and send routing.
 * Delegates to platform chat-service and bracket league chat based on ChatRoomResolver.
 */

import {
  resolveChatRoom,
  isLeagueVirtualRoom,
  getLeagueIdFromVirtualRoom,
  type ResolvedChatRoom,
} from "./ChatRoomResolver"
import type { PlatformChatMessage, PlatformChatThread } from "@/types/platform-shared"

export type { ResolvedChatRoom }

export { resolveChatRoom, isLeagueVirtualRoom, getLeagueIdFromVirtualRoom }

/** Normalize bracket league message shape to PlatformChatMessage-like for unified UI. */
export function bracketMessageToPlatformShape(
  msg: {
    id: string
    message: string
    type?: string
    createdAt: string
    user?: { id: string; username?: string | null; displayName?: string | null; email?: string | null }
  },
  threadId: string
): PlatformChatMessage {
  return {
    id: msg.id,
    threadId,
    senderUserId: msg.user?.id ?? null,
    senderName: msg.user?.displayName || msg.user?.username || "Manager",
    senderUsername: msg.user?.username ?? null,
    messageType: msg.type || "text",
    body: msg.message || "",
    createdAt: typeof msg.createdAt === "string" ? msg.createdAt : new Date(msg.createdAt).toISOString(),
  }
}

/** Determine if messages for this room should be fetched from bracket league API. */
export function shouldFetchMessagesFromBracketLeague(roomId: string): boolean {
  return isLeagueVirtualRoom(roomId)
}

/** Get leagueId for bracket API from roomId (virtual or context). */
export function getLeagueIdForRoom(roomId: string, context?: { leagueId?: string | null }): string | null {
  const leagueId = getLeagueIdFromVirtualRoom(roomId)
  if (leagueId) return leagueId
  return context?.leagueId ?? null
}
