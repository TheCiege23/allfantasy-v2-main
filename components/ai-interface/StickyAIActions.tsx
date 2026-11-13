'use client'

import React from 'react'
import { Copy, MessageCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getChimmyChatHrefWithPrompt, getPrimaryChimmyEntry } from '@/lib/ai-product-layer'

interface StickyAIActionsProps {
  /** Text to copy (e.g. primaryAnswer) */
  copyText?: string
  /** Prompt to prefill in Chimmy when "Open in Chimmy" is clicked */
  chimmyPrompt?: string
  /** Re-run handler */
  onReRun?: () => void
  /** When true, disable re-run button (e.g. loading) */
  reRunLoading?: boolean
  /** Callback after copy (e.g. toast) */
  onCopied?: () => void
  /** Only show on mobile (sticky bottom). If false, render inline. */
  stickyMobileOnly?: boolean
  className?: string
}

/**
 * Sticky action bar: Copy, Open in Chimmy, Re-run. Mobile: sticky at bottom with safe-area.
 */
export default function StickyAIActions({
  copyText,
  chimmyPrompt,
  onReRun,
  reRunLoading = false,
  onCopied,
  stickyMobileOnly = true,
  className = '',
}: StickyAIActionsProps) {
  const handleCopy = () => {
    if (!copyText) return
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(copyText).then(() => {
        onCopied?.()
        if (onCopied == null) toast.success('Copied to clipboard')
      })
    }
  }

  const chimmyHref = chimmyPrompt ? getChimmyChatHrefWithPrompt(chimmyPrompt) : getPrimaryChimmyEntry().href

  const content = (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {copyText && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10 min-h-[44px]"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      )}
      <a
        href={chimmyHref}
        className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 min-h-[44px]"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        Open in Chimmy
      </a>
      {onReRun && (
        <button
          type="button"
          onClick={onReRun}
          disabled={reRunLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50 min-h-[44px]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${reRunLoading ? 'animate-spin' : ''}`} />
          {reRunLoading ? 'Re-running…' : 'Re-run'}
        </button>
      )}
    </div>
  )

  if (stickyMobileOnly) {
    return (
      <div className={`lg:relative lg:mt-4 fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-black/90 backdrop-blur safe-area-bottom px-4 py-3 ${className}`}>
        {content}
      </div>
    )
  }

  return <div className={`flex items-center justify-end gap-2 flex-wrap ${className}`}>{content}</div>
}
