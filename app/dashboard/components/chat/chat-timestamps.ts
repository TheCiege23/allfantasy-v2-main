/**
 * Moved to `lib/chat-core/chat-timestamps` when the comms drawer needed it too.
 * Re-exported here so the two dashboard callers keep their import path.
 */
export {
  CHAT_THREAD_GROUP_MS,
  formatChatMessageTimestamp,
  formatChatMessageTimestampFull,
  isChimmyMessageThreaded,
  isLeagueMessageThreaded,
  toDateTimeAttr,
} from '@/lib/chat-core/chat-timestamps'
