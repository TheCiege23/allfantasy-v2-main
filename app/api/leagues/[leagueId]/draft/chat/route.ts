/**
 * Draft room chat.
 *
 * League sync rules (explicit):
 * - When liveDraftChatSyncEnabled + draft in_progress: viewer sees the unified league chat stream
 *   PLUS draft-only `draft_pick` system rows merged in by time (`source='draft', type='draft_pick'`).
 * - User-authored posts use `source=null` while sync is on → they appear in league chat.
 * - User-authored posts use `source='draft'` while sync is off → draft-room-only chat.
 * - Draft pick notifications are always persisted as `source='draft', type='draft_pick'` → they never
 *   appear in the standalone league chat list (which excludes `source=draft`), including when sync is on.
 * - Commissioner broadcasts follow existing league chat / broadcast plumbing (unchanged here).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { parseMentions } from '@/lib/league-chat'
import {
  createLeaguePollPayload,
  parseLeaguePollPayload,
  type LeaguePollPayload,
} from '@/lib/league-chat/LeaguePollService'
import type { PlatformChatMessage } from '@/types/platform-shared'
import { prisma } from '@/lib/prisma'
import { sanitizeDraftChatPlayerContext } from '@/lib/draft-room/draft-chat-player-context'
import {
  buildDraftChatWireMessage,
  sanitizeDraftChatStructuredSendMeta,
} from '@/lib/draft-room/draft-chat-contract'
import { loadDraftChatWireMessages } from '@/lib/draft-room/draftRoomChatWireLoad'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

function toDraftMessage(m: PlatformChatMessage, syncActive: boolean, leagueId: string) {
  return buildDraftChatWireMessage(m, {
    syncActive,
    leagueId,
    sanitizePlayerContext: sanitizeDraftChatPlayerContext,
    parsePollPayload: (input: { body?: string | null; metadata?: Record<string, unknown> | null }) =>
      normalizedParsePoll(input),
  })
}

function normalizedParsePoll(input: {
  body?: string | null
  metadata?: Record<string, unknown> | null
}): LeaguePollPayload | null {
  return parseLeaguePollPayload(input)
}

function isActiveLiveDraftStatus(status: string | null | undefined): boolean {
  return status === 'in_progress'
}

function parseChatMediaPayload(text: string): {
  body: string
  type: string
  imageUrl: string | null
  mediaUrl: string | null
} {
  const token = text.match(/^\[(GIF|IMAGE|VIDEO|LINK|MEME)\]\s*(.*)$/i)
  const urlRegex = /(https?:\/\/[^\s]+)/i
  const mediaTypeMap: Record<string, string> = {
    GIF: 'gif',
    IMAGE: 'image',
    VIDEO: 'video',
    LINK: 'link',
    MEME: 'meme',
  }

  if (token) {
    const kind = String(token[1] || '').toUpperCase()
    const rest = String(token[2] || '').trim()
    const url = rest.match(urlRegex)?.[1] ?? null
    const type = mediaTypeMap[kind] ?? 'text'
    if (type === 'image') {
      return { body: rest || text, type, imageUrl: url, mediaUrl: url }
    }
    return { body: rest || text, type, imageUrl: null, mediaUrl: url }
  }

  const url = text.match(urlRegex)?.[1] ?? null
  if (!url) {
    return { body: text, type: 'text', imageUrl: null, mediaUrl: null }
  }

  const lowerUrl = url.toLowerCase()
  if (/\.(gif)(\?.*)?$/.test(lowerUrl)) {
    return { body: text, type: 'gif', imageUrl: null, mediaUrl: url }
  }
  if (/\.(png|jpg|jpeg|webp)(\?.*)?$/.test(lowerUrl)) {
    return { body: text, type: 'image', imageUrl: url, mediaUrl: url }
  }
  if (/\.(mp4|webm|mov)(\?.*)?$/.test(lowerUrl)) {
    return { body: text, type: 'video', imageUrl: null, mediaUrl: url }
  }
  return { body: text, type: 'link', imageUrl: null, mediaUrl: url }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = Math.min(Number(req.nextUrl.searchParams?.get('limit') || '80'), 100)
  const before = req.nextUrl.searchParams?.get('before')
  const beforeDate = before ? new Date(before) : undefined

  const { messages, syncActive } = await loadDraftChatWireMessages(leagueId, userId, {
    limit,
    before: beforeDate,
  })

  return NextResponse.json({
    messages,
    syncActive,
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))

  if (String(body?.type ?? '').toLowerCase() === 'draft_pick') {
    return NextResponse.json({ error: 'Pick notifications are generated by the draft engine.' }, { status: 400 })
  }

  const [draftSession, uiSettings] = await Promise.all([
    prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } }),
    getDraftUISettingsForLeague(leagueId),
  ])
  const syncOn = Boolean(uiSettings.liveDraftChatSyncEnabled) && isActiveLiveDraftStatus(draftSession?.status)

  const pollRaw = body?.poll
  if (pollRaw && typeof pollRaw === 'object' && !Array.isArray(pollRaw)) {
    const question = String((pollRaw as { question?: unknown }).question ?? '').trim()
    const rawOpts = (pollRaw as { options?: unknown }).options
    const options = Array.isArray(rawOpts)
      ? rawOpts.map((o) => String(o).trim()).filter(Boolean)
      : []
    if (question.length < 2 || options.length < 2) {
      return NextResponse.json({ error: 'Poll requires a question and at least two options.' }, { status: 400 })
    }
    const payload = createLeaguePollPayload(question, options)
    const metadata: Record<string, unknown> = {
      question: payload.question,
      options: payload.options,
      votes: payload.votes ?? {},
    }
    const created = await createLeagueChatMessage(leagueId, userId, payload.question, {
      type: 'poll',
      metadata,
      source: syncOn ? null : 'draft',
    })
    if (!created) return NextResponse.json({ error: 'Failed to send' }, { status: 500 })
    return NextResponse.json({
      message: toDraftMessage(created, syncOn, leagueId),
      syncActive: syncOn,
    })
  }

  const text = String(body?.text ?? body?.message ?? body?.body ?? '').trim()
  if (!text) return NextResponse.json({ error: 'Message required' }, { status: 400 })
  if (text.length > 1000) return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  const imageUrl =
    typeof body?.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null

  const mediaPayload = parseChatMediaPayload(text)
  const mentions = parseMentions(text)
  const structuredExtra = sanitizeDraftChatStructuredSendMeta(body?.structuredMeta ?? body?.mediaMeta)
  const metadata: Record<string, unknown> = {}
  if (mentions.length > 0) metadata.mentions = mentions
  if (mediaPayload.mediaUrl) metadata.mediaUrl = mediaPayload.mediaUrl
  const playerContext =
    body && typeof body === 'object' && 'playerContext' in body
      ? sanitizeDraftChatPlayerContext((body as Record<string, unknown>).playerContext)
      : undefined
  if (playerContext) metadata.playerContext = playerContext
  Object.assign(metadata, structuredExtra)

  const created = await createLeagueChatMessage(leagueId, userId, mediaPayload.body, {
    type: imageUrl ? 'image' : mediaPayload.type,
    imageUrl: imageUrl ?? mediaPayload.imageUrl,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    /** User messages: league-visible when sync is on; draft-only channel when sync is off. */
    source: syncOn ? null : 'draft',
  })
  if (!created) return NextResponse.json({ error: 'Failed to send' }, { status: 500 })
  return NextResponse.json({
    message: toDraftMessage(created, syncOn, leagueId),
    syncActive: syncOn,
  })
}
