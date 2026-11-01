'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { WeeklyRoutineData } from '@/lib/core-app/weeklyRoutine'
import { ShareMomentButton } from '@/components/core-app/screens/ShareMomentButton'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { yourWeekRoutineMessages } from '@/lib/core-app/messages/yourWeekRoutine'
import { awardLabelText, routineStepTitle, routineSummaryText, routineTodayLabel } from '@/lib/core-app/dashboard3aCopy'

/**
 * "Your week" — the weekly routine card on the /core home (retention item 7, user decisions
 * 2026-09-14). Five steps, today's highlighted; each links to the screen that already does the job.
 *
 * ⚠ A CHECK MARK IS A FACT. `done` is only ever set from data (see lib/core-app/weeklyRoutine.ts);
 * `unknown` renders no mark and no invented summary. On Monday the recap block expands with last
 * week's details, and says plainly that Monday night games may still count.
 *
 * Spanish (2026-10-04): the step summaries are built on the server in English and carry
 * `summaryParts`; lib/core-app/dashboard3aCopy.ts rebuilds them at render, and the recap, awards and
 * upsets are written here from their numbers. The provider starts at English on server and client
 * alike, so the first paint agrees.
 */
export function YourWeekRoutine({ data, help }: { data: WeeklyRoutineData | null; help?: ReactNode }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(yourWeekRoutineMessages)
  if (!data) return null
  const todayStep = data.steps.find((s) => s.today)
  const recap = data.today === 'recap' ? data.recap : null
  const awards = data.awards ?? []
  const upsets = data.upsets ?? []

  return (
    <section className="af3a-sec af3a-routine" aria-label={m.yourWeek}>
      <header className="af3a-sechead">
        <h2>{m.yourWeek}</h2>
        {help}
        <span className="af3a-note">
          {routineTodayLabel(data.todayLabel, language)}
          {todayStep ? ` · ${routineStepTitle(todayStep, language)}` : ''}
        </span>
      </header>
      <ol className="af3a-card af3a-routine-list">
        {data.steps.map((s) => {
          const summary = routineSummaryText(s, language)
          return (
          <li
            key={s.key}
            className="af3a-routine-step"
            data-step={s.key}
            data-today={s.today ? 'true' : undefined}
            data-state={s.state}
            aria-current={s.today ? 'step' : undefined}
          >
            <span className="af3a-routine-day af3a-mono">{m.weekday(s.day)}</span>
            <Link className="af3a-routine-title" href={s.href}>
              {routineStepTitle(s, language)}
            </Link>
            {s.state === 'done' ? (
              <span className="af3a-routine-check" aria-label={m.done}>
                ✓
              </span>
            ) : null}
            {summary ? <span className="af3a-routine-summary">{summary}</span> : null}
          </li>
          )
        })}
      </ol>
      {recap ? (
        <div className="af3a-card af3a-routine-recap">
          <b>{m.recapTitle(recap.week, recap.season, recap.wins, recap.losses)}</b>
          <ul>
            {recap.biggestWin ? (
              <li>{m.biggestWin(recap.biggestWin.leagueName, recap.biggestWin.margin.toFixed(1))}</li>
            ) : null}
            {recap.closestLoss ? (
              <li>{m.closestLoss(recap.closestLoss.leagueName, recap.closestLoss.margin.toFixed(1))}</li>
            ) : null}
            {recap.topScorer ? (
              <li>{m.topScorer(recap.topScorer.name, recap.topScorer.points.toFixed(1), recap.topScorer.leagueName)}</li>
            ) : null}
          </ul>
          {recap.pending ? <p className="af3a-receipt-note">{m.recapPending}</p> : null}
        </div>
      ) : null}
      {/*
        Awards you won in the last played week — shareable moments (2026-09-14). Shown all week, next
        to the week they belong to; each share builds the card image from the league's own history.
      */}
      {awards.length > 0 ? (
        <div className="af3a-card af3a-routine-awards">
          <b>{m.awardsTitle(awards[0]!.week)}</b>
          <ul>
            {awards.map((a) => (
              <li key={`${a.leagueId}:${a.kind}`} className="af3a-routine-award" data-award={a.kind}>
                <span>
                  {awardLabelText(a, language)} · {a.leagueName} ·{' '}
                  <b className="af3a-mono">
                    {a.value.toFixed(1)}
                    {a.unit === 'pts' ? ' pts' : m.ptMargin}
                  </b>
                </span>
                <ShareMomentButton
                  url={`/api/share/rivalry-card?kind=award&leagueId=${encodeURIComponent(a.leagueId)}&award=${a.kind}`}
                  filename={`award-${a.kind}-week-${a.week}.png`}
                  title={m.awardShareTitle(awardLabelText(a, language), a.leagueName, a.week)}
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
          <b>{m.upsetsTitle(upsets[0]!.week)}</b>
          <ul>
            {upsets.map((u) => (
              <li key={u.leagueId} className="af3a-routine-award" data-upset={u.leagueId}>
                <span>
                  {u.leagueName} · {m.won}{' '}
                  <b className="af3a-mono">
                    {u.pointsFor.toFixed(1)}–{u.pointsAgainst.toFixed(1)}
                  </b>{' '}
                  · {m.preGameChance} {u.winChance}
                </span>
                <ShareMomentButton
                  url={`/api/share/rivalry-card?kind=upset&leagueId=${encodeURIComponent(u.leagueId)}&season=${u.season}&week=${u.week}`}
                  filename={`upset-week-${u.week}.png`}
                  title={m.upsetShareTitle(u.leagueName, u.week)}
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
