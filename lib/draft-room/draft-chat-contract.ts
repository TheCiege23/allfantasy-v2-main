/**
 * Wire contract for `/api/leagues/[leagueId]/draft/chat` — backward compatible with
 * plain text rows; optional structured fields come from LeagueChatMessage.type + metadata.
 */

import type { PlatformChatMessage } from '@/types/platform-shared'
import type { LeaguePollPayload } from '@/lib/league-chat/LeaguePollService'
import type { DraftChatPlayerContext } from '@/lib/draft-room/draft-chat-player-context'
import { redactAnonymousPollVotes } from '@/lib/chat-core/messagePolls'
import { isSameSiteRelativePath } from '@/lib/rich-message/safeMedia'

export type DraftChatMessageCategory =
  | 'USER_MESSAGE'
  | 'SYSTEM_PICK_NOTIFICATION'
  | 'COMMISSIONER_SYSTEM_MESSAGE'
  | 'AI_MESSAGE'
  | 'MEDIA_MESSAGE'
  | 'POLL_MESSAGE'

/** Semantic origin for UI / analytics (not necessarily DB `source`). */
export type DraftChatSourceContext = 'draft_room' | 'league_chat' | 'chimmy' | 'system' | 'unknown'

export type DraftChatReactionWire = {
  emoji: string
  count: number
  userIds: string[]
}

export type DraftPickMetaWire = {
  playerName: string | null
  position: string | null
  rosterDisplayName: string | null
  pickedAt: string | null
  overall: number | null
  pickLabel: string | null
  /** Present for new pick rows; older history may omit. */
  round: number | null
  roundSlot: number | null
  playerId: string | null
  nflTeam: string | null
  headshotUrl: string | null
  teamLogoUrl: string | null
  /** D.6.3 — true when this pick was made by an AI / autopick manager. */
  aiManager?: boolean | null
}

export type DraftChatAiMetadataWire = {
  aiRecommendationType?: string | null
  confidence?: number | null
  rationale?: string | null
  actions?: Array<{ label: string; action?: string }>
}

export type DraftChatWireMessage = {
  id: string
  /** Display label (sender or system label like "Draft room"). */
  from: string
  text: string
  at: string
  messageType?: string
  /** High-level category for rendering and sync policy hints. */
  messageCategory: DraftChatMessageCategory
  sourceContext: DraftChatSourceContext
  /**
   * When live draft league sync is ON, whether this row is also visible in the standalone
   * league chat stream for all members (draft-only / pick / excluded rows → false).
   */
  syncToLeagueChat: boolean
  mediaUrl?: string | null
  /** Normalized media kind from message type + metadata (gif, image, …). */
  mediaKind?: string | null
  gifProvider?: string | null
  thumbnailUrl?: string | null
  lastActiveAt?: string | null
  isBroadcast?: boolean
  isAiSuggestion?: boolean
  playerContext?: DraftChatPlayerContext | null
  mentions?: string[]
  reactions?: DraftChatReactionWire[]
  isDraftPickEvent?: boolean
  draftPickMeta?: DraftPickMetaWire | null
  pollPayload?: LeaguePollPayload | null
  /** Same as message id — explicit for poll clients. */
  pollId?: string | null
  pollExpiresAt?: string | null
  /** Viewer-facing identity (from PlatformChatMessage). */
  senderUserId?: string | null
  senderDisplayName?: string | null
  senderAvatarUrl?: string | null
  leagueId?: string | null
  aiMetadata?: DraftChatAiMetadataWire | null
  /** Set when this message answers another one (the same column league chat uses). */
  parentMessageId?: string | null
  /**
   * The row's metadata — GIF (either key layout), photos, polls, reactions, edit/delete stamps —
   * exactly as league chat receives it, anonymous poll votes redacted for the viewer.
   *
   * ⚠ THIS WAS DROPPED, AND IT IS WHY A GIF SENT FROM LEAGUE CHAT SHOWED IN THE DRAFT ROOM AS
   * THE WORDS "🎬 GIF". The composer stores the GIF in `metadata.gif` / `metadata.gifUrl` and the
   * photos in `metadata.attachments`; this wire only ever carried `metadata.mediaUrl`, which only
   * the draft room's own `[GIF] <url>` text path wrote.
   */
  metadata?: Record<string, unknown> | null
  /**
   * Client-only overlay (optional): row counts as unread for collapsed-chat badge when draft chat
   * merges local read state — not persisted on the wire/API contract.
   */
  unread?: boolean
}

const COPILOT_TYPES = new Set(['copilot_on_clock', 'copilot_prepare', 'queue_conflict'])

export function sanitizeDraftChatStructuredSendMeta(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (typeof o.gifProvider === 'string') {
    const g = o.gifProvider.trim().slice(0, 48)
    if (g) out.gifProvider = g
  }
  if (typeof o.thumbnailUrl === 'string') {
    const t = o.thumbnailUrl.trim()
    if (t.startsWith('http') && t.length <= 2048) out.thumbnailUrl = t
  }
  return out
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t && t.length <= max ? t : null
}

/** https only — a GIF is the one thing anybody can aim at an arbitrary URL by pasting it. */
function httpsUrl(value: unknown): string | null {
  const t = boundedString(value, 2048)
  return t && /^https:\/\//i.test(t) ? t : null
}

/**
 * An uploaded file: our own upload route's same-origin path, or https. Never `//host`, and never
 * `/\host` either — a browser reads that as the same protocol-relative URL (see safeMedia.ts).
 */
function mediaUrl(value: unknown): string | null {
  const t = boundedString(value, 2048)
  if (!t) return null
  if (t.startsWith('/')) return isSameSiteRelativePath(t) ? t : null
  return /^https:\/\//i.test(t) ? t : null
}

const MAX_DRAFT_CHAT_ATTACHMENTS = 4
const MAX_DRAFT_CHAT_POLL_OPTIONS = 10

/**
 * The rich half of a draft-room message — GIF, photos, a poll — in the SAME metadata shape
 * league chat stores (`/api/league/chat`, written by the shared composer), so one row renders
 * identically in both rooms and votes through the same `/vote` route.
 *
 * ⚠ EVERY FIELD IS REBUILT, NOTHING IS COPIED THROUGH. The body is client JSON that lands in
 * every league member's chat; a poll arrives with its votes emptied (a client does not get to
 * post a poll with a result already on it), and unknown keys are dropped.
 */
export function sanitizeDraftChatRichMeta(raw: unknown): Record<string, unknown> {
  if (!isPlainRecord(raw)) return {}
  const out: Record<string, unknown> = {}

  if (isPlainRecord(raw.gif)) {
    const url = httpsUrl(raw.gif.url)
    const preview = httpsUrl(raw.gif.previewUrl)
    if (url || preview) {
      out.gif = {
        url: url ?? preview,
        previewUrl: preview ?? url,
        title: boundedString(raw.gif.title, 140) ?? 'GIF',
      }
    }
  }
  const gifUrl = httpsUrl(raw.gifUrl)
  if (gifUrl) out.gifUrl = gifUrl
  const previewUrl = httpsUrl(raw.previewUrl)
  if (previewUrl) out.previewUrl = previewUrl
  const gifTitle = boundedString(raw.gifTitle, 140)
  if (gifTitle && (out.gif || out.gifUrl)) out.gifTitle = gifTitle
  const gifId = boundedString(raw.gifId, 128)
  if (gifId) out.gifId = gifId
  const giphyId = boundedString(raw.giphyId, 128)
  if (giphyId) out.giphyId = giphyId

  if (Array.isArray(raw.attachments)) {
    const attachments: Array<Record<string, unknown>> = []
    for (const entry of raw.attachments) {
      if (attachments.length >= MAX_DRAFT_CHAT_ATTACHMENTS) break
      if (!isPlainRecord(entry)) continue
      const type = entry.type === 'image' || entry.type === 'video' || entry.type === 'voice' ? entry.type : null
      const url = mediaUrl(entry.url)
      if (!type || !url) continue
      const a: Record<string, unknown> = { type, url }
      const mime = boundedString(entry.mimeType, 80)
      if (mime) a.mimeType = mime
      if (typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration >= 0) {
        a.duration = Math.min(entry.duration, 600)
      }
      attachments.push(a)
    }
    if (attachments.length > 0) out.attachments = attachments
  }

  if (isPlainRecord(raw.poll)) {
    const question = boundedString(raw.poll.question, 300)
    const options: Array<{ id: string; text: string; votes: string[] }> = []
    if (Array.isArray(raw.poll.options)) {
      raw.poll.options.forEach((entry, i) => {
        if (options.length >= MAX_DRAFT_CHAT_POLL_OPTIONS) return
        const text = isPlainRecord(entry) ? boundedString(entry.text, 200) : boundedString(entry, 200)
        if (!text) return
        const id = (isPlainRecord(entry) ? boundedString(entry.id, 64) : null) ?? `opt-${i}`
        options.push({ id, text, votes: [] })
      })
    }
    if (question && options.length >= 2) {
      const closeAtRaw = boundedString(raw.poll.closeAt, 64)
      const closeAt = closeAtRaw && !Number.isNaN(Date.parse(closeAtRaw)) ? new Date(closeAtRaw).toISOString() : null
      out.poll = {
        question,
        options,
        ...(closeAt ? { closeAt } : {}),
        allowMultiple: raw.poll.allowMultiple === true,
        anonymous: raw.poll.anonymous === true,
      }
    }
  }

  return out
}

function normalizeReactionEntries(metadata: unknown): DraftChatReactionWire[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  const raw = (metadata as Record<string, unknown>).reactions
  if (!Array.isArray(raw)) return []
  const out: DraftChatReactionWire[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as { emoji?: unknown; count?: unknown; userIds?: unknown }
    const emoji = typeof e.emoji === 'string' ? e.emoji.trim() : ''
    if (!emoji) continue
    const userIds = Array.isArray(e.userIds)
      ? e.userIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []
    const countRaw = e.count
    const count =
      typeof countRaw === 'number' && Number.isFinite(countRaw)
        ? Math.max(0, Math.floor(countRaw))
        : userIds.length
    out.push({ emoji, count, userIds })
  }
  return out
}

function inferCategory(
  normalizedType: string,
  isDraftPickEvent: boolean,
  isAiSuggestion: boolean,
): DraftChatMessageCategory {
  if (isDraftPickEvent) return 'SYSTEM_PICK_NOTIFICATION'
  if (normalizedType === 'poll') return 'POLL_MESSAGE'
  if (normalizedType === 'broadcast' || normalizedType === 'system') return 'COMMISSIONER_SYSTEM_MESSAGE'
  if (isAiSuggestion) return 'AI_MESSAGE'
  if (['gif', 'image', 'video', 'meme', 'link'].includes(normalizedType)) return 'MEDIA_MESSAGE'
  return 'USER_MESSAGE'
}

function inferSourceContext(
  normalizedType: string,
  meta: Record<string, unknown> | null,
  channelSource: string | null | undefined,
  isDraftPickEvent: boolean,
  isAiSuggestion: boolean,
): DraftChatSourceContext {
  if (
    typeof meta?.messageSubtype === 'string' &&
    meta.messageSubtype.toLowerCase().includes('chimmy')
  ) {
    return 'chimmy'
  }
  if (
    typeof meta?.sourceContext === 'string' &&
    ['draft_room', 'league_chat', 'chimmy', 'system'].includes(String(meta.sourceContext))
  ) {
    return meta.sourceContext as DraftChatSourceContext
  }
  if (isDraftPickEvent || channelSource === 'draft') return 'draft_room'
  if (normalizedType === 'system' || normalizedType === 'broadcast') return 'system'
  if (isAiSuggestion) return 'chimmy'
  if (channelSource == null) return 'league_chat'
  return 'unknown'
}

function extractAiMetadata(meta: Record<string, unknown> | null): DraftChatAiMetadataWire | null {
  if (!meta) return null
  const aiRecommendationType =
    typeof meta.aiRecommendationType === 'string' ? meta.aiRecommendationType : undefined
  const rationale = typeof meta.rationale === 'string' ? meta.rationale : undefined
  let confidence: number | undefined
  if (typeof meta.confidence === 'number' && Number.isFinite(meta.confidence)) {
    confidence = meta.confidence
  } else if (typeof meta.confidence === 'string') {
    const n = Number(meta.confidence)
    if (Number.isFinite(n)) confidence = n
  }
  let actions: DraftChatAiMetadataWire['actions']
  if (Array.isArray(meta.actions)) {
    actions = meta.actions
      .map((a) => {
        if (!a || typeof a !== 'object') return null
        const r = a as Record<string, unknown>
        const label = typeof r.label === 'string' ? r.label.trim() : ''
        if (!label) return null
        const action = typeof r.action === 'string' ? r.action : undefined
        return { label, action }
      })
      .filter(Boolean) as DraftChatAiMetadataWire['actions']
  }
  if (!aiRecommendationType && !rationale && confidence == null && !actions?.length) return null
  return {
    aiRecommendationType: aiRecommendationType ?? null,
    rationale: rationale ?? null,
    confidence: confidence ?? null,
    actions,
  }
}

export function buildDraftChatWireMessage(
  m: PlatformChatMessage,
  opts: {
    syncActive: boolean
    leagueId?: string | null
    sanitizePlayerContext: (raw: unknown) => DraftChatPlayerContext | null
    parsePollPayload: (input: { body?: string | null; metadata?: Record<string, unknown> | null }) => LeaguePollPayload | null
    /** Who is reading — anonymous poll votes other than theirs are redacted on the way out. */
    viewerUserId?: string | null
  },
): DraftChatWireMessage {
  const metadata = m.metadata ?? null
  const metaRecord = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : null
  const normalizedType = String(m.messageType ?? 'text').toLowerCase()

  const fromMetaAi =
    typeof metaRecord?.isAiSuggestion === 'boolean'
      ? metaRecord.isAiSuggestion
      : COPILOT_TYPES.has(normalizedType)
  const isAiSuggestion = Boolean(fromMetaAi)

  const isDraftPickEvent =
    normalizedType === 'draft_pick' ||
    Boolean(metaRecord && metaRecord.draftPickEvent === true)

  const playerContext = opts.sanitizePlayerContext(metaRecord?.playerContext)

  const draftPickMeta: DraftPickMetaWire | null =
    isDraftPickEvent && metaRecord
      ? {
          playerName: typeof metaRecord.playerName === 'string' ? metaRecord.playerName : null,
          position: typeof metaRecord.position === 'string' ? metaRecord.position : null,
          rosterDisplayName:
            typeof metaRecord.rosterDisplayName === 'string' ? metaRecord.rosterDisplayName : null,
          pickedAt: typeof metaRecord.pickedAt === 'string' ? metaRecord.pickedAt : null,
          overall: typeof metaRecord.overall === 'number' ? metaRecord.overall : null,
          pickLabel: typeof metaRecord.pickLabel === 'string' ? metaRecord.pickLabel : null,
          round: typeof metaRecord.round === 'number' ? metaRecord.round : null,
          roundSlot:
            typeof metaRecord.roundSlot === 'number'
              ? metaRecord.roundSlot
              : typeof metaRecord.slot === 'number'
                ? metaRecord.slot
                : null,
          playerId: typeof metaRecord.playerId === 'string' ? metaRecord.playerId : null,
          nflTeam: typeof metaRecord.nflTeam === 'string' ? metaRecord.nflTeam : null,
          headshotUrl: typeof metaRecord.headshotUrl === 'string' ? metaRecord.headshotUrl : null,
          teamLogoUrl: typeof metaRecord.teamLogoUrl === 'string' ? metaRecord.teamLogoUrl : null,
          // D.6.3 — preserved across the wire so the chat card can show the
          // "AI Manager" badge when the pick was an autopick.
          aiManager: metaRecord.aiManager === true ? true : null,
        }
      : null

  let pollPayload: LeaguePollPayload | null = null
  if (normalizedType === 'poll') {
    pollPayload = opts.parsePollPayload({
      body: m.body,
      metadata: metaRecord,
    })
  }

  const displayFrom = isDraftPickEvent
    ? 'Draft room'
    : normalizedType === 'system'
      ? (m.senderName ?? 'League')
      : (m.senderName ?? 'User')

  const messageCategory = inferCategory(normalizedType, isDraftPickEvent, isAiSuggestion)

  const channelSource = m.channelSource ?? null
  const sourceContext = inferSourceContext(normalizedType, metaRecord, channelSource, isDraftPickEvent, isAiSuggestion)

  const isPrivateRow = Boolean(metaRecord?.isPrivate)
  const leagueExcluded = Boolean(metaRecord?.leagueChatSyncExcluded)
  const syncToLeagueChat = Boolean(
    opts.syncActive &&
      !isPrivateRow &&
      !leagueExcluded &&
      channelSource !== 'draft' &&
      messageCategory !== 'SYSTEM_PICK_NOTIFICATION',
  )

  const gifProvider =
    typeof metaRecord?.gifProvider === 'string' ? metaRecord.gifProvider : null
  const thumbnailUrl =
    typeof metaRecord?.thumbnailUrl === 'string' ? metaRecord.thumbnailUrl : null
  const mediaKind = ['gif', 'image', 'video', 'meme', 'link'].includes(normalizedType)
    ? normalizedType
    : null

  const aiMetadata = extractAiMetadata(metaRecord)

  return {
    id: m.id,
    from: displayFrom,
    text: m.body,
    at: m.createdAt,
    messageCategory,
    sourceContext,
    syncToLeagueChat,
    messageType: normalizedType,
    mediaUrl:
      (metadata as { mediaUrl?: string } | null)?.mediaUrl ??
      (metadata as { imageUrl?: string } | null)?.imageUrl ??
      null,
    mediaKind,
    gifProvider,
    thumbnailUrl,
    mentions: Array.isArray(metaRecord?.mentions) ? (metaRecord.mentions as string[]) : [],
    lastActiveAt: typeof metaRecord?.lastActiveAt === 'string' ? metaRecord.lastActiveAt : null,
    reactions: normalizeReactionEntries(metadata),
    isBroadcast: normalizedType === 'broadcast',
    ...(playerContext ? { playerContext } : {}),
    ...(isAiSuggestion ? { isAiSuggestion: true as const } : {}),
    ...(isDraftPickEvent ? { isDraftPickEvent: true as const, draftPickMeta } : {}),
    ...(pollPayload
      ? {
          pollPayload,
          pollId: m.id,
          ...(typeof metaRecord?.pollExpiresAt === 'string'
            ? { pollExpiresAt: metaRecord.pollExpiresAt }
            : {}),
        }
      : {}),
    senderUserId: m.senderUserId ?? null,
    senderDisplayName: m.senderName ?? null,
    senderAvatarUrl: m.senderAvatarUrl ?? null,
    leagueId: opts.leagueId ?? null,
    ...(aiMetadata ? { aiMetadata } : {}),
    parentMessageId: m.parentMessageId ?? null,
    metadata: metaRecord
      ? ((redactAnonymousPollVotes(metaRecord, opts.viewerUserId ?? null) ?? null) as Record<string, unknown> | null)
      : null,
  }
}
