/**
 * Conversations — DM and group chat services, list resolver, creation, unread, settings.
 */

export {
  CONVERSATION_TYPE_DIRECT,
  getCreateDMPayload,
  getThreadMessagesUrl,
} from "./DirectMessageService"

export {
  CONVERSATION_TYPE_GROUP,
  getCreateGroupPayload,
  GROUP_MIN_MEMBERS,
  GROUP_MAX_MEMBERS,
} from "./GroupMessageService"

export {
  filterThreadsByType,
  getDMThreads,
  getGroupThreads,
  sortThreadsByLastMessage,
  getConversationDisplayTitle,
  getConversationPreview,
} from "./ConversationListResolver"
export type { ConversationType } from "./ConversationListResolver"

export {
  PARTICIPANT_SEARCH_MIN_QUERY,
  parseParticipantUsernames,
} from "./ParticipantSelectorService"

export {
  getUnreadCount,
  hasUnread,
  getUnreadBadgeLabel,
} from "./ConversationUnreadResolver"

export {
  getLeaveGroupUrl,
  getAddParticipantsUrl,
  getRenameThreadUrl,
  getMuteThreadUrl,
  getRenamePayload,
} from "./ConversationSettingsService"

export { handleComposerKeyDown } from "@/lib/chat-core"
