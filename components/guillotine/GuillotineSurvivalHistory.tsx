'use client'

import { useState } from 'react'
import type { SurvivalHistory, SurvivalPathStep, SurvivalTeam } from '@/lib/guillotine/survivalHistory'

/**
 * Survival history (2026-10-29): the season week by week — the chop line, who fell, who escaped by
 * the least, the top score — and every team's path through it, so "how close was I" has an answer
 * after the moment has passed. Data: lib/guillotine/survivalHistory.ts via the summary's home extras.
 */
const fmt = (n: number) => n.toFixed(1)
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`

function stepTone(step: SurvivalPathStep, closeCallMargin: number): { color: string; label: string } {
  if (step.chopped) return { color: '#ff6b5a', label: 'chopped' }
  if (step.margin == null) return { color: 'rgba(255,255,255,.25)', label: 'no chop that week' }
  if (step.margin <= closeCallMargin) return { color: '#ffc46b', label: `close call, ${signed(step.margin)}` }
  return { color: '#3abe78', label: `safe, ${signed(step.margin)}` }
}

function Path({ team, closeCallMargin }: { team: SurvivalTeam; closeCallMargin: number }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label={`${team.name}, week by week`}>
      {team.path.map((step) => {
        const tone = stepTone(step, closeCallMargin)
        return (
          <li
            key={step.week}
            title={`Week ${step.week}: ${fmt(step.points)} points, ${tone.label}`}
            className="h-3 w-3 rounded-sm"
            style={{ background: tone.color }}
          >
            <span className="sr-only">{`Week ${step.week}: ${fmt(step.points)} points, ${tone.label}`}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function GuillotineSurvivalHistory({
  history,
  myRosterId,
  closeCallMargin,
  onReplay,
}: {
  history: SurvivalHistory | null | undefined
  myRosterId?: string | null
  closeCallMargin: number
  /** Replays the chop animation for a week. */
  onReplay?: (week: number) => void
}) {
  const [showAllWeeks, setShowAllWeeks] = useState(false)
  const weeks = history?.weeks.filter((w) => w.chopLine != null) ?? []
  const teams = history?.teams ?? []
  if (weeks.length === 0) return <p className="gl gl-muted text-sm" data-testid="guillotine-history-empty">No chops yet. Each week’s chop and every team’s path show here once the first chop is in.</p>
  const shown = showAllWeeks ? weeks : weeks.slice(0, 4)

  return (
    <div className="gl space-y-5" data-testid="guillotine-survival-history">
      <ul className="space-y-2" aria-label="Chops, latest first">
        {shown.map((w) => (
          <li key={w.week} className="gl-well rounded-lg border px-3 py-2.5 text-sm" data-testid={`guillotine-history-week-${w.week}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="gl-text font-semibold">
                Week {w.week}
                {w.chopLine != null ? <span className="gl-muted ml-2 font-normal">chop line {fmt(w.chopLine)}</span> : null}
              </span>
              {onReplay ? (
                <button type="button" onClick={() => onReplay(w.week)} className="gl-accent-text text-xs hover:underline">
                  Replay
                </button>
              ) : null}
            </div>
            <p className="gl-bad mt-1 text-[13px]">
              Chopped: {w.chopped.map((c) => `${c.name} (${fmt(c.points)})`).join(', ')}
            </p>
            <p className="gl-text2 mt-0.5 text-[12.5px]">
              {w.closestEscape ? <>Closest escape: <span className="gl-warn font-semibold">{w.closestEscape.name}</span> by {fmt(w.closestEscape.margin)}</> : null}
              {w.closestEscape && w.topScorer ? ' · ' : null}
              {w.topScorer ? <>Top score: {w.topScorer.name} ({fmt(w.topScorer.points)})</> : null}
            </p>
          </li>
        ))}
      </ul>
      {weeks.length > 4 ? (
        <button type="button" onClick={() => setShowAllWeeks((v) => !v)} className="gl-accent-text text-xs hover:underline" data-testid="guillotine-history-all-weeks">
          {showAllWeeks ? 'Show the latest weeks' : `Show all ${weeks.length} weeks`}
        </button>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" data-testid="guillotine-history-teams">
          <caption className="gl-muted mb-2 text-left text-[11px] uppercase tracking-wide">
            Every team’s path · green safe · amber within {fmt(closeCallMargin)} of the line · red chopped
          </caption>
          <thead>
            <tr className="gl-muted text-left text-[11px] uppercase tracking-wide">
              <th scope="col" className="py-1 pr-2 font-semibold">Team</th>
              <th scope="col" className="py-1 pr-2 font-semibold">Status</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Close calls</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Closest escape</th>
              <th scope="col" className="py-1 font-semibold">Path</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const me = !!myRosterId && t.rosterId === myRosterId
              return (
                <tr key={t.rosterId} className={`gl-line border-t ${me ? 'gl-me' : ''}`} data-testid={`guillotine-history-team-${t.rosterId}`} data-status={t.status}>
                  <td className="gl-text py-1.5 pr-2">{me ? `You · ${t.name}` : t.name}</td>
                  <td className={`py-1.5 pr-2 ${t.status === 'chopped' ? 'gl-bad' : 'gl-good'}`}>
                    {t.status === 'chopped' ? `Chopped wk ${t.choppedWeek}` : `Alive · ${t.weeksSurvived} ${t.weeksSurvived === 1 ? 'chop' : 'chops'} survived`}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{t.closeCalls}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{t.bestEscape == null ? '—' : signed(t.bestEscape)}</td>
                  <td className="py-1.5"><Path team={t} closeCallMargin={closeCallMargin} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
