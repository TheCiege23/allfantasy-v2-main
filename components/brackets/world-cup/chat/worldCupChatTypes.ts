/**
 * Shared types for the World Cup chat system.
 * Extracted from WorldCupBracketShell.tsx to enable safe incremental refactoring.
 */

export type WorldCupChatMode = "ai" | "pool" | "dm"
export type WorldCupComposerPanel = "tools" | "format" | "emoji" | "gif" | "poll" | "image" | "voice" | null

type WorldCupChatPollOption = {
  id: string
  label: string
  votes: number
  percentage: number
}

export type WorldCupChatPollAttachment = {
  question: string
  options: WorldCupChatPollOption[]
  currentUserVote: string | null
  totalVotes: number
  closed: boolean
  closedAt: string | null
  createdByUserId: string | null
  createdAt: string | null
}

export type WorldCupChatGifAttachment = {
  id: string
  title: string
  previewUrl: string
  gifUrl: string
  width: number
  height: number
  provider: "klipy" | "tenor" | "giphy"
}

export type WorldCupChatImageAttachment = {
  assetId: string
  publicId: string
  secureUrl: string
  width: number
  height: number
  format: string
  bytes: number
  provider: "cloudinary"
}

/**
 * A pool or AI chat message as returned from the server.
 * Scope is either "pool" (public, stored on challenge) or "private_ai"
 * (Chimmy private response, visible only to the requesting user).
 */
export type WorldCupPoolChatMessage = {
  id: string
  userId: string | null
  authorName: string
  authorAvatarUrl: string | null
  body: string
  messageType: string
  gif?: WorldCupChatGifAttachment | null
  image?: WorldCupChatImageAttachment | null
  poll?: WorldCupChatPollAttachment | null
  /** "public" | "private" */
  visibility: string
  targetUserId: string | null
  mentions: unknown[]
  createdAt: string
  isOwnMessage: boolean
  isPrivate: boolean
  /** Freshness tier: "live" | "cached" | "schedule_only" | "pool_only" | "none". Null on user messages. */
  dataSourceTier?: string | null
  /** Short display text for the freshness chip. Null on user messages. */
  dataSourceDisplay?: string | null
}

export type WorldCupDmMember = {
  userId: string
  username: string | null
  displayName: string
  avatarUrl: string | null
  joinedAt: string
  isCurrentUser: boolean
}

export type WorldCupMentionSuggestion = {
  id: string
  token: string
  label: string
  helper: string
  isBroadcast?: boolean
}

export type WorldCupDmThread = {
  id: string
  threadType: "dm" | "group" | "league" | "bracket_pool" | "ai"
  productType: "shared" | "app" | "bracket" | "legacy"
  title: string
  lastMessageAt: string
  unreadCount: number
  memberCount: number
  context?: Record<string, unknown>
}

export type WorldCupDmMessage = {
  id: string
  threadId: string
  senderUserId: string | null
  senderName: string
  senderUsername?: string | null
  senderAvatarUrl?: string | null
  messageType: string
  body: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export type WorldCupAiPromptAction = {
  key: string
  label: string
  prompt: string
}
