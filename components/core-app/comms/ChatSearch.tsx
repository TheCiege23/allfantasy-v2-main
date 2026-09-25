'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { formatChatMessageTimestamp } from '@/lib/chat-core/chat-timestamps'

/**
 * Search this conversation.
 *
 * ⚠ THE #1 THING PEOPLE ASK SLEEPER FOR. Its own feedback channel carries
 * "Please allow search in the league chat! It sucks not being able to easily
 * search for old messages", and its reviews describe scrolling "countless
 * messages" for ten minutes before giving up. The route already existed —
 * `/api/shared/chat/threads/[threadId]/search`, league rooms included — with no
 * caller anywhere in the drawer.
 *
 * A hit that is on screen is jumped to and flashed. One older than the loaded
 * window is shown in full here, with its date, rather than pretending it can be
 * scrolled to.
 */

type Hit = { id: string; senderName: string; body: string; createdAt: string }

function readHits(data: unknown): Hit[] {
  const list = (data as { messages?: unknown } | null)?.messages
  if (!Array.isArray(list)) return []
  const out: Hit[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    const body = typeof r.body === 'string' ? r.body : typeof r.text === 'string' ? r.text : ''
    if (!id || !body.trim()) continue
    const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null
    if (meta?.deletedAt) continue
    out.push({
      id,
      body,
      senderName:
        typeof r.senderName === 'string' ? r.senderName : typeof r.authorName === 'string' ? r.authorName : 'Someone',
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    })
  }
  /* Newest first: the thing you half-remember is usually recent. */
  return out.reverse()
}

export function ChatSearch({
  threadId,
  onClose,
  onJump,
}: {
  /** The platform thread id, or `league:<id>` for a league room. */
  threadId: string
  onClose: () => void
  /** Returns true when the message was on screen and has been scrolled to. */
  onJump: (messageId: string) => boolean
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setHits(null)
      setError(null)
      return
    }
    let cancelled = false
    const handle = window.setTimeout(() => {
      setBusy(true)
      fetch(`/api/shared/chat/threads/${encodeURIComponent(threadId)}/search?q=${encodeURIComponent(query)}&limit=25`, {
        cache: 'no-store',
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(r.status === 403 ? 'You cannot search this chat.' : 'Search is unavailable right now.')
          return r.json()
        })
        .then((d) => {
          if (cancelled) return
          setHits(readHits(d))
          setError(null)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setHits([])
          setError(e instanceof Error ? e.message : 'Search is unavailable right now.')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [q, threadId])

  return (
    <div className="af-cm-search" role="search">
      <div className="af-cm-search-bar">
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }
          }}
          placeholder="Search this chat"
          aria-label="Search this chat"
          className="af-cm-search-input"
        />
        <button type="button" className="af-cm-search-x" onClick={onClose} aria-label="Close search">
          <X size={14} aria-hidden />
        </button>
      </div>
      {q.trim().length >= 2 ? (
        <div className="af-cm-search-results" aria-live="polite">
          {busy && !hits ? <p className="af-cm-search-note">Searching…</p> : null}
          {error ? <p className="af-cm-search-note">{error}</p> : null}
          {hits && hits.length === 0 && !error ? (
            <p className="af-cm-search-note">Nothing matches &ldquo;{q.trim()}&rdquo;.</p>
          ) : null}
          {hits?.map((h) => (
            <button
              key={h.id}
              type="button"
              className="af-cm-search-hit"
              data-expanded={expanded === h.id || undefined}
              onClick={() => {
                if (!onJump(h.id)) setExpanded((cur) => (cur === h.id ? null : h.id))
              }}
            >
              <span className="af-cm-search-who">
                {h.senderName}
                {h.createdAt ? <span> · {formatChatMessageTimestamp(h.createdAt)}</span> : null}
              </span>
              <span className="af-cm-search-text">{censorProfanity(h.body)}</span>
              {expanded === h.id ? (
                <span className="af-cm-search-note">Older than what&apos;s loaded here — shown in full above.</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default ChatSearch
