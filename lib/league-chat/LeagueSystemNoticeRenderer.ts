/**
 * LeagueSystemNoticeRenderer — detect and label system/commissioner message types.
 * Used by message list to render broadcast, stats_bot, pin distinctly from normal messages.
 */

export const LEAGUE_SYSTEM_MESSAGE_TYPES = [
  "broadcast",
  "stats_bot",
  "pin",
  "system",
  "waiver_bot",
  "commissioner_notice",
  "trade_notice",
  "waiver_notice",
  "trade_accepted",
  "draft_notice",
  "draft_summary",
  "lineup_notice",
  "scoring_notice",
  "matchup_notice",
  "playoff_notice",
  "champion_announcement",
  "chat_message",
] as const
export type LeagueSystemMessageType = (typeof LEAGUE_SYSTEM_MESSAGE_TYPES)[number]

export function isLeagueSystemNotice(messageType: string): messageType is LeagueSystemMessageType {
  return LEAGUE_SYSTEM_MESSAGE_TYPES.includes(messageType as LeagueSystemMessageType)
}

export function getLeagueSystemNoticeLabel(messageType: string): string {
  switch (messageType) {
    case "broadcast":
      return "Commissioner"
    case "stats_bot":
      return "Chat Stats Bot"
    case "pin":
      return "Pinned"
    case "system":
      return "System"
    case "waiver_bot":
      return "Waiver"
    case "commissioner_notice":
      return "Commissioner"
    case "trade_notice":
    case "trade_accepted":
      return "Trade"
    case "waiver_notice":
      return "Waiver"
    case "draft_notice":
    case "draft_summary":
      return "Draft"
    case "lineup_notice":
      return "Lineup"
    case "scoring_notice":
      return "Scoring"
    case "matchup_notice":
      return "Matchup"
    case "playoff_notice":
      return "Playoff"
    case "champion_announcement":
      return "Champion"
    case "chat_message":
      return "Chat"
    default:
      return "Notice"
  }
}

/** Parse broadcast message body (JSON { announcement } or plain text). */
export function getBroadcastBody(body: string): string {
  try {
    const parsed = JSON.parse(body || "{}")
    if (typeof parsed.announcement === "string") return parsed.announcement
  } catch {
    // fallback
  }
  return body || ""
}

/** Parse stats_bot message body (JSON with weekLabel, bestTeam, etc.). */
export function getStatsBotPayload(body: string): {
  weekLabel?: string
  bestTeam?: string
  worstTeam?: string
  bestPlayer?: string
  winStreak?: string
  lossStreak?: string
} | null {
  try {
    const parsed = JSON.parse(body || "{}")
    if (parsed && typeof parsed === "object") return parsed
  } catch {
    // ignore
  }
  return null
}

/** Parse pin message body (JSON { messageId } or { messageId, snippet }). */
export function getPinReferencedMessageId(body: string): string | null {
  try {
    const parsed = JSON.parse(body || "{}")
    if (typeof parsed.messageId === "string") return parsed.messageId
  } catch {
    // ignore
  }
  return null
}

/** Parse generic system notice text from JSON body when available. */
export function getSystemNoticeBody(body: string): string {
  try {
    const parsed = JSON.parse(body || "{}") as Record<string, unknown>
    if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message
    if (typeof parsed.notice === "string" && parsed.notice.trim()) return parsed.notice
  } catch {
    // fall back to raw body
  }
  return body || ""
}
