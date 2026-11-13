/**
 * Conversations — DM and group chat services, list resolver, creation, unread, settings.
 */

export {
  getCreateDMPayload,
  getThreadMessagesUrl,
} from "./DirectMessageService"

export {
  getCreateGroupPayload,
  GROUP_MIN_MEMBERS,
  GROUP_MAX_MEMBERS,
} from "./GroupMessageService"

export {
  getDMThreads,
  getGroupThreads,
  sortThreadsByLastMessage,
  getConversationDisplayTitle,
  getConversationPreview,
} from "./ConversationListResolver"

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
