'use client'

import { useEffect, useState } from 'react'
import { SettingsPanelHeading, SettingsSectionLabel, SettingsHelper, controlClass } from './settings-ui'

function readScheduleSlice(snapshot: Record<string, unknown>) {
  const raw = snapshot.scheduleSettings
  return raw && typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/**
 * 🛑 "REGULAR SEASON WEEKS" CHANGED NO SCHEDULE (2026-11-15). It wrote `settings.scheduleSettings.regularSeasonWeeks`,
 * and every schedule generator reads the season's playoff start instead. The regular season is the weeks before the
 * playoffs, so this control now sets the playoff start week (length + 1) — the same value the Playoffs tab sets — and
 * that change reaches the running season and rebuilds its unstarted weeks (lib/schedule-runtime/seasonPlayoffStartSync.ts),
 * asking for confirmation mid-season. The settings copy is kept in step for the readers that still use it.
 */
export function regularSeasonWeeksFrom(playoffStartWeek: number | null | undefined, stored: unknown): number {
  if (typeof playoffStartWeek === 'number' && Number.isInteger(playoffStartWeek) && playoffStartWeek > 1) return playoffStartWeek - 1
  return typeof stored === 'number' && stored > 0 ? stored : 14
}

export function ScheduleSettingsPanel({
  settingsSnapshot,
  playoffStartWeek,
  canEdit,
  debouncedSave,
}: {
  settingsSnapshot: Record<string, unknown>
  /** `League.playoffStartWeek`: the regular season is every week before it. */
  playoffStartWeek?: number | null
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const disabled = !canEdit
  const slice = readScheduleSlice(settingsSnapshot)
  const [regularSeasonWeeks, setRegularSeasonWeeks] = useState<number>(regularSeasonWeeksFrom(playoffStartWeek, slice.regularSeasonWeeks))
  const [byeWeeksNote, setByeWeeksNote] = useState<string>(
    typeof slice.byeWeeksNote === 'string' ? slice.byeWeeksNote : '',
  )

  useEffect(() => {
    const s = readScheduleSlice(settingsSnapshot)
    setRegularSeasonWeeks(regularSeasonWeeksFrom(playoffStartWeek, s.regularSeasonWeeks))
    setByeWeeksNote(typeof s.byeWeeksNote === 'string' ? s.byeWeeksNote : '')
  }, [settingsSnapshot, playoffStartWeek])

  const mergeSchedule = (next: Record<string, unknown>) => {
    const prev = readScheduleSlice(settingsSnapshot)
    return {
      settingsMerge: {
        scheduleSettings: {
          ...prev,
          ...next,
        },
      },
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-8 px-6 py-6 text-[13px] text-white/85" data-testid="settings-schedule-panel">
      <SettingsPanelHeading
        title="Schedule settings"
        subtitle="Regular season shape and notes stored on the league JSON snapshot. Pair with playoff settings for full bracket timing."
      />

      <div>
        <SettingsSectionLabel>Regular season weeks</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={regularSeasonWeeks}
          onChange={(e) => {
            const n = Number(e.target.value)
            setRegularSeasonWeeks(n)
            debouncedSave({ playoffStartWeek: n + 1, ...mergeSchedule({ regularSeasonWeeks: n }) })
          }}
        >
          {/* 4–24: a regular season is capped at 24 weeks (lib/redraft/regularSeasonCap.ts); the server refuses past it. */}
          {Array.from(new Set([...Array.from({ length: 21 }, (_, i) => i + 4), regularSeasonWeeks])).sort((a, b) => a - b).map((n) => (
            <option key={n} value={n}>
              {n} weeks
            </option>
          ))}
        </select>
        <SettingsHelper>
          Playoffs start the week after ({`week ${regularSeasonWeeks + 1}`}). Changing it rebuilds the matchups for weeks that
          have not started; weeks already played stay as they are.
        </SettingsHelper>
      </div>

      <div>
        <SettingsSectionLabel>Bye / schedule notes (optional)</SettingsSectionLabel>
        <textarea
          className={`${controlClass} min-h-[88px] max-w-lg rounded-2xl py-3`}
          disabled={disabled}
          value={byeWeeksNote}
          placeholder="e.g. NFL Week 14 bye handling, custom holiday blackout…"
          onChange={(e) => {
            const v = e.target.value
            setByeWeeksNote(v)
            debouncedSave(mergeSchedule({ byeWeeksNote: v }))
          }}
        />
      </div>
    </div>
  )
}
