/**
 * How a League, DM or Huddle conversation is laid out — pure, so the rules that
 * decide what a reader sees can be proven without a DOM.
 *
 * ⚠ THE DRAWER USED TO RENDER EVERY MESSAGE AS A FLAT ROW: bold name, grey time,
 * text, repeated for every line somebody sent. Five quick messages from one
 * person carried five copies of their name, nothing said which side was yours,
 * and a conversation spanning three days read as one undated wall. This module
 * is the grouping that fixes that, and it is the only place it is decided:
 *
 *   - a RUN is consecutive messages from one sender, each within
 *     `CHAT_THREAD_GROUP_MS` (5 min) of the one before it, on the same day;
 *   - the name and avatar show once per run, the time once per run (and on
 *     tap/hover for every message);
 *   - a DAY SEPARATOR sits before the first message of each calendar day.
 */

import { CHAT_THREAD_GROUP_MS } from '@/lib/chat-core/chat-timestamps'

export type ChatLayoutMessage = {
  id: string
  /** Null for system rows and for senders the server could not name. */
  authorId: string | null
  createdAt: string
}

export type ChatLayoutItem<M extends ChatLayoutMessage> =
  | { kind: 'day'; key: string; label: string }
  | {
      kind: 'message'
      key: string
      message: M
      /** The viewer sent it — drawn on the right, in the accent colour. */
      mine: boolean
      /** First of its run: carries the name (theirs) and the avatar slot. */
      startsRun: boolean
      /** Last of its run: carries the avatar (theirs) and the run's time. */
      endsRun: boolean
    }

function toDate(value: string): Date | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * "Today", "Yesterday", a weekday inside the last week, then a real date.
 *
 * ⚠ A bare weekday past six days names no particular day — the same trap
 * `chat-timestamps.ts` records — so older days always carry the date.
 */
export function dayLabel(value: string, now: Date = new Date()): string {
  const d = toDate(value)
  if (!d) return ''
  if (sameCalendarDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameCalendarDay(d, yesterday)) return 'Yesterday'
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.round((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000)
  if (days > 0 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * Whether `curr` continues the run `prev` belongs to.
 *
 * A run never crosses a day separator, and a message with no known sender never
 * joins one — two anonymous rows are not evidence of one speaker.
 */
export function continuesRun(prev: ChatLayoutMessage | undefined, curr: ChatLayoutMessage): boolean {
  if (!prev || !prev.authorId || !curr.authorId) return false
  if (prev.authorId !== curr.authorId) return false
  const a = toDate(prev.createdAt)
  const b = toDate(curr.createdAt)
  if (!a || !b || !sameCalendarDay(a, b)) return false
  const gap = b.getTime() - a.getTime()
  return gap >= 0 && gap <= CHAT_THREAD_GROUP_MS
}

/**
 * Messages (oldest first) → the rows the list renders, with day separators and
 * run boundaries decided.
 */
export function layoutMessages<M extends ChatLayoutMessage>(
  messages: M[],
  viewerId: string | null | undefined,
  now: Date = new Date(),
): Array<ChatLayoutItem<M>> {
  const out: Array<ChatLayoutItem<M>> = []
  let lastDay: string | null = null
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    const d = toDate(m.createdAt)
    if (d) {
      const key = dayKey(d)
      if (key !== lastDay) {
        out.push({ kind: 'day', key: `day-${key}`, label: dayLabel(m.createdAt, now) })
        lastDay = key
      }
    }
    const prev = messages[i - 1]
    const next = messages[i + 1]
    out.push({
      kind: 'message',
      key: m.id,
      message: m,
      mine: Boolean(viewerId) && m.authorId === viewerId,
      startsRun: !continuesRun(prev, m),
      endsRun: !next || !continuesRun(m, next),
    })
  }
  return out
}

/** "Sam Darnold" → "SD"; "chimmy" → "C"; "" → "?". Two letters at most. */
export function initialsFor(name: string | null | undefined): string {
  const words = String(name ?? '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]!.charAt(0)
  const second = words.length > 1 ? words[words.length - 1]!.charAt(0) : ''
  return (first + second).toUpperCase()
}

/**
 * An avatar URL we will put in an <img>: https, or a same-origin path. Anything
 * else (javascript:, data:, http on a live host) falls back to initials.
 */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

/*
 * The labels a sender writes as the message body when the real content is rich
 * — a GIF, a poll, an attachment. They exist because the row is text-shaped and
 * needs SOMETHING in it (a push notification, a thread preview), but once the
 * GIF itself renders, printing "🎬 GIF" under it is noise.
 */
const FALLBACK_LABELS = new Set(['🎬 GIF', '📎 Media', 'GIF', '[GIF]'])

export type MessageBodyInput = {
  body: string
  metadata?: Record<string, unknown> | null
  messageType?: string | null
  /** True when the rich half (GIF, poll, attachment) will render for this message. */
  hasRich: boolean
}

/**
 * The text to show in the bubble, or null to show none.
 *
 * ⚠ ONLY THE SENDER'S OWN FALLBACK LABELS ARE HIDDEN, AND ONLY WHEN THE THING
 * THEY STAND FOR ACTUALLY RENDERED. A message whose GIF could not be shown keeps
 * its "🎬 GIF" so the reader at least knows something was sent.
 */
export function visibleBody({ body, metadata, messageType, hasRich }: MessageBodyInput): string | null {
  const text = String(body ?? '').trim()
  if (!text) return null
  if (!hasRich) return text
  if (FALLBACK_LABELS.has(text)) return null
  /* A type-`gif` row carries the GIF's URL as its body; the GIF itself replaces it. */
  if (messageType === 'gif' && /^https:\/\//i.test(text) && !/\s/.test(text)) return null
  const poll = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).poll : null
  if (poll && typeof poll === 'object' && !Array.isArray(poll)) {
    const q = (poll as Record<string, unknown>).question
    if (typeof q === 'string' && (text === `📊 ${q.trim()}` || text === q.trim())) return null
  }
  return text
}

/** Deleted rows keep their metadata server-side (GIF, attachments). The UI must not. */
export function isDeletedMessage(metadata: Record<string, unknown> | null | undefined): boolean {
  return Boolean(metadata && typeof metadata === 'object' && typeof metadata.deletedAt === 'string' && metadata.deletedAt)
}

export function isEditedMessage(metadata: Record<string, unknown> | null | undefined): boolean {
  return Boolean(metadata && typeof metadata === 'object' && typeof metadata.editedAt === 'string' && metadata.editedAt)
}

/** Every reactor's user id, per emoji — for "who reacted". Ids never reach the screen. */
export function reactorIds(metadata: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return out
  const raw = (metadata as Record<string, unknown>).reactions
  if (!Array.isArray(raw)) return out
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const emoji = typeof e.emoji === 'string' ? e.emoji.trim() : ''
    if (!emoji || !Array.isArray(e.userIds)) continue
    const ids = e.userIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    if (ids.length) out[emoji] = ids
  }
  return out
}

/**
 * "You, Sam and 2 others" — names we can resolve from people already on screen,
 * and an honest count for the rest. Never an id.
 */
export function describeReactors(
  ids: string[],
  viewerId: string | null | undefined,
  nameFor: (userId: string) => string | null,
): { names: string[]; others: number; text: string } {
  const names: string[] = []
  let others = 0
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    if (viewerId && id === viewerId) {
      names.unshift('You')
      continue
    }
    const n = nameFor(id)
    if (n) names.push(n)
    else others += 1
  }
  const parts = [...names]
  if (others > 0) parts.push(`${others} ${others === 1 ? 'other' : 'others'}`)
  const text =
    parts.length === 0
      ? ''
      : parts.length === 1
        ? parts[0]!
        : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return { names, others, text }
}
