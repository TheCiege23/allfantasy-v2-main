'use client'

import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { useEffect, useState } from 'react'
import { MAX_GAMES_PER_WEEK } from '@/lib/schedule-runtime/gamesPerWeek'
import { toast } from 'sonner'

type ScheduleConfig = {
  schedule_unit?: string
  regular_season_length?: number
  games_per_week?: number
  matchup_frequency?: string
  matchup_cadence?: string
  schedule_generation_strategy?: string
  playoff_transition_point?: number | null
  head_to_head_behavior?: string
  lock_time_behavior?: string
  lock_window_behavior?: string
  scoring_period_behavior?: string
  reschedule_handling?: string
  doubleheader_handling?: string
  sport?: string
  variant?: string | null
}

type EditableScheduleForm = {
  scheduleUnit: string
  regularSeasonLength: number
  gamesPerWeek: number
  matchupFrequency: string
  matchupCadence: string
  scheduleGenerationStrategy: string
  playoffTransitionPoint: number | null
  headToHeadBehavior: string
  lockTimeBehavior: string
  lockWindowBehavior: string
  scoringPeriodBehavior: string
  rescheduleHandling: string
  doubleheaderHandling: string
}

const SCHEDULE_UNIT_OPTIONS = ['week', 'round', 'series', 'slate', 'scoring_period'] as const
const MATCHUP_CADENCE_OPTIONS = ['weekly', 'daily', 'round', 'slate'] as const
const HEAD_TO_HEAD_OPTIONS = ['head_to_head', 'points_only', 'both'] as const
/** The rule the lineup lock enforces in every sport (lib/roster-lineup-engine/lineupLockService.ts). */
const LINEUP_LOCK_RULE =
  "Each player locks when his own game starts and stays locked for the rest of the week (the rest of the day in a daily-lineup league). Players whose games have not started can still be swapped. Best ball leagues set their own lineup."
const SCORING_PERIOD_OPTIONS = ['full_period', 'daily_rolling', 'slate_based'] as const
const RESCHEDULE_OPTIONS = ['use_final_time', 'use_original_time', 'exclude'] as const
const DOUBLEHEADER_OPTIONS = ['all_games_count', 'single_score_per_slot'] as const
const STRATEGY_OPTIONS = ['round_robin', 'division_based', 'random'] as const

function toEditableForm(config: ScheduleConfig): EditableScheduleForm {
  return {
    scheduleUnit: config.schedule_unit ?? 'week',
    regularSeasonLength: Number(config.regular_season_length ?? 18),
    gamesPerWeek: Number(config.games_per_week ?? 1),
    matchupFrequency: config.matchup_frequency ?? 'weekly',
    matchupCadence: config.matchup_cadence ?? 'weekly',
    scheduleGenerationStrategy: config.schedule_generation_strategy ?? 'round_robin',
    playoffTransitionPoint:
      config.playoff_transition_point === undefined || config.playoff_transition_point === null
        ? null
        : Number(config.playoff_transition_point),
    headToHeadBehavior: config.head_to_head_behavior ?? 'head_to_head',
    lockTimeBehavior: config.lock_time_behavior ?? 'first_game',
    lockWindowBehavior: config.lock_window_behavior ?? 'first_game_of_week',
    scoringPeriodBehavior: config.scoring_period_behavior ?? 'full_period',
    rescheduleHandling: config.reschedule_handling ?? 'use_final_time',
    doubleheaderHandling: config.doubleheader_handling ?? 'all_games_count',
  }
}

export default function ScheduleSettingsPanel({ leagueId }: { leagueId: string }) {
  const { data: config, loading, error, reload } = useLeagueSectionData<ScheduleConfig>(
    leagueId,
    'schedule/config',
  )
  const [canEdit, setCanEdit] = useState(false)
  const [checkingEditPermission, setCheckingEditPermission] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EditableScheduleForm | null>(null)

  useEffect(() => {
    if (!leagueId) return
    let active = true
    setCheckingEditPermission(true)
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/schedule?type=settings`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (!active) return
        setCanEdit(res.ok)
      })
      .catch(() => {
        if (!active) return
        setCanEdit(false)
      })
      .finally(() => {
        if (!active) return
        setCheckingEditPermission(false)
      })

    return () => {
      active = false
    }
  }, [leagueId])

  useEffect(() => {
    if (!config) return
    setForm(toEditableForm(config))
  }, [config])

  async function saveOverrides() {
    if (!form || saving) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/schedule`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error ?? 'Failed to save schedule overrides')
        return
      }
      toast.success('Schedule overrides saved')
      setEditing(false)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Schedule Settings</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to view schedule settings.</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Schedule Settings</h3>
        <p className="mt-2 text-xs text-white/65">Loading…</p>
      </section>
    )
  }

  if (error || !config) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Schedule Settings</h3>
        <p className="mt-2 text-xs text-red-400/90">{error ?? 'Failed to load schedule config.'}</p>
      </section>
    )
  }

  if (!form) return null

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Schedule Settings</h3>
        {canEdit && (
          <button
            type="button"
            data-testid="schedule-settings-edit-toggle"
            disabled={checkingEditPermission || saving}
            onClick={() => {
              if (editing) {
                setForm(toEditableForm(config))
                setEditing(false)
                return
              }
              setEditing(true)
            }}
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {editing ? 'Cancel' : 'Edit overrides'}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-white/65">
        Sport-aware defaults from league creation. Commissioner overrides persist to league settings and refresh this view.
      </p>
      {checkingEditPermission && (
        <p className="mt-1 text-[11px] text-white/45">Checking commissioner access…</p>
      )}

      {editing ? (
        <div className="mt-4 space-y-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-white/70">
              Schedule unit
              <select
                aria-label="Schedule unit"
                value={form.scheduleUnit}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, scheduleUnit: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {SCHEDULE_UNIT_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Games per team each week
              <select
                aria-label="Games per team each week"
                value={form.gamesPerWeek}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, gamesPerWeek: Number(e.target.value) || 1 } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {Array.from({ length: MAX_GAMES_PER_WEEK }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-white/45">
                Takes effect the next time the schedule is generated or regenerated.
              </span>
            </label>
            <label className="text-xs text-white/70">
              Regular season length
              <input
                aria-label="Regular season length"
                type="number"
                min={1}
                value={form.regularSeasonLength}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, regularSeasonLength: Math.max(1, Number(e.target.value) || 1) }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Matchup frequency
              <select
                aria-label="Matchup frequency"
                value={form.matchupFrequency}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, matchupFrequency: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {MATCHUP_CADENCE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Matchup cadence
              <select
                aria-label="Matchup cadence"
                value={form.matchupCadence}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, matchupCadence: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {MATCHUP_CADENCE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Head-to-head / points behavior
              <select
                aria-label="Head-to-head / points behavior"
                value={form.headToHeadBehavior}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, headToHeadBehavior: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {HEAD_TO_HEAD_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            {/*
              🛑 "Lock time" and "Lock window" were offered here and NOTHING ENFORCED THEM (2026-11-23): the
              lock reads settings.sportConfig.lineupLockType (lib/redraft/lineupLock.ts), never these keys, so a
              league showing "first_game" locked each player at his own kickoff. The owner's rule is per player
              in every sport, so the screen now states the rule instead of offering a choice it ignored.
            */}
            <div className="text-xs text-white/70 sm:col-span-2" data-testid="schedule-lineup-lock-rule">
              Lineup lock
              <p className="mt-1 text-xs text-white/90">{LINEUP_LOCK_RULE}</p>
            </div>
            <label className="text-xs text-white/70">
              Scoring period behavior
              <select
                aria-label="Scoring period behavior"
                value={form.scoringPeriodBehavior}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, scoringPeriodBehavior: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {SCORING_PERIOD_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Reschedule handling
              <select
                aria-label="Reschedule handling"
                value={form.rescheduleHandling}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, rescheduleHandling: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {RESCHEDULE_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Doubleheader / multi-game handling
              <select
                aria-label="Doubleheader / multi-game handling"
                value={form.doubleheaderHandling}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, doubleheaderHandling: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {DOUBLEHEADER_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Playoff transition point
              <input
                aria-label="Playoff transition point"
                type="number"
                min={1}
                value={form.playoffTransitionPoint ?? ''}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          playoffTransitionPoint: e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 1),
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Schedule generation strategy
              <select
                aria-label="Schedule generation strategy"
                value={form.scheduleGenerationStrategy}
                onChange={(e) => setForm((prev) => (prev ? { ...prev, scheduleGenerationStrategy: e.target.value } : prev))}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {STRATEGY_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="schedule-settings-cancel"
              onClick={() => {
                setForm(toEditableForm(config))
                setEditing(false)
              }}
              className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="schedule-settings-save"
              disabled={saving}
              onClick={() => void saveOverrides()}
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save overrides'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <a
          href={`/league/${encodeURIComponent(leagueId)}?tab=Matchups`}
          className="rounded border border-white/15 px-2 py-1 text-white/75 hover:bg-white/10"
        >
          Open matchups / schedule
        </a>
        <a
          href={`/league/${encodeURIComponent(leagueId)}?tab=Standings%20%2F%20Playoffs`}
          className="rounded border border-white/15 px-2 py-1 text-white/75 hover:bg-white/10"
        >
          Open standings / playoffs
        </a>
      </div>

      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-white/50">Schedule unit</dt>
          <dd className="text-white/90">{config.schedule_unit ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Regular season length</dt>
          <dd className="text-white/90">{config.regular_season_length ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Games per team each week</dt>
          <dd className="text-white/90">{config.games_per_week ?? 1}</dd>
        </div>
        <div>
          <dt className="text-white/50">Matchup frequency</dt>
          <dd className="text-white/90">{config.matchup_frequency ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Matchup cadence</dt>
          <dd className="text-white/90">{config.matchup_cadence ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Generation strategy</dt>
          <dd className="text-white/90">{config.schedule_generation_strategy ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Playoff transition (week)</dt>
          <dd className="text-white/90">{config.playoff_transition_point ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Head-to-head / points</dt>
          <dd className="text-white/90">{config.head_to_head_behavior ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Lineup lock</dt>
          <dd className="text-white/90">{LINEUP_LOCK_RULE}</dd>
        </div>
        <div>
          <dt className="text-white/50">Scoring period</dt>
          <dd className="text-white/90">{config.scoring_period_behavior ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Reschedule handling</dt>
          <dd className="text-white/90">{config.reschedule_handling ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Doubleheader / multi-game</dt>
          <dd className="text-white/90">{config.doubleheader_handling ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Schedule preview</dt>
          <dd className="text-white/90">
            {config.matchup_cadence ?? 'weekly'} cadence over {config.regular_season_length ?? '—'}{' '}
            {config.schedule_unit ?? 'periods'}
          </dd>
        </div>
        {config.sport && (
          <div>
            <dt className="text-white/50">Sport / variant</dt>
            <dd className="text-white/90">{config.sport}{config.variant ? ` · ${config.variant}` : ''}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}
