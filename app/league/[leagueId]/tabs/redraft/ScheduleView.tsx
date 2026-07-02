'use client'

import { useEffect, useMemo, useState } from 'react'
import type { RedraftScheduleClient } from '@/lib/redraft/client'

function recordLabel(row: { wins: number; losses: number; ties: number }) {
  return row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`
}

export function ScheduleView({ schedule }: { schedule: RedraftScheduleClient | null }) {
  const [selectedWeek, setSelectedWeek] = useState<number>(schedule?.currentWeek || 1)

  useEffect(() => {
    setSelectedWeek(schedule?.currentWeek || 1)
  }, [schedule?.currentWeek])

  const visibleWeek = useMemo(() => {
    if (!schedule?.weeks.length) return null
    return schedule.weeks.find((week) => week.week === selectedWeek) ?? schedule.weeks[0] ?? null
  }, [schedule, selectedWeek])

  if (!schedule) {
    return (
      <section
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-[12px] text-white/55"
        data-testid="redraft-schedule-empty"
      >
        Schedule runtime is not available yet. Complete the draft or ask the commissioner to generate the schedule.
      </section>
    )
  }

  if (!schedule.generated || !schedule.weeks.some((week) => week.matchups.length > 0)) {
    return (
      <section
        className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-4 text-[12px] text-amber-100"
        data-testid="redraft-schedule-empty"
      >
        No regular season schedule has been generated yet. Matchups will appear here once the commissioner creates the
        schedule from the league roster list.
      </section>
    )
  }

  const playoffSnapshot = schedule.playoffQualificationSnapshot
  const blockingIssues = schedule.validationIssues.filter((issue) => issue.severity === 'blocking')

  return (
    <section
      className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]"
      data-testid="redraft-schedule-view"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/70">Schedule</p>
          <h3 className="text-[15px] font-semibold text-white">
            Week {visibleWeek?.week ?? schedule.currentWeek} matchups
          </h3>
          <p className="text-[11px] text-white/45">
            {schedule.regularSeasonWeeks} regular season weeks
            {schedule.playoffStartWeek ? ` · Playoffs prep starts week ${schedule.playoffStartWeek}` : ''}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">Current week</p>
          <p className="text-lg font-bold text-white">{schedule.currentWeek || '-'}</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1" data-testid="redraft-schedule-week-picker">
        {schedule.weeks.map((week) => (
          <button
            key={week.week}
            type="button"
            onClick={() => setSelectedWeek(week.week)}
            className={[
              'min-w-12 rounded-lg border px-2 py-1 text-[11px] transition',
              week.week === visibleWeek?.week
                ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
                : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white/80',
            ].join(' ')}
            aria-pressed={week.week === visibleWeek?.week}
          >
            W{week.week}
          </button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {(visibleWeek?.matchups ?? []).map((matchup) => (
          <div
            key={matchup.id}
            className="rounded-xl border border-white/[0.08] bg-black/20 p-3"
            data-testid={matchup.bye ? 'redraft-schedule-bye' : 'redraft-schedule-matchup'}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-white/35">
                {matchup.bye ? 'Bye week' : matchup.divisionGame ? 'Division matchup' : 'Matchup'}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50">
                {matchup.status}
              </span>
            </div>

            {matchup.bye ? (
              <p className="text-sm font-semibold text-white">{matchup.homeName}</p>
            ) : (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div>
                  <p className="truncate text-sm font-semibold text-white">{matchup.homeName}</p>
                  <p className="text-[10px] text-white/35">{matchup.homeDivisionName ?? 'League'}</p>
                </div>
                <span className="text-[10px] uppercase text-white/35">vs</span>
                <div className="text-right">
                  <p className="truncate text-sm font-semibold text-white">{matchup.awayName}</p>
                  <p className="text-[10px] text-white/35">{matchup.awayDivisionName ?? 'League'}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-white/[0.08] bg-black/15 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Playoff qualification prep</p>
          {playoffSnapshot.seeds.length ? (
            <div className="mt-2 space-y-1">
              {playoffSnapshot.seeds.slice(0, 6).map((seed) => (
                <div key={seed.rosterId} className="flex items-center justify-between gap-2 text-[11px] text-white/65">
                  <span className="truncate">#{seed.seed} {seed.displayName}</span>
                  <span>{seed.record} · {seed.pointsFor.toFixed(1)} PF</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-white/45">Seeds will populate once teams are available.</p>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-black/15 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Schedule health</p>
          {blockingIssues.length ? (
            <ul className="mt-2 space-y-1 text-[11px] text-rose-200">
              {blockingIssues.slice(0, 3).map((issue) => (
                <li key={`${issue.code}-${issue.week ?? 'league'}-${issue.rosterId ?? ''}`}>{issue.message}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-emerald-200">
              All teams are covered once per scheduled week. Standings remain at 0-0 until finalized scores arrive.
            </p>
          )}
          {schedule.standings.length ? (
            <p className="mt-2 text-[11px] text-white/45">
              Leader: {schedule.standings[0]?.displayName} ({recordLabel(schedule.standings[0]!)})
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
