"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Send, Loader2 } from "lucide-react"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"

type ChatMessage = {
  id: string
  message: string
  createdAt: string
  user: {
    id: string
    displayName: string | null
    username: string | null
    email: string
    avatarUrl: string | null
    profile?: { avatarPreset?: string | null } | null
  }
}

export function LeagueChat({ leagueId, currentUserId }: { leagueId: string; currentUserId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/bracket/leagues/${leagueId}/chat`)
      if (!res.ok) return
      const data = await res.json()
      setMessages(data.messages || [])
    } catch {}
  }, [leagueId])

  useEffect(() => {
    setLoading(true)
    fetchMessages().finally(() => setLoading(false))
    pollRef.current = setInterval(fetchMessages, 8000)
    return () => clearInterval(pollRef.current)
  }, [fetchMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return

    setSending(true)
    setInput("")

    const optimistic: ChatMessage = {
      id: `temp-${Date.now()}`,
      message: text,
      createdAt: new Date().toISOString(),
      user: {
        id: currentUserId,
        displayName: null,
        username: null,
        email: "",
        avatarUrl: null,
        profile: { avatarPreset: null },
      },
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await fetch(`/api/bracket/leagues/${leagueId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? data.message : m))
        )
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
    } finally {
      setSending(false)
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return "just now"
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[400px]">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-white/40" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="text-center py-12 text-white/30 text-sm">
            No messages yet. Start the conversation!
          </div>
        )}

        {messages.map((msg) => {
          const isOwn = msg.user.id === currentUserId
          return (
            <div key={msg.id} className={`flex gap-2.5 ${isOwn ? "flex-row-reverse" : ""}`}>
              <IdentityImageRenderer
                avatarUrl={msg.user.avatarUrl}
                avatarPreset={msg.user.profile?.avatarPreset ?? null}
                displayName={msg.user.displayName}
                username={msg.user.username ?? null}
                size="sm"
              />
              <div className={`max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
                <div className={`text-[11px] mb-0.5 ${isOwn ? "text-right" : ""} text-white/40`}>
                  {msg.user.displayName || msg.user.username || "User"}
                </div>
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    isOwn
                      ? "bg-indigo-600 text-white rounded-br-md"
                      : "bg-white/10 text-white/90 rounded-bl-md"
                  }`}
                >
                  {msg.message}
                </div>
                <div className={`text-[11px] mt-0.5 ${isOwn ? "text-right" : ""} text-white/25`}>
                  {formatTime(msg.createdAt)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-white/10 p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          maxLength={1000}
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 transition"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2.5 transition"
        >
          <Send className="h-4 w-4 text-white" />
        </button>
      </form>
    </div>
  )
}
