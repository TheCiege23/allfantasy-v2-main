type WorldCupPoolMentionType = "username" | "chimmy" | "all" | "global"

type WorldCupPoolMention = {
  type: WorldCupPoolMentionType
  token: string
  value: string
  start: number
  end: number
  visibility: "public" | "private_to_user" | "commissioner_only"
  requiresCommissioner: boolean
}

type WorldCupPoolChatCapability = {
  id: string
  label: string
  status: "available" | "planned" | "blocked"
  notes: string
}

export const WORLD_CUP_POOL_CHAT_EVENT_TYPES = {
  TEXT_MESSAGE: "world_cup.pool_chat_message",
  CHIMMY_PRIVATE: "world_cup.pool_chat_chimmy_private",
  POLL: "world_cup.pool_chat_poll",
} as const

const MENTION_PATTERN = /(^|[\s*_~\]])@([a-zA-Z0-9](?:(?:[a-zA-Z0-9.-]|_(?=[a-zA-Z0-9])){0,30}[a-zA-Z0-9])?)(?=$|[^a-zA-Z0-9.-]|_(?![a-zA-Z0-9]))/g

export function parseWorldCupPoolMentions(message: string): WorldCupPoolMention[] {
  const mentions: WorldCupPoolMention[] = []

  for (const match of message.matchAll(MENTION_PATTERN)) {
    const leading = match[1] ?? ""
    const raw = match[2] ?? ""
    const start = (match.index ?? 0) + leading.length
    const token = `@${raw}`
    const normalized = raw.toLowerCase()

    if (normalized === "chimmy") {
      mentions.push({
        type: "chimmy",
        token,
        value: normalized,
        start,
        end: start + token.length,
        visibility: "private_to_user",
        requiresCommissioner: false,
      })
      continue
    }

    if (normalized === "all") {
      mentions.push({
        type: "all",
        token,
        value: normalized,
        start,
        end: start + token.length,
        visibility: "public",
        requiresCommissioner: true,
      })
      continue
    }

    if (normalized === "global") {
      mentions.push({
        type: "global",
        token,
        value: normalized,
        start,
        end: start + token.length,
        visibility: "commissioner_only",
        requiresCommissioner: true,
      })
      continue
    }

    mentions.push({
      type: "username",
      token,
      value: raw,
      start,
      end: start + token.length,
      visibility: "public",
      requiresCommissioner: false,
    })
  }

  return mentions
}

export function shouldKeepWorldCupMentionPrivate(mention: WorldCupPoolMention) {
  return mention.type === "chimmy" || mention.visibility === "private_to_user"
}

export function getWorldCupPoolChatCapabilities(): WorldCupPoolChatCapability[] {
  return [
    {
      id: "activity-feed",
      label: "World Cup activity feed",
      status: "available",
      notes: "WorldCupBracketChatEvent already stores system events and commissioner reminders.",
    },
    {
      id: "text-chat",
      label: "Pool text chat",
      status: "planned",
      notes: "Use a World Cup-scoped message model or safely bridge to BracketLeagueMessage when every pool has a bracketLeagueId.",
    },
    {
      id: "rich-media",
      label: "GIFs, images, voice notes, and polls",
      status: "planned",
      notes: "Existing chat upload, GIF, emoji, and poll patterns can be reused after World Cup membership scoping is added.",
    },
    {
      id: "private-chimmy",
      label: "@chimmy private mention",
      status: "blocked",
      notes: "Must route to a private user-visible thread and never persist the prompt or reply as public pool chat.",
    },
    {
      id: "notifications",
      label: "Mention notifications",
      status: "planned",
      notes: "PlatformNotification and WebPushSubscription exist; World Cup-specific preference keys and dedupe rules are still needed.",
    },
    {
      id: "global-broadcast",
      label: "@global commissioner broadcast",
      status: "planned",
      notes: "Existing league global broadcast can guide implementation, but World Cup pools need commissioner-only targeting and preference filtering.",
    },
  ]
}
