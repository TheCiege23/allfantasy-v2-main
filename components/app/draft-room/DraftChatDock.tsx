'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DraftChatPanel, type DraftChatPanelProps } from '@/components/app/draft-room/DraftChatPanel'

interface DraftChatDockProps extends DraftChatPanelProps {
  unreadCount?: number
}

const CHAT_EXPANDED_KEY = 'af:draft-chat-expanded'

export function DraftChatDock({ unreadCount = 0, ...chatProps }: DraftChatDockProps) {
  const [expanded, setExpanded] = useState(true)
  const [mounted, setMounted] = useState(false)

  // Load initial state from localStorage
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_EXPANDED_KEY)
      if (stored === '0') {
        setExpanded(false)
      }
    } catch {
      // Ignore localStorage errors
    }
    setMounted(true)
  }, [])

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(CHAT_EXPANDED_KEY, next ? '1' : '0')
      } catch {
        // Ignore localStorage errors
      }
      return next
    })
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div
      className={cn(
        'flex flex-col border-t border-slate-700 bg-slate-950/50 transition-all duration-300 ease-out',
        /* h-full: the panel inside fills the dock, so its list scrolls and the box stays in view. */
        expanded ? 'h-full min-h-[200px] flex-1' : 'h-12'
      )}
    >
      {/*
        Chat Header/Toggle. A slim bar: the dock sits under a CHAT tab already, and on a laptop
        the whole dock is ~240px — the old 46px bar cost the conversation a line and a half.
      */}
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse chat' : 'Expand chat'}
        data-testid="draft-chat-dock-toggle"
        className={cn(
          'flex items-center justify-between',
          expanded
            ? 'min-h-[36px] px-3 py-1.5 text-[11px] tracking-[0.12em] md:min-h-[28px] md:py-1'
            : 'h-full px-4 py-3 text-sm',
          'font-semibold text-white',
          'hover:bg-slate-800/30 transition-colors',
          'border-b border-slate-700',
          expanded ? 'bg-slate-900/50' : 'bg-slate-900/80'
        )}
      >
        <div className="flex items-center gap-2">
          <span>CHAT</span>
          {unreadCount > 0 && !expanded && (
            <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-300 text-xs rounded-full border border-red-500/30">
              {unreadCount}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Chat Content */}
      {expanded ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <DraftChatPanel {...chatProps} />
        </div>
      ) : null}
    </div>
  )
}
