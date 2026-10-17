'use client'

import type { ReactNode } from 'react'

export default function PermissionsWrapper({
  allowed,
  reason,
  children,
  className,
  /** When false (default), only tooltip + dimmed children. When true, shows `reason` as visible helper text under the control. */
  showDeniedReason = false,
}: {
  allowed: boolean
  /** Shown as native title tooltip when disabled; also used as visible copy when `showDeniedReason` */
  reason?: string
  children: ReactNode
  className?: string
  showDeniedReason?: boolean
}) {
  if (allowed) {
    return <>{children}</>
  }

  const hint = reason ?? 'You do not have permission for this action.'

  return (
    <div className="inline-flex max-w-full flex-col gap-1">
      <span
        className={className ?? 'inline-flex cursor-not-allowed opacity-50'}
        title={hint}
        aria-disabled
      >
        {children}
      </span>
      {showDeniedReason ? (
        <p className="max-w-[280px] text-[11px] leading-snug text-white/45">{hint}</p>
      ) : null}
    </div>
  )
}
