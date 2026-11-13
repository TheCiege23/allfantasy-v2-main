'use client'

/**
 * League Story Card (PROMPT 296) — shareable AI-generated story card.
 */

import type { LeagueStoryPayload } from '@/lib/league-story-engine/types'

const CARD_WIDTH = 600
const CARD_HEIGHT = 400
const ACCENT = '#a855f7'

export const LEAGUE_STORY_CARD_ID = 'league-story-card-capture'

interface LeagueStoryCardProps {
  payload: LeagueStoryPayload
  captureId?: string
  dataTestId?: string
  className?: string
}

export function LeagueStoryCard({
  payload,
  captureId = LEAGUE_STORY_CARD_ID,
  dataTestId,
  className = '',
}: LeagueStoryCardProps) {
  const { title, narrative, leagueName, week, sport, highlight } = payload

  return (
    <div
      id={captureId}
      data-testid={dataTestId}
      className={`rounded-xl overflow-hidden text-white ${className}`}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        background: 'linear-gradient(180deg, #040915 0%, #0a1228 100%)',
        border: `1px solid ${ACCENT}35`,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="h-1.5 w-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, transparent)` }}
      />
      <div className="p-6 flex flex-col h-full box-border">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
          {leagueName}
          {week != null ? ` · Week ${week}` : ''}
          {sport ? ` · ${sport}` : ''}
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-100 leading-tight">
          {title}
        </h2>
        {highlight && (
          <p className="mt-1 text-sm font-medium text-slate-400">{highlight}</p>
        )}
        <p className="mt-4 text-sm leading-relaxed text-slate-300 flex-1">
          {narrative}
        </p>
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
