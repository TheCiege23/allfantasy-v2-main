'use client'

/**
 * Shareable AI Insight Card (PROMPT 293).
 * Renders a clean image card for capture (html2canvas): player/team names, AI insight, AllFantasy branding.
 * Fixed size for consistent social cards.
 */

import type {
  AICardPayload,
  AICardVariant,
  TradeGradePayload,
  MatchupPredictionPayload,
  DraftGradePayload,
  PowerRankingsPayload,
} from '@/lib/ai-insight-cards/types'

const CARD_WIDTH = 600
const CARD_HEIGHT = 400

const VARIANT_ACCENT: Record<AICardVariant, string> = {
  trade_grade: '#10b981',
  matchup_prediction: '#8b5cf6',
  draft_grade: '#f59e0b',
  power_rankings: '#06b6d4',
}

export const AI_INSIGHT_CARD_ID = 'ai-insight-card-capture'

interface AICardRendererProps {
  payload: AICardPayload
  /** Use this id so html2canvas can find the element */
  captureId?: string
  className?: string
}

export function AICardRenderer({
  payload,
  captureId = AI_INSIGHT_CARD_ID,
  className = '',
}: AICardRendererProps) {
  const accent = VARIANT_ACCENT[payload.variant]

  return (
    <div
      id={captureId}
      className={`rounded-xl overflow-hidden text-white ${className}`}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        background: '#0f172a',
        border: `2px solid ${accent}40`,
        boxSizing: 'border-box',
      }}
    >
      {/* Top accent bar */}
      <div
        className="h-1.5 w-full"
        style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
      <div className="p-6 flex flex-col h-full box-border">
        <p
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: accent }}
        >
          {getVariantLabel(payload.variant)}
        </p>
        <h2 className="mt-2 text-xl font-bold leading-tight" style={{ color: '#f8fafc' }}>
          {payload.title}
        </h2>

        {payload.variant === 'trade_grade' && (
          <TradeGradeBody payload={payload as TradeGradePayload} accent={accent} />
        )}
        {payload.variant === 'matchup_prediction' && (
          <MatchupBody payload={payload as MatchupPredictionPayload} accent={accent} />
        )}
        {payload.variant === 'draft_grade' && (
          <DraftGradeBody payload={payload as DraftGradePayload} accent={accent} />
        )}
        {payload.variant === 'power_rankings' && (
          <PowerRankingsBody payload={payload as PowerRankingsPayload} accent={accent} />
        )}

        <p className="mt-4 text-sm leading-snug flex-1" style={{ color: 'rgba(248,250,252,0.9)' }}>
          {payload.insight}
        </p>
      </div>
      {/* AllFantasy branding */}
      <div
        className="px-6 py-3 flex items-center justify-end gap-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
          allfantasy.ai
        </span>
      </div>
    </div>
  )
}

function TradeGradeBody({ payload, accent }: { payload: TradeGradePayload; accent: string }) {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-sm">
      <div>
        <span className="font-medium" style={{ color: accent }}>Side A</span>
        <p className="text-white/90">{payload.sideA.join(', ') || '—'}</p>
      </div>
      <div>
        <span className="font-medium" style={{ color: accent }}>Side B</span>
        <p className="text-white/90">{payload.sideB.join(', ') || '—'}</p>
      </div>
      {(payload.grade || payload.verdict) && (
        <div className="w-full mt-1">
          {payload.grade && (
            <span className="font-bold text-lg" style={{ color: accent }}>{payload.grade}</span>
          )}
          {payload.verdict && (
            <span className="ml-2 text-white/80 text-sm">{payload.verdict}</span>
          )}
        </div>
      )}
    </div>
  )
}

function MatchupBody({ payload, accent }: { payload: MatchupPredictionPayload; accent: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap text-sm">
      <span className="font-semibold text-white/95">{payload.team1}</span>
      <span className="text-white/50">vs</span>
      <span className="font-semibold text-white/95">{payload.team2}</span>
      {payload.prediction && (
        <span className="ml-2 font-medium" style={{ color: accent }}>{payload.prediction}</span>
      )}
      {payload.weekOrRound && (
        <span className="text-white/50 text-xs"> · {payload.weekOrRound}</span>
      )}
    </div>
  )
}

function DraftGradeBody({ payload, accent }: { payload: DraftGradePayload; accent: string }) {
  return (
    <div className="mt-3 text-sm">
      <p className="text-white/95 font-medium">{payload.teamName}</p>
      {payload.grade && (
        <span className="font-bold text-lg" style={{ color: accent }}>{payload.grade}</span>
      )}
      {payload.roundOrPick && (
        <span className="ml-2 text-white/60 text-xs">{payload.roundOrPick}</span>
      )}
      {payload.highlights && payload.highlights.length > 0 && (
        <ul className="mt-1 list-disc list-inside text-white/70 text-xs">
          {payload.highlights.slice(0, 3).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PowerRankingsBody({ payload, accent }: { payload: PowerRankingsPayload; accent: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      <span className="font-bold text-lg w-8" style={{ color: accent }}>#{payload.rank}</span>
      <span className="font-semibold text-white/95">{payload.teamName}</span>
      {payload.change && (
        <span className="text-xs font-medium" style={{ color: payload.change.startsWith('+') ? '#22c55e' : '#f59e0b' }}>
          {payload.change}
        </span>
      )}
      {payload.blurb && (
        <p className="text-white/70 text-xs mt-0.5">{payload.blurb}</p>
      )}
    </div>
  )
}

function getVariantLabel(v: AICardVariant): string {
  switch (v) {
    case 'trade_grade': return 'Trade Grade'
    case 'matchup_prediction': return 'Matchup'
    case 'draft_grade': return 'Draft Grade'
    case 'power_rankings': return 'Power Rankings'
    default: return 'AI Insight'
  }
}
