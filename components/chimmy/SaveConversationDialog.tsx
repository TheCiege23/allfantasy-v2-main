'use client'

import React, { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveChimmyConversation } from '@/lib/chimmy-conversation-service'

interface SaveConversationDialogProps {
  isOpen: boolean
  messageCount: number
  onClose: () => void
  onSaved?: (conversationId: string) => void
}

export default function SaveConversationDialog({
  isOpen,
  messageCount,
  onClose,
  onSaved,
}: SaveConversationDialogProps) {
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  if (!isOpen) return null

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Please enter a title for your conversation')
      return
    }

    setIsLoading(true)
    try {
      const saved = await saveChimmyConversation(title.trim(), messageCount)
      toast.success('Conversation saved!')
      setTitle('')
      onClose()
      onSaved?.(saved.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save conversation'
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleSave()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-lg shadow-xl max-w-sm w-full">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Save Conversation</h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1 hover:bg-white/10 rounded transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Conversation Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Draft Strategy Q3 2026"
              disabled={isLoading}
              maxLength={200}
              autoFocus
              className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 disabled:opacity-50 transition-colors"
            />
            <p className="text-xs text-white/50 mt-1">
              {title.length}/200 characters · {messageCount} messages
            </p>
          </div>
        </div>

        <div className="flex gap-2 p-4 sm:p-5 border-t border-white/10">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-3 py-2 text-sm font-medium text-white/70 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !title.trim()}
            className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
