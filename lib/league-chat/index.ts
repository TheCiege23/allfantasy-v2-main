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
  LEAGUE_SYSTEM_MESSAGE_TYPES,
} from "./LeagueSystemNoticeRenderer"
export type { LeagueSystemMessageType } from "./LeagueSystemNoticeRenderer"

export {
  getPinnedDisplayBody,
  getReferencedMessageIdFromPin,
} from "./PinnedLeagueMessageResolver"

export { parseMentions, hasMentions, getLeagueMentionRanges } from "./LeagueMentionResolver"
export type { LeagueMentionRange } from "./LeagueMentionResolver"

export {
  createLeaguePollPayload,
  isPollMessage,
  parseLeaguePollPayload,
  getLeaguePollVoteUrl,
  getLeaguePollCloseUrl,
  LEAGUE_POLL_MAX_OPTIONS,
  LEAGUE_POLL_QUESTION_MAX_LENGTH,
  LEAGUE_POLL_OPTION_MAX_LENGTH,
} from "./LeaguePollService"
export type { LeaguePollPayload } from "./LeaguePollService"

export {
  getMentionsPayload,
  getTradeAcceptedNoticePayload,
  getWaiverNoticePayload,
} from "./LeagueChatNotificationBridge"
