"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  MessageCircle, Send, X, Image as ImageIcon,
  Smile, BarChart3, Reply, ChevronDown,
  Search, Loader2
} from "lucide-react"
import { useUserTimezone } from "@/hooks/useUserTimezone"
import { fetchGifs, gifSearchPlaceholder, type GifProvider } from "@/lib/rich-message/gifSearchClient"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"

type ChatMember = {
  id: string
  userId: string
  user: { displayName: string | null; username: string | null }
}

type ReactionData = {
  id: string
  emoji: string
  userId: string
  user: { id: string; displayName: string | null; username: string | null }
}

type ReplyData = {
  id: string
  message: string
  type: string
  user: { id: string; displayName: string | null; username: string | null }
}

type ChatMessage = {
  id: string
  userId: string
  message: string
  type: string
  imageUrl: string | null
  metadata: any
  replyTo: ReplyData | null
  reactions: ReactionData[]
  createdAt: string
  user: {
    id: string
    displayName: string | null
    username: string | null
      avatarUrl?: string | null
    profile?: { avatarPreset?: string | null } | null
  }
}

const QUICK_REACTIONS = ['🔥', '💀', '😂', '🏀', '👀', '💪', '❤️', '👏']

const EXTENDED_EMOJIS: { label: string; emojis: string[] }[] = [
  {
    label: "March Madness",
    emojis: ['🏀', '🏆', '🎯', '🏅', '🥇', '🥈', '🥉', '🎪', '🏟️', '📋'],
  },
  {
    label: "Sports & Action",
    emojis: ['💪', '🔥', '⚡', '💥', '🚀', '🎯', '🙌', '👏', '✊', '🤝'],
  },
  {
    label: "Feelings & Reactions",
    emojis: ['😂', '🤣', '💀', '😤', '😱', '🤯', '😭', '🥶', '🫡', '👀', '😈', '🤡', '🫠', '🥹'],
  },
]

const USER_COLORS = [
  '#fb923c', '#3b82f6', '#22c55e', '#a855f7', '#ec4899',
  '#14b8a6', '#f59e0b', '#ef4444', '#6366f1', '#84cc16',
]

function getUserColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

function getUserName(user: { displayName: string | null; username?: string | null }): string {
  return user.displayName || user.username || "User"
}

function getUserInitials(user: { displayName: string | null; username?: string | null }): string {
  const name = getUserName(user)
  return name.slice(0, 2).toUpperCase()
}

function formatChatTime(
  iso: string,
  formatDateInTimezone: (date: Date | string | number) => string
): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return "now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 172800000) return "yesterday"
  return formatDateInTimezone(iso)
}

function formatFullTime(
  iso: string,
  formatInTimezone: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
): string {
  return formatInTimezone(iso, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function groupReactions(reactions: ReactionData[]): Map<string, { count: number; users: string[]; userIds: string[] }> {
  const map = new Map<string, { count: number; users: string[]; userIds: string[] }>()
  for (const r of reactions) {
    const existing = map.get(r.emoji) || { count: 0, users: [], userIds: [] }
    existing.count++
    existing.users.push(getUserName(r.user))
    existing.userIds.push(r.userId)
    map.set(r.emoji, existing)
  }
  return map
}

type GifResult = { id: string; url: string; preview: string; title: string }

export function PoolChat({
  leagueId,
  currentUserId,
  members,
}: {
  leagueId: string
  currentUserId: string
  members: ChatMember[]
}) {
  const { formatDateInTimezone, formatInTimezone } = useUserTimezone()
  const [latestMessage, setLatestMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [showReactionsFor, setShowReactionsFor] = useState<string | null>(null)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [showPollCreator, setShowPollCreator] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastSeenCount = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/bracket/leagues/${leagueId}/chat`)
      if (res.ok) {
        const data = await res.json()
        const msgs: ChatMessage[] = data.messages ?? []
        setMessages(msgs)
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1]
          const name = getUserName(last.user)
          const preview = last.type === "image" ? "sent a photo" : last.type === "gif" ? "sent a GIF" : last.type === "poll" ? "created a poll" : last.message?.length > 30 ? last.message.slice(0, 30) + "..." : last.message
          setLatestMessage(`${name}: ${preview}`)
        }
        if (!expanded && msgs.length > lastSeenCount.current) {
          setUnreadCount(msgs.length - lastSeenCount.current)
        }
      }
    } catch {}
  }, [leagueId, expanded])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || sending) return
    setSending(true)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: input.trim(),
          type: "text",
          replyToId: replyTo?.id || null,
        }),
      })
      setInput("")
      setReplyTo(null)
      fetchMessages()
    } catch {}
    setSending(false)
  }

  async function sendReaction(messageId: string, emoji: string) {
    setShowReactionsFor(null)
    setShowEmojiPicker(false)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/chat/react`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, emoji }),
      })
      fetchMessages()
    } catch {}
  }

  async function sendGif(gifUrl: string) {
    setShowGifPicker(false)
    setSending(true)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "gif",
          imageUrl: gifUrl,
          message: "GIF",
          replyToId: replyTo?.id || null,
        }),
      })
      setReplyTo(null)
      fetchMessages()
    } catch {}
    setSending(false)
  }

  async function sendPoll(question: string, options: string[]) {
    setShowPollCreator(false)
    setSending(true)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "poll",
          metadata: { question, options },
        }),
      })
      fetchMessages()
    } catch {}
    setSending(false)
  }

  async function votePoll(messageId: string, optionIndex: number) {
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/chat/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, optionIndex }),
      })
      fetchMessages()
    } catch {}
  }

  async function uploadImage(file: File) {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      // Pool photos are private: stored only after the server proves you are in this pool,
      // and served back only to its members.
      formData.append("leagueId", leagueId)
      const res = await fetch("/api/bracket/chat-upload", { method: "POST", body: formData })
      if (!res.ok) throw new Error("Upload failed")
      const { url } = await res.json()
      await fetch(`/api/bracket/leagues/${leagueId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "image",
          imageUrl: url,
          replyToId: replyTo?.id || null,
        }),
      })
      setReplyTo(null)
      fetchMessages()
    } catch {}
    setUploading(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith("image/")) uploadImage(file)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadImage(file)
    e.target.value = ""
  }

  useEffect(() => { fetchMessages() }, [fetchMessages])

  useEffect(() => {
    if (expanded) {
      lastSeenCount.current = messages.length
      setUnreadCount(0)
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
    }
  }, [expanded, messages.length])

  useEffect(() => {
    const interval = setInterval(fetchMessages, 10000)
    return () => clearInterval(interval)
  }, [fetchMessages])

  const onlineCount = Math.min(members.length, Math.max(1, Math.floor(members.length * 0.3)))

  if (!expanded) {
    return (
      <div
        onClick={() => { setExpanded(true); fetchMessages() }}
        className="fixed bottom-0 left-0 right-0 z-30 px-4 py-3 flex items-center gap-3 cursor-pointer transition-all"
        style={{ background: "rgba(13,17,23,0.95)", backdropFilter: "blur(12px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="relative flex-shrink-0">
          <MessageCircle className="h-5 w-5 text-white" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: "#ef4444" }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Chat</span>
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#22c55e" }} />
              {onlineCount} online
            </span>
          </div>
          {latestMessage ? (
            <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{latestMessage}</p>
          ) : (
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Be the first to say hi</p>
          )}
        </div>
        <div className="flex -space-x-1.5 flex-shrink-0">
          {members.slice(0, 3).map((m) => (
            <div
              key={m.id}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold"
              style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c", border: "2px solid #0d1117" }}
            >
              {getUserInitials(m.user)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30"
      style={{ background: "rgba(13,17,23,0.98)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(255,255,255,0.08)", maxHeight: "65vh" }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-t-xl" style={{ background: "rgba(251,146,60,0.1)", border: "2px dashed #fb923c" }}>
          <div className="text-center">
            <ImageIcon className="w-8 h-8 mx-auto mb-2" style={{ color: "#fb923c" }} />
            <p className="text-sm font-semibold" style={{ color: "#fb923c" }}>Drop image here</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-white" />
          <span className="text-sm font-semibold text-white">Pool Chat</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
            {members.length} members
          </span>
        </div>
        <button onClick={() => setExpanded(false)} className="p-1.5 rounded-lg transition hover:bg-white/5" style={{ color: "rgba(255,255,255,0.4)" }}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-y-auto px-4 py-3 space-y-1" style={{ maxHeight: "calc(65vh - 110px)" }}>
        {messages.length === 0 && (
          <div className="text-center py-6 space-y-2">
            <MessageCircle className="h-8 w-8 mx-auto" style={{ color: "rgba(255,255,255,0.08)" }} />
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>No messages yet. Start the trash talk!</p>
          </div>
        )}
        {messages.map((m, idx) => {
          const isMe = m.user?.id === currentUserId || m.userId === currentUserId
          const prevMsg = idx > 0 ? messages[idx - 1] : null
          const sameSender = prevMsg && (prevMsg.user?.id || prevMsg.userId) === (m.user?.id || m.userId)
          const timeDiff = prevMsg ? new Date(m.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() : Infinity
          const showHeader = !sameSender || timeDiff > 300000

          let systemMsg: { type: string; content: string } | null = null
          try {
            const parsed = JSON.parse(m.message)
            if (parsed.isSystem) systemMsg = parsed
          } catch {}

          if (systemMsg) {
            const typeColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
              UPSET_ALERT: { bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.2)", text: "#fb923c", icon: "🚨" },
              BRACKET_BUSTED: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", text: "#ef4444", icon: "💥" },
              BIG_SWING: { bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.2)", text: "#818cf8", icon: "📊" },
              LEAD_CHANGE: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)", text: "#22c55e", icon: "👑" },
              TOURNAMENT_READY: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)", text: "#3b82f6", icon: "🏀" },
              BRACKET_LOCKED: { bg: "rgba(234,179,8,0.08)", border: "rgba(234,179,8,0.2)", text: "#eab308", icon: "🔒" },
            }
            const style = typeColors[systemMsg.type] || typeColors.TOURNAMENT_READY
            return (
              <div key={m.id} className="flex justify-center my-2">
                <div className="rounded-lg px-3 py-1.5 text-center max-w-[85%]" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                  <span className="text-[11px] font-semibold" style={{ color: style.text }}>
                    {style.icon} {systemMsg.content}
                  </span>
                </div>
              </div>
            )
          }

          const userColor = getUserColor(m.user?.id || m.userId)
          const grouped = groupReactions(m.reactions || [])

          return (
            <div key={m.id} className={`group ${showHeader ? "mt-3" : "mt-0.5"}`}>
              <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                {!isMe && showHeader ? (
                  <div className="w-8 h-8 flex-shrink-0 mt-0.5">
                    <IdentityImageRenderer
                      avatarUrl={m.user.avatarUrl ?? null}
                      avatarPreset={m.user.profile?.avatarPreset ?? null}
                      displayName={m.user.displayName}
                      username={m.user.username ?? null}
                      size="sm"
                    />
                  </div>
                ) : !isMe ? (
                  <div className="w-7 flex-shrink-0" />
                ) : null}

                <div className={`max-w-[78%] min-w-0 ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                  {showHeader && (
                    <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "flex-row-reverse" : ""}`}>
                      <span className="text-[11px] font-semibold" style={{ color: userColor }}>
                        {isMe ? "You" : getUserName(m.user)}
                      </span>
                      <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                        {formatChatTime(m.createdAt, formatDateInTimezone)}
                      </span>
                    </div>
                  )}

                  {m.replyTo && (
                    <div
                      className={`rounded-lg px-2.5 py-1 mb-1 text-[10px] ${isMe ? "ml-auto" : ""}`}
                      style={{ background: "rgba(255,255,255,0.03)", borderLeft: `2px solid ${getUserColor(m.replyTo.user?.id || "")}` }}
                    >
                      <span className="font-semibold" style={{ color: getUserColor(m.replyTo.user?.id || "") }}>
                        {getUserName(m.replyTo.user)}
                      </span>
                      <p className="truncate" style={{ color: "rgba(255,255,255,0.35)", maxWidth: 200 }}>
                        {m.replyTo.type === "image" ? "📷 Photo" : m.replyTo.type === "gif" ? "GIF" : m.replyTo.message}
                      </p>
                    </div>
                  )}

                  <div className="relative group/msg">
                    {m.type === "poll" ? (
                      <PollBubble msg={m} currentUserId={currentUserId} onVote={votePoll} />
                    ) : m.type === "image" && m.imageUrl ? (
                      <div className={`rounded-2xl overflow-hidden ${isMe ? "rounded-br-md" : "rounded-bl-md"}`} style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                        <img src={m.imageUrl} alt="" className="max-w-full max-h-48 object-cover" loading="lazy" />
                        {m.message && m.message !== "" && (
                          <div className="px-3 py-1.5 text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{m.message}</div>
                        )}
                      </div>
                    ) : m.type === "gif" && m.imageUrl ? (
                      <div className={`rounded-2xl overflow-hidden ${isMe ? "rounded-br-md" : "rounded-bl-md"}`} style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                        <img src={m.imageUrl} alt="GIF" className="max-w-full max-h-48 object-cover" loading="lazy" />
                      </div>
                    ) : (
                      <div
                        className={`rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed ${isMe ? "rounded-br-md" : "rounded-bl-md"}`}
                        style={{
                          background: isMe ? "rgba(251,146,60,0.12)" : "rgba(255,255,255,0.04)",
                          color: isMe ? "#fbbf24" : "rgba(255,255,255,0.8)",
                        }}
                      >
                        {m.message}
                      </div>
                    )}

                    <div className={`absolute ${isMe ? "-left-16" : "-right-16"} top-0 opacity-0 group-hover/msg:opacity-100 flex items-center gap-0.5 transition-opacity`}>
                      <button
                        onClick={() => { setShowReactionsFor(showReactionsFor === m.id ? null : m.id); setShowEmojiPicker(false) }}
                        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 transition"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                        title="React"
                      >
                        <Smile className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setReplyTo(m); inputRef.current?.focus() }}
                        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 transition"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                        title="Reply"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {showReactionsFor === m.id && (
                      <div className={`absolute ${isMe ? "right-0" : "left-0"} z-20`} style={{ bottom: "100%", marginBottom: 4 }}>
                        <div className="rounded-xl px-1.5 py-1" style={{ background: "rgba(22,22,30,0.98)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }}>
                          <div className="flex items-center gap-0.5">
                            {QUICK_REACTIONS.map((r) => (
                              <button key={r} onClick={() => sendReaction(m.id, r)} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition text-sm hover:scale-125">
                                {r}
                              </button>
                            ))}
                            <button
                              onClick={() => setShowEmojiPicker(showEmojiPicker ? false : true)}
                              className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition text-[10px]"
                              title="More emojis"
                            >
                              ＋
                            </button>
                          </div>
                          {showEmojiPicker && (
                            <div className="pt-1 mt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", maxWidth: 260 }}>
                              {EXTENDED_EMOJIS.map((cat) => (
                                <div key={cat.label} className="mb-1.5">
                                  <div className="text-[9px] uppercase tracking-wider px-1 mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{cat.label}</div>
                                  <div className="flex flex-wrap gap-0.5">
                                    {cat.emojis.map((e, i) => (
                                      <button key={`${e}-${i}`} onClick={() => sendReaction(m.id, e)} className="w-7 h-7 rounded flex items-center justify-center hover:bg-white/10 transition text-sm hover:scale-125">
                                        {e}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {grouped.size > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? "justify-end" : ""}`}>
                      {Array.from(grouped.entries()).map(([emoji, data]) => {
                        const iReacted = data.userIds.includes(currentUserId)
                        return (
                          <button
                            key={emoji}
                            onClick={() => sendReaction(m.id, emoji)}
                            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] transition hover:scale-105"
                            style={{
                              background: iReacted ? "rgba(251,146,60,0.15)" : "rgba(255,255,255,0.04)",
                              border: `1px solid ${iReacted ? "rgba(251,146,60,0.3)" : "rgba(255,255,255,0.06)"}`,
                            }}
                            title={data.users.join(", ")}
                          >
                            <span>{emoji}</span>
                            <span style={{ color: iReacted ? "#fb923c" : "rgba(255,255,255,0.4)", fontWeight: 600, fontSize: 10 }}>{data.count}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {!showHeader && (
                    <span className="text-[9px] opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" style={{ color: "rgba(255,255,255,0.15)" }}>
                      {formatFullTime(m.createdAt, formatInTimezone)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {replyTo && (
        <div className="px-4 py-2 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <Reply className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#fb923c" }} />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-semibold" style={{ color: "#fb923c" }}>
              Replying to {getUserName(replyTo.user)}
            </span>
            <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.3)" }}>
              {replyTo.type === "image" ? "📷 Photo" : replyTo.type === "gif" ? "GIF" : replyTo.message}
            </p>
          </div>
          <button onClick={() => setReplyTo(null)} className="p-1 rounded hover:bg-white/5">
            <X className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
          </button>
        </div>
      )}

      {showGifPicker && (
        <GifPicker onSelect={sendGif} onClose={() => setShowGifPicker(false)} />
      )}

      {showPollCreator && (
        <PollCreator onSubmit={sendPoll} onClose={() => setShowPollCreator(false)} />
      )}

      <form onSubmit={sendMessage} className="px-4 py-2.5 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition hover:bg-white/5"
            style={{ color: "rgba(255,255,255,0.3)" }}
            title="Upload image"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => { setShowGifPicker(!showGifPicker); setShowPollCreator(false) }}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition hover:bg-white/5 text-[11px] font-bold"
            style={{ color: showGifPicker ? "#fb923c" : "rgba(255,255,255,0.3)" }}
            title="Send GIF"
          >
            GIF
          </button>
          <button
            type="button"
            onClick={() => { setShowPollCreator(!showPollCreator); setShowGifPicker(false) }}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition hover:bg-white/5"
            style={{ color: showPollCreator ? "#fb923c" : "rgba(255,255,255,0.3)" }}
            title="Create poll"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
        </div>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={replyTo ? `Reply to ${getUserName(replyTo.user)}...` : "Type a message..."}
          maxLength={500}
          className="flex-1 rounded-xl px-3 py-2 text-sm text-white outline-none placeholder-white/20"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="p-2 rounded-xl disabled:opacity-40 transition"
          style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c" }}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}

function PollBubble({
  msg,
  currentUserId,
  onVote,
}: {
  msg: ChatMessage
  currentUserId: string
  onVote: (messageId: string, optionIndex: number) => void
}) {
  const meta = msg.metadata as { question: string; options: string[]; votes: Record<string, string[]> }
  if (!meta) return null

  const votes = meta.votes || {}
  let totalVotes = 0
  for (const arr of Object.values(votes)) totalVotes += (arr as string[]).length

  let myVoteIdx: number | null = null
  for (const [key, arr] of Object.entries(votes)) {
    if ((arr as string[]).includes(currentUserId)) myVoteIdx = parseInt(key)
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", minWidth: 220 }}>
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart3 className="w-3.5 h-3.5" style={{ color: "#fb923c" }} />
          <span className="text-[11px] font-bold" style={{ color: "#fb923c" }}>POLL</span>
        </div>
        <p className="text-[13px] font-semibold text-white mb-2">{meta.question}</p>
      </div>
      <div className="px-3 pb-2.5 space-y-1.5">
        {meta.options.map((opt, i) => {
          const optVotes = (votes[String(i)] || []).length
          const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0
          const isMyVote = myVoteIdx === i
          return (
            <button
              key={i}
              onClick={() => onVote(msg.id, i)}
              className="w-full rounded-lg px-3 py-2 text-left relative overflow-hidden transition hover:brightness-110"
              style={{
                background: isMyVote ? "rgba(251,146,60,0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isMyVote ? "rgba(251,146,60,0.3)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              {totalVotes > 0 && (
                <div
                  className="absolute left-0 top-0 bottom-0 rounded-lg transition-all duration-500"
                  style={{ width: `${pct}%`, background: isMyVote ? "rgba(251,146,60,0.08)" : "rgba(255,255,255,0.02)" }}
                />
              )}
              <div className="relative flex items-center justify-between">
                <span className="text-[12px]" style={{ color: isMyVote ? "#fb923c" : "rgba(255,255,255,0.7)" }}>{opt}</span>
                {totalVotes > 0 && (
                  <span className="text-[10px] font-semibold ml-2" style={{ color: "rgba(255,255,255,0.3)" }}>{pct}%</span>
                )}
              </div>
            </button>
          )
        })}
        <p className="text-[10px] text-center pt-1" style={{ color: "rgba(255,255,255,0.2)" }}>
          {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  )
}

/*
 * The pool chat's GIF picker. It called Tenor straight from the browser, with a key inlined into the
 * page — and Google shut the Tenor API down on 2026-06-30, so it showed nothing at all. It now asks our
 * own `/api/chat/gifs` (lib/rich-message/gifSearchClient.ts): the preloaded grid when the box is empty,
 * a live search otherwise, and the credit of whichever service supplied what is on screen.
 */
export function GifPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(false)
  const [trending, setTrending] = useState<GifResult[]>([])
  const [provider, setProvider] = useState<GifProvider | null>(null)
  const [searchProvider, setSearchProvider] = useState<GifProvider | null>(null)
  const latest = useRef(0)

  const load = useCallback(async (q: string) => {
    const ticket = ++latest.current
    setLoading(true)
    const res = await fetchGifs(q, 24)
    // A slower, older search must not overwrite a newer one.
    if (ticket !== latest.current) return
    const gifs: GifResult[] = res.gifs.map((g) => ({ id: g.id, url: g.url, preview: g.previewUrl || g.url, title: g.title || "" }))
    if (q.trim()) setResults(gifs)
    else setTrending(gifs)
    setProvider(res.provider)
    if (res.searchProvider) setSearchProvider(res.searchProvider)
    setLoading(false)
  }, [])

  useEffect(() => { void load("") }, [load])

  useEffect(() => {
    if (!query.trim()) return
    const t = setTimeout(() => { void load(query) }, 400)
    return () => clearTimeout(t)
  }, [query, load])

  const displayGifs = query.trim() ? results : trending

  return (
    // Only the grid scrolls: the search box and the credit stay in view — the credit is part of the
    // terms, and a credit you have to scroll to find is not much of one.
    <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={gifSearchPlaceholder(searchProvider)}
            aria-label="Search GIFs"
            className="w-full rounded-lg pl-8 pr-3 py-1.5 text-xs text-white outline-none placeholder-white/20"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            autoFocus
          />
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5" aria-label="Close GIFs">
          <X className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "rgba(255,255,255,0.2)" }} />
        </div>
      ) : displayGifs.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
          {query.trim() ? `No GIFs for "${query.trim()}". Try another word.` : "GIFs aren't available right now."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5" style={{ maxHeight: 208, overflowY: "auto" }}>
          {displayGifs.map((g) => (
            <button
              key={g.id}
              onClick={() => onSelect(g.url)}
              aria-label={g.title ? `Send GIF: ${g.title}` : "Send GIF"}
              className="rounded-lg overflow-hidden hover:ring-2 hover:ring-orange-400/50 transition aspect-square"
            >
              <img src={g.preview} alt={g.title} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {provider === "klipy" || provider === "giphy" ? (
        <a
          href={provider === "klipy" ? "https://klipy.com" : "https://giphy.com"}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[9px] text-center mt-2 uppercase tracking-widest"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          {provider === "klipy" ? "Powered by KLIPY" : "Powered by GIPHY"}
        </a>
      ) : null}
    </div>
  )
}

function PollCreator({ onSubmit, onClose }: { onSubmit: (question: string, options: string[]) => void; onClose: () => void }) {
  const [question, setQuestion] = useState("")
  const [options, setOptions] = useState(["", ""])

  function addOption() {
    if (options.length < 6) setOptions([...options, ""])
  }

  function updateOption(idx: number, val: string) {
    const updated = [...options]
    updated[idx] = val
    setOptions(updated)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validOptions = options.filter((o) => o.trim())
    if (!question.trim() || validOptions.length < 2) return
    onSubmit(question.trim(), validOptions.map((o) => o.trim()))
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-3 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" style={{ color: "#fb923c" }} />
          <span className="text-xs font-bold" style={{ color: "#fb923c" }}>Create Poll</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-white/5">
          <X className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
        </button>
      </div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask a question..."
        maxLength={200}
        className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none placeholder-white/20"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        autoFocus
      />
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <input
            key={i}
            value={opt}
            onChange={(e) => updateOption(i, e.target.value)}
            placeholder={`Option ${i + 1}`}
            maxLength={100}
            className="w-full rounded-lg px-3 py-1.5 text-xs text-white outline-none placeholder-white/20"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        {options.length < 6 && (
          <button type="button" onClick={addOption} className="text-[11px] font-semibold" style={{ color: "#fb923c" }}>
            + Add option
          </button>
        )}
        <button
          type="submit"
          disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition"
          style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c" }}
        >
          Create Poll
        </button>
      </div>
    </form>
  )
}
