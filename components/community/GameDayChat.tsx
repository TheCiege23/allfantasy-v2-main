'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { REPLY_BODY_MAX } from '@/lib/community/validation'
import type { ChatMessage } from '@/lib/community/service'
import { AuthorBadges, Avatar } from './CommunityBits'

/**
 * The game-day room's chat: replies on today's room thread, polled. No websocket on
 * purpose — the app has no realtime path the Clubhouse can share, and a few seconds of
 * lag is fine for talking about a game. Polling pauses while the tab is hidden.
 */

const POLL_MS = 6_000
const SCORES_REFRESH_MS = 60_000
const MAX_KEPT = 300

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev
  const seen = new Set(prev.map((m) => m.id))
  const merged = [...prev, ...incoming.filter((m) => !seen.has(m.id))]
  merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return merged.length > MAX_KEPT ? merged.slice(merged.length - MAX_KEPT) : merged
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function GameDayChat({
  postId,
  initial,
  signedIn,
  loginHref,
}: {
  postId: string
  initial: ChatMessage[]
  signedIn: boolean
  loginHref: string
}) {
  const router = useRouter()
  const [messages, setMessages] = useState(initial)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const latest = useRef(initial.at(-1)?.createdAt ?? null)
  const stickToBottom = useRef(true)

  const poll = useCallback(async () => {
    try {
      const q = latest.current ? `?after=${encodeURIComponent(latest.current)}` : ''
      const res = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/replies${q}`, { cache: 'no-store' })
      if (!res.ok) {
        setStale(true)
        return
      }
      const data = (await res.json()) as { messages?: ChatMessage[] }
      setStale(false)
      const incoming = Array.isArray(data.messages) ? data.messages : []
      if (incoming.length) {
        latest.current = incoming[incoming.length - 1]!.createdAt
        setMessages((prev) => mergeMessages(prev, incoming))
      }
    } catch {
      setStale(true)
    }
  }, [postId])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (!timer) timer = setInterval(poll, POLL_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else {
        void poll()
        start()
      }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    // The slate above is server-rendered; refresh it on a slower clock than the chat.
    const scores = setInterval(() => {
      if (!document.hidden) router.refresh()
    }, SCORES_REFRESH_MS)
    return () => {
      stop()
      clearInterval(scores)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [poll, router])

  // Follow new messages only when the reader is already at the bottom.
  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send() {
    const body = draft.trim()
    if (!body) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data?.error || 'Message not sent. Try again.')
      else {
        setDraft('')
        stickToBottom.current = true
        await poll()
      }
    } catch {
      setError("Couldn't reach AllFantasy.")
    }
    setSending(false)
  }

  return (
    <section aria-labelledby="chat-heading" className="ch-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
        <h2 id="chat-heading" className="ch-h2" style={{ fontSize: 16 }}>
          💬 Live chat
        </h2>
        {stale ? (
          <span className="ch-pill" style={{ color: '#fbbf24' }} aria-live="polite">
            Reconnecting…
          </span>
        ) : (
          <span className="ch-live" aria-live="polite">
            Live
          </span>
        )}
      </div>

      <ol
        ref={listRef}
        aria-label="Chat messages"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="h-[58vh] min-h-[300px] overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 && (
          <li className="grid h-full place-items-center py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
            <span>
              <span className="mb-2 block text-3xl" aria-hidden>
                🏟️
              </span>
              Nobody has said anything yet. Start the conversation.
            </span>
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className="ch-chat-msg text-sm" data-mine={m.mine}>
            <Avatar author={m.author} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="ch-chat-name">{m.author.displayName || m.author.username}</span>
                <AuthorBadges badges={m.author.badges} />
                <time dateTime={m.createdAt} className="ch-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                  {clock(m.createdAt)}
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words" style={{ color: 'var(--text)' }}>
                {censorProfanity(m.body)}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t p-3" style={{ borderColor: 'var(--line)', background: 'var(--surface2)' }}>
        {signedIn ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, REPLY_BODY_MAX))}
              placeholder="Say something about the games…"
              aria-label="Chat message"
              className="min-w-0 flex-1 px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="ch-btn ch-btn-primary disabled:opacity-50"
            >
              Send
            </button>
          </form>
        ) : (
          <a href={loginHref} className="ch-btn ch-btn-primary w-full">
            Sign in to chat
          </a>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-500">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
