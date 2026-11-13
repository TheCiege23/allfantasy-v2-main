'use client'

import React from 'react'

export type AIMode = 'single_model' | 'specialist' | 'consensus' | 'unified_brain'

const MODE_LABELS: Record<AIMode, string> = {
  single_model: 'Single model',
  specialist: 'Specialist',
  consensus: 'Consensus',
  unified_brain: 'Unified brain',
}

interface AIModeSelectorProps {
  value: AIMode
  onChange: (mode: AIMode) => void
  /** Only these modes will be shown. If length 1, selector can be hidden by parent. */
  allowedModes?: AIMode[]
  disabled?: boolean
  className?: string
}

/**
 * Mode selector for orchestration. Only show when allowedModes has more than one option.
 * Wire to local state; parent sends mode in API request.
 */
export default function AIModeSelector({
  value,
  onChange,
  allowedModes = ['single_model', 'specialist', 'consensus', 'unified_brain'],
  disabled = false,
  className = '',
}: AIModeSelectorProps) {
  const options = allowedModes.length ? allowedModes : (['unified_brain'] as AIMode[])

  if (options.length <= 1) return null

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-xs font-medium text-white/50">Mode</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as AIMode)}
        disabled={disabled}
        data-testid="ai-mode-selector"
        className="min-h-[44px] rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
        aria-label="AI mode"
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m] ?? m}
          </option>
        ))}
      </select>
    </div>
  )
}
