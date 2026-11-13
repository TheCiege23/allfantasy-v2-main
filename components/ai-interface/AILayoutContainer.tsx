'use client'

import type { ReactNode } from 'react'

interface AILayoutContainerProps {
  children: ReactNode
  /** Optional strip above content (e.g. mode + provider selectors) */
  strip?: ReactNode
  /** Max width class. Default max-w-3xl */
  maxWidth?: string
  className?: string
}

/**
 * Reusable AI layout: consistent padding, max-width, optional top strip.
 * Use inside ProductShellLayout or af-legacy; does not replace shell.
 */
export default function AILayoutContainer({
  children,
  strip,
  maxWidth = 'max-w-3xl',
  className = '',
}: AILayoutContainerProps) {
  return (
    <div className={`mode-surface mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 ${className}`}>
      {strip && (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          {strip}
        </div>
      )}
      <div className={maxWidth}>{children}</div>
    </div>
  )
}
