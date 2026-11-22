/**
 * League chat — service, composer, system notices, pinned, mentions, poll, notifications.
 */

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

export { parseMentions, getLeagueMentionRanges } from "./LeagueMentionResolver"

export {
  createLeaguePollPayload,
  parseLeaguePollPayload,
  getLeaguePollVoteUrl,
  getLeaguePollCloseUrl,
} from "./LeaguePollService"
export type { LeaguePollPayload } from "./LeaguePollService"

export {
  getTradeAcceptedNoticePayload,
  getWaiverNoticePayload,
} from "./LeagueChatNotificationBridge"
