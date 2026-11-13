/**
 * GroupMessageService — create group thread, payloads for API.
 */

export const CONVERSATION_TYPE_GROUP = "group"

export function getCreateGroupPayload(memberUserIds: string[], title?: string): {
  threadType: string
  memberUserIds: string[]
  title?: string
} {
  return {
    threadType: CONVERSATION_TYPE_GROUP,
    memberUserIds: memberUserIds.filter(Boolean),
    ...(title?.trim() ? { title: title.trim() } : {}),
  }
}

export const GROUP_MIN_MEMBERS = 2
export const GROUP_MAX_MEMBERS = 20
