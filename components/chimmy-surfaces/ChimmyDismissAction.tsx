'use client'

import React from 'react'

export interface ChimmyDismissActionProps {
  onDismiss?: () => void
  disabled?: boolean
}

export default function ChimmyDismissAction({ onDismiss, disabled }: ChimmyDismissActionProps) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      disabled={disabled}
      className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/[0.07] disabled:opacity-40"
    >
      Dismiss
    </button>
  )
}
