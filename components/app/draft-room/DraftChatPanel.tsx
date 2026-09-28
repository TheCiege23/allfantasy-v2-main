'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Maximize2, MessageCircle, Megaphone, Minimize2, RotateCw } from 'lucide-react'
import type { DraftChatWireMessage } from '@/lib/draft-room/draft-chat-contract'
import { PlayerAvatar } from './PlayerAvatar'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import RichMessage, { hasRichContent } from '@/components/core-app/comms/RichMessage'
import { LeagueConversation } from '@/components/core-app/comms/LeagueConversation'
import { DraftPollView, draftPollVoteUrl, readDraftPoll } from '@/components/core-app/comms/draftPoll'
import { ChatComposer, type LeagueComposerPayload } from '@/app/dashboard/components/chat/ChatComposer'
import { readReactions, toggleReactionLocally, type ViewerReaction } from '@/lib/chat-core/messageReactions'
import { notifyMentions, leagueMentionRoomId } from '@/lib/chat-core/notifyMentions'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import '@/components/core-app/af-comms.css'

/**
 * Draft room chat.
 *
 * 🛑 WHAT WAS BROKEN, PRECISELY:
 *   - GIF was a `window.prompt("Paste gif URL")` that typed `[GIF] <url>` into the box. No
 *     search. Where a webview blocks prompts it sent the literal text "[GIF]". Any https URL
 *     was then drawn as an <img> — no host check, no credit line.
 *   - A GIF or photo sent from LEAGUE chat reached the draft room as the words "🎬 GIF" /
 *     "📎 Media": the wire (`draft-chat-contract.ts`) dropped `metadata`, so the composer's
 *     `metadata.gif` / `metadata.attachments` never arrived. It carries them now.
 *   - Emoji was a hard-coded row of eight; reactions a row of six, with no way to see who.
 *   - Un-reacting could POST instead of DELETE: the add/remove decision was read out of a
 *     React state UPDATER, which React may run later — after the request had been chosen.
 *   - No photos, no replies, no copy, no edit/delete, and @mentions offered only people who
 *     had already spoken, then notified nobody.
 *
 * Now: the same conversation list, rich renderer and composer as league chat (GIF search
 * through our server, Klipy/GIPHY/Tenor only and credited; the full emoji picker; polls;
 * photos by button, drop or paste; @ the league's members), and a switch to the LEAGUE's chat
 * itself when the commissioner's live-sync is off. With sync on, this room already IS league
 * chat plus the pick feed, and the header says so.
 */

export type DraftChatReaction = {
  emoji: string
  count: number
  userIds: string[]
}

/** Draft room chat wire shape from `/api/leagues/[leagueId]/draft/chat`. */
export type DraftChatMessage = DraftChatWireMessage

/** What the room posts: words, GIF/photos/poll in league chat's metadata shape, and a reply target. */
export type DraftChatSendPayload = {
  text: string
  metadata?: Record<string, unknown>
  parentMessageId?: string | null
}

export type DraftChatPanelProps = {
  messages: DraftChatMessage[]
  /**
   * Post a message. MUST reject on failure: the composer clears the box before it awaits
   * this and only puts the message back when it rejects. Resolve with the new id so
   * @mentions can be announced.
   */
  onSend: (payload: DraftChatSendPayload) => Promise<{ id?: string } | void> | void
  sending?: boolean
  /** League-specific: draft chat syncs with league chat when true */
  leagueChatSync?: boolean
  /** Commissioner: show broadcast entry point */
  isCommissioner?: boolean
  onBroadcast?: () => void
  onAiSuggestionClick?: () => void
  /** Refetch/reconnect entry; call when reconnecting */
  onReconnect?: () => void
  /** Refetch only the chat — after a reaction, vote, edit or delete. */
  onRefreshChat?: () => void
  disabled?: boolean
  /** Current viewer's appUserId — puts your messages on your side and marks your reactions. */
  currentUserId?: string | null
  presentationVariant?: 'default' | 'redraft_snake'
  /** Last chat POST failure — cleared on successful send */
  sendError?: string | null
  onDismissSendError?: () => void
  /** Required for reactions, polls, uploads, @mentions and the league chat view. */
  leagueId?: string | null
  leagueName?: string | null
}

type View = 'draft' | 'league'

function isCopilotLocal(m: DraftChatMessage): boolean {
  return m.id.startsWith('ai-copilot-')
}

/**
 * The wire row as the shared list reads it. Pick announcements and copilot notes have no
 * author (they are drawn as cards, never as somebody's bubble). Rows from the old
 * `[IMAGE] <url>` / `[GIF] <url>` text path carry their URL as `mediaUrl`; it is mapped onto
 * the attachment / GIF keys `RichMessage` reads, which then applies its own https and GIF-host
 * checks — an arbitrary pasted host still renders as text, never as an <img>.
 */
function toListMessage(m: DraftChatMessage): ChatListMessage {
  const system = Boolean(m.isDraftPickEvent || m.isAiSuggestion)
  const meta: Record<string, unknown> = { ...(m.metadata ?? {}) }
  const type = String(m.messageType ?? '').toLowerCase()
  if (m.mediaUrl && !Array.isArray(meta.attachments) && (type === 'image' || type === 'meme')) {
    meta.attachments = [{ type: 'image', url: m.mediaUrl }]
  }
  if (m.mediaUrl && type === 'video' && !Array.isArray(meta.attachments)) {
    meta.attachments = [{ type: 'video', url: m.mediaUrl }]
  }
  if (m.mediaUrl && type === 'gif' && !meta.gif && !meta.gifUrl) meta.gifUrl = m.mediaUrl
  if (!Array.isArray(meta.reactions) && Array.isArray(m.reactions)) meta.reactions = m.reactions
  return {
    id: m.id,
    authorId: system ? null : m.senderUserId ?? null,
    authorName: m.from || m.senderDisplayName || 'Someone',
    avatarUrl: m.senderAvatarUrl ?? null,
    body: m.isDraftPickEvent ? '' : m.text,
    createdAt: m.at,
    parentMessageId: m.parentMessageId ?? null,
    metadata: meta,
    messageType: m.messageType ?? null,
  }
}

export function DraftChatPanel({
  messages,
  onSend,
  sending = false,
  leagueChatSync = false,
  isCommissioner = false,
  onBroadcast,
  onAiSuggestionClick,
  onReconnect,
  onRefreshChat,
  disabled = false,
  currentUserId = null,
  presentationVariant = 'default',
  sendError = null,
  onDismissSendError,
  leagueId = null,
  leagueName = null,
}: DraftChatPanelProps) {
  const rs = presentationVariant === 'redraft_snake'
  const [view, setView] = useState<View>('draft')
  /** Laptop only: the chat lifted out of the short dock into a tall panel. */
  const [popped, setPopped] = useState(false)
  const [replyTo, setReplyTo] = useState<DraftChatMessage | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reactionOverride, setReactionOverride] = useState<Record<string, ViewerReaction[]>>({})
  const [reactionBusy, setReactionBusy] = useState<string | null>(null)
  const [voteBusy, setVoteBusy] = useState<string | null>(null)
  /** The draft conversation — photos dropped anywhere on it land in the message. */
  const convoRef = useRef<HTMLDivElement | null>(null)
  const room = leagueId ? `league:${leagueId}` : null
  const refresh = onRefreshChat ?? onReconnect
  /* With sync on this room already IS league chat (plus picks); one view, no switch. */
  const canSwitch = Boolean(leagueId) && !leagueChatSync
  const activeView: View = canSwitch ? view : 'draft'

  const byId = useMemo(() => {
    const map = new Map<string, DraftChatMessage>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])
  const listMessages = useMemo(() => messages.map(toListMessage), [messages])

  const nameForUserId = useCallback(
    (id: string): string | null => messages.find((m) => m.senderUserId === id)?.from ?? null,
    [messages],
  )

  /*
   * Reactions, through the same league-room route league chat uses (every draft message is a
   * LeagueChatMessage). The add/remove choice is made from state read HERE, before the
   * request — see the header note on the updater that used to decide it.
   */
  const toggleReaction = useCallback(
    async (m: ChatListMessage, emoji: string) => {
      if (!room || reactionBusy || disabled) return
      const current = reactionOverride[m.id] ?? readReactions(m.metadata, currentUserId)
      const next = toggleReactionLocally(current, emoji)
      const adding = next.some((r) => r.emoji === emoji && r.mine)
      setReactionOverride((prev) => ({ ...prev, [m.id]: next }))
      setReactionBusy(m.id)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(m.id)}/reactions`,
          {
            method: adding ? 'POST' : 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji }),
          },
        )
        if (!res.ok) throw new Error(`server said ${res.status}`)
        setActionError(null)
      } catch (e) {
        setActionError(e instanceof Error ? `Reaction didn't save — ${e.message}.` : "Reaction didn't save.")
      } finally {
        setReactionOverride((prev) => {
          const rest = { ...prev }
          delete rest[m.id]
          return rest
        })
        setReactionBusy(null)
        refresh?.()
      }
    },
    [room, reactionBusy, disabled, reactionOverride, currentUserId, refresh],
  )

  const post = useCallback(
    async (url: string, init: RequestInit, failure: string, busyId: string) => {
      setVoteBusy(busyId)
      try {
        const res = await fetch(url, init)
        if (!res.ok) throw new Error(`server said ${res.status}`)
        setActionError(null)
      } catch (e) {
        setActionError(e instanceof Error ? `${failure} — ${e.message}.` : `${failure}.`)
      } finally {
        setVoteBusy(null)
        refresh?.()
      }
    },
    [refresh],
  )

  const editMessage = useCallback(
    async (m: ChatListMessage, nextBody: string) => {
      if (!room) throw new Error('no league')
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(m.id)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: nextBody }) },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that edit.")
      refresh?.()
    },
    [room, refresh],
  )

  const deleteMessage = useCallback(
    async (m: ChatListMessage) => {
      if (!room) throw new Error('no league')
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(m.id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error("Couldn't delete that message.")
      refresh?.()
    },
    [room, refresh],
  )

  /*
   * The composer's payload, in league chat's metadata shape — the same mapping
   * `LeagueConversation` makes, so one row renders the same in both rooms.
   */
  const sendPayload = useCallback(
    async (payload: LeagueComposerPayload) => {
      /* Never a silent return: the composer has already cleared the box. */
      if (disabled) throw new Error('chat is paused')
      if (sending) throw new Error('still sending the previous message')
      const text = payload.text.trim()
      const metadata: Record<string, unknown> = {}
      if (payload.gifUrl || payload.giphyId) {
        if (payload.gifId) metadata.gifId = payload.gifId
        if (payload.giphyId) metadata.giphyId = payload.giphyId
        if (payload.gifUrl) metadata.gifUrl = payload.gifUrl
        if (payload.previewUrl) metadata.previewUrl = payload.previewUrl
        if (payload.gifTitle) metadata.gifTitle = payload.gifTitle
        metadata.gif = {
          previewUrl: payload.previewUrl ?? payload.gifUrl ?? '',
          url: payload.gifUrl ?? '',
          title: payload.gifTitle ?? 'GIF',
        }
      }
      if (payload.attachments?.length) {
        metadata.attachments = payload.attachments.map((a) => ({
          type: a.type,
          url: a.url,
          duration: a.duration,
          mimeType: a.mimeType,
        }))
      }
      if (payload.poll) {
        metadata.poll = {
          question: payload.poll.question,
          options: payload.poll.options.map((t, i) => ({ id: `opt-${i}-${Date.now()}`, text: t, votes: [] as string[] })),
          closeAt: payload.poll.closeAt.toISOString(),
          allowMultiple: payload.poll.allowMultiple,
          anonymous: Boolean(payload.poll.anonymous),
        }
      }
      if (!text && Object.keys(metadata).length === 0) throw new Error('nothing to send')

      const created = await onSend({
        text,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(replyTo ? { parentMessageId: replyTo.id } : {}),
      })
      /* Only once it actually sent — a failed reply keeps its target. */
      setReplyTo(null)
      /* @name and @all reach people only through this; the message is already posted either way. */
      if (leagueId && created && typeof created === 'object' && created.id && text) {
        void notifyMentions({ threadId: leagueMentionRoomId(leagueId), messageId: created.id, text })
      }
    },
    [disabled, sending, onSend, replyTo, leagueId],
  )

  /** Pick announcements and copilot notes: drawn as cards across the chat, not as somebody's bubble. */
  const renderSystem = useCallback(
    (lm: ChatListMessage) => {
      const m = byId.get(lm.id)
      if (!m) return null
      if (m.isDraftPickEvent) {
        const meta = m.draftPickMeta
        const when = meta?.pickedAt ? new Date(meta.pickedAt) : new Date(m.at)
        const headshot = meta?.headshotUrl ?? null
        const isAi = meta?.aiManager === true
        return (
          <div
            className={`rounded-xl border px-3 py-2.5 text-[11px] shadow-lg ${
              rs
                ? 'border-emerald-400/35 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(6,12,28,0.98))] ring-1 ring-emerald-500/15'
                : 'border-emerald-400/25 bg-emerald-500/10'
            }`}
            data-testid="draft-chat-pick-event"
            data-ai-manager={isAi ? 'true' : 'false'}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200/95">
                Pick{meta?.pickLabel ? ` ${meta.pickLabel}` : ''}
              </span>
              <span className="text-[10px] text-white/55 tabular-nums">
                {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <div className="mt-2 flex items-start gap-2.5">
              {/* D.6.3 — player headshot via shared PlayerAvatar (silhouette+initials fallback,
                  DEF team-logo promotion, broken-load handling all centralized). */}
              <PlayerAvatar
                headshotUrl={headshot}
                teamLogoUrl={meta?.teamLogoUrl ?? null}
                teamAbbr={meta?.nflTeam ?? null}
                position={meta?.position ?? null}
                displayName={meta?.playerName ?? 'Player'}
                size={48}
                testIdBase="draft-chat-pick-headshot"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold leading-snug text-white">
                  {meta?.playerName ?? m.text}
                  {meta?.position ? (
                    <span className="ml-1.5 text-[12px] font-medium text-white/65">{meta.position}</span>
                  ) : null}
                  {meta?.nflTeam ? (
                    <span className="ml-1.5 text-[11px] font-medium text-white/45">· {meta.nflTeam}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-[12px] text-emerald-100/90" data-testid="draft-chat-pick-drafter">
                  <span className="text-white/50">To </span>
                  <span className="font-medium">{meta?.rosterDisplayName ?? 'Team'}</span>
                  {isAi ? (
                    <span
                      className="ml-1.5 inline-flex items-center rounded-full border border-violet-400/35 bg-violet-500/15 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-100"
                      data-testid="draft-chat-pick-ai-badge"
                    >
                      AI
                    </span>
                  ) : null}
                </p>
                {(meta?.overall != null || meta?.round != null) && (
                  <p className="mt-1 text-[10px] text-white/45">
                    {meta?.round != null && meta?.roundSlot != null ? (
                      <>
                        Round {meta.round} · Pick {meta.roundSlot}
                      </>
                    ) : meta?.pickLabel ? (
                      <>Round/pick {meta.pickLabel}</>
                    ) : null}
                    {meta?.overall != null ? <> · #{meta.overall} overall</> : null}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      }
      if (m.isAiSuggestion) {
        return (
          <div
            className={`rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed ${
              rs
                ? 'border-cyan-400/35 bg-[linear-gradient(145deg,rgba(34,211,238,0.12),rgba(15,23,42,0.96))] ring-1 ring-cyan-400/12'
                : 'border-cyan-400/30 bg-cyan-500/10'
            }`}
            data-ai-suggestion="true"
            data-testid="draft-chat-copilot"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-semibold text-cyan-100">{m.from}</span>
              <span className="rounded-full border border-cyan-400/25 bg-black/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100/90">
                {m.messageType === 'copilot_prepare'
                  ? 'Prep'
                  : m.messageType === 'queue_conflict'
                    ? 'Queue'
                    : m.messageType === 'copilot_on_clock'
                      ? 'Live'
                      : 'Chimmy'}
              </span>
              {isCopilotLocal(m) ? <span className="text-[9px] text-white/50">Only you see this</span> : null}
            </div>
            {m.playerContext ? (
              <div className="mt-2 flex gap-2 rounded-lg border border-white/12 bg-black/30 p-2">
                <PlayerAvatar
                  headshotUrl={m.playerContext.headshotUrl ?? null}
                  teamLogoUrl={m.playerContext.teamLogoUrl ?? null}
                  teamAbbr={m.playerContext.team ?? null}
                  position={m.playerContext.position ?? null}
                  displayName={m.playerContext.playerName ?? 'Player'}
                  size={44}
                  testIdBase="draft-chat-player-context-avatar"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-[11px] font-semibold text-white/92">
                    {m.playerContext.playerName ?? 'Player'}
                    {m.playerContext.position ? (
                      <span className="ml-1 font-normal text-white/55">{m.playerContext.position}</span>
                    ) : null}
                    {m.playerContext.team ? (
                      <span className="ml-1 font-normal text-cyan-200/70">{m.playerContext.team}</span>
                    ) : null}
                  </p>
                  {m.playerContext.statSummary ? (
                    <p className="truncate text-[10px] text-emerald-200/85">{m.playerContext.statSummary}</p>
                  ) : null}
                  {(m.playerContext.injuryStatus || m.playerContext.headlineSnippet) && (
                    <p className="truncate text-[10px] leading-snug text-amber-100/80">
                      {[m.playerContext.injuryStatus, m.playerContext.headlineSnippet].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
            <p className="mt-1.5 text-white/92">{censorProfanity(m.text)}</p>
            {m.aiMetadata?.rationale ? (
              <p className="mt-2 border-l-2 border-cyan-400/35 pl-2 text-[10px] leading-snug text-white/72">
                {m.aiMetadata.rationale}
              </p>
            ) : null}
            {m.aiMetadata?.confidence != null && Number.isFinite(m.aiMetadata.confidence) ? (
              <p className="mt-1 text-[9px] text-cyan-100/75">
                Confidence{' '}
                {m.aiMetadata.confidence <= 1
                  ? `${Math.round(m.aiMetadata.confidence * 100)}%`
                  : `${Math.round(m.aiMetadata.confidence)}%`}
              </p>
            ) : null}
            {m.aiMetadata?.actions?.length ? (
              <ul className="mt-2 space-y-1 text-[10px] text-cyan-100/85">
                {m.aiMetadata.actions.map((a, i) => (
                  <li key={`${m.id}-ai-act-${i}`}>• {a.label}</li>
                ))}
              </ul>
            ) : null}
            {onAiSuggestionClick ? (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={onAiSuggestionClick}
                  data-testid="draft-chat-open-ai-helper"
                  className="min-h-[36px] rounded-lg border border-cyan-300/35 bg-cyan-500/12 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                >
                  Open the Chimmy helper
                </button>
              </div>
            ) : null}
          </div>
        )
      }
      return null
    },
    [byId, rs, onAiSuggestionClick],
  )

  const tagFor = useCallback(
    (lm: ChatListMessage): string | null => {
      const m = byId.get(lm.id)
      if (!m) return null
      if (m.isBroadcast) return 'Commissioner'
      if (m.messageCategory === 'COMMISSIONER_SYSTEM_MESSAGE') return 'League'
      return null
    },
    [byId],
  )

  const error = actionError ?? sendError

  const subtitle = leagueChatSync
    ? 'One conversation: what you post here lands in league chat, and pick alerts stay in the room.'
    : activeView === 'league'
      ? `Posting to ${leagueName?.trim() || 'the league'}'s chat — the whole league sees it.`
      : 'Draft room only. League chat shows it too, tagged, while the draft is live.'

  const iconBtn =
    'min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border px-2 py-1.5 text-[11px] touch-manipulation'

  return (
    <section
      className={`flex flex-col overflow-hidden rounded-xl border bg-[#060d1e] ${
        popped
          ? 'af-dc-popped h-[min(70dvh,640px)] min-h-[320px] md:fixed md:bottom-4 md:right-4 md:top-4 md:z-[70] md:h-auto md:min-h-0 md:w-[min(460px,calc(100vw-32px))]'
          : 'h-[min(70dvh,640px)] min-h-[320px] md:h-full md:min-h-[200px]'
      } ${
        rs ? 'border-cyan-500/20 shadow-[0_12px_44px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(34,211,238,0.06)]' : 'border-white/10'
      }`}
      data-testid="draft-chat-panel"
      data-view={activeView}
      data-popped={popped ? 'true' : 'false'}
    >
      {/*
        One compact row. The draft room's dock is ~240px tall on a laptop, so every pixel of
        header is a line of chat the room cannot see — the explainer line below it shows on a
        phone and when the chat is popped out, and is the title's tooltip otherwise.
      */}
      <div
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2.5 py-1.5 ${
          rs ? 'border-cyan-500/12 bg-[linear-gradient(90deg,rgba(34,211,238,0.06),transparent)]' : 'border-white/8'
        }`}
      >
        <div className="flex min-w-0 flex-1 basis-[7rem] items-center gap-1.5">
          <MessageCircle className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden />
          <span className="truncate text-sm font-semibold text-white" title={subtitle}>
            {activeView === 'league' ? 'League chat' : 'Draft chat'}
          </span>
          {leagueChatSync ? (
            <span
              className="shrink-0 rounded border border-cyan-300/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-100"
              data-testid="draft-chat-sync-badge"
              title={subtitle}
            >
              Linked to league chat
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          {canSwitch ? (
            <div
              className="inline-flex rounded-lg border border-white/12 bg-black/30 p-0.5"
              role="group"
              aria-label="Which chat"
            >
              {(['draft', 'league'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={activeView === v}
                  aria-label={v === 'draft' ? 'Draft room chat' : 'League chat'}
                  title={v === 'draft' ? 'Draft room chat' : `${leagueName?.trim() || 'League'} chat`}
                  data-testid={`draft-chat-view-${v}`}
                  className={`min-h-[32px] rounded-md px-2 text-[11px] font-semibold transition ${
                    activeView === v ? 'bg-cyan-500/20 text-cyan-50' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {v === 'draft' ? 'Draft' : 'League'}
                </button>
              ))}
            </div>
          ) : null}
          {onAiSuggestionClick && (
            <button
              type="button"
              onClick={onAiSuggestionClick}
              data-testid="draft-chat-ai-handoff"
              className={`${iconBtn} gap-1 border-cyan-300/35 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20`}
              aria-label="Open Chimmy"
            >
              Chimmy
            </button>
          )}
          {onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              data-testid="draft-chat-refresh"
              className={`${iconBtn} border-white/12 bg-black/20 text-white/75 hover:bg-white/10`}
              aria-label="Refresh chat"
              title="Refresh chat"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          {isCommissioner && onBroadcast && (
            <button
              type="button"
              onClick={onBroadcast}
              data-testid="draft-open-broadcast-button"
              className={`${iconBtn} border-amber-400/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20`}
              aria-label="Commissioner broadcast"
              title="Commissioner broadcast"
            >
              <Megaphone className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => setPopped((p) => !p)}
            data-testid="draft-chat-popout"
            className={`${iconBtn} hidden border-white/12 bg-black/20 text-white/75 hover:bg-white/10 md:inline-flex`}
            aria-pressed={popped}
            aria-label={popped ? 'Dock the chat' : 'Pop out the chat'}
            title={popped ? 'Dock the chat' : 'Pop out the chat — more room to talk'}
          >
            {popped ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>
      <p
        className={`${popped ? '' : 'md:hidden'} border-b px-3 py-1 text-[10px] leading-snug ${
          rs ? 'border-cyan-500/10 text-cyan-200/55' : 'border-white/8 text-white/50'
        }`}
        data-testid="draft-chat-subtitle"
      >
        {subtitle}
      </p>

      {error && activeView === 'draft' ? (
        <div
          className="flex items-center justify-between gap-2 border-b border-rose-400/30 bg-rose-500/12 px-3 py-2 text-[11px] text-rose-100"
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              onDismissSendError?.()
            }}
            className="rounded px-2 py-1 text-rose-200 hover:bg-rose-500/20"
            aria-label="Dismiss chat error"
          >
            ×
          </button>
        </div>
      ) : null}

      {activeView === 'league' && leagueId ? (
        <div className="af-cm af-cm-embed" data-fill="true" data-testid="draft-chat-league-view">
          <LeagueConversation
            leagueId={leagueId}
            leagueName={leagueName}
            isCommissioner={isCommissioner}
            viewerId={currentUserId}
            surface="draft_room"
          />
        </div>
      ) : (
        <div className="af-cm af-cm-embed" data-fill="true">
          <div className="af-cm-panel af-cm-convo" ref={convoRef}>
            <ChatMessageList
              messages={listMessages}
              viewerId={currentUserId}
              label="Draft chat messages"
              scrollTestId="draft-chat-scroll-root"
              reactionsFor={(m) => reactionOverride[m.id] ?? readReactions(m.metadata, currentUserId)}
              reactionBusyId={reactionBusy}
              onToggleReaction={(m, emoji) => void toggleReaction(m, emoji)}
              onReply={(m) => setReplyTo(byId.get(m.id) ?? null)}
              onEdit={room ? editMessage : undefined}
              onDelete={room ? deleteMessage : undefined}
              nameForUserId={nameForUserId}
              renderSystem={renderSystem}
              tagFor={tagFor}
              hasRichFor={(m) =>
                hasRichContent(m.metadata, m.messageType, m.body) ||
                readDraftPoll(m.metadata, m.messageType, currentUserId) != null
              }
              renderRich={(m) => {
                const older = readDraftPoll(m.metadata, m.messageType, currentUserId)
                if (older) {
                  return (
                    <DraftPollView
                      poll={older}
                      disabled={disabled || voteBusy === m.id || !leagueId}
                      onVote={(optionIndex) => {
                        if (!leagueId) return
                        void post(
                          draftPollVoteUrl(leagueId),
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messageId: m.id, optionIndex }),
                          },
                          "Vote didn't save",
                          m.id,
                        )
                      }}
                    />
                  )
                }
                return (
                  <RichMessage
                    metadata={m.metadata}
                    messageType={m.messageType}
                    body={m.body}
                    viewerUserId={currentUserId}
                    onVote={
                      room
                        ? (optionId) =>
                            void post(
                              `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(m.id)}/vote`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ optionId }),
                              },
                              "Vote didn't save",
                              m.id,
                            )
                        : undefined
                    }
                    onClosePoll={
                      room && ((currentUserId && m.authorId === currentUserId) || isCommissioner)
                        ? () =>
                            void post(
                              `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(m.id)}/close-poll`,
                              { method: 'POST' },
                              "Couldn't close the poll",
                              m.id,
                            )
                        : undefined
                    }
                  />
                )
              }}
              empty={
                <div className="af-cm-empty">
                  <p className="af-cm-empty-t">Quiet in here. Start the trash talk.</p>
                  <p className="af-cm-empty-b">
                    Drop a GIF, run a poll, @ a manager who&apos;s on the clock. Pick alerts show up here as they happen.
                  </p>
                </div>
              }
            />

            {replyTo ? (
              <div className="af-cm-replybar">
                <span className="af-cm-replybar-label">Replying to {replyTo.from}</span>
                <span className="af-cm-replybar-text">{censorProfanity(replyTo.text)}</span>
                <button
                  type="button"
                  className="af-cm-replybar-x"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                >
                  ×
                </button>
              </div>
            ) : null}

            {/*
              The box stays inside the panel (border-t, in flow — never pinned to the viewport)
              so it rides above the phone keyboard with the conversation, not over the page.
              Docked, the chat is the room's bottom-right corner — exactly where the War Room's
              round button floats — so the box keeps clear of it (`data-fab-corner`, af-comms.css)
              instead of sliding its right end and the send button underneath.
            */}
            <div
              className={`af-dc-composer border-t p-2.5 sm:p-3 ${rs ? 'border-cyan-500/15 bg-[#050a14]' : 'border-white/8'}`}
              data-fab-corner={popped ? undefined : 'true'}
            >
              <div className="flex min-w-0 items-end gap-1.5 sm:gap-2">
                <div className="relative min-w-0 flex-1">
                  {disabled ? (
                    <p className="px-2 py-2 text-[12px] text-white/55">Chat is paused right now.</p>
                  ) : (
                    <ChatComposer
                      leagueId={leagueId ?? ''}
                      currentUserId={currentUserId ?? undefined}
                      chatType="draft"
                      placeholder="Talk your talk…"
                      onSend={sendPayload}
                      isCommissioner={isCommissioner}
                      dropZoneRef={convoRef}
                      pickerPlacement="auto"
                      testIds={{
                        input: 'draft-chat-input',
                        send: 'draft-chat-send',
                        gif: 'draft-chat-media-gif',
                        emoji: 'draft-chat-composer-emoji-toggle',
                        poll: 'draft-chat-poll-toggle',
                        photo: 'draft-chat-media-image',
                        video: 'draft-chat-media-video',
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
