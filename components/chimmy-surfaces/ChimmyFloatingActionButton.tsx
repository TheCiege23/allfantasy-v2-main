'use client'

import React from 'react'
import { Sparkles } from 'lucide-react'

export interface ChimmyFloatingActionButtonProps {
  /** Tooltip / aria-label */
  label?: string
  hasNotification?: boolean
  onClick?: () => void
  /** Position class overrides */
  positionClass?: string
  className?: string
}

export default function ChimmyFloatingActionButton({
  label = 'Ask Chimmy',
  hasNotification = false,
  onClick,
  positionClass = 'fixed bottom-6 right-6 z-40',
  className = '',
}: ChimmyFloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-13 w-13 items-center justify-center rounded-full bg-indigo-600 shadow-xl hover:bg-indigo-500 active:scale-95 transition-all duration-150 ${positionClass} ${className}`}
    >
      <Sparkles className="h-6 w-6 text-white" />
      {hasNotification && (
        <span className="absolute top-0 right-0 h-3 w-3 rounded-full bg-amber-400 border-2 border-slate-900" />
      )}
    </button>
  )
}
