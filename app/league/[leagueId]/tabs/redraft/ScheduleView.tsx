'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RedraftScheduleClient } from '@/lib/redraft/client'
import { buildScheduleCalendar, type CalendarCell } from '@/lib/league-media/redraftScheduleCalendar'
import '../redraft-tailwind-tabs.css'

function recordLabel(row: { wins: number; losses: number; ties: number }) {
  return row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`
}

function cellTag(cell: CalendarCell): string | null {
  if (cell.state === 'now') return 'Now'
  if (cell.championship) return 'Final'
  if (cell.deadline) return 'Deadline'
  if (cell.playoffStart) return 'Playoffs'
  if (cell.kind === 'playoff') return 'Playoff'
  return null
}

/**
 * The season schedule: a calendar of every week (played, now, upcoming), with the trade deadline and
 * the playoff weeks marked, then the selected week's matchups.
 *
 * `totalWeeks` (RedraftSeason.totalWeeks) and `tradeDeadlineWeek` (League.tradeDeadlineWeek) are
 * optional on purpose: a caller that does not have them (the legacy Season Hub) gets no playoff cells
 * and no deadline marker rather than a guessed one — lib/league-media/redraftScheduleCalendar.ts.
 */
export function ScheduleView({
  schedule,
  totalWeeks = null,
  tradeDeadlineWeek = null,
}: {
  schedule: RedraftScheduleClient | null
  totalWeeks?: number | null
  tradeDeadlineWeek?: number | null
}) {
  const [selectedWeek, setSelectedWeek] = useState<number>(schedule?.currentWeek || 1)

  useEffect(() => {
    setSelectedWeek(schedule?.currentWeek || 1)
  }, [schedule?.currentWeek])

  const visibleWeek = useMemo(() => {
    if (!schedule?.weeks.length) return null
    return schedule.weeks.find((week) => week.week === selectedWeek) ?? schedule.weeks[0] ?? null
  }, [schedule, selectedWeek])

  const calendar = useMemo(
    () =>
      buildScheduleCalendar({
        weeks: schedule?.weeks ?? [],
        currentWeek: schedule?.currentWeek ?? null,
        playoffStartWeek: schedule?.playoffStartWeek ?? null,
        totalWeeks,
        tradeDeadlineWeek,
      }),
    [schedule, totalWeeks, tradeDeadlineWeek],
  )

  if (!schedule) {
    return (
      <section className="rdt rdt-card rdt-muted p-4 text-[12px]" data-testid="redraft-schedule-empty">
        Schedule runtime is not available yet. Complete the draft or ask the commissioner to generate the schedule.
      </section>
    )
  }

  if (!schedule.generated || !schedule.weeks.some((week) => week.matchups.length > 0)) {
    return (
      <section className="rdt rdt-warn-soft rdt-warn-line rdt-text2 rounded-xl border p-4 text-[12px]" data-testid="redraft-schedule-empty">
        No regular season schedule has been generated yet. Matchups will appear here once the commissioner creates the
        schedule from the league roster list.
      </section>
    )
  }

  const playoffSnapshot = schedule.playoffQualificationSnapshot
  const blockingIssues = schedule.validationIssues.filter((issue) => issue.severity === 'blocking')
  const hasPlayoffCells = calendar.cells.some((c) => c.kind === 'playoff')

  return (
    <section className="rdt rdt-card space-y-4 p-4 md:p-5" data-testid="redraft-schedule-view">
      <div className="rdt-head">
        <div>
          <p className="rdt-eyebrow rdt-eyebrow-accent">Season schedule{schedule.season ? ` · ${schedule.season}` : ''}</p>
          <h3 className="mt-1 text-[17px] font-bold rdt-text">Week {visibleWeek?.week ?? schedule.currentWeek} matchups</h3>
          <p className="mt-0.5 text-[12px] rdt-muted">
            {schedule.regularSeasonWeeks} regular season weeks
            {schedule.playoffStartWeek ? ` · Playoffs prep starts week ${schedule.playoffStartWeek}` : ''}
            {calendar.deadlineWeek ? ` · Trade deadline week ${calendar.deadlineWeek}` : ''}
          </p>
        </div>
        <div className="rdt-well rdt-line2 rounded-xl border px-3 py-2 text-right">
          <p className="rdt-eyebrow">Current week</p>
          <p className="text-lg font-bold rdt-accent">{schedule.currentWeek || '-'}</p>
        </div>
      </div>

      <div className="rdt-cal" data-testid="redraft-schedule-week-picker" role="group" aria-label="Season calendar">
        {calendar.cells.map((cell) => {
          const tag = cellTag(cell)
          return (
            <button
              key={cell.week}
              type="button"
              className="rdt-cal-cell"
              data-kind={cell.kind}
              data-state={cell.state}
              data-deadline={cell.deadline ? 'true' : undefined}
              data-championship={cell.championship ? 'true' : undefined}
              data-testid={`redraft-schedule-cal-week-${cell.week}`}
              disabled={!cell.selectable}
              onClick={() => setSelectedWeek(cell.week)}
              aria-pressed={cell.selectable ? cell.week === visibleWeek?.week : undefined}
            >
              <span className="rdt-cal-wk">W{cell.week}</span>
              {tag ? <span className="rdt-cal-tag">{tag}</span> : null}
            </button>
          )
        })}
      </div>

      <ul className="rdt-cal-legend" aria-label="Calendar key">
        <li><i data-k="done" aria-hidden />Played</li>
        <li><i data-k="now" aria-hidden />This week</li>
        {calendar.deadlineWeek ? <li><i data-k="deadline" aria-hidden />Trade deadline · Wk {calendar.deadlineWeek}</li> : null}
        {hasPlayoffCells ? (
          <li>
            <i data-k="playoff" aria-hidden />Playoffs · Wk {calendar.playoffStartWeek}
            {calendar.championshipWeek ? `–${calendar.championshipWeek}` : ''}
          </li>
        ) : null}
      </ul>

      <div className="grid gap-2 md:grid-cols-2">
        {(visibleWeek?.matchups ?? []).map((matchup) => {
          const scored = matchup.homeScore != null && matchup.awayScore != null
          return (
            <div
              key={matchup.id}
              className="rdt-well rdt-line2 rounded-xl border p-3"
              data-testid={matchup.bye ? 'redraft-schedule-bye' : 'redraft-schedule-matchup'}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="rdt-eyebrow">
                  {matchup.bye ? (matchup.extraMatchup ? 'Extra matchup' : 'Bye week') : matchup.divisionGame ? 'Division matchup' : 'Matchup'}
                </span>
                <span className="rdt-surface rdt-line2 rdt-muted rounded-full border px-2 py-0.5 text-[11px]">{matchup.status}</span>
              </div>

              {matchup.bye ? (
                <>
                  <p className="text-sm font-semibold rdt-text">{matchup.homeName}</p>
                  {/* An odd-team league's extra game, in place of the bye (lib/redraft/oddTeamExtraMatchupRules.ts). */}
                  {matchup.extraMatchup ? (
                    <p className="text-[11px] rdt-muted" data-testid="redraft-schedule-extra-matchup">{matchup.extraMatchup.line}</p>
                  ) : null}
                </>
              ) : (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold rdt-text">{matchup.homeName}</p>
                    <p className="text-[11px] rdt-faint">{matchup.homeDivisionName ?? 'League'}</p>
                  </div>
                  {scored ? (
                    <span className="rdt-match-score">
                      {matchup.homeScore!.toFixed(1)}–{matchup.awayScore!.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-[11px] uppercase rdt-faint">vs</span>
                  )}
                  <div className="min-w-0 text-right">
                    <p className="truncate text-sm font-semibold rdt-text">{matchup.awayName}</p>
                    <p className="text-[11px] rdt-faint">{matchup.awayDivisionName ?? 'League'}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rdt-well rdt-line2 rounded-xl border p-3">
          <p className="rdt-eyebrow">Playoff qualification prep</p>
          {playoffSnapshot.seeds.length ? (
            <div className="mt-2 space-y-1">
              {playoffSnapshot.seeds.slice(0, 6).map((seed) => (
                <div key={seed.rosterId} className="flex items-center justify-between gap-2 text-[12px] rdt-text2">
                  <span className="truncate">
                    <span className="rdt-accent font-bold">#{seed.seed}</span> {seed.displayName}
                  </span>
                  <span className="shrink-0 tabular-nums rdt-muted">
                    {seed.record} · {seed.pointsFor.toFixed(1)} PF
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] rdt-muted">Seeds will populate once teams are available.</p>
          )}
        </div>

        <div className="rdt-well rdt-line2 rounded-xl border p-3">
          <p className="rdt-eyebrow">Schedule health</p>
          {blockingIssues.length ? (
            <ul className="mt-2 space-y-1 text-[11px] rdt-bad">
              {blockingIssues.slice(0, 3).map((issue) => (
                <li key={`${issue.code}-${issue.week ?? 'league'}-${issue.rosterId ?? ''}`}>{issue.message}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] rdt-good">
              All teams are covered once per scheduled week. Standings remain at 0-0 until finalized scores arrive.
            </p>
          )}
          {schedule.standings.length ? (
            <p className="mt-2 text-[11px] rdt-muted">
              Leader: {schedule.standings[0]?.displayName} ({recordLabel(schedule.standings[0]!)})
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
