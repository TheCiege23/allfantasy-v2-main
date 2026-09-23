'use client'

import React, { useEffect } from 'react'
import { X } from 'lucide-react'

export interface ChimmyDrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** Snap height: 'half' (50vh), 'full' (95vh), or 'auto' */
  height?: 'half' | 'full' | 'auto'
  className?: string
}

const HEIGHT_CLASS: Record<NonNullable<ChimmyDrawerProps['height']>, string> = {
  half: 'max-h-[50vh]',
  full: 'max-h-[95vh]',
  auto: 'max-h-[80vh]',
}

export default function ChimmyDrawer({
  open,
  onClose,
  title,
  children,
  height = 'auto',
  className = '',
}: ChimmyDrawerProps) {
  // Lock body scroll while drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-white/10 bg-slate-900 overflow-y-auto pb-[env(safe-area-inset-bottom)] ${HEIGHT_CLASS[height]} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Chimmy Drawer'}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <span className="h-1 w-10 rounded-full bg-white/20" />
        </div>

        {title && (
          <div className="flex items-center justify-between border-b border-white/10 px-4 pb-3">
            <span className="text-sm font-semibold text-white">{title}</span>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-white/60" />
            </button>
          </div>
        )}

        <div className="p-4">{children}</div>
      </div>
    </>
  )
}
