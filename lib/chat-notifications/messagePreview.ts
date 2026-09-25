/**
 * The one-line preview a message alert carries — push body, bell row, email quote, text.
 *
 * PURE, AND SAFE TO IMPORT FROM THE BROWSER: no prisma, no server-only.
 *
 * ⚠ THE BODY OF A MEDIA MESSAGE IS NOT WORDS. An `image` / `gif` / `file` row stores the URL as its
 * body and a `poll` row stores JSON, so previewing `body` verbatim would push a storage URL or a
 * blob of JSON to somebody's lock screen. Those collapse to "sent a photo" / "sent a GIF" /
 * "sent a poll". The composer's own fallback labels ("🎬 GIF", "📎 Media") get the same treatment,
 * because they are placeholders for the real thing, not something anyone typed.
 *
 * ⚠ CENSORED THE SAME WAY THE APP RENDERS IT. The conversation shows swearing as comic-strip
 * symbols (`censorProfanity`, applied at render). A lock-screen preview that printed the raw word
 * would be the one surface that did not.
 */

import { censorProfanity } from '@/lib/chat-core/censorProfanity'

export const MESSAGE_PREVIEW_MAX_CHARS = 140

export type MessagePreviewInput = {
  messageType?: string | null
  body?: string | null
  metadata?: Record<string, unknown> | null
}

const MEDIA_LABELS = {
  photo: 'sent a photo',
  gif: 'sent a GIF',
  video: 'sent a video',
  voice: 'sent a voice note',
  file: 'sent a file',
  meme: 'sent a meme',
  poll: 'sent a poll',
  media: 'sent an attachment',
} as const

/** Bodies the composer writes when the message has no words of its own. */
const PLACEHOLDER_BODIES = new Set(['🎬 gif', '📎 media', 'gif', 'image', 'photo', 'video', 'media'])

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/** Collapse whitespace and cut to `max` characters by code point, so an emoji is never split. */
export function truncatePreview(text: string, max = MESSAGE_PREVIEW_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  if (chars.length <= max) return flat
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`
}

function pollQuestion(body: string | null | undefined, meta: Record<string, unknown> | null): string | null {
  const fromMeta = str(obj(meta?.poll)?.question) ?? str(meta?.question)
  if (fromMeta) return fromMeta
  if (!body) return null
  try {
    const parsed = JSON.parse(body) as unknown
    return str(obj(parsed)?.question)
  } catch {
    return null
  }
}

function withQuestion(label: string, question: string | null): string {
  return question ? `${label}: ${censorProfanity(question)}` : label
}

/** What kind of media a text-shaped row carries in its metadata, if any. */
function mediaFromMetadata(meta: Record<string, unknown> | null): keyof typeof MEDIA_LABELS | null {
  if (!meta) return null
  if (obj(meta.gif) || str(meta.gifUrl) || str(meta.giphyId)) return 'gif'
  if (obj(meta.poll)) return 'poll'
  if (Array.isArray(meta.attachments)) {
    for (const raw of meta.attachments as unknown[]) {
      const type = str(obj(raw)?.type)?.toLowerCase()
      if (type === 'image' || type === 'photo') return 'photo'
      if (type === 'gif') return 'gif'
      if (type === 'video') return 'video'
      if (type === 'voice' || type === 'audio') return 'voice'
      if (type) return 'media'
    }
  }
  return null
}

/**
 * The preview, never empty. `sender` is not included — every caller puts the sender in the title,
 * so "Alex · sent a GIF" reads as one sentence.
 */
export function buildMessagePreview(input: MessagePreviewInput, max = MESSAGE_PREVIEW_MAX_CHARS): string {
  const type = String(input.messageType || 'text').trim().toLowerCase()
  const meta = obj(input.metadata)
  const body = typeof input.body === 'string' ? input.body : ''

  switch (type) {
    case 'image':
    case 'photo':
    case 'media':
      return MEDIA_LABELS.photo
    case 'gif':
      return MEDIA_LABELS.gif
    case 'video':
      return MEDIA_LABELS.video
    case 'voice':
    case 'audio':
      return MEDIA_LABELS.voice
    case 'file':
      return MEDIA_LABELS.file
    case 'meme':
      return MEDIA_LABELS.meme
    case 'poll':
      return truncatePreview(withQuestion(MEDIA_LABELS.poll, pollQuestion(body, meta)), max)
    default:
      break
  }

  const text = body.replace(/\s+/g, ' ').trim()
  const media = mediaFromMetadata(meta)
  const isPlaceholder =
    !text || PLACEHOLDER_BODIES.has(text.toLowerCase()) || (media === 'poll' && text.startsWith('📊'))

  if (isPlaceholder) {
    if (media === 'poll') return truncatePreview(withQuestion(MEDIA_LABELS.poll, pollQuestion(null, meta)), max)
    if (media) return MEDIA_LABELS[media]
    return 'sent a message'
  }

  return truncatePreview(censorProfanity(text), max)
}
