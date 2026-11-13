/**
 * League chat — service, composer, system notices, pinned, mentions, poll, notifications.
 */

export {
  LEAGUE_CHAT_MESSAGES_LIMIT,
} from "./LeagueChatService"

export {
  validateMessageBody,
  MAX_MESSAGE_LENGTH,
  MIN_MESSAGE_LENGTH,
  isSendKey,
  handleComposerKeyDown,
} from "./LeagueMessageComposer"

export {
  isLeagueSystemNotice,
  getLeagueSystemNoticeLabel,
  getPinReferencedMessageId,
  getSystemNoticeBody,
} from "./LeagueSystemNoticeRenderer"

export {
  getPinnedDisplayBody,
  getReferencedMessageIdFromPin,
} from "./PinnedLeagueMessageResolver"

export { parseMentions, hasMentions, getLeagueMentionRanges } from "./LeagueMentionResolver"

export {
  createLeaguePollPayload,
  isPollMessage,
  parseLeaguePollPayload,
  getLeaguePollVoteUrl,
  getLeaguePollCloseUrl,
} from "./LeaguePollService"
export type { LeaguePollPayload } from "./LeaguePollService"

export {
  getMentionsPayload,
  getTradeAcceptedNoticePayload,
  getWaiverNoticePayload,
} from "./LeagueChatNotificationBridge"
