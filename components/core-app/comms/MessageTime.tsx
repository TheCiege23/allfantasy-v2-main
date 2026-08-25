'use client'

import {
  formatChatMessageTimestamp,
  formatChatMessageTimestampFull,
  toDateTimeAttr,
} from '@/lib/chat-core/chat-timestamps'

/**
 * The send time on a chat row.
 *
 * ⚠ RENDERS NOTHING RATHER THAN SOMETHING WRONG. A null, absent or unparseable
 * `createdAt` yields no element at all — a row missing its time is a small gap,
 * whereas a row reading "Invalid Date" or a fabricated time is a lie about when
 * something was said, and these transcripts get quoted back at people in trade
 * arguments.
 *
 * The short form is deliberately short — "9:41 PM" for today — with the full
 * local timestamp on the `title`, so the exact moment is one hover away without
 * every row carrying a date it does not need.
 */
export function MessageTime({ value }: { value: string | number | Date | null | undefined }) {
  if (value === null || value === undefined || value === '') return null

  const label = formatChatMessageTimestamp(value)
  if (!label) return null

  return (
    <time className="af-cm-msg-time" dateTime={toDateTimeAttr(value)} title={formatChatMessageTimestampFull(value)}>
      {label}
    </time>
  )
}

export default MessageTime
