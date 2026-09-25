'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { ChatMessageList, type ChatListMessage } from './ChatMessageList'
import { ChatSearch } from './ChatSearch'
import { useTypingSignal } from './useTypingSignal'
import RichMessage, { hasRichContent } from './RichMessage'
import { PresenceStrip, type PresentViewer } from './PresenceStrip'
import { PinnedBoard } from './PinnedBoard'
import { DraftPollView, draftPollVoteUrl, readDraftPoll } from './draftPoll'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { readPinnedRefs, type PinnedRef } from '@/lib/chat-core/pinnedMessages'
import { readReactions, toggleReactionLocally, type ViewerReaction } from '@/lib/chat-core/messageReactions'
import { notifyMentions, leagueMentionRoomId } from '@/lib/chat-core/notifyMentions'
import { useChatPolling } from '@/lib/chat-core/useChatPolling'
import { isDraftRoomSource, type LeagueDraftLink } from '@/lib/league-chat/draftChatLink'
import { ChatComposer, type LeagueComposerPayload } from '@/app/dashboard/components/chat/ChatComposer'
import '@/components/core-app/af-comms.css'

/**
 * One league's chat, as a conversation — the SAME component in the comms drawer, on the
 * league page, and inside the draft room.
 *
 * ⚠ IT WAS TWO IMPLEMENTATIONS AND ONE OF THEM RENDERED NO TEXT. The drawer's league tab got
 * the redesigned conversation (bubbles, your side / their side, GIFs, photos, polls,
 * reactions, reply, copy, edit, pin, search). The league PAGE rendered every row through
 * `components/chat/LeagueMessageRow.tsx`, a test stub whose helpers were `() => null` and whose
 * body was the comment "rest of message rendering omitted" — avatars and nothing else, in
 * production. Two copies of one chat is how one of them rots unseen, so there is one now.
 *
 * What differs between the three places is passed in: the drawer's league picker and
 * @chimmy button ride in `toolbarLead`; `surface` decides only chrome (the draft room hides
 * the "open the draft room" banner it is already inside).
 *
 * Routes, all pre-existing:
 *   GET/POST  /api/app/leagues/[id]/chat           → /api/league/chat
 *   reactions, vote, close-poll, edit, delete, pin, unpin, pinned, typing, search
 *             /api/shared/chat/threads/league:[id]/…
 *   a Survivor tribe channel (`source="tribe_…"`) reads and posts through
 *             /api/shared/chat/threads/league:[id]/messages?source=…, which enforces tribe
 *             membership — league chat's route excludes those channels by design.
 */

export type ConversationLeague = {
  id: string
  name: string
  isCommissioner?: boolean
  teamCount?: number | null
}

export type LeagueConversationSurface = 'drawer' | 'page' | 'draft_room'

export type LeagueConversationProps = {
  leagueId: string
  leagueName?: string | null
  /** Offers "close the poll" on anyone's poll and @global. The server re-checks both. */
  isCommissioner?: boolean
  /** The writer's leagues: `#` autocomplete, and the @global picker for commissioners. */
  leagues?: ConversationLeague[]
  /** The composer's "Ask Chimmy". */
  onAskChimmy?: () => void
  /** First in the toolbar row — the drawer puts its league picker and @chimmy button here. */
  toolbarLead?: ReactNode
  surface?: LeagueConversationSurface
  /** A Survivor tribe channel, `tribe_<id>`. Null or absent for the league's own chat. */
  source?: string | null
  /**
   * Who is reading, when the caller knows. League chat's own response says so too and wins;
   * a tribe channel's route does not, so this is what puts your messages on your side there.
   * A prop rather than a session hook, which throws outside a SessionProvider.
   */
  viewerId?: string | null
}

type LeagueMessage = {
  id: string
  /** Set when this message answers another one. */
  parentMessageId: string | null
  /** Needed to tell whether the viewer may close a poll they posted. */
  authorId: string | null
  author: string
  /** `authorAvatarUrl` on the wire — sent all along, first drawn by the bubble layout. */
  avatarUrl: string | null
  message: string
  createdAt: string
  /** `gif` rows posted from the full league panel carry the GIF's URL as the text. */
  messageType: string | null
  /** The rich half — GIF, attachments, poll, reactions. */
  metadata?: Record<string, unknown> | null
  /** `'draft'` when it was posted in the draft room. */
  source: string | null
}

function leagueToListMessage(m: LeagueMessage): ChatListMessage {
  return {
    id: m.id,
    authorId: m.authorId,
    authorName: m.author,
    avatarUrl: m.avatarUrl,
    body: m.message,
    createdAt: m.createdAt,
    parentMessageId: m.parentMessageId,
    metadata: m.metadata ?? null,
    messageType: m.messageType,
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/** `/api/league/chat`'s toClientMessage: flat `authorName` / `text`. */
function fromLeagueWire(m: Record<string, unknown>): LeagueMessage | null {
  const id = str(m.id)
  if (!id) return null
  return {
    id,
    parentMessageId: str(m.parentMessageId),
    authorId: str(m.authorId),
    author: str(m.authorName) ?? 'Someone',
    avatarUrl: str(m.authorAvatarUrl),
    message: typeof m.text === 'string' ? m.text : '',
    createdAt: str(m.createdAt) ?? new Date(0).toISOString(),
    messageType: str(m.messageType),
    metadata: m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : null,
    source: str(m.source),
  }
}

/** The shared thread route's PlatformChatMessage: `senderName` / `body`. */
function fromThreadWire(m: Record<string, unknown>): LeagueMessage | null {
  const id = str(m.id)
  if (!id) return null
  return {
    id,
    parentMessageId: str(m.parentMessageId),
    authorId: str(m.senderUserId),
    author: str(m.senderName) ?? str(m.senderUsername) ?? 'Someone',
    avatarUrl: str(m.senderAvatarUrl),
    message: typeof m.body === 'string' ? m.body : '',
    createdAt: str(m.createdAt) ?? new Date(0).toISOString(),
    messageType: str(m.messageType),
    metadata: m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : null,
    source: str(m.channelSource),
  }
}

function readDraftLink(value: unknown): LeagueDraftLink | null {
  if (!value || typeof value !== 'object') return null
  const d = value as Record<string, unknown>
  const href = str(d.href)
  if (!href || !href.startsWith('/')) return null
  return { live: d.live === true, status: str(d.status) ?? '', href }
}

export function LeagueConversation({
  leagueId,
  leagueName = null,
  isCommissioner = false,
  leagues,
  onAskChimmy,
  toolbarLead,
  surface = 'drawer',
  source = null,
  viewerId = null,
}: LeagueConversationProps) {
  const tribe = typeof source === 'string' && source.startsWith('tribe_') ? source : null
  const room = `league:${leagueId}`

  const [messages, setMessages] = useState<LeagueMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [presence, setPresence] = useState<PresentViewer[]>([])
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  /*
   * In-flight reaction toggles win over whatever the server last said. Without
   * this the 4-8s poll would land mid-request and snap the chip back to its old
   * state, then forward again a tick later.
   */
  const [reactionOverride, setReactionOverride] = useState<Record<string, ViewerReaction[]>>({})
  const [reactionBusy, setReactionBusy] = useState<string | null>(null)
  const [voteBusy, setVoteBusy] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<LeagueMessage | null>(null)
  const [pins, setPins] = useState<PinnedRef[]>([])
  const [pinBusy, setPinBusy] = useState(false)
  /*
   * Whether the draft room's messages are folded in. `null` means the reader has not chosen,
   * and the server decides: in while a draft is live, out otherwise. Inside the draft room
   * it is always out — its own view already shows them.
   */
  const [includeDraftChoice, setIncludeDraftChoice] = useState<boolean | null>(
    surface === 'draft_room' ? false : null,
  )
  const [includeDraft, setIncludeDraft] = useState(false)
  const [draft, setDraft] = useState<LeagueDraftLink | null>(null)
  /** Whether this chat has loaded at least once — a failed POLL must not blank a chat on screen. */
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [typing, setTyping] = useState<Array<{ userId: string; name: string }>>([])
  const [searching, setSearching] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  /** The whole conversation — where dropped photos land. */
  const convoRef = useRef<HTMLDivElement | null>(null)
  /** The league a response belongs to; a slow reply for the last league must not land here. */
  const activeLeague = useRef(leagueId)
  activeLeague.current = leagueId

  const viewer = viewerUserId ?? viewerId

  /*
   * Parents are looked up among the messages already loaded. The panel holds the
   * most recent 40, so a reply to something older finds nothing here — which
   * `QuotedMessage` states rather than rendering an empty quote.
   */
  const byId = useMemo(() => {
    const map = new Map<string, LeagueMessage>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  /*
   * `quiet` exists for polling. Without it every tick would flip the loading flag
   * and flash "Loading league chat…" over a conversation the reader is already
   * looking at, several times a minute.
   */
  const load = useCallback(
    async (quiet = false) => {
      const forLeague = leagueId
      if (!quiet) setLoading(true)
      setError(null)
      try {
        if (tribe) {
          const res = await fetch(
            `/api/shared/chat/threads/${encodeURIComponent(room)}/messages?limit=40&source=${encodeURIComponent(tribe)}`,
          )
          if (!res.ok) throw new Error(`Chat returned ${res.status}`)
          const data = (await res.json()) as { messages?: unknown[] }
          if (activeLeague.current !== forLeague) return
          setMessages(
            (Array.isArray(data.messages) ? data.messages : [])
              .map((m) => (m && typeof m === 'object' ? fromThreadWire(m as Record<string, unknown>) : null))
              .filter((m): m is LeagueMessage => m !== null),
          )
          setLoadedOnce(true)
          return
        }
        /*
         * `markRead=1` moves this league's read marker (the bubble's league count) — only while the page
         * is actually visible, so a poll ticking in a background tab never marks unseen messages read.
         */
        const seen = typeof document !== 'undefined' && document.visibilityState === 'visible'
        const draftParam = includeDraftChoice === null ? '' : `&includeDraft=${includeDraftChoice ? '1' : '0'}`
        const res = await fetch(
          `/api/app/leagues/${encodeURIComponent(leagueId)}/chat?limit=40${draftParam}${seen ? '&markRead=1' : ''}`,
        )
        if (!res.ok) throw new Error(`Chat returned ${res.status}`)
        /*
         * Wire shape is /api/league/chat's toClientMessage (reached via the
         * /api/app proxy): flat `authorName` / `text`, not a nested `user` row —
         * that nested shape was the bracket-pool chat's, which the drawer was
         * once wrongly pointed at (and 403'd every fantasy league).
         */
        const data = (await res.json()) as {
          viewerUserId?: string | null
          presence?: PresentViewer[]
          includeDraft?: boolean
          draft?: unknown
          messages?: unknown[]
        }
        if (activeLeague.current !== forLeague) return
        setPresence(Array.isArray(data.presence) ? data.presence : [])
        setViewerUserId(typeof data.viewerUserId === 'string' ? data.viewerUserId : null)
        setIncludeDraft(data.includeDraft === true)
        setDraft(readDraftLink(data.draft))
        setMessages(
          (Array.isArray(data.messages) ? data.messages : [])
            .map((m) => (m && typeof m === 'object' ? fromLeagueWire(m as Record<string, unknown>) : null))
            .filter((m): m is LeagueMessage => m !== null),
        )
        setLoadedOnce(true)
        /*
         * Who is typing rides the same poll, as it does in DMs, and fails quietly —
         * a missing hint must never take the conversation down with it.
         */
        void fetch(`/api/shared/chat/threads/${encodeURIComponent(room)}/typing`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (activeLeague.current === forLeague) setTyping(Array.isArray(d?.typing) ? d.typing : [])
          })
          .catch(() => setTyping([]))
      } catch (e) {
        if (activeLeague.current !== forLeague) return
        setError(
          e instanceof Error
            ? `Could not load this league's chat (${e.message}).`
            : "Could not load this league's chat.",
        )
      } finally {
        if (!quiet) setLoading(false)
      }
      /* Flipping the draft-room view has to re-fetch, so it belongs in here. */
    },
    [leagueId, room, tribe, includeDraftChoice],
  )

  const loadPins = useCallback(async () => {
    if (tribe) return
    try {
      const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(room)}/pinned`)
      if (!res.ok) return
      const data = (await res.json().catch(() => ({}))) as { pinned?: unknown }
      setPins(readPinnedRefs(data.pinned))
    } catch {
      /* A board that failed to load is not worth an error over a working chat. */
    }
  }, [room, tribe])

  useEffect(() => {
    void load()
  }, [load])

  /* A different league is a different conversation: nothing carries over from the last one. */
  useEffect(() => {
    setMessages([])
    setPresence([])
    setReactionOverride({})
    setReplyTo(null)
    setPins([])
    setTyping([])
    setLoadedOnce(false)
    setSearching(false)
    setFocusRequest(null)
    setDraft(null)
    void loadPins()
  }, [leagueId, loadPins])

  /*
   * Near-realtime. League chat loaded once when you picked a league and never again, so a
   * reply arrived only if you switched leagues and back.
   */
  useChatPolling({
    refresh: () => load(true),
    enabled: Boolean(leagueId),
    active: sending,
  })

  /*
   * Reactions. For a fantasy league they store into `LeagueChatMessage.metadata.reactions`,
   * which is the same metadata this panel already renders GIFs and polls from.
   *
   * ⚠ A failure says so plainly and puts the chip back, rather than leaving a tap that
   * silently did nothing.
   */
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, current: ViewerReaction[]) => {
      if (reactionBusy) return

      const next = toggleReactionLocally(current, emoji)
      const adding = next.some((r) => r.emoji === emoji && r.mine)

      setReactionOverride((prev) => ({ ...prev, [messageId]: next }))
      setReactionBusy(messageId)

      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(messageId)}/reactions`,
          {
            method: adding ? 'POST' : 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ emoji }),
          },
        )
        if (!res.ok) {
          throw new Error(res.status === 403 ? 'you cannot react in this league' : `server said ${res.status}`)
        }
        await load(true)
      } catch (e) {
        setError(e instanceof Error ? `Reaction did not save — ${e.message}.` : 'Reaction did not save.')
      } finally {
        /* Server state wins from here, right or wrong — the override only covers the round trip. */
        setReactionOverride((prev) => {
          const rest = { ...prev }
          delete rest[messageId]
          return rest
        })
        setReactionBusy(null)
      }
    },
    [room, reactionBusy, load],
  )

  const votePoll = useCallback(
    async (messageId: string, optionId: string) => {
      if (voteBusy) return
      setVoteBusy(messageId)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(messageId)}/vote`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ optionId }),
          },
        )
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await load(true)
      } catch (e) {
        setError(e instanceof Error ? `Vote did not save — ${e.message}.` : 'Vote did not save.')
      } finally {
        setVoteBusy(null)
      }
    },
    [room, voteBusy, load],
  )

  /* The draft room's older polls vote by index through their own route — see draftPoll.tsx. */
  const voteDraftPoll = useCallback(
    async (messageId: string, optionIndex: number) => {
      if (voteBusy) return
      setVoteBusy(messageId)
      try {
        const res = await fetch(draftPollVoteUrl(leagueId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messageId, optionIndex }),
        })
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await load(true)
      } catch (e) {
        setError(e instanceof Error ? `Vote did not save — ${e.message}.` : 'Vote did not save.')
      } finally {
        setVoteBusy(null)
      }
    },
    [leagueId, voteBusy, load],
  )

  const pinMessage = useCallback(
    async (messageId: string) => {
      if (pinBusy) return
      setPinBusy(true)
      try {
        const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(room)}/pin`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messageId }),
        })
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await loadPins()
      } catch (e) {
        setError(e instanceof Error ? `Could not pin that — ${e.message}.` : 'Could not pin that.')
      } finally {
        setPinBusy(false)
      }
    },
    [room, pinBusy, loadPins],
  )

  const unpinMessage = useCallback(
    async (pinMessageId: string) => {
      if (pinBusy) return
      setPinBusy(true)
      try {
        const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(room)}/unpin`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinMessageId }),
        })
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await loadPins()
      } catch (e) {
        setError(e instanceof Error ? `Could not unpin that — ${e.message}.` : 'Could not unpin that.')
      } finally {
        setPinBusy(false)
      }
    },
    [room, pinBusy, loadPins],
  )

  const closePoll = useCallback(
    async (messageId: string) => {
      if (voteBusy) return
      setVoteBusy(messageId)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(messageId)}/close-poll`,
          { method: 'POST' },
        )
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await load(true)
      } catch (e) {
        setError(e instanceof Error ? `Could not close the poll — ${e.message}.` : 'Could not close the poll.')
      } finally {
        setVoteBusy(null)
      }
    },
    [room, voteBusy, load],
  )

  /*
   * Edit and delete your own league messages — the shared route's league branch, sender-checked,
   * `editedAt` / `deletedAt` stamped in metadata. Sleeper's feedback channel asks for exactly
   * this: "Allow deleting comments from the league chat".
   */
  const editMessage = useCallback(
    async (m: ChatListMessage, nextBody: string) => {
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(m.id)}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: nextBody }) },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not save that edit.')
      await load(true)
    },
    [room, load],
  )

  const deleteMessage = useCallback(
    async (m: ChatListMessage) => {
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(room)}/messages/${encodeURIComponent(m.id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error('Could not delete that message.')
      await load(true)
    },
    [room, load],
  )

  /* Names for "who reacted": everybody who has spoken on screen, plus who is here now. */
  const nameForUserId = useCallback(
    (id: string): string | null =>
      messages.find((m) => m.authorId === id)?.author ?? presence.find((p) => p.userId === id)?.name ?? null,
    [messages, presence],
  )

  const listMessages = useMemo(() => messages.map(leagueToListMessage), [messages])
  const sourceById = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const m of messages) map.set(m.id, m.source)
    return map
  }, [messages])

  const signalTyping = useTypingSignal(tribe ? null : room)

  /*
   * Maps the composer's payload onto the metadata shape `/api/league/chat` already stores and
   * `RichMessage` already reads. Identical to the DM panel's mapping on purpose — two shapes
   * for one feature is how a GIF ends up rendering in one surface and not the other.
   */
  const sendPayload = useCallback(
    async (payload: LeagueComposerPayload) => {
      /*
       * 🛑 THESE WERE SILENT `return`s AND THAT DESTROYED MESSAGES. The composer clears its
       * input optimistically BEFORE awaiting this function, and it cannot distinguish
       * "sent" from "returned without doing anything" — so every early exit threw the
       * user's text away with no request, no error and no trace.
       *
       * Throwing instead lets the composer restore the draft. Every non-send path must
       * throw for that reason; a bare `return` is the bug.
       */
      if (!leagueId) throw new Error('no league selected')
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
          options: payload.poll.options.map((t, i) => ({
            id: `opt-${i}-${Date.now()}`,
            text: t,
            votes: [] as string[],
          })),
          closeAt: payload.poll.closeAt.toISOString(),
          allowMultiple: payload.poll.allowMultiple,
          anonymous: Boolean(payload.poll.anonymous),
        }
      }

      /*
       * A GIF or an image with no words still has to carry SOMETHING as the
       * message body — the row is text-shaped — but the label is a fallback, not
       * the content, and `RichMessage` renders the real thing above it.
       */
      const displayText =
        text ||
        (payload.gifUrl || payload.giphyId ? '🎬 GIF' : '') ||
        (payload.poll ? `📊 ${payload.poll.question}` : '') ||
        (payload.attachments?.length ? '📎 Media' : '')

      // `canSend` should make this unreachable, but the draft must come back rather than vanish.
      if (!displayText && Object.keys(metadata).length === 0) throw new Error('nothing to send')

      setSending(true)
      try {
        const res = tribe
          ? await fetch(`/api/shared/chat/threads/${encodeURIComponent(room)}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                body: displayText,
                messageType: 'text',
                source: tribe,
                ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
                ...(replyTo ? { parentMessageId: replyTo.id } : {}),
              }),
            })
          : await fetch(`/api/app/leagues/${encodeURIComponent(leagueId)}/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: displayText,
                ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
                ...(replyTo ? { parentMessageId: replyTo.id } : {}),
              }),
            })
        if (!res.ok) throw new Error(`Send returned ${res.status}`)
        /*
         * The composer offers @mentions and @all; without this the drawer autocompleted
         * them and notified nobody. Fire-and-forget — the message is already posted, and a
         * failed ping must not read as a failed send.
         */
        const posted = (await res.json().catch(() => ({}))) as { message?: { id?: string } }
        if (posted.message?.id && !tribe) {
          void notifyMentions({
            threadId: leagueMentionRoomId(leagueId),
            messageId: posted.message.id,
            text: displayText,
          })
        }
        /* Only after it actually sent — a failed reply keeps its target. */
        setReplyTo(null)
        /* Quiet: a full reload flashed "Loading…" over the chat after every send. */
        await load(true)
      } catch (e) {
        setError(e instanceof Error ? `Message not sent (${e.message}).` : 'Message not sent.')
        /*
         * ⚠ RETHROW. Setting the inline error is not enough: the composer has already
         * cleared the user's text and only restores it if this rejects. Swallowing here is
         * what turned a failed send into a lost message.
         */
        throw e
      } finally {
        setSending(false)
      }
    },
    [load, leagueId, room, tribe, sending, replyTo],
  )

  const commissionerLeagues = useMemo(
    () =>
      (leagues ?? [])
        .filter((l) => l.isCommissioner)
        .map((l) => ({ id: l.id, name: l.name, teamCount: l.teamCount ?? 0 })),
    [leagues],
  )

  const name = leagueName?.trim() || 'the league'
  const draftLive = Boolean(draft?.live) && !tribe
  const showDraftBanner = draftLive && surface !== 'draft_room'
  const canToggleDraft = !tribe && surface !== 'draft_room'

  return (
    <div className="af-cm-panel af-cm-convo" ref={convoRef} data-surface={surface}>
      <div className="af-cm-scope">
        {toolbarLead}
        {!tribe ? <PresenceStrip viewers={presence} /> : null}
        {!tribe ? (
          <button
            type="button"
            className="af-cm-draft-toggle af-cm-search-toggle"
            data-on={searching}
            aria-pressed={searching}
            onClick={() => setSearching((v) => !v)}
          >
            <Search size={13} aria-hidden /> Search chat
          </button>
        ) : null}
        {/*
          The draft room's messages live in this league's chat table; this decides whether
          the reader sees them. A view preference, not a league setting — one reader turning
          it on changes nothing for anybody else. Left alone, it follows the draft: in while
          a draft is live, out otherwise.
        */}
        {canToggleDraft ? (
          <button
            type="button"
            className="af-cm-draft-toggle"
            data-on={includeDraft}
            onClick={() => setIncludeDraftChoice(!includeDraft)}
            aria-pressed={includeDraft}
          >
            {includeDraft ? 'Hide draft room' : 'Show draft room'}
          </button>
        ) : null}
      </div>

      {showDraftBanner && draft ? (
        <div className="af-cm-draftlive" role="status" data-testid="league-chat-draft-live">
          <span className="af-cm-draftlive-dot" aria-hidden="true" />
          <span className="af-cm-draftlive-text">
            <b>{draft.status === 'paused' ? 'Your draft is paused.' : 'Your draft is live.'}</b>{' '}
            {includeDraft ? 'Draft room chatter shows here, tagged.' : 'Draft room chatter is hidden here.'}
          </span>
          <a className="af-cm-draftlive-link" href={draft.href} data-testid="league-chat-open-draft-room">
            Open the draft room
          </a>
        </div>
      ) : null}

      {!tribe ? (
        <PinnedBoard
          pins={pins}
          busy={pinBusy}
          onUnpin={(pinId) => void unpinMessage(pinId)}
          onJump={(messageId) => setFocusRequest({ id: messageId, nonce: Date.now() })}
        />
      ) : null}

      {searching && !tribe ? (
        <ChatSearch
          threadId={room}
          onClose={() => setSearching(false)}
          onJump={(id) => {
            if (!document.getElementById(`af-cm-msg-${id}`)) return false
            setFocusRequest({ id, nonce: Date.now() })
            return true
          }}
        />
      ) : null}

      {loading && !loadedOnce ? (
        <div className="af-cm-thread">
          <p className="af-cm-loading">Loading {leagueName?.trim() || 'league'} chat…</p>
        </div>
      ) : error && !loadedOnce ? (
        <div className="af-cm-thread">
          <p className="af-cm-error">{error}</p>
        </div>
      ) : (
        <ChatMessageList
          messages={listMessages}
          viewerId={viewer}
          label={`${leagueName?.trim() || 'League'} chat`}
          reactionsFor={(m) => reactionOverride[m.id] ?? readReactions(m.metadata, viewer)}
          reactionBusyId={reactionBusy}
          onToggleReaction={(m, emoji) =>
            void toggleReaction(m.id, emoji, reactionOverride[m.id] ?? readReactions(m.metadata, viewer))
          }
          onReply={(m) => setReplyTo(byId.get(m.id) ?? null)}
          onPin={tribe ? undefined : (m) => void pinMessage(m.id)}
          pinBusy={pinBusy}
          onEdit={editMessage}
          onDelete={deleteMessage}
          nameForUserId={nameForUserId}
          focusRequest={focusRequest}
          tagFor={(m) => (isDraftRoomSource(sourceById.get(m.id)) ? 'Draft room' : null)}
          hasRichFor={(m) =>
            hasRichContent(m.metadata, m.messageType, m.body) || readDraftPoll(m.metadata, m.messageType, viewer) != null
          }
          renderRich={(m) => {
            const older = readDraftPoll(m.metadata, m.messageType, viewer)
            if (older) {
              return (
                <DraftPollView
                  poll={older}
                  disabled={voteBusy === m.id}
                  onVote={(index) => void voteDraftPoll(m.id, index)}
                />
              )
            }
            return (
              <RichMessage
                metadata={m.metadata}
                messageType={m.messageType}
                body={m.body}
                viewerUserId={viewer}
                onVote={(optionId) => void votePoll(m.id, optionId)}
                onClosePoll={
                  /*
                   * Only offered to the author or a commissioner. The server checks the same
                   * thing — this just avoids showing a control that would be refused.
                   */
                  (viewer && m.authorId === viewer) || isCommissioner ? () => void closePoll(m.id) : undefined
                }
              />
            )
          }}
          empty={
            <div className="af-cm-empty">
              <p className="af-cm-empty-t">Nobody&apos;s said anything yet.</p>
              <p className="af-cm-empty-b">Be the one who starts it.</p>
            </div>
          }
          footer={error ? <p className="af-cm-error">{error}</p> : null}
        />
      )}

      {/*
        ⚠ HONEST ABOUT BEING LATE, as in DMs: this rides the 4–8s poll, so it can
        appear just after the message it was announcing.
      */}
      {typing.length > 0 ? (
        <p className="af-cm-typing-note">
          {typing.length === 1 ? `${typing[0]!.name} is typing…` : `${typing.length} people are typing…`}
        </p>
      ) : null}

      {/*
        What this message will be answering, right above the composer — a reply target you
        cannot see is one you forget you set.
      */}
      {replyTo ? (
        <div className="af-cm-replybar">
          <span className="af-cm-replybar-label">Replying to {replyTo.author}</span>
          <span className="af-cm-replybar-text">{censorProfanity(replyTo.message)}</span>
          <button type="button" className="af-cm-replybar-x" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            ×
          </button>
        </div>
      ) : null}

      {/*
        The full composer: GIF search, the emoji picker, polls, photos by button, drop or
        paste, @mention autocomplete, @all, and @global for commissioners.
        `commissionerLeagues` is what makes @global offered — the broadcast endpoint
        re-checks commissioner status, so this decides what is shown, never what is permitted.
      */}
      <ChatComposer
        /* A half-written message belongs to the league it was typed in. */
        key={`${leagueId}:${tribe ?? ''}`}
        leagueId={leagueId}
        currentUserId={viewer ?? undefined}
        autocompleteLeagues={leagues?.map((l) => ({ id: l.id, name: l.name }))}
        chatType="league"
        placeholder={`Message ${name}…`}
        onSend={sendPayload}
        onAskChimmy={onAskChimmy}
        isCommissioner={isCommissioner}
        commissionerLeagues={commissionerLeagues}
        dropZoneRef={convoRef}
        onTypingChange={signalTyping}
      />
    </div>
  )
}

export default LeagueConversation
