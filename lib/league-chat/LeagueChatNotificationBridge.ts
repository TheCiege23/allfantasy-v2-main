/**
 * LeagueChatNotificationBridge — trigger notifications for league chat events.
 * Mentions: POST /api/shared/chat/mentions with threadId, messageId, mentionedUsernames.
 * Trade/waiver notices: created by backend or cron; this module documents the contract.
 */

export function getMentionsPayload(threadId: string, messageId: string, mentionedUsernames: string[]) {
  return { threadId, messageId, mentionedUsernames: mentionedUsernames.filter(Boolean) }
}

export function getTradeAcceptedNoticePayload(params: {
  acceptedByName: string
  teamsSummary: string
  actionHref?: string | null
}) {
  return {
    messageType: "trade_accepted",
    body: `${params.acceptedByName} accepted a trade: ${params.teamsSummary}`,
    metadata: params.actionHref ? { actionHref: params.actionHref } : undefined,
  }
}

export function getWaiverNoticePayload(params: {
  summary: string
  actionHref?: string | null
}) {
  return {
    messageType: "waiver_notice",
    body: params.summary,
    metadata: params.actionHref ? { actionHref: params.actionHref } : undefined,
  }
}
