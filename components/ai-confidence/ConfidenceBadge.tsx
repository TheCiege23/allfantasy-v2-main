'use client'

import React, { useState } from 'react'
import { AlertTriangle, Brain } from 'lucide-react'
import type { TrustState, TrustData } from '@/lib/analytics/confidence-types'

function AFCrest({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2L3 7v6c0 5.25 3.85 10.15 9 11.25C17.15 23.15 21 18.25 21 13V7l-9-5z"
        fill="currentColor"
        opacity="0.2"
      />
      <path
        d="M12 2L3 7v6c0 5.25 3.85 10.15 9 11.25C17.15 23.15 21 18.25 21 13V7l-9-5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="8"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >AF</text>
    </svg>
  )
}

interface ConfidenceBadgeProps {
  data: TrustData
  size?: 'sm' | 'md' | 'lg'
  onTap?: () => void
  interactive?: boolean
}

const stateConfig: Record<TrustState, {
  label: string
  microcopy: string
  icon: React.ElementType
  bg: string
  text: string
  border: string
  ring: string
  dashed: boolean
}> = {
  high: {
    label: 'High Confidence',
    microcopy: 'This recommendation has performed well historically in similar situations.',
    icon: AFCrest,
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30',
    ring: 'ring-emerald-500/20',
    dashed: false,
  },
  medium: {
    label: 'Moderate Confidence',
    microcopy: 'There is upside here, but outcomes may vary.',
    icon: AlertTriangle,
    bg: 'bg-amber-500/15',
    text: 'text-amber-300',
    border: 'border-amber-500/30',
    ring: 'ring-amber-500/20',
    dashed: false,
  },
  learning: {
    label: 'Learning',
    microcopy: 'The AI is still learning from limited data in this scenario.',
    icon: Brain,
    bg: 'bg-purple-500/10',
    text: 'text-purple-300',
    border: 'border-purple-400/30',
    ring: 'ring-purple-500/20',
    dashed: true,
  },
}

export default function ConfidenceBadge({
  data,
  size = 'md',
  onTap,
  interactive = true,
}: ConfidenceBadgeProps) {
  const [hovered, setHovered] = useState(false)
  const config = stateConfig[data.state]
  const Icon = config.icon

  const sizeClasses = {
    sm: { pill: 'px-2 py-0.5 gap-1', icon: 'w-3 h-3', text: 'text-[11px]', micro: 'text-[11px]' },
    md: { pill: 'px-3 py-1.5 gap-1.5', icon: 'w-3.5 h-3.5', text: 'text-xs', micro: 'text-[11px]' },
    lg: { pill: 'px-3.5 py-2 gap-2', icon: 'w-4 h-4', text: 'text-sm', micro: 'text-xs' },
  }[size]

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={interactive ? onTap : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={[
          'inline-flex items-center rounded-xl transition-all duration-200 min-h-[44px] touch-manipulation',
          sizeClasses.pill,
          config.bg,
          config.border,
          config.dashed ? 'border-dashed border' : 'border',
          interactive ? 'cursor-pointer hover:ring-2 active:scale-[0.97]' : 'cursor-default',
          interactive ? config.ring : '',
        ].join(' ')}
        type="button"
        aria-label={`${config.label}: ${data.score}/100`}
      >
        <Icon className={`${sizeClasses.icon} ${config.text}`} />
        <span className={`${sizeClasses.text} font-semibold ${config.text}`}>
          {config.label}
        </span>
        {size !== 'sm' && (
          <span className={`${sizeClasses.text} font-medium ${config.text} opacity-60`}>
            {data.score}
          </span>
        )}
      </button>

      {hovered && !onTap && (
        <div className={`${sizeClasses.micro} ${config.text} opacity-70 max-w-[260px] leading-relaxed`}>
          {config.microcopy}
        </div>
      )}
    </div>
  )
}
