'use client'

import React from 'react'
import type { TrustState } from '@/lib/analytics/confidence-types'

interface ConfidenceMeterProps {
  score: number
  state: TrustState
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

const stateColors: Record<TrustState, { stroke: string; track: string; text: string; glow: string }> = {
  high: { stroke: '#34d399', track: 'rgba(52,211,153,0.1)', text: 'text-emerald-300', glow: 'drop-shadow(0 0 6px rgba(52,211,153,0.3))' },
  medium: { stroke: '#fbbf24', track: 'rgba(251,191,36,0.1)', text: 'text-amber-300', glow: 'drop-shadow(0 0 6px rgba(251,191,36,0.3))' },
  learning: { stroke: '#a78bfa', track: 'rgba(167,139,250,0.1)', text: 'text-purple-300', glow: 'drop-shadow(0 0 6px rgba(167,139,250,0.3))' },
}

const stateLabels: Record<TrustState, string> = {
  high: 'Strong',
  medium: 'Moderate',
  learning: 'Learning',
}

export default function ConfidenceMeter({
  score,
  state,
  size = 'md',
  showLabel = true,
}: ConfidenceMeterProps) {
  const colors = stateColors[state]
  const clamped = Math.max(0, Math.min(100, score))

  const dims = { sm: 56, md: 80, lg: 100 }[size]
  const strokeWidth = { sm: 4, md: 5, lg: 6 }[size]
  const fontSize = { sm: 'text-sm', md: 'text-lg', lg: 'text-2xl' }[size]
  const labelSize = { sm: 'text-[11px]', md: 'text-[11px]', lg: 'text-xs' }[size]

  const radius = (dims - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const arc = circumference * 0.75
  const offset = arc - (arc * clamped) / 100

  return (
    <div className="inline-flex flex-col items-center gap-1" style={{ filter: colors.glow }}>
      <div className="relative" style={{ width: dims, height: dims }}>
        <svg width={dims} height={dims} className="transform -rotate-[135deg]">
          <circle
            cx={dims / 2}
            cy={dims / 2}
            r={radius}
            fill="none"
            stroke={colors.track}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc} ${circumference}`}
            strokeLinecap="round"
          />
          <circle
            cx={dims / 2}
            cy={dims / 2}
            r={radius}
            fill="none"
            stroke={colors.stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc} ${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`${fontSize} font-bold ${colors.text} tabular-nums`}>
            {clamped}
          </span>
        </div>
      </div>
      {showLabel && (
        <span className={`${labelSize} font-medium ${colors.text} opacity-70 uppercase tracking-wider`}>
          {stateLabels[state]}
        </span>
      )}
    </div>
  )
}
