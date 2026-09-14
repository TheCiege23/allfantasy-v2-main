import type { ReactNode } from 'react'
import Link from 'next/link'
import type { WeeklyRoutineData } from '@/lib/core-app/weeklyRoutine'

/**
 * "Your week" — the weekly routine card on the /core home (retention item 7, user decisions
 * 2026-09-14). Five steps, today's highlighted; each links to the screen that already does the job.
 *
 * ⚠ A CHECK MARK IS A FACT. `done` is only ever set from data (see lib/core-app/weeklyRoutine.ts);
 * `unknown` renders no mark and no invented summary. On Monday the recap block expands with last
 * week's details, and says plainly that Monday night games may still count.
 */
export function YourWeekRoutine({ data, help }: { data: WeeklyRoutineData | null; help?: ReactNode }) {
  if (!data) return null
  const todayStep = data.steps.find((s) => s.today)
  const recap = data.today === 'recap' ? data.recap : null

  return (
    <section className="af3a-sec af3a-routine" aria-label="Your week">
      <header className="af3a-sechead">
        <h2>Your week</h2>
        {help}
        <span className="af3a-note">
          {data.todayLabel}
          {todayStep ? ` · ${todayStep.title}` : ''}
        </span>
      </header>
      <ol className="af3a-card af3a-routine-list">
        {data.steps.map((s) => (
          <li
            key={s.key}
            className="af3a-routine-step"
            data-step={s.key}
            data-today={s.today ? 'true' : undefined}
            data-state={s.state}
            aria-current={s.today ? 'step' : undefined}
          >
            <span className="af3a-routine-day af3a-mono">{s.day}</span>
            <Link className="af3a-routine-title" href={s.href}>
              {s.title}
            </Link>
            {s.state === 'done' ? (
              <span className="af3a-routine-check" aria-label="Done">
                ✓
              </span>
            ) : null}
            {s.summary ? <span className="af3a-routine-summary">{s.summary}</span> : null}
          </li>
        ))}
      </ol>
      {recap ? (
        <div className="af3a-card af3a-routine-recap">
          <b>
            {recap.season} week {recap.week} recap: {recap.wins}-{recap.losses}
          </b>
          <ul>
            {recap.biggestWin ? (
              <li>
                Biggest win: {recap.biggestWin.leagueName} by {recap.biggestWin.margin.toFixed(1)}
              </li>
            ) : null}
            {recap.closestLoss ? (
              <li>
                Closest loss: {recap.closestLoss.leagueName} by {recap.closestLoss.margin.toFixed(1)}
              </li>
            ) : null}
            {recap.topScorer ? (
              <li>
                Top scorer: {recap.topScorer.name} {recap.topScorer.points.toFixed(1)} ({recap.topScorer.leagueName})
              </li>
            ) : null}
          </ul>
          <p className="af3a-receipt-note">Monday night games may still change these.</p>
        </div>
      ) : null}
    </section>
  )
}

export default YourWeekRoutine
