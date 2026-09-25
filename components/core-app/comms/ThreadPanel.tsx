'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Search } from 'lucide-react'
import { ThreadListRow, type ThreadRowContext } from './ThreadListRow'
import RichMessage from './RichMessage'
import { notifyMentions } from '@/lib/chat-core/notifyMentions'
import { useChatPolling } from '@/lib/chat-core/useChatPolling'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { SeenBy } from './SeenBy'
import { readReactions, toggleReactionLocally, type ViewerReaction } from '@/lib/chat-core/messageReactions'
import { useSession } from 'next-auth/react'
import { ChatComposer, type LeagueComposerPayload } from '@/app/dashboard/components/chat/ChatComposer'
import { ChatMessageList, type ChatListMessage } from './ChatMessageList'
import { ChatSearch } from './ChatSearch'
import { useTypingSignal } from './useTypingSignal'

/**
 * DMs and Huddle, on the platform chat threads that already exist.
 *
 * ⚠ THE PLACEHOLDER THIS REPLACES SAID THE STORE DID NOT EXIST. It does:
 * `platform_chat_threads` / `_thread_members` / `_messages`, reachable through
 * `/api/shared/chat/threads` and `.../[threadId]/messages`, carrying 398 real
 * messages in production (measured 2026-08-25). Both tabs were empty because
 * nobody wired them, not because there was nothing to wire.
 *
 * ⚠ NO NEW ROUTE. The repo sits at Vercel's hard 2048-route ceiling, so this
 * consumes the shared chat endpoints exactly as they are. The one server change
 * was teaching the EXISTING create endpoint to resolve usernames for `dm` as it
 * already did for `group` — without it, starting a DM needed a user uuid that no
 * surface in the drawer has.
 *
 * ⚠ ONE COMPONENT, TWO TABS. A DM and a huddle differ only in `threadType` and
 * in how many people you may add. List, open, read, post and read-state are
 * identical, and two near-copies would drift apart.
 *
 * ⚠ MODERATION IS THE SERVER'S. The list endpoint runs conversation safety and
 * the message endpoint filters blocked senders, returning `hiddenBlockedCount`.
 * Nothing here re-implements that; a client-side copy would be the one that gets
 * out of date.
 */

export type PlatformThread = {
  id: string
  threadType: string
  title: string
  lastMessageAt: string
  unreadCount: number
  memberCount: number
  /**
   * Already returned by the threads endpoint and never declared here, so the
   * drawer could not have rendered a control even though the column, the
   * endpoint and the semantics all existed.
   */
  isMuted?: boolean
  /**
   * The list row's preview, "You:" flag, time and the other people's avatars. Filtered on the
   * server so a preview never shows a message the thread would not (see chat-service).
   */
  context?: ThreadRowContext | null
}

type PlatformMessage = {
  id: string
  /** Set when this message answers another one in the thread. */
  parentMessageId?: string | null
  senderUserId: string | null
  senderName: string
  senderUsername?: string | null
  /** Sent by the endpoint since it existed and never drawn until the bubble layout. */
  senderAvatarUrl?: string | null
  /** `gif` rows from /messages carry the GIF's URL as the body. */
  messageType?: string | null
  body: string
  createdAt: string
  /** GIFs, media and polls. The endpoint returns it; dropping it hid them. */
  metadata?: Record<string, unknown> | null
}

function toListMessage(m: PlatformMessage): ChatListMessage {
  return {
    id: m.id,
    authorId: m.senderUserId,
    authorName: m.senderName || m.senderUsername || 'Someone',
    avatarUrl: m.senderAvatarUrl ?? null,
    body: m.body ?? '',
    createdAt: m.createdAt,
    parentMessageId: m.parentMessageId ?? null,
    metadata: m.metadata ?? null,
    messageType: m.messageType ?? null,
  }
}

/** What "Ask Chimmy about this chat" hands over: the thread, and its last few lines. */
export type ThreadAskChimmy = {
  threadId: string
  threadType: 'dm' | 'group'
  title: string
  recent: Array<{ name: string; body: string }>
}

export function ThreadPanel({
  kind,
  privacy,
  onAskChimmy,
}: {
  kind: 'dm' | 'group'
  privacy: string
  /**
   * The league page's Messages tab offers "Ask Chimmy about this chat", seeded with the
   * conversation. Absent in the drawer, whose Chimmy tab is one tap away already.
   */
  onAskChimmy?: (ask: ThreadAskChimmy) => void
}) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const [threads, setThreads] = useState<PlatformThread[] | null>(null)
  const [openThread, setOpenThread] = useState<PlatformThread | null>(null)
  const [messages, setMessages] = useState<PlatformMessage[]>([])
  const [hiddenBlocked, setHiddenBlocked] = useState(0)
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [replyTo, setReplyTo] = useState<PlatformMessage | null>(null)
  const [typing, setTyping] = useState<Array<{ userId: string; name: string }>>([])
  const [receipts, setReceipts] = useState<Array<{ userId: string; displayName: string | null; username: string | null; lastReadAt: string | null }>>([])
  const [error, setError] = useState<string | null>(null)
  /* In-flight reaction toggles win over the poll, as in league chat — see CommsDrawer. */
  const [reactionOverride, setReactionOverride] = useState<Record<string, ViewerReaction[]>>({})
  const [reactionBusy, setReactionBusy] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  /* "5m" has to become "6m" without a reload; a minute is the list's finest unit. */
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  /** The whole open conversation — the drop target for photos. */
  const panelRef = useRef<HTMLDivElement | null>(null)
  const activeThreadId = useRef<string | null>(null)
  useEffect(() => () => { activeThreadId.current = null }, [])

  const label = kind === 'dm' ? 'DMs' : 'huddles'

  const loadThreads = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/shared/chat/threads')
      const data = (await res.json().catch(() => ({}))) as {
        threads?: PlatformThread[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not load conversations.')
      // Times are measured against the moment the list arrived, not when the panel mounted.
      setNow(new Date())
      setThreads((data.threads ?? []).filter((t) => t.threadType === kind))
    } catch (e) {
      setThreads([])
      setError(e instanceof Error ? e.message : 'Could not load conversations.')
    }
  }, [kind])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const loadMessages = useCallback(async (thread: PlatformThread) => {
    if (activeThreadId.current !== thread.id) return
    setError(null)
    try {
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(thread.id)}/messages`,
      )
      const data = (await res.json().catch(() => ({}))) as {
        messages?: PlatformMessage[]
        hiddenBlockedCount?: number
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Could not load messages.')
      if (activeThreadId.current !== thread.id) return
      setMessages(data.messages ?? [])

      /*
       * Both ride the poll the panel already makes rather than adding timers of
       * their own, and both fail quietly: a missing receipt or a stale typing
       * row must never take the conversation down with it.
       */
      void fetch(`/api/shared/chat/threads/${encodeURIComponent(thread.id)}/typing`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (activeThreadId.current === thread.id) setTyping(Array.isArray(d?.typing) ? d.typing : []) })
        .catch(() => { if (activeThreadId.current === thread.id) setTyping([]) })

      void fetch(`/api/shared/chat/threads/${encodeURIComponent(thread.id)}/read-receipts`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (activeThreadId.current === thread.id) setReceipts(Array.isArray(d?.receipts) ? d.receipts : []) })
        .catch(() => { if (activeThreadId.current === thread.id) setReceipts([]) })
      setHiddenBlocked(data.hiddenBlockedCount ?? 0)
    } catch (e) {
      if (activeThreadId.current !== thread.id) return
      setMessages([])
      setError(e instanceof Error ? e.message : 'Could not load messages.')
    }
  }, [])

  /*
   * Following new messages only when the reader is already at the bottom — and
   * offering "N new ↓" when they are not — now lives in ChatMessageList, so the
   * league tab and this one cannot disagree about it.
   */

  // Near-realtime: without this a message only appeared when the thread was reopened.
  useChatPolling({
    refresh: () => (openThread ? loadMessages(openThread) : Promise.resolve()),
    enabled: Boolean(openThread),
    active: busy,
  })

  const open = useCallback(
    (thread: PlatformThread) => {
      activeThreadId.current = thread.id
      setTyping([])
      setReceipts([])
      setOpenThread(thread)
      /* A reply target belongs to one thread; it must not follow you into another. */
      setReplyTo(null)
      setMessages([])
      setHiddenBlocked(0)
      setReactionOverride({})
      setSearching(false)
      void loadMessages(thread)
    },
    [loadMessages],
  )

  /*
   * Same payload-to-metadata mapping the league panel uses. Kept identical on
   * purpose: two shapes for one feature is how a GIF ends up rendering in one
   * surface and not another.
   */
  const sendPayload = useCallback(
    async (payload: LeagueComposerPayload) => {
      /*
       * 🛑 SILENT RETURNS DESTROY THE MESSAGE — same defect as CommsDrawer, same reason.
       * ChatComposer clears its input optimistically BEFORE awaiting this, and restores it
       * only if this rejects. A bare `return` therefore looks identical to a successful
       * send and takes the user's text with it. Every non-send path must throw.
       */
      if (!openThread) throw new Error('no conversation open')
      if (busy) throw new Error('still sending the previous message')
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

      const displayText =
        text ||
        (payload.gifUrl || payload.giphyId ? '🎬 GIF' : '') ||
        (payload.poll ? `📊 ${payload.poll.question}` : '') ||
        (payload.attachments?.length ? '📎 Media' : '')

      // Also a silent return once; `canSend` should make it unreachable, but the draft must
      // come back rather than vanish if it is ever hit.
      if (!displayText && Object.keys(metadata).length === 0) throw new Error('nothing to send')

      setBusy(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(openThread.id)}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              body: displayText,
              messageType: payload.poll ? 'poll' : 'text',
              ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
              ...(replyTo ? { parentMessageId: replyTo.id } : {}),
            }),
          },
        )
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: { id?: string }
        }
        if (!res.ok) throw new Error(data.error ?? 'Message not sent.')
        /*
         * A huddle can carry @all; the endpoint resolves it to every thread
         * member. A DM cannot, and the mention hook already withholds it there.
         */
        if (data.message?.id) {
          void notifyMentions({
            threadId: openThread.id,
            messageId: data.message.id,
            text: displayText,
          })
        }
        /* Only once it actually sent — a failed reply keeps its target. */
        setReplyTo(null)
        await loadMessages(openThread)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Message not sent.')
        // ⚠ RETHROW so the composer restores the draft. The inline error alone is not
        // enough — the text is already gone from the box by the time we get here.
        throw e
      } finally {
        setBusy(false)
      }
    },
    [openThread, busy, loadMessages, replyTo],
  )

  /*
   * Mute. This stops being a nicety the moment trade cards start landing
   * automatically: an unmutable stream of generated messages is how you teach
   * somebody to switch notifications off for the whole app instead.
   */
  const toggleMute = useCallback(async () => {
    if (!openThread || busy) return
    const next = !openThread.isMuted
    setBusy(true)
    try {
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(openThread.id)}/mute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muted: next }),
        },
      )
      if (!res.ok) throw new Error(`server said ${res.status}`)
      /* Optimism is safe here: the only state is a boolean we just set. */
      setOpenThread({ ...openThread, isMuted: next })
      setThreads((prev) =>
        prev ? prev.map((t) => (t.id === openThread.id ? { ...t, isMuted: next } : t)) : prev,
      )
    } catch (e) {
      setError(e instanceof Error ? `Could not change mute — ${e.message}.` : 'Could not change mute.')
    } finally {
      setBusy(false)
    }
  }, [openThread, busy])

  /*
   * Reactions, with the same optimistic override the league tab uses: the chip
   * moves on tap, and the 4–8s poll cannot snap it back mid-request.
   */
  const toggleReaction = useCallback(
    async (m: ChatListMessage, emoji: string) => {
      if (!openThread || reactionBusy) return
      const current = reactionOverride[m.id] ?? readReactions(m.metadata, viewerId)
      const next = toggleReactionLocally(current, emoji)
      const adding = next.some((r) => r.emoji === emoji && r.mine)
      setReactionOverride((prev) => ({ ...prev, [m.id]: next }))
      setReactionBusy(m.id)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(openThread.id)}/messages/${encodeURIComponent(m.id)}/reactions`,
          {
            method: adding ? 'POST' : 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji }),
          },
        )
        if (!res.ok) throw new Error('Could not update reaction.')
        await loadMessages(openThread)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update reaction.')
      } finally {
        setReactionOverride((prev) => {
          const rest = { ...prev }
          delete rest[m.id]
          return rest
        })
        setReactionBusy(null)
      }
    },
    [openThread, reactionBusy, reactionOverride, viewerId, loadMessages],
  )

  /* Your own messages only — the route checks the sender, this only decides what is offered. */
  const editMessage = useCallback(
    async (m: ChatListMessage, nextBody: string) => {
      if (!openThread) throw new Error('no conversation open')
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(openThread.id)}/messages/${encodeURIComponent(m.id)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: nextBody }) },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not save that edit.')
      await loadMessages(openThread)
    },
    [openThread, loadMessages],
  )

  const deleteMessage = useCallback(
    async (m: ChatListMessage) => {
      if (!openThread) throw new Error('no conversation open')
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(openThread.id)}/messages/${encodeURIComponent(m.id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error('Could not delete that message.')
      await loadMessages(openThread)
    },
    [openThread, loadMessages],
  )

  /*
   * Everybody this panel can already name: the read-receipt rows (every member of
   * the thread, with names) and whoever has spoken. Used for "who reacted" and for
   * the `@` list — no extra request, and never an id on screen.
   */
  const people = useMemo(() => {
    const byId = new Map<string, { name: string; username: string | null; avatarUrl: string | null }>()
    for (const r of receipts) {
      byId.set(r.userId, { name: r.displayName || r.username || '', username: r.username, avatarUrl: null })
    }
    for (const m of messages) {
      if (!m.senderUserId) continue
      const had = byId.get(m.senderUserId)
      byId.set(m.senderUserId, {
        name: had?.name || m.senderName || m.senderUsername || '',
        username: had?.username ?? m.senderUsername ?? null,
        avatarUrl: m.senderAvatarUrl ?? had?.avatarUrl ?? null,
      })
    }
    return byId
  }, [receipts, messages])

  const nameForUserId = useCallback((id: string) => people.get(id)?.name || null, [people])

  const mentionMembers = useMemo(
    () =>
      Array.from(people.entries())
        .filter(([id, p]) => id !== viewerId && p.username)
        .map(([, p]) => ({ username: p.username as string, displayName: p.name, avatarUrl: p.avatarUrl })),
    [people, viewerId],
  )

  const listMessages = useMemo(() => messages.map(toListMessage), [messages])

  const signalTyping = useTypingSignal(openThread?.id ?? null)

  const start = useCallback(async () => {
    const names = invite
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    if (names.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/shared/chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadType: kind, usernames: names }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        thread?: PlatformThread
        error?: string
      }
      /*
       * The endpoint says exactly what went wrong — an unknown username, or more
       * than one person on a DM. Surfaced verbatim, because a generic failure is
       * one the user cannot act on.
       */
      if (!res.ok || !data.thread) {
        throw new Error(data.error ?? 'Could not start that conversation.')
      }
      setInvite('')
      await loadThreads()
      open(data.thread)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that conversation.')
    } finally {
      setBusy(false)
    }
  }, [invite, kind, busy, loadThreads, open])

  if (openThread) {
    return (
      <div className="af-cm-panel af-cm-convo" ref={panelRef}>
        {/*
          Folded to one line inside a conversation: the full note sat above every message and cost
          the thread two lines of height on a phone. The list view still shows it in full, and the
          words are one tap away here.
        */}
        <details className="af-cm-privacy-mini">
          <summary>
            <Lock size={11} aria-hidden />
            Private conversation
          </summary>
          <p>{privacy}</p>
        </details>

        <div className="af-cm-threadhead">
          <button type="button" className="af-cm-back" onClick={() => {
              activeThreadId.current = null
              setOpenThread(null)
              setReplyTo(null)
            }}>
            ‹ All {label}
          </button>
          <span className="af-cm-threadtitle">
            {openThread.title || `${openThread.memberCount} people`}
            <button
              type="button"
              className="af-cm-mute"
              data-on={Boolean(openThread.isMuted)}
              disabled={busy}
              onClick={() => void toggleMute()}
              aria-pressed={Boolean(openThread.isMuted)}
              title={openThread.isMuted ? 'Muted — tap to unmute' : 'Mute this conversation'}
            >
              {openThread.isMuted ? '🔕' : '🔔'}
            </button>
            <button
              type="button"
              className="af-cm-mute"
              data-on={searching}
              aria-pressed={searching}
              onClick={() => setSearching((v) => !v)}
              aria-label="Search this conversation"
              title="Search this conversation"
            >
              <Search size={15} aria-hidden />
            </button>
          </span>
          {onAskChimmy ? (
            <button
              type="button"
              className="af-cm-draft-toggle af-cm-askchimmy"
              data-testid="league-chat-dm-ai-chat-button"
              onClick={() =>
                onAskChimmy({
                  threadId: openThread.id,
                  threadType: kind,
                  title: openThread.title || '',
                  recent: messages
                    .slice(-10)
                    .map((m) => ({ name: m.senderName || m.senderUsername || 'Someone', body: m.body ?? '' }))
                    .filter((m) => m.body.trim().length > 0),
                })
              }
            >
              Ask Chimmy about this chat
            </button>
          ) : null}
        </div>

        {searching ? (
          <ChatSearch
            threadId={openThread.id}
            onClose={() => setSearching(false)}
            onJump={(id) => {
              if (!document.getElementById(`af-cm-msg-${id}`)) return false
              setFocusRequest({ id, nonce: Date.now() })
              return true
            }}
          />
        ) : null}

        <ChatMessageList
          messages={listMessages}
          viewerId={viewerId}
          label={`Messages in ${openThread.title || 'this conversation'}`}
          reactionsFor={(m) => reactionOverride[m.id] ?? readReactions(m.metadata, viewerId)}
          reactionBusyId={reactionBusy}
          onToggleReaction={(m, emoji) => void toggleReaction(m, emoji)}
          onReply={(m) => setReplyTo(messages.find((x) => x.id === m.id) ?? null)}
          onEdit={editMessage}
          onDelete={deleteMessage}
          nameForUserId={nameForUserId}
          focusRequest={focusRequest}
          renderRich={(m) => (
            <RichMessage
              metadata={m.metadata}
              messageType={m.messageType}
              body={m.body}
              viewerUserId={viewerId}
              onVote={(optionId) => {
                void fetch(
                  `/api/shared/chat/threads/${encodeURIComponent(openThread.id)}/messages/${encodeURIComponent(m.id)}/vote`,
                  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }) },
                )
                  .then(async (r) => {
                    if (!r.ok) throw new Error('Could not record vote. The poll may be closed.')
                    await loadMessages(openThread)
                  })
                  .catch((e) => setError(e.message))
              }}
              onClosePoll={
                m.authorId === viewerId
                  ? () => {
                      void fetch(
                        `/api/shared/chat/threads/${encodeURIComponent(openThread.id)}/messages/${encodeURIComponent(m.id)}/close-poll`,
                        { method: 'POST' },
                      )
                        .then(async (r) => {
                          if (!r.ok) throw new Error('Could not close poll.')
                          await loadMessages(openThread)
                        })
                        .catch((e) => setError(e.message))
                    }
                  : undefined
              }
            />
          )}
          empty={
            <div className="af-cm-empty">
              <p className="af-cm-empty-t">No messages yet.</p>
              <p className="af-cm-empty-b">Nobody outside this thread can read what you send here.</p>
            </div>
          }
          footer={
            <>
              {hiddenBlocked > 0 ? (
                /* Say it rather than leaving a silent gap in the transcript. */
                <p className="af-cm-empty-b">
                  {hiddenBlocked} message{hiddenBlocked === 1 ? '' : 's'} hidden from people you blocked.
                </p>
              ) : null}
              {error ? <p className="af-cm-error">{error}</p> : null}
            </>
          }
        />

        {/*
          The same composer the league chat uses. `leagueId` is empty because a
          DM has none, so the league member search has nothing to ask — the
          thread's own members come in through `mentionMembers` instead, and
          uploads authorise against `threadId`.
        */}
        {/*
          Seen-by, on the LAST message you sent and nowhere else. Marking every
          message would be a column of noise, and the only one anybody actually
          wonders about is the most recent thing they said.
        */}
        <SeenBy messages={messages} receipts={receipts} viewerUserId={viewerId} />

        {/*
          ⚠ HONEST ABOUT BEING LATE. Chat refreshes every 4-8s, so this can
          appear after the message it was announcing. Durable now, so it works
          across servers at all — but genuinely live typing needs a transport
          this app does not have.
        */}
        {typing.length > 0 ? (
          <p className="af-cm-typing-note">
            {typing.length === 1
              ? `${typing[0].name} is typing…`
              : `${typing.length} people are typing…`}
          </p>
        ) : null}

        {replyTo ? (
          <div className="af-cm-replybar">
            <span className="af-cm-replybar-label">Replying to {replyTo.senderName}</span>
            <span className="af-cm-replybar-text">{censorProfanity(replyTo.body)}</span>
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

        <ChatComposer
          key={openThread.id}
          leagueId=""
          threadId={openThread.id}
          currentUserId={viewerId ?? undefined}
          chatType={kind === 'dm' ? 'dm' : 'huddle'}
          placeholder="Message"
          onSend={sendPayload}
          dropZoneRef={panelRef}
          onTypingChange={signalTyping}
          mentionMembers={mentionMembers}
        />
      </div>
    )
  }

  return (
    <div className="af-cm-panel">
      <div className="af-cm-privacy">{privacy}</div>

      <form
        className="af-cm-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <input
          className="af-cm-input"
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          placeholder={kind === 'dm' ? 'Username to message' : 'Usernames, comma separated'}
          aria-label={kind === 'dm' ? 'Username to message' : 'Usernames to add'}
        />
        <button type="submit" className="af-cm-send" disabled={busy || !invite.trim()}>
          Start
        </button>
      </form>

      <div className="af-cm-thread">
        {threads == null ? (
          <div className="af-cm-empty">
            <p className="af-cm-empty-b">Loading…</p>
          </div>
        ) : threads.length === 0 ? (
          <div className="af-cm-empty af-cm-empty--grow">
            <p className="af-cm-empty-t">No {label} yet.</p>
            <p className="af-cm-empty-b">
              {kind === 'dm'
                ? 'Start one with an AllFantasy username above. This is separate from Sleeper and ESPN messages.'
                : 'A huddle is a group thread. Add a few AllFantasy usernames above to start one.'}
            </p>
          </div>
        ) : (
          threads.map((t) => <ThreadListRow key={t.id} thread={t} now={now} onOpen={() => open(t)} />)
        )}
        {error ? <p className="af-cm-error">{error}</p> : null}
      </div>
    </div>
  )
}

export default ThreadPanel
