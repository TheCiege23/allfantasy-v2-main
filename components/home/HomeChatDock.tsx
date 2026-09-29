"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  MessageCircle,
  X,
  Hash,
  User2,
  Sparkles,
  Image as ImageIcon,
  Film,
  SmilePlus,
  BarChart2,
  AtSign,
  ShieldAlert,
  BellOff,
  Users,
} from "lucide-react"
import type { PlatformChatMessage, PlatformChatThread } from "@/types/platform-shared"
import { useUserTimezone } from "@/hooks/useUserTimezone"
import { getMuteThreadUrl } from "@/lib/conversations"
import {
  BLOCK_API,
  UNBLOCK_API,
  getBlockPayload,
  getUnblockPayload,
  REPORT_MESSAGE_API,
  REPORT_USER_API,
  getReportMessagePayload,
  getReportUserPayload,
  REPORT_REASONS,
  isBlockedDirectConversation,
  getBlockedConversationNotice,
  getBlockedVisibilityNotice,
} from "@/lib/moderation/client"
import MessageActionsMenu from "@/components/chat/MessageActionsMenu"

type ChatTab = "league" | "dm" | "ai"

type BlockedUser = {
  userId: string
  username: string | null
  displayName: string | null
}

type LeagueMeta = {
  lastViewed: string | null
  bestTeam: string | null
  worstTeam: string | null
  bestPlayer: string | null
  streak: string | null
}

export default function HomeChatDock() {
  const { formatInTimezone } = useUserTimezone()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ChatTab>("league")
  const [input, setInput] = useState("")
  const [showBlocked, setShowBlocked] = useState(false)
  const [allowDMs, setAllowDMs] = useState(true)
  const [threads, setThreads] = useState<PlatformChatThread[]>([])
  const [leagueThreadId, setLeagueThreadId] = useState<string | null>(null)
  const [dmThreadId, setDmThreadId] = useState<string | null>(null)
  const [aiThreadId, setAiThreadId] = useState<string | null>(null)
  const [messagesByThread, setMessagesByThread] = useState<Record<string, PlatformChatMessage[]>>({})
  const [hiddenBlockedByThread, setHiddenBlockedByThread] = useState<Record<string, number>>({})
  const [sending, setSending] = useState(false)
  const [loadingMessagesFor, setLoadingMessagesFor] = useState<string | null>(null)
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([])
  const [leagueMeta, setLeagueMeta] = useState<LeagueMeta | null>(null)
  const [mutedThreads, setMutedThreads] = useState<Set<string>>(new Set())
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const [reportMessageOpen, setReportMessageOpen] = useState<{ messageId: string; threadId: string } | null>(null)
  const [reportUserOpen, setReportUserOpen] = useState<{ userId: string; username: string } | null>(null)
  const [reportReason, setReportReason] = useState("other")
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [reportSuccess, setReportSuccess] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [blockConfirmOpen, setBlockConfirmOpen] = useState<{ userId: string; username: string } | null>(null)

  const activeThreadId = useMemo(() => {
    if (activeTab === "league") return leagueThreadId
    if (activeTab === "dm") return dmThreadId
    return aiThreadId
  }, [activeTab, leagueThreadId, dmThreadId, aiThreadId])

  const activeMessages: PlatformChatMessage[] = useMemo(() => {
    if (!activeThreadId) return []
    return messagesByThread[activeThreadId] || []
  }, [activeThreadId, messagesByThread])
  const activeHiddenBlockedCount = useMemo(() => {
    if (!activeThreadId) return 0
    return hiddenBlockedByThread[activeThreadId] ?? 0
  }, [activeThreadId, hiddenBlockedByThread])
  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((thread) => thread.id === activeThreadId) || null : null),
    [activeThreadId, threads]
  )
  const blockedUserSet = useMemo(() => new Set(blockedUsers.map((user) => user.userId)), [blockedUsers])
  const activeThreadBlockedDirect = useMemo(
    () => isBlockedDirectConversation(activeThread, blockedUserSet),
    [activeThread, blockedUserSet]
  )
  const activeThreadLabel = useMemo(() => {
    if (!activeThread) return null
    const context = (activeThread.context || {}) as { otherDisplayName?: string | null; otherUsername?: string | null }
    return context.otherDisplayName || context.otherUsername || activeThread.title
  }, [activeThread])
  const blockedConversationNotice = useMemo(() => {
    if (!activeThreadBlockedDirect) return ""
    return getBlockedConversationNotice(activeThreadLabel)
  }, [activeThreadBlockedDirect, activeThreadLabel])
  const blockedVisibilityNotice = useMemo(
    () => getBlockedVisibilityNotice(blockedUsers.length),
    [blockedUsers.length]
  )

  const loadThreads = useCallback(async (): Promise<PlatformChatThread[]> => {
    try {
      const threadsRes = await fetch("/api/shared/chat/threads", { cache: "no-store" })
      if (!threadsRes.ok) return []
      const tJson = await threadsRes.json()
      const list: PlatformChatThread[] = Array.isArray(tJson?.threads) ? tJson.threads : []
      setThreads(list)
      const league = list.find((thread) => thread.threadType === "league") || null
      const dm = list.find((thread) => thread.threadType === "dm") || null
      const ai = list.find((thread) => thread.threadType === "ai") || null
      setLeagueThreadId(league?.id || null)
      setDmThreadId(dm?.id || null)
      setAiThreadId(ai?.id || null)
      return list
    } catch {
      return []
    }
  }, [])

  const loadBlockedUsers = useCallback(async (): Promise<BlockedUser[]> => {
    try {
      const blockedRes = await fetch("/api/shared/chat/blocked", { cache: "no-store" })
      if (!blockedRes.ok) return []
      const blockedJson = await blockedRes.json()
      const list: BlockedUser[] = Array.isArray(blockedJson?.blockedUsers) ? blockedJson.blockedUsers : []
      setBlockedUsers(list)
      return list
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    if (!open) return

    let cancelled = false

    async function loadInitial() {
      const [list] = await Promise.all([loadThreads(), loadBlockedUsers()])
      if (cancelled) return
      const league = list.find((thread) => thread.threadType === "league") || null
      const dm = list.find((thread) => thread.threadType === "dm") || null
      const ai = list.find((thread) => thread.threadType === "ai") || null
      const initialThreadId = league?.id || dm?.id || ai?.id || null
      if (initialThreadId) {
        void loadMessages(initialThreadId)
      }
    }

    loadInitial()

    return () => {
      cancelled = true
    }
  }, [open, loadBlockedUsers, loadThreads])

  useEffect(() => {
    if (!open || !leagueThreadId) return

    let cancelled = false
    async function loadMeta() {
      try {
        const res = await fetch("/api/shared/chat/league-meta", { cache: "no-store" })
        if (!res.ok || cancelled) return
        const json = await res.json()
        const meta = (json?.meta || null) as LeagueMeta | null
        setLeagueMeta(meta)
      } catch {
        // ignore
      }
    }
    loadMeta()
    return () => {
      cancelled = true
    }
  }, [open, leagueThreadId])

  const loadMessages = useCallback(async (threadId: string) => {
    if (!threadId) return
    setLoadingMessagesFor(threadId)
    try {
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages?limit=80`,
        { cache: "no-store" },
      )
      if (res.ok) {
        const json = await res.json()
        const list: PlatformChatMessage[] = Array.isArray(json?.messages) ? json.messages : []
        setMessagesByThread((prev) => ({ ...prev, [threadId]: list }))
        setHiddenBlockedByThread((prev) => ({
          ...prev,
          [threadId]: Math.max(0, Number(json?.hiddenBlockedCount || 0)),
        }))
      }
    } catch {
      // ignore
    } finally {
      setLoadingMessagesFor((prev) => (prev === threadId ? null : prev))
    }
  }, [])

  useEffect(() => {
    if (!activeThreadId || !open) return
    if (messagesByThread[activeThreadId]?.length) return
    void loadMessages(activeThreadId)
  }, [activeThreadId, open, messagesByThread, loadMessages])

  useEffect(() => {
    const muted = new Set<string>()
    for (const thread of threads) {
      const context = (thread.context || {}) as Record<string, unknown>
      if (context.isMuted === true) muted.add(thread.id)
    }
    setMutedThreads(muted)
  }, [threads])

  const handleSend = async () => {
    if (!activeThreadId || !input.trim() || sending) return
    if (activeThreadBlockedDirect) {
      setThreadActionError(blockedConversationNotice || "This conversation is blocked.")
      return
    }
    const text = input.trim()
    setSending(true)
    setThreadActionError(null)
    setInput("")

    try {
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(activeThreadId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text, messageType: "text" }),
        },
      )
      if (res.ok) {
        const json = await res.json()
        const created: PlatformChatMessage | null = json?.message || null
        if (created) {
          setMessagesByThread((prev) => ({
            ...prev,
            [activeThreadId]: [...(prev[activeThreadId] || []), created],
          }))
        }
      } else {
        const json = await res.json().catch(() => ({}))
        setInput(text)
        setThreadActionError(
          typeof json?.error === "string" ? json.error : "Unable to send message right now."
        )
      }
    } catch {
      setInput(text)
      setThreadActionError("Unable to send message right now.")
    } finally {
      setSending(false)
    }
  }

  const launcherLabel =
    activeTab === "league"
      ? "League Chat"
      : activeTab === "dm"
      ? "Private DMs"
      : "AI Chat"

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur sm:px-4"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--panel2) 90%, transparent)",
          color: "var(--text)",
        }}
      >
        <MessageCircle className="h-4 w-4" />
        <span className="hidden sm:inline">{launcherLabel}</span>
      </button>
    )
  }

  return (
    <section
      className="fixed bottom-0 right-0 z-40 flex w-full max-w-md flex-col rounded-t-2xl border-t border-l shadow-2xl sm:bottom-4 sm:right-4 sm:max-h-[520px] sm:max-w-sm sm:rounded-2xl sm:border"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--panel) 96%, transparent)",
      }}
      aria-label="AllFantasy chat"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl border text-[11px] font-semibold"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel2)",
              color: "var(--text)",
            }}
          >
            💬
          </span>
          <div className="leading-tight">
            <p
              className="text-xs font-semibold"
              style={{ color: "var(--text)" }}
            >
              AllFantasy Chat
            </p>
            <p
              className="text-[11px]"
              style={{ color: "var(--muted2)" }}
            >
              League talk, private DMs, and AI coaching in one dock.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-xl border text-[11px]"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--panel2) 88%, transparent)",
            color: "var(--muted)",
          }}
          aria-label="Close chat"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Tabs */}
      <div className="px-2 pb-1 pt-0 sm:px-3">
        <div
          className="flex rounded-2xl border p-0.5 text-[11px] font-medium"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--panel2) 94%, transparent)",
          }}
        >
          <ChatTabButton
            active={activeTab === "league"}
            onClick={() => setActiveTab("league")}
            icon={<Hash className="h-3 w-3" />}
            label="League"
          />
          <ChatTabButton
            active={activeTab === "dm"}
            onClick={() => setActiveTab("dm")}
            icon={<User2 className="h-3 w-3" />}
            label="DMs"
          />
          <ChatTabButton
            active={activeTab === "ai"}
            onClick={() => setActiveTab("ai")}
            icon={<Sparkles className="h-3 w-3" />}
            label="AI"
          />
        </div>
      </div>

      {/* League meta strip */}
      {activeTab === "league" && (
        <div
          className="mx-3 mb-1 rounded-xl border px-2.5 py-1.5 text-[11px]"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--panel2) 92%, transparent)",
            color: "var(--muted2)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              Last viewed:{" "}
              {leagueMeta?.lastViewed
                ? formatInTimezone(leagueMeta.lastViewed)
                : "Not viewed yet"}
            </span>
            <span className="hidden sm:inline">
              Streak: {leagueMeta?.streak || "—"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            <span>Best team: {leagueMeta?.bestTeam || "Coming soon"}</span>
            <span>Worst team: {leagueMeta?.worstTeam || "Coming soon"}</span>
            <span className="sm:hidden">Streak: {leagueMeta?.streak || "—"}</span>
          </div>
          <div className="mt-0.5">
            Best player: {leagueMeta?.bestPlayer || "Coming soon"}
          </div>
        </div>
      )}

      {/* DM controls strip */}
      {activeTab === "dm" && (
        <div
          className="mx-3 mb-1 flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-[11px]"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--panel2) 92%, transparent)",
            color: "var(--muted2)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <BellOff className="h-3 w-3" />
            <span>DM preferences</span>
          </div>
          <div className="flex items-center gap-1">
            {activeThreadId && (
              <button
                type="button"
                onClick={async () => {
                  const next = !mutedThreads.has(activeThreadId)
                  try {
                    const res = await fetch(getMuteThreadUrl(activeThreadId), {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ muted: next }),
                    })
                    if (!res.ok) {
                      const json = await res.json().catch(() => ({}))
                      setThreadActionError(
                        typeof json?.error === "string"
                          ? json.error
                          : "Unable to update mute preference."
                      )
                      return
                    }
                    setMutedThreads((prev) => {
                      const nextSet = new Set(prev)
                      if (next) nextSet.add(activeThreadId)
                      else nextSet.delete(activeThreadId)
                      return nextSet
                    })
                    setThreadActionError(null)
                    await loadThreads()
                  } catch {
                    setThreadActionError("Unable to update mute preference.")
                  }
                }}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: "var(--border)",
                  background: mutedThreads.has(activeThreadId)
                    ? "color-mix(in srgb, var(--accent-cyan) 10%, transparent)"
                    : "color-mix(in srgb, var(--panel2) 92%, transparent)",
                  color: mutedThreads.has(activeThreadId)
                    ? "var(--accent-cyan-strong)"
                    : "var(--muted2)",
                }}
              >
                {mutedThreads.has(activeThreadId) ? "Unmute chat" : "Mute chat"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAllowDMs((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: "var(--border)",
                background: allowDMs
                  ? "color-mix(in srgb, var(--accent-emerald) 10%, transparent)"
                  : "color-mix(in srgb, var(--panel) 92%, transparent)",
                color: allowDMs
                  ? "var(--accent-emerald-strong)"
                  : "var(--muted2)",
              }}
            >
              {allowDMs ? "Allow DMs" : "Decline new DMs"}
            </button>
          </div>
        </div>
      )}

      {/* Block list toggle */}
      <div className="mx-3 mb-1 flex items-center justify-between gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setShowBlocked((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
          style={{
            borderColor: "var(--border)",
            background: showBlocked
              ? "color-mix(in srgb, var(--accent-red) 10%, transparent)"
              : "color-mix(in srgb, var(--panel2) 96%, transparent)",
            color: showBlocked
              ? "var(--accent-red-strong)"
              : "var(--muted2)",
          }}
        >
          <ShieldAlert className="h-3 w-3" />
          <span>Blocked users</span>
        </button>

        {activeTab === "league" && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
            style={{
              borderColor: "var(--border)",
              background: "color-mix(in srgb, var(--panel2) 96%, transparent)",
              color: "var(--muted2)",
            }}
          >
            <AtSign className="h-3 w-3" />
            <span>@everyone broadcast</span>
          </button>
        )}
      </div>
      {blockedVisibilityNotice && (
        <p className="mx-3 mb-1 text-[11px]" style={{ color: "var(--muted2)" }}>
          {blockedVisibilityNotice}
        </p>
      )}

      {/* Block list panel */}
      {showBlocked && (
        <div
          className="mx-3 mb-1 max-h-20 overflow-y-auto rounded-xl border px-2.5 py-1.5 text-[11px]"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--panel2) 94%, transparent)",
            color: "var(--muted2)",
          }}
        >
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
            <Users className="h-3 w-3" />
            <span>Blocked users</span>
          </div>
          {blockedUsers.length === 0 ? (
            <p>No blocked users yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {blockedUsers.map((u) => (
                <li key={u.userId} className="flex items-center justify-between">
                  <span>{u.displayName || u.username || "User"}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(UNBLOCK_API, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify(getUnblockPayload(u.userId)),
                        })
                        if (res.ok) {
                          setBlockedUsers((prev) => prev.filter((b) => b.userId !== u.userId))
                          setThreadActionError(null)
                          await loadThreads()
                          if (activeThreadId) void loadMessages(activeThreadId)
                        } else {
                          const json = await res.json().catch(() => ({}))
                          setThreadActionError(
                            typeof json?.error === "string" ? json.error : "Unable to unblock user."
                          )
                        }
                      } catch {
                        setThreadActionError("Unable to unblock user.")
                      }
                    }}
                    className="text-[11px] underline"
                    style={{ color: "var(--accent-emerald-strong)" }}
                  >
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages list */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-1 pt-1 sm:px-3 sm:pb-2">
        <div className="flex-1 overflow-y-auto rounded-xl border px-2 py-2 text-[11px] sm:px-3">
          <div
            className="space-y-1.5"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {loadingMessagesFor && loadingMessagesFor === activeThreadId && (
              <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
                Loading messages…
              </p>
            )}
            {threadActionError && (
              <p className="text-[11px]" style={{ color: "var(--accent-red-strong)" }}>
                {threadActionError}
              </p>
            )}
            {activeThreadBlockedDirect && blockedConversationNotice && (
              <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
                {blockedConversationNotice}
              </p>
            )}
            {!activeThreadBlockedDirect && activeHiddenBlockedCount > 0 && (
              <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
                {activeHiddenBlockedCount === 1
                  ? "1 message is hidden because the sender is blocked."
                  : `${activeHiddenBlockedCount} messages are hidden because senders are blocked.`}
              </p>
            )}
            {activeMessages.map((m) => (
              <ChatMessageRow
                key={m.id}
                msg={m}
                threadId={activeThreadId}
                isBlocked={m.senderUserId ? blockedUsers.some((b) => b.userId === m.senderUserId) : false}
                onReportMessage={() => {
                  setReportError(null)
                  if (!activeThreadId) return
                  setReportMessageOpen({ messageId: m.id, threadId: activeThreadId })
                }}
                onReportUser={() => {
                  if (!m.senderUserId) return
                  setReportError(null)
                  setReportUserOpen({
                    userId: m.senderUserId,
                    username: m.senderUsername || m.senderName,
                  })
                }}
                onBlockUser={() => {
                  if (!m.senderUserId) return
                  setBlockConfirmOpen({
                    userId: m.senderUserId,
                    username: m.senderUsername || m.senderName,
                  })
                }}
                onUnblockUser={async () => {
                  if (!m.senderUserId) return
                  try {
                    const res = await fetch(UNBLOCK_API, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(getUnblockPayload(m.senderUserId)),
                    })
                    if (!res.ok) {
                      const json = await res.json().catch(() => ({}))
                      setThreadActionError(
                        typeof json?.error === "string" ? json.error : "Unable to unblock user."
                      )
                      return
                    }
                    await Promise.all([loadBlockedUsers(), loadThreads()])
                    if (activeThreadId) void loadMessages(activeThreadId)
                    setThreadActionError(null)
                  } catch {
                    setThreadActionError("Unable to unblock user.")
                  }
                }}
              />
            ))}
            {!loadingMessagesFor && activeMessages.length === 0 && (
              <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
                No messages yet. Start the conversation.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t px-2 pb-2 pt-1 sm:px-3 sm:pb-3 sm:pt-1.5" style={{ borderColor: "var(--border)" }}>
        <div className="mb-1 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--muted2)" }}>
          <span>GIFs, images, video, memes, polls, reactions, @mentions supported.</span>
        </div>
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl border text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel2)",
              color: "var(--muted2)",
            }}
            aria-label="Add GIF"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl border text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel2)",
              color: "var(--muted2)",
            }}
            aria-label="Upload image"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justifyCenter rounded-xl border text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel2)",
              color: "var(--muted2)",
            }}
            aria-label="Upload video"
          >
            <Film className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl border text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel2)",
              color: "var(--muted2)",
            }}
            aria-label="Create poll"
          >
            <BarChart2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl border text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel2)",
              color: "var(--muted2)",
            }}
            aria-label="Add reaction"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>

          <div className="flex-1 rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={activeThreadBlockedDirect}
              placeholder={
                activeThreadBlockedDirect
                  ? "Conversation blocked. Unblock to message."
                  : activeTab === "ai"
                  ? "Ask the AI coach about a trade or matchup…"
                  : "Message league, @mention, or /poll…"
              }
              className="w-full bg-transparent text-xs outline-none"
              style={{ color: "var(--text)" }}
            />
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || !activeThreadId || sending || activeThreadBlockedDirect}
            className="inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{
              background: "color-mix(in srgb, var(--accent-cyan) 60%, #020617)",
              color: "#0f172a",
            }}
          >
            Send
          </button>
        </div>
      </div>

      {reportMessageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>Report message</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--muted2)" }}>
              Choose a reason. Reports are reviewed by moderators.
            </p>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            >
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            {reportError && (
              <p className="mt-2 text-xs" style={{ color: "var(--accent-red-strong)" }}>
                {reportError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setReportMessageOpen(null)
                  setReportReason("other")
                  setReportError(null)
                }}
                className="flex-1 rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--muted2)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reportSubmitting}
                onClick={async () => {
                  setReportSubmitting(true)
                  setReportError(null)
                  try {
                    const res = await fetch(REPORT_MESSAGE_API, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(
                        getReportMessagePayload(
                          reportMessageOpen.messageId,
                          reportMessageOpen.threadId,
                          reportReason
                        )
                      ),
                    })
                    const json = await res.json().catch(() => ({}))
                    if (!res.ok) {
                      setReportError(typeof json?.error === "string" ? json.error : "Unable to submit report.")
                      return
                    }
                    setReportMessageOpen(null)
                    setReportReason("other")
                    setReportSuccess(true)
                    setTimeout(() => setReportSuccess(false), 3000)
                  } catch {
                    setReportError("Unable to submit report.")
                  } finally {
                    setReportSubmitting(false)
                  }
                }}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reportUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>Report user</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--muted2)" }}>
              Reporting @{reportUserOpen.username}. Reports are reviewed by moderators.
            </p>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            >
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            {reportError && (
              <p className="mt-2 text-xs" style={{ color: "var(--accent-red-strong)" }}>
                {reportError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setReportUserOpen(null)
                  setReportReason("other")
                  setReportError(null)
                }}
                className="flex-1 rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--muted2)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reportSubmitting}
                onClick={async () => {
                  setReportSubmitting(true)
                  setReportError(null)
                  try {
                    const res = await fetch(REPORT_USER_API, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(getReportUserPayload(reportUserOpen.userId, reportReason)),
                    })
                    const json = await res.json().catch(() => ({}))
                    if (!res.ok) {
                      setReportError(typeof json?.error === "string" ? json.error : "Unable to submit report.")
                      return
                    }
                    setReportUserOpen(null)
                    setReportReason("other")
                    setReportSuccess(true)
                    setTimeout(() => setReportSuccess(false), 3000)
                  } catch {
                    setReportError("Unable to submit report.")
                  } finally {
                    setReportSubmitting(false)
                  }
                }}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {blockConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>Block user?</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--muted2)" }}>
              Block @{blockConfirmOpen.username}? They won't be able to message you directly.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setBlockConfirmOpen(null)}
                className="flex-1 rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--muted2)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(BLOCK_API, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(getBlockPayload(blockConfirmOpen.userId)),
                    })
                    if (!res.ok) {
                      const json = await res.json().catch(() => ({}))
                      setThreadActionError(typeof json?.error === "string" ? json.error : "Unable to block user.")
                      return
                    }
                    await Promise.all([loadBlockedUsers(), loadThreads()])
                    if (activeThreadId) void loadMessages(activeThreadId)
                    setBlockConfirmOpen(null)
                    setThreadActionError(null)
                  } catch {
                    setThreadActionError("Unable to block user.")
                  }
                }}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}

      {reportSuccess && (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-xs"
          style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}
        >
          Report submitted. Thank you.
        </div>
      )}
    </section>
  )
}

function ChatTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-2xl px-2.5 py-1.5 text-[11px] font-medium inline-flex items-center justify-center gap-1 transition-colors"
      style={{
        background: active
          ? "color-mix(in srgb, var(--accent-cyan) 10%, transparent)"
          : "transparent",
        color: active ? "var(--accent-cyan-strong)" : "var(--muted2)",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function ChatMessageRow({
  msg,
  threadId,
  isBlocked,
  onReportMessage,
  onReportUser,
  onBlockUser,
  onUnblockUser,
}: {
  msg: PlatformChatMessage
  threadId: string | null
  isBlocked: boolean
  onReportMessage: () => void
  onReportUser: () => void
  onBlockUser: () => void
  onUnblockUser: () => void
}) {
  const { formatInTimezone } = useUserTimezone()
  return (
    <article className="group rounded-xl px-2 py-1.5 transition-colors hover:bg-black/5">
      <div className="flex items-start gap-2">
        <div
          className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/90 text-[11px] font-semibold"
          style={{ color: "#020617" }}
        >
          {msg.senderName
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[11px] font-semibold" style={{ color: "var(--text)" }}>
                {msg.senderName}
              </span>
              <span className="ml-1 text-[11px]" style={{ color: "var(--muted2)" }}>
                {formatInTimezone(msg.createdAt, { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
            {threadId && (
              <MessageActionsMenu
                messageId={msg.id}
                threadId={threadId}
                senderUserId={msg.senderUserId}
                senderName={msg.senderName}
                isBlocked={isBlocked}
                onReportMessage={onReportMessage}
                onReportUser={onReportUser}
                onBlockUser={onBlockUser}
                onUnblockUser={onUnblockUser}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              />
            )}
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text)" }}>
            {msg.body}
          </p>
          {msg.metadata &&
            Array.isArray((msg.metadata as any).attachments) &&
            (msg.metadata as any).attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
              {(msg.metadata as any).attachments.map((a: any) => (
                <span
                  key={a.url}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--muted2)",
                  }}
                >
                  {a.type === "gif" && <ImageIcon className="h-3 w-3" />}
                  {a.type === "image" && <ImageIcon className="h-3 w-3" />}
                  {a.type === "video" && <Film className="h-3 w-3" />}
                  {a.type === "meme" && <SmilePlus className="h-3 w-3" />}
                  <span>{a.type.toUpperCase()}</span>
                </span>
              ))}
            </div>
          )}
          {msg.metadata && (msg.metadata as any).systemMeta && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted2)" }}>
              {(msg.metadata as any).systemMeta}
            </p>
          )}
          {msg.metadata &&
            Array.isArray((msg.metadata as any).reactions) &&
            (msg.metadata as any).reactions.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {(msg.metadata as any).reactions.map((r: any) => (
                <button
                  key={r.emoji}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]"
                  style={{
                    borderColor: r.reactedByMe
                      ? "color-mix(in srgb, var(--accent-cyan) 50%, var(--border))"
                      : "var(--border)",
                    background: r.reactedByMe
                      ? "color-mix(in srgb, var(--accent-cyan) 10%, transparent)"
                      : "transparent",
                    color: r.reactedByMe
                      ? "var(--accent-cyan-strong)"
                      : "var(--muted2)",
                  }}
                >
                  <span>{r.emoji}</span>
                  <span>{r.count}</span>
                </button>
              ))}
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: "var(--border)", color: "var(--muted2)" }}
              >
                +
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

