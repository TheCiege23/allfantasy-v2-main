'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import RichMessage from './RichMessage'
import { notifyMentions } from '@/lib/chat-core/notifyMentions'
import { isNearBottom, useChatPolling } from '@/lib/chat-core/useChatPolling'
import { ChatComposer, type LeagueComposerPayload } from '@/app/dashboard/components/chat/ChatComposer'

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
}

type PlatformMessage = {
  id: string
  senderUserId: string | null
  senderName: string
  senderUsername?: string | null
  body: string
  createdAt: string
  /** GIFs, media and polls. The endpoint returns it; dropping it hid them. */
  metadata?: Record<string, unknown> | null
}

export function ThreadPanel({ kind, privacy }: { kind: 'dm' | 'group'; privacy: string }) {
  const [threads, setThreads] = useState<PlatformThread[] | null>(null)
  const [openThread, setOpenThread] = useState<PlatformThread | null>(null)
  const [messages, setMessages] = useState<PlatformMessage[]>([])
  const [hiddenBlocked, setHiddenBlocked] = useState(0)
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<HTMLDivElement | null>(null)

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
      setMessages(data.messages ?? [])
      setHiddenBlocked(data.hiddenBlockedCount ?? 0)
    } catch (e) {
      setMessages([])
      setError(e instanceof Error ? e.message : 'Could not load messages.')
    }
  }, [])

  /*
   * Only follow new messages when the reader is already at the bottom. With
   * polling on, scrolling unconditionally would yank the view away from somebody
   * reading back through the thread every few seconds.
   */
  useEffect(() => {
    if (isNearBottom(streamRef.current)) {
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [messages.length])

  // Near-realtime: without this a message only appeared when the thread was reopened.
  useChatPolling({
    refresh: () => (openThread ? loadMessages(openThread) : Promise.resolve()),
    enabled: Boolean(openThread),
    active: busy,
  })

  const open = useCallback(
    (thread: PlatformThread) => {
      setOpenThread(thread)
      setMessages([])
      setHiddenBlocked(0)
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
      if (!openThread || busy) return
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
        }
      }

      const displayText =
        text ||
        (payload.gifUrl || payload.giphyId ? '🎬 GIF' : '') ||
        (payload.poll ? `📊 ${payload.poll.question}` : '') ||
        (payload.attachments?.length ? '📎 Media' : '')

      if (!displayText && Object.keys(metadata).length === 0) return

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
              ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
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
        await loadMessages(openThread)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Message not sent.')
      } finally {
        setBusy(false)
      }
    },
    [openThread, busy, loadMessages],
  )

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
      <div className="af-cm-panel">
        <div className="af-cm-privacy">{privacy}</div>

        <div className="af-cm-threadhead">
          <button type="button" className="af-cm-back" onClick={() => setOpenThread(null)}>
            ‹ All {label}
          </button>
          <span className="af-cm-threadtitle">
            {openThread.title || `${openThread.memberCount} people`}
          </span>
        </div>

        <div className="af-cm-thread" ref={streamRef}>
          {messages.length === 0 ? (
            <div className="af-cm-empty">
              <p className="af-cm-empty-t">No messages yet.</p>
              <p className="af-cm-empty-b">
                Nobody outside this thread can read what you send here.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="af-cm-msg">
                <span className="af-cm-msg-author">{m.senderName}</span>
                <span className="af-cm-msg-text">{m.body}</span>
                <RichMessage metadata={m.metadata} />
              </div>
            ))
          )}
          {hiddenBlocked > 0 ? (
            /* Say it rather than leaving a silent gap in the transcript. */
            <p className="af-cm-empty-b">
              {hiddenBlocked} message{hiddenBlocked === 1 ? '' : 's'} hidden from people you blocked.
            </p>
          ) : null}
          {error ? <p className="af-cm-error">{error}</p> : null}
          <div ref={endRef} />
        </div>

        {/*
          The same composer the league chat uses. `leagueId` is empty because a
          DM has none: the mention hook then offers only its static suggestions
          (and correctly withholds @all from a one-to-one), and uploads authorise
          against `threadId` instead.
        */}
        <ChatComposer
          leagueId=""
          threadId={openThread.id}
          chatType={kind === 'dm' ? 'dm' : 'huddle'}
          placeholder="Message"
          onSend={sendPayload}
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
          threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className="af-cm-threadrow"
              onClick={() => open(t)}
            >
              <span className="af-cm-threadrow-title">
                {t.title || `${t.memberCount} people`}
              </span>
              {t.unreadCount > 0 ? (
                <span className="af-cm-threadrow-unread">{t.unreadCount}</span>
              ) : null}
            </button>
          ))
        )}
        {error ? <p className="af-cm-error">{error}</p> : null}
      </div>
    </div>
  )
}

export default ThreadPanel
