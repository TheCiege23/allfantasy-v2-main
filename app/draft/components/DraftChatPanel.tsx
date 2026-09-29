'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageModerationMenu } from '@/components/moderation/MessageModerationMenu'
import { draftRoomReportThreadId } from '@/lib/moderation/reportRooms'

type Msg = {
  id: string
  /** The author; null on system rows. Present so Report and Block can be offered. */
  authorUserId?: string | null
  authorDisplayName: string | null
  message: string
  type: string
  createdAt: string
}

type Props = {
  sessionId: string
  mode: 'mock' | 'live'
  /** The viewer's appUserId — Report and Block are offered on everybody's messages but yours. */
  viewerId?: string | null
}

export function DraftChatPanel({ sessionId, mode, viewerId = null }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  /*
   * People blocked from this panel, hidden at once: the history route drops them from the next
   * read, but this panel only re-reads every 4 seconds.
   */
  const [blockedAuthors, setBlockedAuthors] = useState<ReadonlySet<string>>(() => new Set())

  const load = useCallback(async () => {
    const r = await fetch(`/api/draft/chat/history?sessionId=${encodeURIComponent(sessionId)}`)
    /*
     * Keep what is on screen when a read fails. The route answers 503 rather than serve a transcript
     * that may include people this viewer blocked, and blanking the chat on that would read as data loss.
     */
    if (!r.ok) return
    const j = (await r.json().catch(() => ({}))) as { messages?: Msg[] }
    if (Array.isArray(j.messages)) setMessages(j.messages)
  }, [sessionId])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(id)
  }, [load])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    await fetch('/api/draft/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: t, mode }),
    })
    void load()
  }

  const threadId = draftRoomReportThreadId(sessionId)
  const visible = messages.filter((m) => !m.authorUserId || !blockedAuthors.has(m.authorUserId))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1117]">
      <div className="border-b border-white/[0.06] px-2 py-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Draft chat</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 text-[11px]">
        {visible.map((m) => (
          <div
            key={m.id}
            className={m.type === 'system' ? 'text-center text-[11px] text-cyan-300/80' : 'flex items-start gap-1 text-white/80'}
          >
            <span className={m.type === 'system' ? undefined : 'min-w-0 flex-1'}>
              {m.type !== 'system' ? <span className="font-semibold text-white/60">{m.authorDisplayName}: </span> : null}
              {m.message}
            </span>
            {m.type !== 'system' ? (
              <MessageModerationMenu
                threadId={threadId}
                messageId={m.id}
                authorId={m.authorUserId}
                authorName={m.authorDisplayName}
                viewerId={viewerId}
                onBlocked={(id) => setBlockedAuthors((prev) => new Set(prev).add(id))}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex gap-1 border-t border-white/[0.06] p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          placeholder="Message…"
          className="min-w-0 flex-1 rounded border border-white/[0.08] bg-black/30 px-2 py-1 text-[11px] text-white"
        />
        <button
          type="button"
          onClick={() => void send()}
          className="rounded bg-cyan-500 px-3 py-1 text-[11px] font-bold text-black"
        >
          Send
        </button>
      </div>
    </div>
  )
}
