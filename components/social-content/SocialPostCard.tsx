'use client'

/**
 * Generic social post card for weekly recap and other content (PROMPT 297).
 * Renders title + body lines + required hashtags; same size as other share cards.
 */

import { REQUIRED_HASHTAGS } from '@/lib/social-content-generator/constants'

const CARD_WIDTH = 600
const CARD_HEIGHT = 400
const ACCENT = '#0ea5e9'

export const SOCIAL_POST_CARD_ID = 'social-post-card-capture'

export interface SocialPostCardProps {
  title: string
  bodyLines?: string[]
  leagueName?: string
  week?: number
  /** Override hashtags (default: REQUIRED_HASHTAGS) */
  hashtags?: string[]
  captureId?: string
  className?: string
}

export function SocialPostCard({
  title,
  bodyLines = [],
  leagueName,
  week,
  hashtags = [...REQUIRED_HASHTAGS],
  captureId = SOCIAL_POST_CARD_ID,
  className = '',
}: SocialPostCardProps) {
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
          {leagueName ?? 'Fantasy'}
          {week != null ? ` · Week ${week}` : ''}
        </p>
        <h2 className="mt-2 text-xl font-bold text-slate-100 leading-tight">
          {title}
        </h2>
        {bodyLines.length > 0 && (
          <ul className="mt-4 space-y-2 flex-1">
            {bodyLines.map((line, i) => (
              <li key={i} className="text-sm text-slate-300 leading-snug">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        className="px-6 py-3 flex flex-col gap-1"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        <p className="text-[11px] text-slate-500 leading-tight">
          {hashtags.join(' ')}
        </p>
        <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
          allfantasy.ai
        </span>
      </div>
    </div>
  )
}
