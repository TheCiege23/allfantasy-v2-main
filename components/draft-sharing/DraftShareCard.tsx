'use client'

/**
 * Draft Results Share Card (PROMPT 294).
 * Renders draft grade (single), team rankings, or "winner of draft" as a shareable image card.
 */

import type {
  DraftShareCardPayload,
  DraftGradeCardPayload,
  DraftRankingsCardPayload,
  DraftWinnerCardPayload,
} from '@/lib/draft-sharing/types'

const CARD_WIDTH = 600
const CARD_HEIGHT = 400
const ACCENT = '#f59e0b'

export const DRAFT_SHARE_CARD_ID = 'draft-share-card-capture'

interface DraftShareCardProps {
  payload: DraftShareCardPayload
  captureId?: string
  className?: string
}

export function DraftShareCard({
  payload,
  captureId = DRAFT_SHARE_CARD_ID,
  className = '',
}: DraftShareCardProps) {
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
          {payload.leagueName} · {payload.season}
        </p>
        {payload.variant === 'draft_grade' && (
          <DraftGradeBody payload={payload as DraftGradeCardPayload} />
        )}
        {payload.variant === 'draft_rankings' && (
          <DraftRankingsBody payload={payload as DraftRankingsCardPayload} />
        )}
        {payload.variant === 'draft_winner' && (
          <DraftWinnerBody payload={payload as DraftWinnerCardPayload} />
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

function DraftGradeBody({ payload }: { payload: DraftGradeCardPayload }) {
  return (
    <>
      <h2 className="mt-2 text-xl font-bold text-slate-100">Draft Grade</h2>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-bold text-2xl" style={{ color: ACCENT }}>
          {payload.grade}
        </span>
        <span className="text-slate-400 text-sm">({payload.score})</span>
        {payload.rank != null && (
          <span className="text-slate-500 text-xs ml-2">#{payload.rank} in league</span>
        )}
      </div>
      <p className="mt-2 font-semibold text-slate-200">{payload.teamName}</p>
      <p className="mt-3 text-sm leading-snug text-slate-300">{payload.insight}</p>
      {payload.highlights?.length ? (
        <ul className="mt-2 list-disc list-inside text-xs text-slate-400">
          {payload.highlights.slice(0, 3).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function DraftRankingsBody({ payload }: { payload: DraftRankingsCardPayload }) {
  const rows = payload.grades.slice(0, 10)
  return (
    <>
      <h2 className="mt-2 text-xl font-bold text-slate-100">Draft Rankings</h2>
      <p className="text-sm text-slate-400 mt-0.5">Post-draft team grades</p>
      <div className="mt-3 flex-1 min-h-0 overflow-hidden">
        <div className="space-y-1.5">
          {rows.map((r, idx) => (
            <div
              key={r.rosterId}
              className="flex justify-between items-center py-1.5 px-2 rounded-lg bg-white/5"
            >
              <span className="text-slate-200 font-medium text-sm">
                #{idx + 1} {r.name ?? `Roster ${r.rosterId}`}
              </span>
              <span className="font-bold text-sm" style={{ color: ACCENT }}>
                {r.grade}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function DraftWinnerBody({ payload }: { payload: DraftWinnerCardPayload }) {
  return (
    <>
      <h2 className="mt-2 text-lg font-bold text-slate-100">Winner of the Draft</h2>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-bold text-2xl" style={{ color: ACCENT }}>
          {payload.grade}
        </span>
        <span className="text-slate-400 text-sm">({payload.score})</span>
      </div>
      <p className="mt-1 font-semibold text-lg text-slate-200">{payload.winnerName}</p>
      <p className="mt-3 text-sm leading-snug text-slate-300">{payload.insight}</p>
      {payload.blurb && (
        <p className="mt-2 text-xs text-slate-400">{payload.blurb}</p>
      )}
    </>
  )
}
