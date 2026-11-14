'use client'

import React, { useEffect } from 'react'
import ChimmyChatShell from './ChimmyChatShell'
import type { ChimmyChatShellProps } from './ChimmyChatShell'

export type ChimmyChatPanelVariant = 'inline' | 'drawer' | 'split'

export interface ChimmyChatPanelProps extends Omit<ChimmyChatShellProps, 'compact'> {
  /** When true, panel is visible (for drawer/split). When inline, ignored. */
  open?: boolean
  /** Callback when user closes the panel (drawer/split) */
  onClose?: () => void
  /** inline = full width in flow; drawer = slide-over on mobile; split = side panel on desktop */
  variant?: ChimmyChatPanelVariant
  /** When true, use compact layout (passed to shell when variant is inline). */
  compact?: boolean
}

/**
 * Wraps ChimmyChatShell for inline, drawer (mobile), or split (desktop) layout.
 * Close button and mobile drawer behavior — no dead buttons.
 */
export default function ChimmyChatPanel({
  open = true,
  onClose,
  variant = 'inline',
  compact: compactProp,
  ...shellProps
}: ChimmyChatPanelProps) {
  useEffect(() => {
    if (variant === 'drawer' && open && typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [variant, open])

  if (variant === 'inline') {
    return (
      <ChimmyChatShell
        {...shellProps}
        compact={!!compactProp}
        onClose={onClose}
      />
    )
  }

  if (variant === 'drawer') {
    if (!open) return null
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm md:hidden"
        role="dialog"
        aria-label="Chimmy chat"
      >
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <ChimmyChatShell
            {...shellProps}
            compact={false}
            onClose={onClose}
            className="rounded-none border-0 flex-1 min-h-0 h-full"
          />
        </div>
      </div>
    )
  }

  if (variant === 'split') {
    if (!open) return null
    return (
      <aside
        className="hidden md:flex md:flex-col w-full max-w-md border-l border-white/10 bg-black/20 shrink-0"
        aria-label="Chimmy chat panel"
      >
        <ChimmyChatShell
          {...shellProps}
          compact={false}
          onClose={onClose}
          className="rounded-none border-0 flex-1 min-h-0 h-full"
        />
      </aside>
    )
  }

  return null
}
