"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useSession } from "next-auth/react"
import {
  MessageCircle,
  Send,
  Loader2,
  Plus,
  ChevronLeft,
  Smile,
  ImageIcon,
  FileImage,
  Paperclip,
  Search,
  X,
  BarChart3,
  UserPlus,
  Pencil,
} from "lucide-react"
import type { PlatformChatMessage, PlatformChatThread } from "@/types/platform-shared"
import {
  getDMThreads,
  getGroupThreads,
  sortThreadsByLastMessage,
  getConversationDisplayTitle,
  getConversationPreview,
  getUnreadCount,
  getUnreadBadgeLabel,
  hasUnread,
  getThreadMessagesUrl,
  getLeaveGroupUrl,
  getAddParticipantsUrl,
  getRenamePayload,
  getRenameThreadUrl,
  getMuteThreadUrl,
  handleComposerKeyDown,
  parseParticipantUsernames,
} from "@/lib/conversations"
import {
  EMOJI_LIST,
  appendEmoji,
  isGifSearchConfigured,
  getGifProviderName,
  isValidGifOrImageUrl,
  searchGifs,
  validateImageFile,
  validateAttachmentFile,
  getMessagePayloadForImage,
  getMessagePayloadForGif,
  getMessagePayloadForFile,
  canSendComposerMessage,
  getAttachmentPreviewLabel,
  clearAttachmentState,
  resolveMediaViewerUrl,
} from "@/lib/rich-message"
import type { AttachmentPreview, GifSearchResult } from "@/lib/rich-message"
import {
  parseMentions,
  notifyMentions,
  getMentionQueryFromInput,
  getPinnedUrl,
  getUnpinUrl,
  getUnpinPayload,
  getPinnedDisplayBody,
  getReferencedMessageIdFromPin,
  MessageInteractionRenderer,
  getCreatePollPayload,
  POLL_MAX_OPTIONS,
} from "@/lib/social-chat"
import PinnedSection from "@/components/chat/PinnedSection"
import MessageActionsMenu from "@/components/chat/MessageActionsMenu"
import { IdentityImageRenderer } from "@/components/identity/IdentityImageRenderer"
import {
  BLOCKED_LIST_API,
  BLOCK_API,
  UNBLOCK_API,
  REPORT_MESSAGE_API,
  REPORT_USER_API,
  getBlockPayload,
  getUnblockPayload,
  getReportMessagePayload,
  getReportUserPayload,
  REPORT_REASONS,
  isBlockedDirectConversation,
  getBlockedConversationNotice,
  getBlockedVisibilityNotice,
} from "@/lib/moderation/client"
import { useUserTimezone } from "@/hooks/useUserTimezone"
import { ChimmyChatShell } from "@/components/chimmy"
import { readAIContextFromSearchParams, resolveMessagesTab } from "@/lib/chimmy-chat"
import type { AIChatContext } from "@/lib/chimmy-chat"
import { buildChimmyToolDisplayContext } from "@/lib/chimmy-interface"

const TABS = [
  { id: "dm" as const, label: "Private DMs" },
  { id: "groups" as const, label: "Group Chats" },
  { id: "ai" as const, label: "AI Chatbot" },
]

function buildDmAISeedPrompt(messages: PlatformChatMessage[]): string {
  const lines = messages
    .slice(-10)
    .map((msg) => `${msg.senderName}: ${msg.body}`)
    .filter((line) => line.trim().length > 0)
  if (lines.length === 0) {
    return "Help me with trade, waiver, and draft strategy based on this direct conversation."
  }
  return [
    "Use this direct conversation as context and help with the best next fantasy move.",
    "",
    "Recent messages:",
    ...lines,
    "",
    "Give one clear recommendation and a backup option.",
  ].join("\n")
}

export default function MessagesContent() {
  const { formatInTimezone } = useUserTimezone()
  const searchParams = useSearchParams()
  const tabFromUrl = searchParams?.get("tab") ?? null
  const threadIdFromUrl = searchParams?.get("thread") ?? null
  const messageIdFromUrl = searchParams?.get("message") ?? null
  const startUsernameFromUrl = searchParams?.get("start") ?? null
  const aiContextFromUrl = useMemo(
    () => readAIContextFromSearchParams(searchParams ?? undefined),
    [searchParams]
  )

  const [threads, setThreads] = useState<PlatformChatThread[]>([])
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [activeTab, setActiveTab] = useState<"dm" | "groups" | "ai">(() => resolveMessagesTab(tabFromUrl))
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(threadIdFromUrl)
  const [messages, setMessages] = useState<PlatformChatMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [startDmUsername, setStartDmUsername] = useState("")
  const [startDmOpen, setStartDmOpen] = useState(false)
  const [startDmLoading, setStartDmLoading] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newGroupTitle, setNewGroupTitle] = useState("")
  const [newGroupUsernames, setNewGroupUsernames] = useState("")
  const [newGroupLoading, setNewGroupLoading] = useState(false)
  const [newGroupError, setNewGroupError] = useState<string | null>(null)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null)
  const [gifUrlInput, setGifUrlInput] = useState("")
  const [gifUrlOpen, setGifUrlOpen] = useState(false)
  const [gifSearchQuery, setGifSearchQuery] = useState("")
  const [gifSearchLoading, setGifSearchLoading] = useState(false)
  const [gifSearchResults, setGifSearchResults] = useState<GifSearchResult[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [mediaViewerUrl, setMediaViewerUrl] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pinned, setPinned] = useState<PlatformChatMessage[]>([])
  const [pollCreateOpen, setPollCreateOpen] = useState(false)
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOptions, setPollOptions] = useState(["", ""])
  const [pollCreating, setPollCreating] = useState(false)
  const [threadMembers, setThreadMembers] = useState<Array<{ id: string; username: string; displayName: string | null }>>([])
  const [mentionSelectIndex, setMentionSelectIndex] = useState(0)
  const [blockedUsers, setBlockedUsers] = useState<Array<{ userId: string; username: string | null; displayName: string | null }>>([])
  const [reportMessageOpen, setReportMessageOpen] = useState<{ messageId: string; threadId: string } | null>(null)
  const [reportUserOpen, setReportUserOpen] = useState<{ userId: string; username: string } | null>(null)
  const [reportReason, setReportReason] = useState("other")
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [reportSuccess, setReportSuccess] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [blockConfirmOpen, setBlockConfirmOpen] = useState<{ userId: string; username: string } | null>(null)
  const [blockedListOpen, setBlockedListOpen] = useState(false)
  const [mutedThreads, setMutedThreads] = useState<Set<string>>(new Set())
  const [conversationSearch, setConversationSearch] = useState("")
  const [renameGroupOpen, setRenameGroupOpen] = useState(false)
  const [renameGroupTitle, setRenameGroupTitle] = useState("")
  const [renamingGroup, setRenamingGroup] = useState(false)
  const [renameGroupError, setRenameGroupError] = useState<string | null>(null)
  const [addParticipantOpen, setAddParticipantOpen] = useState(false)
  const [addParticipantUsernames, setAddParticipantUsernames] = useState("")
  const [addingParticipants, setAddingParticipants] = useState(false)
  const [addParticipantError, setAddParticipantError] = useState<string | null>(null)
  const [aiDmContext, setAiDmContext] = useState<AIChatContext | null>(null)
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(messageIdFromUrl)
  const [hiddenBlockedMessageCount, setHiddenBlockedMessageCount] = useState(0)

  const { data: session } = useSession()
  useEffect(() => {
    const nextTab = resolveMessagesTab(tabFromUrl)
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab))
  }, [tabFromUrl])

  const handleSelectTab = useCallback((tab: "dm" | "groups" | "ai") => {
    setActiveTab(tab)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (tab === "ai") {
      url.searchParams.set("tab", "ai")
    } else {
      url.searchParams.delete("tab")
    }
    window.history.replaceState(null, "", url.pathname + url.search)
  }, [])

  const currentUserId = (session?.user as { id?: string })?.id ?? null

  const mentionState = getMentionQueryFromInput(input)
  const mentionSuggestions = mentionState
    ? threadMembers
        .filter((m) => m.id !== currentUserId && m.username.toLowerCase().startsWith(mentionState.query))
        .slice(0, 8)
    : []
  const showMentionDropdown = mentionState && mentionSuggestions.length > 0

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true)
    try {
      const res = await fetch("/api/shared/chat/threads", { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      const list: PlatformChatThread[] = Array.isArray(json?.threads) ? json.threads : []
      setThreads(list)
    } finally {
      setLoadingThreads(false)
    }
  }, [])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  useEffect(() => {
    if (threadIdFromUrl) setSelectedThreadId(threadIdFromUrl)
  }, [threadIdFromUrl])

  useEffect(() => {
    setFocusedMessageId(messageIdFromUrl || null)
  }, [messageIdFromUrl])

  useEffect(() => {
    if (startUsernameFromUrl?.trim()) {
      setStartDmUsername(startUsernameFromUrl.trim())
      setStartDmOpen(true)
      setActiveTab("dm")
      const url = new URL(window.location.href)
      url.searchParams.delete("start")
      window.history.replaceState(null, "", url.pathname + url.search)
    }
  }, [startUsernameFromUrl])

  const dmThreads = sortThreadsByLastMessage(getDMThreads(threads))
  const groupThreads = sortThreadsByLastMessage(getGroupThreads(threads))
  const baseList = activeTab === "dm" ? dmThreads : activeTab === "groups" ? groupThreads : []
  const normalizedSearch = conversationSearch.trim().toLowerCase()
  const currentList = baseList.filter((thread) => {
    if (!normalizedSearch) return true
    const title = getConversationDisplayTitle(thread).toLowerCase()
    const preview = getConversationPreview(thread).toLowerCase()
    return title.includes(normalizedSearch) || preview.includes(normalizedSearch)
  })
  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  )
  const selectedThreadContext = (selectedThread?.context || {}) as Record<string, unknown>
  const selectedThreadIsDraftIntel =
    selectedThread?.threadType === "ai" && selectedThreadContext.showInDmList === true
  const selectedThreadArchived = selectedThreadContext.archived === true
  const selectedThreadAllowsReplies = selectedThreadContext.allowReplies !== false && !selectedThreadArchived
  const selectedDmTargetUsername =
    typeof selectedThreadContext.otherUsername === "string" && selectedThreadContext.otherUsername.trim().length > 0
      ? selectedThreadContext.otherUsername.trim()
      : null
  const aiContext = useMemo<AIChatContext>(
    () => ({
      ...aiContextFromUrl,
      ...aiDmContext,
      source: aiDmContext?.source ?? aiContextFromUrl.source,
    }),
    [aiContextFromUrl, aiDmContext]
  )
  const chimmyToolContext = useMemo(
    () =>
      buildChimmyToolDisplayContext({
        source: aiContext.source ?? null,
        leagueName: aiContext.leagueName ?? null,
        sport: aiContext.sport ?? null,
      }),
    [aiContext.leagueName, aiContext.source, aiContext.sport]
  )
  const handleOpenDmAi = useCallback(() => {
    if (!selectedThreadId) return
    const nextAiContext: AIChatContext = {
      source: "messages_dm_ai",
      conversationId: selectedThreadId,
      privateMode: selectedThread?.threadType === "dm",
      targetUsername: selectedDmTargetUsername ?? undefined,
      prompt: buildDmAISeedPrompt(messages),
      strategyMode: "dm_chat_review",
      leagueId:
        typeof selectedThreadContext.leagueId === "string" && selectedThreadContext.leagueId.trim().length > 0
          ? selectedThreadContext.leagueId.trim()
          : undefined,
      sport:
        typeof selectedThreadContext.sport === "string" && selectedThreadContext.sport.trim().length > 0
          ? (selectedThreadContext.sport.trim() as AIChatContext["sport"])
          : undefined,
    }
    setAiDmContext(nextAiContext)
    handleSelectTab("ai")
  }, [handleSelectTab, messages, selectedDmTargetUsername, selectedThread?.threadType, selectedThreadContext, selectedThreadId])
  const blockedUserIdSet = useMemo(() => new Set(blockedUsers.map((b) => b.userId)), [blockedUsers])
  const selectedThreadBlockedDirect = useMemo(
    () => isBlockedDirectConversation(selectedThread, blockedUserIdSet),
    [selectedThread, blockedUserIdSet]
  )
  const blockedConversationNotice = useMemo(() => {
    if (!selectedThreadBlockedDirect) return ""
    const displayTitle = selectedThread ? getConversationDisplayTitle(selectedThread) : null
    return getBlockedConversationNotice(displayTitle)
  }, [selectedThread, selectedThreadBlockedDirect])
  const blockedVisibilityNotice = useMemo(
    () => getBlockedVisibilityNotice(blockedUsers.length),
    [blockedUsers.length]
  )

  useEffect(() => {
    const muted = new Set<string>()
    for (const thread of threads) {
      const context = (thread.context || {}) as Record<string, unknown>
      if (context.isMuted === true) muted.add(thread.id)
    }
    setMutedThreads(muted)
  }, [threads])

  useEffect(() => {
    if (!selectedThreadId) return
    const selected = threads.find((t) => t.id === selectedThreadId)
    if (!selected) {
      setSelectedThreadId(null)
      return
    }
    if (activeTab === "dm" && selected.threadType !== "dm") {
      if (selected.threadType === "group") setActiveTab("groups")
      return
    } else if (activeTab === "groups" && selected.threadType !== "group") {
      if (selected.threadType === "dm") setActiveTab("dm")
      return
    }
  }, [activeTab, selectedThreadId, threads])

  const loadMessages = useCallback(async (tid: string, options?: { refreshThreads?: boolean }) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(getThreadMessagesUrl(tid), { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      setMessages(Array.isArray(json?.messages) ? json.messages : [])
      setHiddenBlockedMessageCount(Math.max(0, Number(json?.hiddenBlockedCount || 0)))
      if (options?.refreshThreads !== false) {
        await loadThreads()
      }
    } catch {
      setMessages([])
      setHiddenBlockedMessageCount(0)
    } finally {
      setLoadingMessages(false)
    }
  }, [loadThreads])

  const loadPinned = useCallback(async (tid: string) => {
    try {
      const res = await fetch(getPinnedUrl(tid), { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      setPinned(Array.isArray(json?.pinned) ? json.pinned : [])
    } catch {
      setPinned([])
    }
  }, [])

  const loadThreadMembers = useCallback(async (tid: string) => {
    try {
      const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(tid)}/members`, { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      setThreadMembers(Array.isArray(json?.members) ? json.members : [])
    } catch {
      setThreadMembers([])
    }
  }, [])

  const loadBlockedList = useCallback(async () => {
    try {
      const res = await fetch(BLOCKED_LIST_API, { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      setBlockedUsers(Array.isArray(json?.blockedUsers) ? json.blockedUsers : [])
    } catch {
      setBlockedUsers([])
    }
  }, [])

  useEffect(() => {
    loadBlockedList()
  }, [loadBlockedList])

  useEffect(() => {
    setMentionSelectIndex(0)
  }, [mentionState?.query, mentionSuggestions.length])

  useEffect(() => {
    if (selectedThreadId) {
      loadMessages(selectedThreadId)
      loadPinned(selectedThreadId)
      loadThreadMembers(selectedThreadId)
    } else {
      setMessages([])
      setPinned([])
      setThreadMembers([])
      setHiddenBlockedMessageCount(0)
    }
  }, [selectedThreadId, loadMessages, loadPinned, loadThreadMembers])

  useEffect(() => {
    if (!focusedMessageId) return
    const target = document.getElementById(`message-row-${focusedMessageId}`)
    if (!target) return
    target.scrollIntoView({ behavior: "smooth", block: "center" })
    const timer = window.setTimeout(() => setFocusedMessageId(null), 2800)
    return () => window.clearTimeout(timer)
  }, [focusedMessageId, messages])

  const handleSend = useCallback(async () => {
    if (sending || !selectedThreadId) return
    if (selectedThreadBlockedDirect) {
      setThreadActionError(blockedConversationNotice || "This conversation is blocked.")
      return
    }
    const text = input.trim()
    const hasAttachment = attachmentPreview !== null
    if (!text && !hasAttachment) return

    setSending(true)
    setUploadError(null)
    setThreadActionError(null)
    try {
      if (hasAttachment && attachmentPreview) {
        const payload =
          attachmentPreview.type === "image"
            ? getMessagePayloadForImage(attachmentPreview.url)
            : attachmentPreview.type === "gif"
              ? getMessagePayloadForGif(attachmentPreview.url, attachmentPreview.source)
              : getMessagePayloadForFile(
                  attachmentPreview.url || "",
                  attachmentPreview.file?.name || "attachment",
                  attachmentPreview.file?.type || undefined,
                )

        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(selectedThreadId)}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...payload, metadata: payload.metadata }),
          }
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setUploadError(typeof json?.error === "string" ? json.error : "Unable to send attachment")
          return
        }
        const created: PlatformChatMessage | null = json?.message ?? null
        const aiReply: PlatformChatMessage | null = json?.aiReply ?? null
        if (created) {
          setMessages((prev) => [...prev, created, ...(aiReply ? [aiReply] : [])])
          clearAttachmentState(setAttachmentPreview, setUploadError)
        }
      } else {
        setInput("")
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(selectedThreadId)}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: text, messageType: "text" }),
          }
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setInput(text)
          setThreadActionError(typeof json?.error === "string" ? json.error : "Unable to send message")
          return
        }
        const created: PlatformChatMessage | null = json?.message ?? null
        const aiReply: PlatformChatMessage | null = json?.aiReply ?? null
        if (created) {
          setMessages((prev) => [...prev, created, ...(aiReply ? [aiReply] : [])])
          const mentioned = parseMentions(text)
          if (mentioned.length > 0) notifyMentions(selectedThreadId, created.id, mentioned).catch(() => {})
        }
      }
      await loadThreads()
    } catch {
      if (!hasAttachment) setInput(text)
    } finally {
      setSending(false)
    }
  }, [input, sending, selectedThreadId, attachmentPreview, loadThreads, selectedThreadBlockedDirect, blockedConversationNotice])

  const handleEmojiSelect = useCallback((emoji: string) => {
    setInput((prev) => appendEmoji(prev, emoji))
    setEmojiPickerOpen(false)
  }, [])

  const handleImageSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) return
      const result = validateImageFile(file)
      if (!result.valid) {
        setUploadError(result.error ?? "Invalid image")
        return
      }
      setUploadError(null)
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch("/api/shared/chat/upload", { method: "POST", body: formData })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setUploadError(data?.error ?? "Upload failed")
          return
        }
        const url = data?.url
        if (url) setAttachmentPreview({ type: "image", file, url })
      } finally {
        setUploading(false)
      }
    },
    []
  )

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) return
      const validation = validateAttachmentFile(file)
      if (!validation.valid) {
        setUploadError(validation.error ?? "Invalid file")
        return
      }
      setUploadError(null)
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch("/api/shared/chat/upload", { method: "POST", body: formData })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setUploadError(data?.error ?? "Upload failed")
          return
        }
        const url = typeof data?.url === "string" ? data.url : ""
        if (url) setAttachmentPreview({ type: "file", file, url })
      } finally {
        setUploading(false)
      }
    },
    []
  )

  const handleGifUrlSubmit = useCallback(() => {
    const url = gifUrlInput.trim()
    if (!isValidGifOrImageUrl(url)) {
      setUploadError("Enter a valid https URL")
      return
    }
    setUploadError(null)
    setAttachmentPreview({ type: "gif", url, source: "url" })
    setGifUrlInput("")
    setGifUrlOpen(false)
  }, [gifUrlInput])

  const handleGifSearch = useCallback(async () => {
    const query = gifSearchQuery.trim()
    if (!query || !isGifSearchConfigured()) return
    setGifSearchLoading(true)
    try {
      const results = await searchGifs(query, 16)
      setGifSearchResults(results)
    } finally {
      setGifSearchLoading(false)
    }
  }, [gifSearchQuery])

  const canSend =
    canSendComposerMessage(input, attachmentPreview, sending) &&
    !selectedThreadBlockedDirect &&
    selectedThreadAllowsReplies

  const applyMentionSuggestion = useCallback((username: string) => {
    if (!mentionState) return
    const before = input.slice(0, mentionState.startIndex)
    const after = `${username} `
    setInput(before + "@" + after)
    setMentionSelectIndex(0)
  }, [input, mentionState])

  const handleComposerKeyDownWithMentions = useCallback(
    (e: React.KeyboardEvent, onSend: () => void, canSendNow: boolean) => {
      if (showMentionDropdown && mentionSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setMentionSelectIndex((i) => (i + 1) % mentionSuggestions.length)
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setMentionSelectIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length)
          return
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault()
          applyMentionSuggestion(mentionSuggestions[mentionSelectIndex].username)
          return
        }
        if (e.key === "Escape") {
          setMentionSelectIndex(0)
        }
      }
      handleComposerKeyDown(e, onSend, canSendNow)
    },
    [showMentionDropdown, mentionSuggestions, mentionSelectIndex, applyMentionSuggestion]
  )

  const handleStartDm = useCallback(async () => {
    const username = startDmUsername.trim()
    if (!username || startDmLoading) return
    setStartDmLoading(true)
    setThreadActionError(null)
    try {
      const res = await fetch("/api/shared/chat/dm/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setThreadActionError(typeof json?.error === "string" ? json.error : "Unable to start DM")
        return
      }
      const thread: PlatformChatThread | null = json?.thread ?? null
      if (thread) {
        setStartDmOpen(false)
        setStartDmUsername("")
        setSelectedThreadId(thread.id)
        setActiveTab("dm")
        loadThreads()
        window.history.replaceState(null, "", `/messages?thread=${encodeURIComponent(thread.id)}`)
      }
    } catch {
      setThreadActionError("Unable to start DM")
    } finally {
      setStartDmLoading(false)
    }
  }, [startDmUsername, startDmLoading, loadThreads])

  const handleCreateGroup = useCallback(async () => {
    const usernames = parseParticipantUsernames(newGroupUsernames)
    if (usernames.length < 1 || newGroupLoading) return
    setNewGroupError(null)
    setThreadActionError(null)
    setNewGroupLoading(true)
    try {
      const res = await fetch("/api/shared/chat/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadType: "group",
          title: newGroupTitle.trim() || undefined,
          usernames,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNewGroupError(typeof json?.error === "string" ? json.error : "Unable to create group")
        return
      }
      const thread: PlatformChatThread | null = json?.thread ?? null
      if (thread) {
        setNewGroupOpen(false)
        setNewGroupTitle("")
        setNewGroupUsernames("")
        setSelectedThreadId(thread.id)
        setActiveTab("groups")
        loadThreads()
        window.history.replaceState(null, "", `/messages?thread=${encodeURIComponent(thread.id)}`)
      }
    } catch {
      setNewGroupError("Unable to create group")
    } finally {
      setNewGroupLoading(false)
    }
  }, [newGroupTitle, newGroupUsernames, newGroupLoading, loadThreads])

  const handleLeaveGroup = useCallback(
    async (tid: string) => {
      setThreadActionError(null)
      try {
        const res = await fetch(getLeaveGroupUrl(tid), { method: "POST" })
        if (res.ok) {
          if (selectedThreadId === tid) setSelectedThreadId(null)
          loadThreads()
        } else {
          const json = await res.json().catch(() => ({}))
          setThreadActionError(typeof json?.error === "string" ? json.error : "Unable to leave group")
        }
      } catch {
        setThreadActionError("Unable to leave group")
      }
    },
    [selectedThreadId, loadThreads]
  )

  const handleRenameGroup = useCallback(async () => {
    if (!selectedThreadId || !renameGroupTitle.trim() || renamingGroup) return
    setRenamingGroup(true)
    setRenameGroupError(null)
    setThreadActionError(null)
    try {
      const res = await fetch(getRenameThreadUrl(selectedThreadId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(getRenamePayload(renameGroupTitle.trim())),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRenameGroupError(typeof json?.error === "string" ? json.error : "Unable to rename group")
        return
      }
      setRenameGroupOpen(false)
      setRenameGroupTitle("")
      await loadThreads()
    } catch {
      setRenameGroupError("Unable to rename group")
    } finally {
      setRenamingGroup(false)
    }
  }, [loadThreads, renameGroupTitle, renamingGroup, selectedThreadId])

  const handleAddParticipants = useCallback(async () => {
    if (!selectedThreadId || addingParticipants) return
    const usernames = parseParticipantUsernames(addParticipantUsernames)
    if (usernames.length === 0) {
      setAddParticipantError("Enter at least one username")
      return
    }
    setAddingParticipants(true)
    setAddParticipantError(null)
    setThreadActionError(null)
    try {
      const res = await fetch(getAddParticipantsUrl(selectedThreadId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usernames }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAddParticipantError(typeof json?.error === "string" ? json.error : "Unable to add participants")
        return
      }
      setAddParticipantOpen(false)
      setAddParticipantUsernames("")
      await loadThreadMembers(selectedThreadId)
      await loadThreads()
    } catch {
      setAddParticipantError("Unable to add participants")
    } finally {
      setAddingParticipants(false)
    }
  }, [addParticipantUsernames, addingParticipants, loadThreadMembers, loadThreads, selectedThreadId])

  return (
    <div className="flex flex-col gap-4">
      <section className="mode-panel rounded-2xl p-3">
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [-webkit-overflow-scrolling:touch]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSelectTab(tab.id)}
              className="touch-manipulation shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium transition min-h-[44px] sm:min-h-0 sm:py-2"
              style={
                activeTab === tab.id
                  ? { background: "var(--text)", color: "var(--bg)" }
                  : { background: "color-mix(in srgb, var(--panel2) 80%, transparent)", color: "var(--muted)" }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "ai" && (
        <section className="mode-panel flex flex-col overflow-hidden rounded-2xl p-2 sm:p-4">
          <div className="flex h-[min(72dvh,calc(100dvh-13rem))] max-h-[min(85dvh,800px)] min-h-0 w-full flex-col">
          <ChimmyChatShell
            initialPrompt={aiContext.prompt ?? ""}
            clearUrlPromptAfterUse
            leagueId={aiContext.leagueId ?? null}
            leagueName={aiContext.leagueName ?? null}
            sleeperUsername={aiContext.sleeperUsername ?? null}
            insightType={aiContext.insightType}
            teamId={aiContext.teamId ?? null}
            sport={aiContext.sport ?? null}
            season={aiContext.season ?? null}
            week={aiContext.week ?? null}
            conversationId={aiContext.conversationId ?? null}
            privateMode={Boolean(aiContext.privateMode)}
            targetUsername={aiContext.targetUsername ?? null}
            strategyMode={aiContext.strategyMode ?? null}
            source={aiContext.source}
            toolContext={chimmyToolContext}
            className="min-h-0 flex-1 !h-full !min-h-0 max-h-full"
          />
          </div>
        </section>
      )}

      {(activeTab === "dm" || activeTab === "groups") && (
        <section
          className="mode-panel rounded-2xl border overflow-hidden"
          style={{ borderColor: "var(--border)", minHeight: "420px" }}
        >
          <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
            <div
              className={`border-b md:border-b-0 md:border-r flex flex-col ${selectedThreadId ? "hidden md:flex" : "flex"}`}
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex flex-col gap-1 p-3 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold mode-text">
                    {activeTab === "dm" ? "Conversations" : "Groups"}
                  </span>
                  <button
                    type="button"
                    onClick={() => (activeTab === "dm" ? setStartDmOpen(true) : setNewGroupOpen(true))}
                    className="rounded-lg border p-1.5"
                    style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                    title={activeTab === "dm" ? "New DM" : "New group"}
                    aria-label={activeTab === "dm" ? "New DM" : "New group"}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setBlockedListOpen(true)}
                  className="text-left text-xs"
                  style={{ color: "var(--muted)" }}
                >
                  Blocked users {blockedUsers.length > 0 ? `(${blockedUsers.length})` : ""}
                </button>
                {blockedVisibilityNotice && (
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                    {blockedVisibilityNotice}
                  </p>
                )}
                <input
                  type="search"
                  value={conversationSearch}
                  onChange={(e) => setConversationSearch(e.target.value)}
                  placeholder={activeTab === "dm" ? "Search conversations" : "Search groups"}
                  className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs"
                  style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
                />
              </div>
              <ul className="overflow-y-auto flex-1">
                {loadingThreads ? (
                  <li className="p-4 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted)" }} />
                  </li>
                ) : currentList.length === 0 ? (
                  <li className="p-4 text-sm mode-muted">
                    {activeTab === "dm"
                      ? blockedUsers.length > 0
                        ? "No visible DMs. Blocked conversations are hidden for safety."
                        : "No DMs yet. Start a conversation."
                      : "No groups yet. Create one."}
                  </li>
                ) : (
                  currentList.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedThreadId(t.id)
                          window.history.replaceState(null, "", `/messages?thread=${encodeURIComponent(t.id)}`)
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition"
                        style={{
                          background: selectedThreadId === t.id ? "color-mix(in srgb, var(--accent-cyan-strong) 10%, transparent)" : "transparent",
                          color: selectedThreadId === t.id ? "var(--accent-cyan-strong)" : "var(--text)",
                        }}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm flex items-center gap-1">
                            <span className="truncate">{getConversationDisplayTitle(t)}</span>
                            {((t.context || {}) as Record<string, unknown>).verifiedBadge === true && (
                              <span
                                className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
                                style={{ borderColor: "var(--border)", color: "var(--accent-cyan-strong)" }}
                              >
                                Verified
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[10px]" style={{ color: "var(--muted)" }}>
                            {getConversationPreview(t)}
                          </p>
                        </div>
                        {hasUnread(t) && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
                          >
                            {getUnreadBadgeLabel(getUnreadCount(t))}
                          </span>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className={`flex flex-col min-h-[320px] ${selectedThreadId ? "flex" : "hidden md:flex"}`}>
              {selectedThreadId ? (
                <>
                  <div className="flex items-center gap-2 p-3 border-b" style={{ borderColor: "var(--border)" }}>
                    <button
                      type="button"
                      onClick={() => setSelectedThreadId(null)}
                      className="md:hidden rounded-lg border p-1.5"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                      aria-label="Back"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="font-medium truncate mode-text">
                      {selectedThread ? getConversationDisplayTitle(selectedThread) : "Conversation"}
                    </span>
                    {selectedThreadContext.verifiedBadge === true && (
                      <span
                        className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
                        style={{ borderColor: "var(--border)", color: "var(--accent-cyan-strong)" }}
                      >
                        Verified
                      </span>
                    )}
                    {selectedThreadArchived && (
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                        Archived
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      {activeTab === "dm" && selectedThread?.threadType === "dm" && (
                        <button
                          type="button"
                          onClick={handleOpenDmAi}
                          data-testid="messages-dm-ai-chat-button"
                          className="rounded-lg border px-2 py-1.5 text-[11px]"
                          style={{ borderColor: "var(--border)", color: "var(--accent-cyan-strong)" }}
                          title="Ask Chimmy about this conversation"
                          aria-label="Ask Chimmy about this conversation"
                        >
                          Ask AI
                        </button>
                      )}
                      {selectedThread?.threadType === "group" && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRenameGroupTitle(selectedThread.title || "")
                              setRenameGroupError(null)
                              setRenameGroupOpen(true)
                            }}
                            className="rounded-lg border p-1.5"
                            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                            title="Rename group"
                            aria-label="Rename group"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddParticipantError(null)
                              setAddParticipantOpen(true)
                            }}
                            className="rounded-lg border p-1.5"
                            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                            title="Add participant"
                            aria-label="Add participant"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      {selectedThreadId && (
                        <button
                          type="button"
                          onClick={async () => {
                            const next = !mutedThreads.has(selectedThreadId)
                            try {
                              const res = await fetch(
                                getMuteThreadUrl(selectedThreadId),
                                {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ muted: next }),
                                }
                              )
                              if (res.ok) {
                                setMutedThreads((s) =>
                                  next
                                    ? new Set(s).add(selectedThreadId)
                                    : (() => {
                                        const n = new Set(s)
                                        n.delete(selectedThreadId)
                                        return n
                                      })()
                                )
                                await loadThreads()
                              } else {
                                const json = await res.json().catch(() => ({}))
                                setThreadActionError(
                                  typeof json?.error === "string"
                                    ? json.error
                                    : "Unable to update mute preference"
                                )
                              }
                            } catch {
                              setThreadActionError("Unable to update mute preference")
                            }
                          }}
                          className="rounded-lg border p-1.5"
                          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                          title={mutedThreads.has(selectedThreadId) ? "Unmute" : "Mute"}
                          aria-label={mutedThreads.has(selectedThreadId) ? "Unmute" : "Mute"}
                        >
                          {mutedThreads.has(selectedThreadId) ? (
                            <span className="text-xs">Unmute</span>
                          ) : (
                            <span className="text-xs">Mute</span>
                          )}
                        </button>
                      )}
                      {selectedThread?.threadType === "group" && (
                        <button
                          type="button"
                          onClick={() => handleLeaveGroup(selectedThread.id)}
                          className="text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          Leave
                        </button>
                      )}
                    </div>
                  </div>
                  {threadActionError && (
                    <p className="px-3 py-1 text-[11px]" style={{ color: "var(--error)" }}>
                      {threadActionError}
                    </p>
                  )}
                  {selectedThreadBlockedDirect && blockedConversationNotice && (
                    <p className="px-3 py-1 text-[11px]" style={{ color: "var(--muted)" }}>
                      {blockedConversationNotice}
                    </p>
                  )}
                  {selectedThreadIsDraftIntel && (
                    <p className="px-3 py-1 text-[11px]" style={{ color: "var(--muted)" }}>
                      {selectedThreadArchived
                        ? "This Chimmy draft thread is archived after the draft."
                        : "Chimmy posts private draft updates here. You can still send text questions."}
                    </p>
                  )}
                  {!selectedThreadBlockedDirect && hiddenBlockedMessageCount > 0 && (
                    <p className="px-3 py-1 text-[11px]" style={{ color: "var(--muted)" }}>
                      {hiddenBlockedMessageCount === 1
                        ? "1 message is hidden because the sender is blocked."
                        : `${hiddenBlockedMessageCount} messages are hidden because senders are blocked.`}
                    </p>
                  )}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px]">
                    {selectedThreadId && pinned.length > 0 && (
                      <PinnedSection
                        pinned={pinned}
                        onUnpin={async (pinMessageId) => {
                          try {
                            await fetch(getUnpinUrl(selectedThreadId), {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify(getUnpinPayload(pinMessageId)),
                            })
                            loadPinned(selectedThreadId)
                            loadMessages(selectedThreadId)
                          } catch {
                            // ignore
                          }
                        }}
                        onSelectPinned={(_pinMessage, referencedMessageId) => {
                          setFocusedMessageId(referencedMessageId)
                        }}
                        canUnpin={true}
                        className="mb-3"
                      />
                    )}
                    {loadingMessages ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted)" }} />
                      </div>
                    ) : messages.filter((m) => m.messageType !== "pin").length === 0 ? (
                      <p className="text-sm mode-muted py-4 text-center">No messages yet. Say something.</p>
                    ) : (
                      messages
                        .filter((m) => m.messageType !== "pin")
                        .map((m) => (
                          <div
                            key={m.id}
                            id={`message-row-${m.id}`}
                            data-message-id={m.id}
                            className="rounded-lg px-3 py-2 text-sm"
                            style={{
                              background: "color-mix(in srgb, var(--panel2) 80%, transparent)",
                              color: "var(--text)",
                              border:
                                focusedMessageId === m.id
                                  ? "1px solid var(--accent-cyan-strong)"
                                  : "1px solid transparent",
                            }}
                          >
                            <div className="flex items-start gap-2">
                              <IdentityImageRenderer
                                avatarUrl={m.senderAvatarUrl ?? null}
                                avatarPreset={m.senderAvatarPreset ?? null}
                                displayName={m.senderName}
                                username={
                                  typeof (m as { senderUsername?: unknown }).senderUsername === "string"
                                    ? ((m as { senderUsername?: string }).senderUsername ?? null)
                                    : null
                                }
                                size="sm"
                                className="mt-0.5 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-xs">{m.senderName}</span>
                                  <span className="text-[10px] mode-muted">
                                    {formatInTimezone(m.createdAt, { hour: "numeric", minute: "2-digit" })}
                                  </span>
                                  <div className="ml-auto">
                                    <MessageActionsMenu
                                      messageId={m.id}
                                      threadId={selectedThreadId!}
                                      senderUserId={m.senderUserId}
                                      senderName={m.senderName}
                                      isBlocked={m.senderUserId ? blockedUsers.some((b) => b.userId === m.senderUserId) : false}
                                      onReportMessage={() => {
                                        setReportError(null)
                                        setReportMessageOpen({ messageId: m.id, threadId: selectedThreadId! })
                                      }}
                                      onReportUser={() => {
                                        if (!m.senderUserId) return
                                        setReportError(null)
                                        setReportUserOpen({
                                          userId: m.senderUserId,
                                          username:
                                            (typeof (m as { senderUsername?: unknown }).senderUsername === "string"
                                              ? ((m as { senderUsername?: string }).senderUsername ?? "")
                                              : "") || m.senderName,
                                        })
                                      }}
                                      onBlockUser={() =>
                                        m.senderUserId &&
                                        setBlockConfirmOpen({
                                          userId: m.senderUserId,
                                          username:
                                            (typeof (m as { senderUsername?: unknown }).senderUsername === "string"
                                              ? ((m as { senderUsername?: string }).senderUsername ?? "")
                                              : "") || m.senderName,
                                        })
                                      }
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
                                            setThreadActionError(typeof json?.error === "string" ? json.error : "Unable to unblock user")
                                            return
                                          }
                                          loadBlockedList()
                                          loadMessages(selectedThreadId!)
                                          loadThreads()
                                        } catch {
                                          setThreadActionError("Unable to unblock user")
                                        }
                                      }}
                                    />
                                  </div>
                                </div>
                                <MessageInteractionRenderer
                                  message={m}
                                  threadId={selectedThreadId!}
                                  currentUserId={currentUserId}
                                  pinnedReferencedIds={new Set(pinned.map(getReferencedMessageIdFromPin).filter(Boolean) as string[])}
                                  onReactionUpdate={() => loadMessages(selectedThreadId!)}
                                  onPinUpdate={() => { loadPinned(selectedThreadId!); loadMessages(selectedThreadId!) }}
                                  onVote={() => loadMessages(selectedThreadId!)}
                                  onPollClose={() => loadMessages(selectedThreadId!)}
                                  onImageClick={(url) => setMediaViewerUrl(resolveMediaViewerUrl(url))}
                                  getMessageSnippet={(msgId) => {
                                    const msg = messages.find((x) => x.id === msgId)
                                    const b = msg?.body ?? ""
                                    return b.slice(0, 80) + (b.length > 80 ? "…" : "")
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                  <div className="relative">
                  {uploadError && (
                    <p className="px-3 py-1 text-xs" style={{ color: "var(--error)" }}>{uploadError}</p>
                  )}
                  {attachmentPreview && (
                    <div className="flex items-center gap-2 p-2 border-b" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
                      {(attachmentPreview.type === "image" || attachmentPreview.type === "gif") && (
                        <img src={attachmentPreview.url} alt="Preview" className="h-14 w-14 rounded object-cover" />
                      )}
                      {attachmentPreview.type === "file" && <Paperclip className="h-4 w-4 shrink-0" style={{ color: "var(--muted)" }} />}
                      <span className="text-xs mode-muted flex-1 truncate">
                        {getAttachmentPreviewLabel(attachmentPreview)}
                      </span>
                      <button
                        type="button"
                        onClick={() => clearAttachmentState(setAttachmentPreview, setUploadError)}
                        className="rounded p-1"
                        style={{ color: "var(--muted)" }}
                        aria-label="Remove"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2 p-3 border-t" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-0.5">
                      {!selectedThreadIsDraftIntel && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEmojiPickerOpen((o) => !o)}
                            className="rounded-lg p-2"
                            style={{ color: "var(--muted)" }}
                            title="Emoji"
                            aria-label="Emoji"
                          >
                            <Smile className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => imageInputRef.current?.click()}
                            disabled={uploading}
                            className="rounded-lg p-2 disabled:opacity-50"
                            style={{ color: "var(--muted)" }}
                            title="Upload image"
                            aria-label="Upload image"
                          >
                            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                          </button>
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={handleImageSelect}
                          />
                          <button
                            type="button"
                            onClick={() => setGifUrlOpen((o) => !o)}
                            className="rounded-lg p-2"
                            style={{ color: "var(--muted)" }}
                            title="GIF"
                            aria-label="GIF"
                          >
                            <FileImage className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="rounded-lg p-2 disabled:opacity-50"
                            style={{ color: "var(--muted)" }}
                            title="Attach file"
                            aria-label="Attach file"
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv"
                            className="hidden"
                            onChange={handleFileSelect}
                          />
                          <button
                            type="button"
                            onClick={() => setPollCreateOpen(true)}
                            className="rounded-lg p-2"
                            style={{ color: "var(--muted)" }}
                            title="Create poll"
                            aria-label="Create poll"
                          >
                            <BarChart3 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => handleComposerKeyDownWithMentions(e, handleSend, Boolean(canSend))}
                      placeholder={
                        selectedThreadBlockedDirect
                          ? "Conversation blocked. Unblock to message."
                          : selectedThreadArchived
                            ? "Thread archived after draft completion."
                            : selectedThreadIsDraftIntel
                              ? "Ask Chimmy a draft question..."
                              : "Message… (type @ to mention)"
                      }
                      disabled={selectedThreadBlockedDirect || !selectedThreadAllowsReplies}
                      className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                      style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
                    />
                    {showMentionDropdown && mentionState && (
                      <div
                        className="absolute bottom-full left-3 right-12 mb-1 rounded-xl border shadow-lg z-10 max-h-48 overflow-y-auto"
                        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
                      >
                        <p className="px-2 py-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                          Mention
                        </p>
                        {mentionSuggestions.map((m, i) => {
                          const selected = i === Math.min(mentionSelectIndex, mentionSuggestions.length - 1)
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => applyMentionSuggestion(m.username)}
                              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                              style={{
                                background: selected ? "color-mix(in srgb, var(--accent-cyan-strong) 12%, transparent)" : "transparent",
                                color: "var(--text)",
                              }}
                            >
                              <span className="font-medium">@{m.username}</span>
                              {m.displayName && (
                                <span className="truncate text-xs" style={{ color: "var(--muted)" }}>{m.displayName}</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!canSend}
                      className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                      style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                  {emojiPickerOpen && (
                    <div
                      className="absolute bottom-full left-3 mb-1 rounded-xl border p-2 shadow-lg z-10"
                      style={{ background: "var(--panel)", borderColor: "var(--border)", maxHeight: "160px", overflowY: "auto" }}
                    >
                      <div className="flex flex-wrap gap-1 max-w-[240px]">
                        {EMOJI_LIST.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleEmojiSelect(emoji)}
                            className="text-lg leading-8 w-8 rounded hover:opacity-80"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {gifUrlOpen && (
                    <div
                      className="absolute bottom-full left-3 mb-1 rounded-xl border p-3 shadow-lg z-10 w-80"
                      style={{ background: "var(--panel)", borderColor: "var(--border)" }}
                    >
                      {isGifSearchConfigured() ? (
                        <p className="text-xs mode-muted mb-2">Search GIFs or paste a GIF/image URL.</p>
                      ) : (
                        <p className="text-xs mode-muted mb-2">Paste a GIF or image URL to send.</p>
                      )}
                      {isGifSearchConfigured() && (
                        <div className="mb-2">
                          <div className="flex gap-2 mb-2">
                            <div className="relative flex-1">
                              <Search className="absolute left-2 top-2 h-3.5 w-3.5" style={{ color: "var(--muted)" }} />
                              <input
                                type="text"
                                value={gifSearchQuery}
                                onChange={(e) => setGifSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault()
                                    void handleGifSearch()
                                  }
                                }}
                                placeholder={`Search ${getGifProviderName() || "GIF"}...`}
                                className="w-full rounded-lg border pl-7 pr-2 py-1.5 text-sm"
                                style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleGifSearch()}
                              disabled={!gifSearchQuery.trim() || gifSearchLoading}
                              className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
                              style={{ borderColor: "var(--border)", color: "var(--text)" }}
                            >
                              {gifSearchLoading ? "…" : "Search"}
                            </button>
                          </div>
                          {gifSearchResults.length > 0 && (
                            <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto rounded-lg border p-1.5 mb-2" style={{ borderColor: "var(--border)" }}>
                              {gifSearchResults.map((gif) => (
                                <button
                                  key={gif.id}
                                  type="button"
                                  onClick={() => {
                                    setAttachmentPreview({ type: "gif", url: gif.url, source: gif.provider })
                                    setGifUrlOpen(false)
                                    setUploadError(null)
                                  }}
                                  className="overflow-hidden rounded border"
                                  style={{ borderColor: "var(--border)" }}
                                  aria-label="Select GIF"
                                >
                                  <img src={gif.previewUrl || gif.url} alt="GIF result" className="h-14 w-full object-cover" loading="lazy" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <input
                        type="url"
                        value={gifUrlInput}
                        onChange={(e) => setGifUrlInput(e.target.value)}
                        placeholder="https://…"
                        className="w-full rounded-lg border px-2 py-1.5 text-sm mb-2"
                        style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setGifUrlOpen(false); setGifUrlInput(""); setGifSearchResults([]); setGifSearchQuery("") }}
                          className="rounded-lg border px-2 py-1 text-xs"
                          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleGifUrlSubmit}
                          className="rounded-lg px-2 py-1 text-xs font-medium"
                          style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
                        >
                          Add GIF
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <MessageCircle className="h-12 w-12 mb-3" style={{ color: "var(--muted)" }} />
                  <p className="text-sm mode-muted">
                    {activeTab === "dm" ? "Select a conversation or start a new DM." : "Select a group or create one."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Report message modal */}
      {reportMessageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Report message</h3>
            <p className="mt-1 text-sm mode-muted">Choose a reason. Reports are reviewed by moderators.</p>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
              ))}
            </select>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setReportMessageOpen(null); setReportReason("other"); setReportError(null) }}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
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
                      body: JSON.stringify(getReportMessagePayload(reportMessageOpen.messageId, reportMessageOpen.threadId, reportReason)),
                    })
                    const json = await res.json().catch(() => ({}))
                    if (res.ok) {
                      setReportSuccess(true)
                      setReportMessageOpen(null)
                      setReportReason("other")
                      setReportError(null)
                      setTimeout(() => setReportSuccess(false), 3000)
                    } else {
                      setReportError(typeof json?.error === "string" ? json.error : "Unable to submit report")
                    }
                  } catch {
                    setReportError("Unable to submit report")
                  } finally {
                    setReportSubmitting(false)
                  }
                }}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
            {reportError && (
              <p className="mt-2 text-xs" style={{ color: "var(--error)" }}>
                {reportError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Report user modal */}
      {reportUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Report user</h3>
            <p className="mt-1 text-sm mode-muted">Reporting @{reportUserOpen.username}. Reports are reviewed by moderators.</p>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
              ))}
            </select>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setReportUserOpen(null); setReportReason("other"); setReportError(null) }}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
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
                    if (res.ok) {
                      setReportSuccess(true)
                      setReportUserOpen(null)
                      setReportReason("other")
                      setReportError(null)
                      setTimeout(() => setReportSuccess(false), 3000)
                    } else {
                      setReportError(typeof json?.error === "string" ? json.error : "Unable to submit report")
                    }
                  } catch {
                    setReportError("Unable to submit report")
                  } finally {
                    setReportSubmitting(false)
                  }
                }}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
            {reportError && (
              <p className="mt-2 text-xs" style={{ color: "var(--error)" }}>
                {reportError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Block confirmation modal */}
      {blockConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Block user?</h3>
            <p className="mt-1 text-sm mode-muted">
              Block @{blockConfirmOpen.username}? They won&apos;t be able to message you in shared threads. You can unblock later from Blocked users.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setBlockConfirmOpen(null)}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
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
                      setThreadActionError(typeof json?.error === "string" ? json.error : "Unable to block user")
                      return
                    }
                    loadBlockedList()
                    if (selectedThreadId) {
                      loadMessages(selectedThreadId)
                      loadThreads()
                    }
                    setBlockConfirmOpen(null)
                  } catch {
                    setThreadActionError("Unable to block user")
                  }
                }}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocked users list modal */}
      {blockedListOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4 max-h-[80vh] overflow-hidden flex flex-col"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Blocked users</h3>
            <p className="mt-1 text-sm mode-muted">Unblock to receive messages from them again.</p>
            <ul className="mt-3 overflow-y-auto flex-1 min-h-0 space-y-2">
              {blockedUsers.length === 0 ? (
                <li className="text-sm mode-muted py-4 text-center">No blocked users.</li>
              ) : (
                blockedUsers.map((u) => (
                  <li key={u.userId} className="flex items-center justify-between gap-2 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                    <span className="text-sm truncate">@{u.username ?? u.displayName ?? u.userId}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch(UNBLOCK_API, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify(getUnblockPayload(u.userId)),
                          })
                          if (!res.ok) {
                            const json = await res.json().catch(() => ({}))
                            setThreadActionError(typeof json?.error === "string" ? json.error : "Unable to unblock user")
                            return
                          }
                          loadBlockedList()
                          if (selectedThreadId) {
                            loadMessages(selectedThreadId)
                            loadThreads()
                          }
                        } catch {
                          setThreadActionError("Unable to unblock user")
                        }
                      }}
                      className="rounded-lg border px-2 py-1 text-xs"
                      style={{ borderColor: "var(--border)", color: "var(--accent-cyan-strong)" }}
                    >
                      Unblock
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-3 pt-3 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
              <button
                type="button"
                onClick={() => setBlockedListOpen(false)}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {reportSuccess && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-4 py-2 text-sm shadow-lg"
          style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}
        >
          Report submitted. Thank you.
        </div>
      )}

      {startDmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Start a conversation</h3>
            <p className="mt-1 text-sm mode-muted">Enter their username (e.g. jane)</p>
            <input
              type="text"
              value={startDmUsername}
              onChange={(e) => setStartDmUsername(e.target.value)}
              placeholder="Username"
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            />
            {threadActionError && (
              <p className="mt-2 text-xs" style={{ color: "var(--error)" }}>
                {threadActionError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setStartDmOpen(false); setStartDmUsername("") }}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartDm}
                disabled={!startDmUsername.trim() || startDmLoading}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {startDmLoading ? "Opening…" : "Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {newGroupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">New group</h3>
            <p className="mt-1 text-sm mode-muted">Add usernames separated by comma or space</p>
            <input
              type="text"
              value={newGroupTitle}
              onChange={(e) => setNewGroupTitle(e.target.value)}
              placeholder="Group name (optional)"
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            />
            <input
              type="text"
              value={newGroupUsernames}
              onChange={(e) => setNewGroupUsernames(e.target.value)}
              placeholder="user1, user2, user3"
              className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            />
            {newGroupError && (
              <p className="mt-2 text-xs" style={{ color: "var(--error)" }}>
                {newGroupError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setNewGroupOpen(false); setNewGroupTitle(""); setNewGroupUsernames("") }}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={newGroupUsernames.trim().length < 1 || newGroupLoading}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {newGroupLoading ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameGroupOpen && selectedThread?.threadType === "group" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Rename group</h3>
            <input
              type="text"
              value={renameGroupTitle}
              onChange={(e) => setRenameGroupTitle(e.target.value)}
              placeholder="Group name"
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            />
            {renameGroupError && (
              <p className="mt-2 text-xs" style={{ color: "var(--error)" }}>
                {renameGroupError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenameGroupOpen(false)
                  setRenameGroupTitle("")
                  setRenameGroupError(null)
                }}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameGroup}
                disabled={!renameGroupTitle.trim() || renamingGroup}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {renamingGroup ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {addParticipantOpen && selectedThread?.threadType === "group" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Add participants</h3>
            <p className="mt-1 text-sm mode-muted">Enter usernames separated by comma or space.</p>
            <input
              type="text"
              value={addParticipantUsernames}
              onChange={(e) => setAddParticipantUsernames(e.target.value)}
              placeholder="user1, user2"
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            />
            {addParticipantError && (
              <p className="mt-2 text-xs" style={{ color: "var(--error)" }}>
                {addParticipantError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddParticipantOpen(false)
                  setAddParticipantUsernames("")
                  setAddParticipantError(null)
                }}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddParticipants}
                disabled={!addParticipantUsernames.trim() || addingParticipants}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {addingParticipants ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pollCreateOpen && selectedThreadId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-md rounded-2xl border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <h3 className="text-lg font-semibold mode-text">Create poll</h3>
            <p className="mt-1 text-sm mode-muted">Question and at least two options.</p>
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Question"
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            />
            <div className="mt-2 space-y-2">
              {pollOptions.map((opt, i) => (
                <input
                  key={i}
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollOptions]
                    next[i] = e.target.value
                    setPollOptions(next)
                  }}
                  placeholder={`Option ${i + 1}`}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
                />
              ))}
            </div>
            {pollOptions.length < POLL_MAX_OPTIONS && (
              <button
                type="button"
                onClick={() => setPollOptions((o) => [...o, ""])}
                className="mt-2 text-xs"
                style={{ color: "var(--accent-cyan-strong)" }}
              >
                + Add option
              </button>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setPollCreateOpen(false); setPollQuestion(""); setPollOptions(["", ""]) }}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!pollQuestion.trim() || pollOptions.filter(Boolean).length < 2 || pollCreating}
                onClick={async () => {
                  const opts = pollOptions.map((o) => o.trim()).filter(Boolean)
                  if (!pollQuestion.trim() || opts.length < 2) return
                  setPollCreating(true)
                  try {
                    const res = await fetch(
                      `/api/shared/chat/threads/${encodeURIComponent(selectedThreadId)}/polls`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(getCreatePollPayload(pollQuestion.trim(), opts)),
                      }
                    )
                    if (res.ok) {
                      setPollCreateOpen(false)
                      setPollQuestion("")
                      setPollOptions(["", ""])
                      loadMessages(selectedThreadId)
                    }
                  } finally {
                    setPollCreating(false)
                  }
                }}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent-cyan-strong)", color: "var(--on-accent-bg)" }}
              >
                {pollCreating ? "Creating…" : "Create poll"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mediaViewerUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setMediaViewerUrl(null)}
          role="dialog"
          aria-label="View media"
        >
          <button
            type="button"
            onClick={() => setMediaViewerUrl(null)}
            className="absolute top-4 right-4 rounded-full p-2 text-white bg-black/50 hover:bg-black/70"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={mediaViewerUrl}
            alt=""
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

