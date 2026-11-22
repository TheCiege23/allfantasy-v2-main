/**
 * Social chat — mentions, reactions, pins, polls.
 */

export {
  parseMentions,
  hasMentions,
  getMentionRanges,
  getMentionQueryFromInput,
} from "./MentionResolver"

export {
  notifyMentions,
} from "./MentionNotificationBridge"

export {
  getReactionsFromMetadata,
  getAddReactionUrl,
  getRemoveReactionUrl,
  QUICK_REACTIONS,
} from "./ReactionService"
export type { ReactionEntry } from "./ReactionService"

export {
  getPinnedUrl,
  getPinUrl,
  getUnpinUrl,
  getPinPayload,
  getUnpinPayload,
  getPinnedDisplayBody,
  getReferencedMessageIdFromPin,
} from "./PinnedMessageService"

export {
  parsePollBody,
  getVoteUrl,
  getVotePayload,
  getClosePollUrl,
  getCreatePollPayload,
  POLL_MAX_OPTIONS,
} from "./PollService"
export type { PollPayload } from "./PollService"

export { MessageInteractionRenderer } from "./MessageInteractionRenderer"
