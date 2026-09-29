'use client'

import React, { useState, useRef, useEffect } from 'react'
import type { TrustRiskChip } from '@/lib/analytics/confidence-types'

interface RiskChipProps {
  chip: TrustRiskChip
  size?: 'sm' | 'md'
}

const categoryColors: Record<TrustRiskChip['category'], { bg: string; text: string; border: string }> = {
  age: { bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/20' },
  injury: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/20' },
  market: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/20' },
  role: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/20' },
  coaching: { bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/20' },
  pick: { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/20' },
  depth: { bg: 'bg-blue-500/10', text: 'text-blue-300', border: 'border-blue-500/20' },
  schedule: { bg: 'bg-indigo-500/10', text: 'text-indigo-300', border: 'border-indigo-500/20' },
  trend: { bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/20' },
  data: { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/20' },
  other: { bg: 'bg-white/5', text: 'text-white/60', border: 'border-white/10' },
}

export default function RiskChip({ chip, size = 'sm' }: RiskChipProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showTooltip) return
    function handleClickOutside(e: MouseEvent) {
      if (
        chipRef.current && !chipRef.current.contains(e.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
      ) {
        setShowTooltip(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTooltip])

  const colors = categoryColors[chip.category]
  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-[11px] gap-1 min-h-[28px]'
    : 'px-2.5 py-1 text-xs gap-1.5 min-h-[32px]'

  return (
    <div className="relative inline-block">
      <button
        ref={chipRef}
        onClick={() => setShowTooltip(!showTooltip)}
        className={[
          'inline-flex items-center rounded-lg font-medium border transition-all duration-150 touch-manipulation',
          sizeClasses,
          colors.bg,
          colors.text,
          colors.border,
          showTooltip ? 'ring-1 ring-white/10' : '',
        ].join(' ')}
        type="button"
      >
        {chip.label}
      </button>

      {showTooltip && (
        <div
          ref={tooltipRef}
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2.5 rounded-xl bg-slate-800/95 border border-white/10 shadow-xl backdrop-blur-sm"
        >
          <div className="text-[11px] text-white/80 leading-relaxed">{chip.tooltip}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="w-2 h-2 rotate-45 bg-slate-800/95 border-r border-b border-white/10" />
          </div>
        </div>
      )}
    </div>
  )
}
