'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ChevronRight, Loader2, Trash2, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import {
  listChimmyConversations,
  deleteChimmyConversation,
  type ChimmyConversation,
} from '@/lib/chimmy-conversation-service'

interface ConversationHistorySidebarProps {
  isOpen: boolean
  onClose?: () => void
  onSelectConversation?: (conversationId: string) => void
  currentConversationId?: string | null
}

const REFRESH_INTERVAL_MS = 30_000 // Refresh every 30 seconds

export default function ConversationHistorySidebar({
  isOpen,
  onClose,
  onSelectConversation,
  currentConversationId,
}: ConversationHistorySidebarProps) {
  const [conversations, setConversations] = useState<ChimmyConversation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadConversations = useCallback(async (reset = false) => {
    setIsLoading(true)
    try {
      const nextOffset = reset ? 0 : offset
      const result = await listChimmyConversations(20, nextOffset)
      if (reset) {
        setConversations(result.conversations)
        setOffset(0)
      } else {
        setConversations((prev) => [...prev, ...result.conversations])
        setOffset(nextOffset + result.conversations.length)
      }
      setHasMore(result.offset + result.conversations.length < result.total)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load conversations'
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }, [offset])

  // Load on mount and set up refresh interval
  useEffect(() => {
    if (!isOpen) return
    loadConversations(true)
    const interval = setInterval(() => loadConversations(true), REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isOpen, loadConversations])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return

    setDeletingId(id)
    try {
      await deleteChimmyConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      toast.success('Conversation deleted')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete conversation'
      toast.error(msg)
    } finally {
      setDeletingId(null)
    }
  }

  const handleSelect = (id: string) => {
    onSelectConversation?.(id)
    onClose?.()
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60_000)
    const diffHours = Math.floor(diffMs / 3_600_000)
    const diffDays = Math.floor(diffMs / 86_400_000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-40 lg:static lg:bg-transparent lg:block lg:w-80 lg:border-r lg:border-white/10 lg:bg-white/[0.02]">
      {/* Mobile overlay - close on background click */}
      <div
        className="absolute inset-0 lg:hidden"
        onClick={onClose}
        aria-hidden
      />

      {/* Sidebar content */}
      <div className="absolute inset-y-0 right-0 w-64 bg-slate-900 border-l border-white/10 shadow-lg lg:static lg:w-full lg:border-l-0 lg:rounded-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Conversations
          </h2>
          <button
            onClick={onClose}
            className="lg:hidden p-1 hover:bg-white/10 rounded transition-colors"
            aria-label="Close sidebar"
          >
            <ChevronRight className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && conversations.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-white/50">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-white/50 text-sm">
              No conversations yet. Save one to get started!
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelect(conv.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors group ${
                    conv.id === currentConversationId
                      ? 'bg-blue-600/20 border border-blue-500/30'
                      : 'hover:bg-white/10 border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 min-w-0 mb-1">
                    <p className="text-sm font-medium text-white truncate flex-1">
                      {conv.title || 'Untitled'}
                    </p>
                    <button
                      onClick={(e) => handleDelete(e, conv.id)}
                      disabled={deletingId === conv.id}
                      className="p-1 hover:bg-red-600/20 rounded opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                  <p className="text-xs text-white/50">
                    {conv.messageCount} messages · {formatDate(conv.lastMessageAt)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Load more button */}
        {hasMore && (
          <div className="p-3 border-t border-white/10">
            <button
              onClick={() => loadConversations(false)}
              disabled={isLoading}
              className="w-full px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                'Load More'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
