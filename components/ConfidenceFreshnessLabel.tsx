'use client'

import { Clock, Shield } from 'lucide-react'

function timeAgo(date: string | Date | number | undefined): string {
  if (!date) return 'unknown'
  const ms = Date.now() - new Date(date).getTime()
  if (ms < 0) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function confidenceLabel(score: number): { text: string; color: string } {
  if (score >= 0.8) return { text: 'High', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/25' }
  if (score >= 0.5) return { text: 'Medium', color: 'text-amber-300 bg-amber-500/15 border-amber-400/25' }
  return { text: 'Learning', color: 'text-orange-300 bg-orange-500/15 border-orange-400/25' }
}

function freshnessColor(date: string | Date | number | undefined): string {
  if (!date) return 'text-white/40'
  const hrs = (Date.now() - new Date(date).getTime()) / 3600000
  if (hrs < 6) return 'text-emerald-300/70'
  if (hrs < 24) return 'text-amber-300/70'
  return 'text-orange-300/70'
}

export default function ConfidenceFreshnessLabel({
  confidence,
  timestamp,
  compact,
}: {
  confidence?: number | null
  timestamp?: string | Date | number | null
  compact?: boolean
}) {
  if (!confidence && !timestamp) return null

  const conf = confidence != null ? confidenceLabel(confidence) : null

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {conf && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-medium ${conf.color}`}>
            <Shield className="w-2.5 h-2.5" />
            {conf.text}
          </span>
        )}
        {timestamp && (
          <span className={`inline-flex items-center gap-1 text-[11px] ${freshnessColor(timestamp)}`}>
            <Clock className="w-2.5 h-2.5" />
            {timeAgo(timestamp)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {conf && (
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${conf.color}`}>
          <Shield className="w-3 h-3" />
          Confidence: {conf.text} {confidence != null && `(${Math.round(confidence * 100)}%)`}
        </div>
      )}
      {timestamp && (
        <div className={`inline-flex items-center gap-1.5 text-[11px] ${freshnessColor(timestamp)}`}>
          <Clock className="w-3 h-3" />
          Data: {timeAgo(timestamp)}
        </div>
      )}
    </div>
  )
}
