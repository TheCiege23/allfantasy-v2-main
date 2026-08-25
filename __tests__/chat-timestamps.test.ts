import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatChatMessageTimestamp,
  formatChatMessageTimestampFull,
  toDateTimeAttr,
} from '@/lib/chat-core/chat-timestamps'

/* A fixed "now" so the today / this-week / older branches are deterministic. */
const NOW = new Date('2026-08-25T20:00:00')

describe('formatChatMessageTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('shows only a time for today', () => {
    const out = formatChatMessageTimestamp(new Date('2026-08-25T09:41:00'))
    expect(out).toMatch(/9:41/)
    expect(out).not.toMatch(/Aug|Mon|Tue/)
  })

  it('adds a weekday inside the last week', () => {
    // Saturday, two days before the Monday "now".
    expect(formatChatMessageTimestamp(new Date('2026-08-23T09:41:00'))).toMatch(/^\w{3} /)
  })

  /*
   * The bug this replaced: everything older than today got a bare weekday, so a
   * message from three weeks ago read as though it were from this week.
   */
  it('uses a real date once a weekday no longer identifies one day', () => {
    const out = formatChatMessageTimestamp(new Date('2026-08-03T09:41:00'))
    expect(out).toMatch(/Aug/)
    expect(out).toMatch(/3/)
  })

  it('includes the year for another year', () => {
    expect(formatChatMessageTimestamp(new Date('2025-03-04T09:41:00'))).toMatch(/2025/)
  })

  it('accepts the ISO string the API actually returns', () => {
    expect(formatChatMessageTimestamp(new Date('2026-08-25T09:41:00').toISOString())).toMatch(/9:41/)
  })

  it('accepts epoch milliseconds, which the dashboard callers pass', () => {
    expect(formatChatMessageTimestamp(new Date('2026-08-25T09:41:00').getTime())).toMatch(/9:41/)
  })

  /*
   * A row reading "Invalid Date" is worse than a row with no time: these
   * transcripts get quoted back at people in trade arguments.
   */
  it('renders nothing for an unparseable value rather than "Invalid Date"', () => {
    expect(formatChatMessageTimestamp('not a date')).toBe('')
    expect(formatChatMessageTimestamp('')).toBe('')
    expect(formatChatMessageTimestampFull('not a date')).toBe('')
    expect(toDateTimeAttr('not a date')).toBe('')
  })

  it('encodes a machine-readable datetime attribute', () => {
    const iso = new Date('2026-08-25T09:41:00').toISOString()
    expect(toDateTimeAttr(iso)).toBe(iso)
  })
})
