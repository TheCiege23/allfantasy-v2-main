'use client'

import React from 'react'

export type ConfidenceRating = 'HIGH' | 'MEDIUM' | 'LEARNING'

export interface Confidence {
  rating: ConfidenceRating
  score: number
}

const STYLES: Record<ConfidenceRating, string> = {
  HIGH: 'bg-green-500/15 text-green-400 border-green-500/30',
  MEDIUM: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  LEARNING: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

const DOTS: Record<ConfidenceRating, number> = {
  HIGH: 4,
  MEDIUM: 3,
  LEARNING: 2,
}

const DOT_COLORS: Record<ConfidenceRating, string> = {
  HIGH: 'bg-green-400',
  MEDIUM: 'bg-yellow-400',
  LEARNING: 'bg-gray-400',
}

interface ConfidencePillProps {
  confidence: Confidence
  onClick?: () => void
  size?: 'sm' | 'md'
  showDots?: boolean
}

export default function ConfidencePill({
  confidence,
  onClick,
  size = 'md',
  showDots = true,
}: ConfidencePillProps) {
  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-[11px] gap-1 min-h-[28px]'
    : 'px-3 py-1.5 text-xs gap-2 min-h-[36px]'

  return (
    <button
      onClick={onClick}
      type="button"
      className={`inline-flex items-center rounded-full border font-medium transition-all duration-150 touch-manipulation ${sizeClasses} ${STYLES[confidence.rating]} ${onClick ? 'cursor-pointer hover:opacity-90 active:scale-[0.97]' : 'cursor-default'}`}
    >
      <span className="font-semibold">{confidence.rating}</span>
      {showDots && (
        <span className="flex gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${i < DOTS[confidence.rating] ? DOT_COLORS[confidence.rating] : 'bg-white/15'}`}
            />
          ))}
        </span>
      )}
      <span className="opacity-80">{confidence.score}%</span>
    </button>
  )
}
