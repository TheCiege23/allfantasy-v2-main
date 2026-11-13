'use client'

import type { ReactNode } from 'react'

interface AIResultCardProps {
  children: ReactNode
  /** Optional title above content */
  title?: string
  className?: string
}

/**
 * Reusable card wrapper for AI result blocks. Consistent border and background with shell.
 */
export default function AIResultCard({ children, title, className = '' }: AIResultCardProps) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden ${className}`}>
      {title && (
        <div className="border-b border-white/10 px-4 py-2">
          <h3 className="text-sm font-semibold text-white/90">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}
