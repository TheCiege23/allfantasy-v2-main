/**
 * What a CLIENT may put on a chat message it creates — and nothing else.
 *
 * 🛑 THE ROUTES STORED THE CLIENT'S `metadata` AND `messageType` VERBATIM (found 2026-09-25). The
 * readers trust both, so any league or thread member could:
 *   - set `metadata.discordAuthorName` / `discordAuthorAvatarUrl` — the read path shows those as the
 *     sender's name and avatar, so a member could post as "Chimmy" or "Commissioner", or aim every
 *     viewer's browser at an image host of their choosing;
 *   - seed `reactions` or poll votes carrying other people's user ids;
 *   - forge a `tradeCard`, or pick `messageType: 'broadcast'` for the commissioner-announcement style.
 *
 * So request paths keep an ALLOWLIST, never a denylist: a key nobody listed is a key some server
 * writer owns. Server writers (the Discord inbound relay, bots, trade cards, awards and stats jobs,
 * commissioner broadcasts) call `createLeagueChatMessage` / `createSystemMessage` / prisma directly
 * and never pass through this module, so they keep every key they write.
 *
 * ─── THE CENSUS THIS IS BUILT FROM (every client that POSTs a chat message) ─────────────────────
 *   GIF / photos / poll  — components/core-app/comms/LeagueConversation.tsx, ThreadPanel.tsx,
 *                          app/dashboard/components/LeagueChatInPanel.tsx,
 *                          components/app/draft-room/DraftChatPanel.tsx:
 *                          gifId, giphyId, gifUrl, previewUrl, gifTitle, gif{url,previewUrl,title},
 *                          attachments[{type,url,duration,mimeType}],
 *                          poll{question,options[{id,text,votes:[]}],closeAt,allowMultiple,anonymous}
 *   image / gif / file   — app/messages/MessagesContent.tsx via lib/rich-message/MessageAttachmentService:
 *                          alt, source (the GIF provider, or "url"), filename, contentType
 *   World Cup DM         — components/brackets/world-cup/WorldCupBracketShell.tsx:
 *                          source ("world_cup_private_chat"), challengeId
 *   Big Brother room     — LeagueChatInPanel.tsx sends `bbChannel`. It is NOT kept here: the room is
 *                          decided by the channel-access rule (lib/big-brother/bbChatChannelAccess.ts),
 *                          which writes it back only once the sender may post there.
 *
 * The GIF / attachment / poll half is `sanitizeDraftChatRichMeta`, which the draft room already
 * uses for this exact shape — reused rather than copied, so the two cannot drift. It rebuilds every
 * field and empties a poll's votes: a client creates a poll, the server counts it.
 *
 * Message types sent by clients: 'text' (every composer), 'poll' (ThreadPanel), and 'image' /
 * 'gif' / 'file' (MessagesContent). Anything else becomes 'text'.
 */

import { sanitizeDraftChatRichMeta } from '@/lib/draft-room/draft-chat-contract'
import { chatUploadReadUrl, parseChatUploadPath, type ChatUploadScope } from '@/lib/chat-core/chatUploadAccess'
import { isAllowedGifUrl } from '@/lib/rich-message/GIFIntegrationResolver'

export const CLIENT_MESSAGE_TYPES = ['text', 'poll', 'image', 'gif', 'file'] as const
export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number]

const CLIENT_MESSAGE_TYPE_SET: ReadonlySet<string> = new Set(CLIENT_MESSAGE_TYPES)

/**
 * The type a client may give its own message. Unknown or server-owned types ('broadcast', 'system',
 * 'stats_bot', 'trade', 'pin', 'draft_pick', 'draft_intel_*', …) are stored as plain 'text' rather
 * than refused, so an older client that sends something unexpected still gets its words through.
 */
export function sanitizeClientMessageType(raw: unknown): ClientMessageType {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return CLIENT_MESSAGE_TYPE_SET.has(value) ? (value as ClientMessageType) : 'text'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t && t.length <= max ? t : null
}

/** A short identifier-like token: a provider name, "url", "world_cup_private_chat", an id. */
function token(value: unknown, max: number): string | null {
  const t = boundedString(value, max)
  return t && /^[A-Za-z0-9_.:-]+$/.test(t) ? t : null
}

/**
 * The metadata a client may store on a message it creates. Returns `undefined` when nothing
 * survives, so callers store no metadata rather than an empty object.
 */
export function sanitizeClientMessageMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(raw)) return undefined
  const out: Record<string, unknown> = { ...sanitizeDraftChatRichMeta(raw) }

  const alt = boundedString(raw.alt, 300)
  if (alt) out.alt = alt
  const filename = boundedString(raw.filename, 255)
  if (filename) out.filename = filename
  const contentType = boundedString(raw.contentType, 120)
  if (contentType) out.contentType = contentType
  const source = token(raw.source, 48)
  if (source) out.source = source
  const challengeId = token(raw.challengeId, 64)
  if (challengeId) out.challengeId = challengeId

  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The body of a legacy `messageType: 'poll'` message, which readers parse as JSON
 * (`parsePollBody` / `parseLeaguePollPayload`) — votes included.
 *
 * A client may create the question and options; it may not arrive with votes already cast or the
 * poll already closed. So a poll body is REBUILT from its creation fields with empty votes, whether
 * those fields came in `metadata.question` / `metadata.options` or as a JSON body. A body that is not
 * poll JSON (the composer sends its "📊 question" label, with the poll itself in `metadata.poll`) is
 * returned untouched.
 */
export function buildClientPollBody(rawMetadata: unknown, rawBody: string): string {
  const fromParts = (question: unknown, options: unknown): string | null => {
    if (typeof question !== 'string' || !Array.isArray(options)) return null
    return JSON.stringify({
      question: String(question),
      options: options.map((option) => String(option)).filter(Boolean),
      votes: {},
      closed: false,
    })
  }
  if (isPlainRecord(rawMetadata)) {
    const rebuilt = fromParts(rawMetadata.question, rawMetadata.options)
    if (rebuilt) return rebuilt
  }
  const trimmed = rawBody.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (isPlainRecord(parsed)) {
        const rebuilt = fromParts(parsed.question, parsed.options)
        if (rebuilt) return rebuilt
      }
    } catch {
      /* not JSON — an ordinary label */
    }
  }
  return rawBody
}

const UPLOAD_PROBE_ORIGIN = 'https://same-site.invalid'

/**
 * A client-supplied `imageUrl` (the column every viewer's browser loads as an `<img src>`), reduced to
 * OUR OWN storage — or null.
 *
 * 🛑 THE SHARED-THREAD ROUTE STORED ANY STRING HERE (found 2026-09-25) on its league and bracket
 * branches, and the league read path copies it into the message for rendering. So any https host —
 * a tracking pixel — could be put in front of every member.
 *
 * Census of what our uploaders return (2026-09-25): `/api/chat/upload` and `/api/shared/chat/upload`
 * both return `chatUploadReadUrl(path)` — `/api/chat/upload?path=chat/…`, private storage whose reader
 * re-checks membership on every open. That is the one upload shape kept, and only when the path is
 * one the reader itself would accept (`parseChatUploadPath`); it is rebuilt from the parsed path, so
 * nothing else rides along in the query. No client of the shared-thread route sends `imageUrl` today
 * (every composer puts media in `metadata` or the body), so this is the whole contract.
 *
 * `/api/bracket/chat-upload` (the bracket pool composer) now returns the same private shape, under
 * `chat/bracket/<leagueId>/image/…`. Its OLD public Vercel Blob URLs (`…/bracket-chat/<userId>/…`)
 * are deliberately NOT accepted for new posts: "any *.blob.vercel-storage.com host" would admit every
 * OTHER Blob store on the internet too — the tracking-host hole under a trusted-looking name. Rows
 * that already carry one are untouched; this runs only on the way in.
 *
 * Pass `scope` when the route knows which chat the message is going into: an upload path is then kept
 * only when it belongs to THAT chat, which is where the upload routes store it.
 *
 * A GIF from a service we can name (`isAllowedGifUrl`: https on Klipy / GIPHY / Tenor's CDN) is kept,
 * so a GIF that travels in this field still renders.
 */
export function sanitizeClientImageUrl(raw: unknown, scope?: ChatUploadScope): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 2048) return null

  if (value.startsWith('/') && !/^[/\\][/\\]/.test(value)) {
    try {
      const url = new URL(value, UPLOAD_PROBE_ORIGIN)
      const keys = [...url.searchParams.keys()]
      const path = url.searchParams.get('path')
      const parsed = path ? parseChatUploadPath(path) : null
      if (
        url.origin === UPLOAD_PROBE_ORIGIN &&
        url.pathname === '/api/chat/upload' &&
        keys.length === 1 &&
        path &&
        parsed &&
        (!scope || (parsed.scope.kind === scope.kind && parsed.scope.id === scope.id))
      ) {
        return chatUploadReadUrl(path)
      }
    } catch {
      /* not a URL */
    }
    return null
  }

  return isAllowedGifUrl(value) ? value : null
}
