'use client'

/**
 * Matchup Share Card (PROMPT 295).
 * Renders projected winner, score prediction, and key players as a shareable image card.
 */

import type { MatchupSharePayload } from '@/lib/matchup-sharing/types'

const CARD_WIDTH = 600
const CARD_HEIGHT = 400
const ACCENT = '#8b5cf6'

export const MATCHUP_SHARE_CARD_ID = 'matchup-share-card-capture'

interface MatchupShareCardProps {
  payload: MatchupSharePayload
  captureId?: string
  className?: string
}

export function MatchupShareCard({
  payload,
  captureId = MATCHUP_SHARE_CARD_ID,
  className = '',
}: MatchupShareCardProps) {
  const { team1Name, team2Name, projectedWinner, projectedScore1, projectedScore2, keyPlayers, sport, weekOrRound } = payload
  const winPct = payload.winProbability != null ? `${Math.round(payload.winProbability)}%` : null

  return (
    <div
      id={captureId}
      className={`rounded-xl overflow-hidden text-white ${className}`}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        background: '#0f172a',
        border: `2px solid ${ACCENT}40`,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="h-1.5 w-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, transparent)` }}
      />
      <div className="p-6 flex flex-col h-full box-border">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
          {sport ?? 'Matchup'} {weekOrRound ? `· ${weekOrRound}` : ''}
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-100">
          {team1Name} vs {team2Name}
        </h2>

        <div className="mt-4 flex items-center justify-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-200">{team1Name}</p>
            <p className="text-3xl font-black mt-1" style={{ color: projectedWinner === team1Name ? ACCENT : 'rgba(248,250,252,0.7)' }}>
              {projectedScore1.toFixed(1)}
            </p>
          </div>
          <span className="text-slate-500 font-bold">–</span>
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-200">{team2Name}</p>
            <p className="text-3xl font-black mt-1" style={{ color: projectedWinner === team2Name ? ACCENT : 'rgba(248,250,252,0.7)' }}>
              {projectedScore2.toFixed(1)}
            </p>
          </div>
        </div>

        <div className="mt-3 text-center">
          <p className="text-sm font-semibold" style={{ color: ACCENT }}>
            Projected winner: {projectedWinner}
            {winPct != null && (
              <span className="text-slate-400 font-normal ml-1">({winPct})</span>
            )}
          </p>
        </div>

        {keyPlayers && keyPlayers.length > 0 && (
          <div className="mt-4 flex-1 min-h-0">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Key players</p>
            <p className="text-sm text-slate-300 leading-snug">
              {keyPlayers.slice(0, 5).join(' · ')}
            </p>
          </div>
        )}
      </div>
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
