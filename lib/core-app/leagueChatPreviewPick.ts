import type { PlatformChatMessage } from '@/types/platform-shared'

/**
 * What the league-first chat bar shows: the newest line of league chat, as one short sentence.
 *
 * Pure so it can be tested without a database; the read lives in `leagueChatPreview.ts`.
 */
export type LeagueChatPreview = {
  senderName: string
  text: string
  createdAt: string
}

const PREVIEW_MAX = 90

/**
 * The newest message worth previewing, or null.
 *
 * ⚠ A PIN IS A CHAT ROW WHOSE BODY IS JSON (see `/api/league/chat` GET), so it is skipped rather
 * than previewed as `{"messageId":…}`. Any other non-text row — a trade card, a poll — is named by
 * its type instead of its body, for the same reason: bodies of structured rows are not sentences.
 */
export function pickLeagueChatPreview(messages: readonly PlatformChatMessage[]): LeagueChatPreview | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const type = (m.messageType ?? 'text').toLowerCase()
    if (type === 'pin') continue
    const raw = type === 'text' || type === 'chat' ? String(m.body ?? '') : ''
    const oneLine = raw.replace(/\s+/g, ' ').trim()
    const text = oneLine
      ? oneLine.length > PREVIEW_MAX
        ? `${oneLine.slice(0, PREVIEW_MAX - 1).trimEnd()}…`
        : oneLine
      : type === 'text' || type === 'chat'
        ? ''
        : `shared a ${type.replace(/_/g, ' ')}`
    if (!text) continue
    return { senderName: m.senderName?.trim() || 'Manager', text, createdAt: m.createdAt }
  }
  return null
}
