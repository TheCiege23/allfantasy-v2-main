import type { ReactNode } from 'react'
import Link from 'next/link'
import type { WeeklyRoutineData } from '@/lib/core-app/weeklyRoutine'
import { ShareMomentButton } from '@/components/core-app/screens/ShareMomentButton'

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
  const awards = data.awards ?? []
  const upsets = data.upsets ?? []

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
      {/*
        Awards you won in the last played week — shareable moments (2026-09-14). Shown all week, next
        to the week they belong to; each share builds the card image from the league's own history.
      */}
      {awards.length > 0 ? (
        <div className="af3a-card af3a-routine-awards">
          <b>Week {awards[0]!.week} awards</b>
          <ul>
            {awards.map((a) => (
              <li key={`${a.leagueId}:${a.kind}`} className="af3a-routine-award" data-award={a.kind}>
                <span>
                  {a.label} · {a.leagueName} ·{' '}
                  <b className="af3a-mono">
                    {a.value.toFixed(1)}
                    {a.unit === 'pts' ? ' pts' : ' pt margin'}
                  </b>
                </span>
                <ShareMomentButton
                  url={`/api/share/rivalry-card?kind=award&leagueId=${encodeURIComponent(a.leagueId)}&award=${a.kind}`}
                  filename={`award-${a.kind}-week-${a.week}.png`}
                  title={`${a.label} — ${a.leagueName}, week ${a.week}`}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/*
        Upset wins in the last played week (2026-09-14): a win you were given at most a 40% chance of
        by the odds SAVED BEFORE kickoff. No saved odds, no upset — nothing here is recomputed.
      */}
      {upsets.length > 0 ? (
        <div className="af3a-card af3a-routine-awards af3a-routine-upsets">
          <b>Week {upsets[0]!.week} upsets</b>
          <ul>
            {upsets.map((u) => (
              <li key={u.leagueId} className="af3a-routine-award" data-upset={u.leagueId}>
                <span>
                  {u.leagueName} · won{' '}
                  <b className="af3a-mono">
                    {u.pointsFor.toFixed(1)}–{u.pointsAgainst.toFixed(1)}
                  </b>{' '}
                  · pre-game win chance {u.winChance}
                </span>
                <ShareMomentButton
                  url={`/api/share/rivalry-card?kind=upset&leagueId=${encodeURIComponent(u.leagueId)}&season=${u.season}&week=${u.week}`}
                  filename={`upset-week-${u.week}.png`}
                  title={`Upset win — ${u.leagueName}, week ${u.week}`}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

export default YourWeekRoutine
