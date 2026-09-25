/**
 * Moderation — block, report, safety visibility, queue, user actions, chat resolve, content filter.
 */

export {
  addBlock,
  removeBlock,
  getBlockedUserIds,
  getBlockedUserIdsForRead,
  hasBlockBetween,
  BlockListUnavailableError,
  getBlockedUsersWithDetails,
  isUserBlockedBy,
} from "./BlockUserService"
export type { BlockedUserInfo } from "./BlockUserService"

export {
  REPORT_REASONS,
  REPORT_STATUS,
} from "./shared"
export type { ReportReason } from "./shared"

export {
  createMessageReport,
  createUserReport,
  isValidReason,
} from "./ReportSubmissionService"

export {
  getMessageReportQueue,
  getUserReportQueue,
  REPORT_STATUSES,
} from "./ModerationQueueService"
export type { ReportStatus, MessageReportItem, UserReportItem } from "./ModerationQueueService"

export {
  getModerationQueueSnapshot,
} from "./ModerationQueueBridge"
export type {
  ModerationQueueSnapshot,
  ModerationBlockedUserItem,
} from "./ModerationQueueBridge"

export {
  applyModerationAction,
  removeBan,
  removeMute,
  removeSuspend,
  isUserBanned,
  isUserMuted,
  getActiveActionsForUser,
  MODERATION_ACTION_TYPES,
} from "./UserModerationService"
export type { ModerationActionType, ApplyActionInput, ModerationActionRecord } from "./UserModerationService"

export {
  updateMessageReportStatus,
  updateUserReportStatus,
  getMessageReportById,
  getUserReportById,
} from "./ChatModerationService"

export {
  submitMessageReportForUser,
  submitUserReportForUser,
  resolveConversationSafetyForUser,
} from "./ModerationService"

export {
  checkProfanity,
  checkSpam,
  moderateText,
  moderateWithAI,
} from "./AIContentModerationBridge"
export type { ContentModerationResult } from "./AIContentModerationBridge"

export {
  filterThreadsByBlocked,
  filterMessagesByBlocked,
  getBlockedMessagePlaceholder,
} from "./SafetyVisibilityResolver"

export {
  BLOCK_API,
  UNBLOCK_API,
  BLOCKED_LIST_API,
  REPORT_MESSAGE_API,
  REPORT_USER_API,
  getBlockPayload,
  getUnblockPayload,
  getReportMessagePayload,
  getReportUserPayload,
  isBlockedDirectConversation,
  getBlockedConversationNotice,
  getBlockedVisibilityNotice,
} from "./ConversationSafetyResolver"
