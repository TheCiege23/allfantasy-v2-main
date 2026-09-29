'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { MessageModerationMenu } from '@/components/moderation/MessageModerationMenu'
import { mockDraftReportThreadId } from '@/lib/moderation/reportRooms'

export interface MockDraftChatPanelProps {
  draftId: string
  pollIntervalMs?: number
  aiSuggestion?: string | null
}

type ChatMessage = {
  id: string
  userId: string | null
  displayName: string | null
  content: string
  createdAt: string
}

export function MockDraftChatPanel({ draftId, pollIntervalMs = 5000, aiSuggestion = null }: MockDraftChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Who is reading — from the chat route, so Report and Block skip your own messages. */
  const [viewerId, setViewerId] = useState<string | null>(null)
  /** Blocked here, hidden at once — the route drops them from the next poll. */
  const [blockedAuthors, setBlockedAuthors] = useState<ReadonlySet<string>>(() => new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchMessages = async () => {
    try {
      const res = await fetch(`/api/mock-draft/${draftId}/chat`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages ?? [])
        if (typeof data.viewerUserId === 'string') setViewerId(data.viewerUserId)
        setError(null)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Unable to load chat for this draft.')
      }
    } catch {
      setError('Unable to load chat for this draft.')
    }
  }

  useEffect(() => {
    if (!draftId) return
    fetchMessages()
    const id = setInterval(fetchMessages, pollIntervalMs)
    return () => clearInterval(id)
  }, [draftId, pollIntervalMs])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/mock-draft/${draftId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      if (res.ok) {
        const msg = await res.json()
        setMessages((prev) => [...prev, msg])
        setInput('')
        setError(null)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Unable to send message.')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="flex flex-col rounded-2xl border border-white/12 bg-black/25 text-xs" data-testid="mock-draft-chat-panel">
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <MessageCircle className="h-4 w-4 text-cyan-400" />
        <span className="font-medium text-white">Mock chat (isolated)</span>
      </header>
      <div className="flex min-h-[120px] max-h-[220px] flex-1 flex-col overflow-y-auto p-2">
        {aiSuggestion && (
          <p className="mb-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-[11px] text-cyan-100" data-testid="mock-draft-chat-ai-suggestion">
            {aiSuggestion}
          </p>
        )}
        {error && (
          <p className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
            {error}
          </p>
        )}
        {messages.length === 0 ? (
          <p className="py-4 text-center text-white/50">No messages yet. Mock chat does not sync with league chat.</p>
        ) : (
          messages
            .filter((m) => !m.userId || !blockedAuthors.has(m.userId))
            .map((m) => (
              <div key={m.id} className="mb-2 flex items-start gap-1 rounded-lg border border-white/5 bg-black/30 px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-cyan-300">{m.displayName || 'User'}:</span>{' '}
                  <span className="text-white/90">{m.content}</span>
                </span>
                <MessageModerationMenu
                  threadId={mockDraftReportThreadId(draftId)}
                  messageId={m.id}
                  authorId={m.userId}
                  authorName={m.displayName}
                  viewerId={viewerId}
                  onBlocked={(id) => setBlockedAuthors((prev) => new Set(prev).add(id))}
                />
              </div>
            ))
        )}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-white/10 p-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Message..."
          data-testid="mock-draft-chat-input"
          className="flex-1 rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-white placeholder:text-white/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          data-testid="mock-draft-chat-send"
          className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-1.5 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </section>
  )
}
