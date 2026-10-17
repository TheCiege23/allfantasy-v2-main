'use client'

import React from 'react'
import type { TrustTimelinePoint } from '@/lib/analytics/confidence-types'

interface TrustTimelineProps {
  points: TrustTimelinePoint[]
  size?: 'sm' | 'md'
}

const phaseColors: Record<TrustTimelinePoint['phase'], { dot: string; line: string; label: string }> = {
  before: { dot: 'bg-white/40', line: 'bg-white/15', label: 'text-white/40' },
  after: { dot: '', line: '', label: '' },
  longterm: { dot: '', line: '', label: '' },
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-400'
  if (score >= 45) return 'bg-amber-400'
  return 'bg-purple-400'
}

function getScoreTextColor(score: number): string {
  if (score >= 70) return 'text-emerald-400'
  if (score >= 45) return 'text-amber-400'
  return 'text-purple-400'
}

function getLineColor(from: number, to: number): string {
  const avg = (from + to) / 2
  if (avg >= 70) return 'bg-emerald-400/30'
  if (avg >= 45) return 'bg-amber-400/30'
  return 'bg-purple-400/30'
}

export default function TrustTimeline({ points, size = 'md' }: TrustTimelineProps) {
  if (points.length === 0) return null

  const height = size === 'sm' ? 40 : 56
  const dotSize = size === 'sm' ? 8 : 10
  const labelSize = size === 'sm' ? 'text-[11px]' : 'text-[11px]'
  const scoreSize = size === 'sm' ? 'text-[11px]' : 'text-[11px]'

  const maxScore = 100
  const minY = 4
  const maxY = height - 4

  return (
    <div className="w-full">
      <div className="relative" style={{ height: height + 28 }}>
        <svg
          className="w-full"
          style={{ height }}
          viewBox={`0 0 ${points.length * 100} ${height}`}
          preserveAspectRatio="none"
        >
          {points.map((point, i) => {
            if (i === points.length - 1) return null
            const nextPoint = points[i + 1]
            const x1 = (i / (points.length - 1)) * ((points.length - 1) * 100)
            const x2 = ((i + 1) / (points.length - 1)) * ((points.length - 1) * 100)
            const y1 = maxY - ((point.score / maxScore) * (maxY - minY))
            const y2 = maxY - ((nextPoint.score / maxScore) * (maxY - minY))
            const lineColor = getLineColor(point.score, nextPoint.score)
            return (
              <line
                key={`line-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={lineColor.replace('bg-', 'stroke-')}
                strokeWidth="2"
                strokeLinecap="round"
              />
            )
          })}
        </svg>

        {points.map((point, i) => {
          const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100
          const y = maxY - ((point.score / maxScore) * (maxY - minY))
          const dotColor = getScoreColor(point.score)
          const textColor = getScoreTextColor(point.score)

          return (
            <div
              key={`point-${i}`}
              className="absolute flex flex-col items-center"
              style={{
                left: `${x}%`,
                top: y - dotSize / 2,
                transform: 'translateX(-50%)',
              }}
            >
              <div
                className={`rounded-full ${dotColor} shadow-lg`}
                style={{ width: dotSize, height: dotSize }}
              />
              <span className={`${scoreSize} font-bold ${textColor} mt-1 tabular-nums`}>
                {point.score}
              </span>
              <span className={`${labelSize} text-white/40 font-medium mt-0.5 whitespace-nowrap`}>
                {point.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
