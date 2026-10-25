'use client'

import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type PlayoffConfig = {
  playoff_team_count?: number
  playoff_weeks?: number
  playoff_start_week?: number | null
  first_round_byes?: number
  bracket_type?: string
  matchup_length?: number
  total_rounds?: number | null
  consolation_bracket_enabled?: boolean
  third_place_game_enabled?: boolean
  toilet_bowl_enabled?: boolean
  championship_length?: number
  consolation_plays_for?: string
  seeding_rules?: string
  tiebreaker_rules?: string[]
  bye_rules?: string | null
  reseed_behavior?: string
  standings_tiebreakers?: string[]
  sport?: string
  variant?: string | null
}

type EditablePlayoffForm = {
  playoffTeamCount: number
  playoffWeeks: number
  playoffStartWeek: number | null
  firstRoundByes: number
  seedingRules: string
  tiebreakerRules: string[]
  standingsTiebreakers: string[]
  byeRules: string | null
  reseedBehavior: string
  matchupLength: number
  totalRounds: number | null
  consolationBracketEnabled: boolean
  thirdPlaceGameEnabled: boolean
  toiletBowlEnabled: boolean
  championshipLength: number
  consolationPlaysFor: string
}

const SEEDING_RULES = [
  { value: 'standard_standings', label: 'Standard standings' },
  { value: 'division_winners_first', label: 'Division winners first' },
  { value: 'points_for_then_record', label: 'Points-for then record' },
] as const

const RESEED_BEHAVIORS = [
  { value: 'fixed_bracket', label: 'Fixed bracket' },
  { value: 'reseed_after_round', label: 'Reseed each round' },
] as const

const BYE_RULES = [
  { value: '', label: 'No byes' },
  { value: 'top_seed_bye', label: 'Top seed bye' },
  { value: 'top_two_seeds_bye', label: 'Top two seeds bye' },
] as const

/** What "Draft pick" does (lib/playoff-runtime/consolationPlaysFor.ts). Cash and Nothing leave the draft order alone. */
const CONSOLATION_PLAYS_FOR_HELP =
  "Draft pick: next season, the consolation winner picks first among non-playoff teams; in a toilet bowl, last place (the final's loser) picks first. Everyone else follows in reverse standings."

const CONSOLATION_PLAYS_FOR = [
  { value: 'none', label: 'Nothing' },
  { value: 'pick', label: 'Draft pick' },
  { value: 'cash', label: 'Cash' },
] as const

const TIEBREAKER_OPTIONS = [
  { value: 'points_for', label: 'Points for' },
  { value: 'head_to_head', label: 'Head-to-head' },
  { value: 'points_against', label: 'Points against' },
  { value: 'division_record', label: 'Division record' },
  { value: 'conference_record', label: 'Conference record' },
  { value: 'total_wins', label: 'Total wins' },
] as const

function toEditableForm(config: PlayoffConfig): EditablePlayoffForm {
  return {
    playoffTeamCount: Math.max(0, Number(config.playoff_team_count ?? 0)),
    playoffWeeks: Math.max(0, Number(config.playoff_weeks ?? 0)),
    playoffStartWeek:
      config.playoff_start_week === null || config.playoff_start_week === undefined
        ? null
        : Number(config.playoff_start_week),
    firstRoundByes: Math.max(0, Number(config.first_round_byes ?? 0)),
    seedingRules: config.seeding_rules ?? 'standard_standings',
    tiebreakerRules: Array.isArray(config.tiebreaker_rules) ? config.tiebreaker_rules : [],
    standingsTiebreakers: Array.isArray(config.standings_tiebreakers)
      ? config.standings_tiebreakers
      : [],
    byeRules: config.bye_rules ?? null,
    reseedBehavior: config.reseed_behavior ?? 'fixed_bracket',
    matchupLength: Math.max(1, Number(config.matchup_length ?? 1)),
    totalRounds:
      config.total_rounds === null || config.total_rounds === undefined
        ? null
        : Math.max(0, Number(config.total_rounds)),
    consolationBracketEnabled: Boolean(config.consolation_bracket_enabled),
    thirdPlaceGameEnabled: Boolean(config.third_place_game_enabled),
    toiletBowlEnabled: Boolean(config.toilet_bowl_enabled),
    championshipLength: Math.max(0, Number(config.championship_length ?? 1)),
    consolationPlaysFor: config.consolation_plays_for ?? 'none',
  }
}

export default function PlayoffSettingsPanel({ leagueId }: { leagueId: string }) {
  const { data: config, loading, error, reload } = useLeagueSectionData<PlayoffConfig>(
    leagueId,
    'playoff/config',
  )
  const [canEdit, setCanEdit] = useState(false)
  const [checkingEditPermission, setCheckingEditPermission] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EditablePlayoffForm | null>(null)
  // Saving "plays for" opts an existing league's draft order in (lib/playoff-runtime/consolationPlaysFor.ts),
  // so the whole-form save sends it only once the commissioner has touched it.
  const [playsForTouched, setPlaysForTouched] = useState(false)

  useEffect(() => {
    if (!leagueId) return
    let active = true
    setCheckingEditPermission(true)
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/playoffs?type=settings`, {
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
    setPlaysForTouched(false)
  }, [config])

  async function saveOverrides() {
    if (!form || saving) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/playoffs`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playoffTeamCount: form.playoffTeamCount,
            playoffWeeks: form.playoffWeeks,
            playoffStartWeek: form.playoffStartWeek,
            firstRoundByes: form.firstRoundByes,
            seedingRules: form.seedingRules,
            tiebreakerRules: form.tiebreakerRules,
            standingsTiebreakers: form.standingsTiebreakers,
            byeRules: form.byeRules,
            reseedBehavior: form.reseedBehavior,
            matchupLength: form.matchupLength,
            totalRounds: form.totalRounds,
            consolationBracketEnabled: form.consolationBracketEnabled,
            thirdPlaceGameEnabled: form.thirdPlaceGameEnabled,
            toiletBowlEnabled: form.toiletBowlEnabled,
            championshipLength: form.championshipLength,
            ...(playsForTouched ? { consolationPlaysFor: form.consolationPlaysFor } : {}),
          }),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error ?? 'Failed to save playoff overrides')
        return
      }
      setEditing(false)
      setForm(toEditableForm(json as PlayoffConfig))
      setPlaysForTouched(false)
      toast.success('Playoff overrides saved')
      await reload()
    } finally {
      setSaving(false)
    }
  }

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Playoff Settings</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to view playoff settings.</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Playoff Settings</h3>
        <p className="mt-2 text-xs text-white/65">Loading…</p>
      </section>
    )
  }

  if (error || !config) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Playoff Settings</h3>
        <p className="mt-2 text-xs text-red-400/90">{error ?? 'Failed to load playoff config.'}</p>
      </section>
    )
  }

  if (!form) return null

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Playoff Settings</h3>
        {canEdit && (
          <button
            type="button"
            data-testid="playoff-settings-edit-toggle"
            disabled={checkingEditPermission || saving}
            onClick={() => {
              if (editing) {
                setForm(toEditableForm(config))
                setPlaysForTouched(false)
                setEditing(false)
              } else {
                setEditing(true)
              }
            }}
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {editing ? 'Cancel' : 'Edit overrides'}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-white/65">
        Sport-aware defaults from league creation. Commissioner overrides can be applied via league settings.
      </p>
      {checkingEditPermission && (
        <p className="mt-1 text-[11px] text-white/45">Checking commissioner access...</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={`/league/${encodeURIComponent(leagueId)}?tab=Standings%20%2F%20Playoffs`}
          className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
        >
          Open standings / playoffs
        </a>
        <a
          href={`/brackets/leagues/${encodeURIComponent(leagueId)}`}
          className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
        >
          Open bracket
        </a>
      </div>

      {editing ? (
        <div className="mt-4 space-y-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-white/70">
              Playoff team count
              <input
                aria-label="Playoff team count"
                type="number"
                min={0}
                value={form.playoffTeamCount}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, playoffTeamCount: Math.max(0, Number(e.target.value) || 0) }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Playoff weeks
              <input
                aria-label="Playoff weeks"
                type="number"
                min={0}
                value={form.playoffWeeks}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, playoffWeeks: Math.max(0, Number(e.target.value) || 0) }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Playoff start week
              <input
                aria-label="Playoff start week"
                type="number"
                min={1}
                value={form.playoffStartWeek ?? ''}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          playoffStartWeek:
                            e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 1),
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
                placeholder="None"
              />
            </label>
            <label className="text-xs text-white/70">
              First-round byes
              <input
                aria-label="First-round byes"
                type="number"
                min={0}
                value={form.firstRoundByes}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, firstRoundByes: Math.max(0, Number(e.target.value) || 0) }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Seeding rules
              <select
                aria-label="Seeding rules"
                value={form.seedingRules}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, seedingRules: e.target.value } : prev))
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {SEEDING_RULES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Bye rules
              <select
                aria-label="Bye rules"
                value={form.byeRules ?? ''}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, byeRules: e.target.value || null } : prev))
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {BYE_RULES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Reseed behavior
              <select
                aria-label="Reseed behavior"
                value={form.reseedBehavior}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, reseedBehavior: e.target.value } : prev))
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {RESEED_BEHAVIORS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Matchup length
              <input
                aria-label="Matchup length"
                type="number"
                min={1}
                value={form.matchupLength}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, matchupLength: Math.max(1, Number(e.target.value) || 1) }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Total rounds
              <input
                aria-label="Total rounds"
                type="number"
                min={0}
                value={form.totalRounds ?? ''}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          totalRounds: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0),
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
                placeholder="Auto"
              />
            </label>
            <label className="text-xs text-white/70">
              Championship length
              <input
                aria-label="Championship length"
                type="number"
                min={0}
                value={form.championshipLength}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, championshipLength: Math.max(0, Number(e.target.value) || 0) }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Consolation plays for
              <select
                aria-label="Consolation plays for"
                value={form.consolationPlaysFor}
                onChange={(e) => {
                  setPlaysForTouched(true)
                  setForm((prev) => (prev ? { ...prev, consolationPlaysFor: e.target.value } : prev))
                }}
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                {CONSOLATION_PLAYS_FOR.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-white/45">{CONSOLATION_PLAYS_FOR_HELP}</span>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="inline-flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={form.consolationBracketEnabled}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, consolationBracketEnabled: e.target.checked } : prev
                  )
                }
                className="rounded border-white/20"
              />
              Consolation bracket
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={form.thirdPlaceGameEnabled}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, thirdPlaceGameEnabled: e.target.checked } : prev
                  )
                }
                className="rounded border-white/20"
              />
              Third-place game
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={form.toiletBowlEnabled}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, toiletBowlEnabled: e.target.checked } : prev
                  )
                }
                className="rounded border-white/20"
              />
              Toilet bowl
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white/80">Playoff tiebreakers</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TIEBREAKER_OPTIONS.map((option) => {
                const checked = form.tiebreakerRules.includes(option.value)
                return (
                  <label key={`playoff-${option.value}`} className="inline-flex items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setForm((prev) => {
                          if (!prev) return prev
                          const next = e.target.checked
                            ? Array.from(new Set([...prev.tiebreakerRules, option.value]))
                            : prev.tiebreakerRules.filter((rule) => rule !== option.value)
                          return { ...prev, tiebreakerRules: next }
                        })
                      }
                      className="rounded border-white/20"
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white/80">Standings tiebreakers</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TIEBREAKER_OPTIONS.map((option) => {
                const checked = form.standingsTiebreakers.includes(option.value)
                return (
                  <label key={`standings-${option.value}`} className="inline-flex items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setForm((prev) => {
                          if (!prev) return prev
                          const next = e.target.checked
                            ? Array.from(new Set([...prev.standingsTiebreakers, option.value]))
                            : prev.standingsTiebreakers.filter((rule) => rule !== option.value)
                          return { ...prev, standingsTiebreakers: next }
                        })
                      }
                      className="rounded border-white/20"
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="playoff-settings-cancel"
              onClick={() => {
                setForm(toEditableForm(config))
                setPlaysForTouched(false)
                setEditing(false)
              }}
              className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="playoff-settings-save"
              disabled={saving}
              onClick={() => void saveOverrides()}
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save overrides'}
            </button>
          </div>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-white/50">Playoff teams</dt>
          <dd className="text-white/90">{editing ? form.playoffTeamCount : config.playoff_team_count ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Playoff start (week)</dt>
          <dd className="text-white/90">{editing ? form.playoffStartWeek ?? '—' : config.playoff_start_week ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Playoff weeks</dt>
          <dd className="text-white/90">{editing ? form.playoffWeeks : config.playoff_weeks ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">First-round byes</dt>
          <dd className="text-white/90">{editing ? form.firstRoundByes : config.first_round_byes ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Bracket type</dt>
          <dd className="text-white/90">{config.bracket_type ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Matchup length</dt>
          <dd className="text-white/90">{editing ? form.matchupLength : config.matchup_length ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Total rounds</dt>
          <dd className="text-white/90">{editing ? form.totalRounds ?? '—' : config.total_rounds ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Championship length</dt>
          <dd className="text-white/90">{editing ? form.championshipLength : config.championship_length ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Consolation bracket</dt>
          <dd className="text-white/90">{(editing ? form.consolationBracketEnabled : config.consolation_bracket_enabled) ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Consolation plays for</dt>
          <dd className="text-white/90">{editing ? form.consolationPlaysFor : config.consolation_plays_for ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Third-place game</dt>
          <dd className="text-white/90">{(editing ? form.thirdPlaceGameEnabled : config.third_place_game_enabled) ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Toilet bowl</dt>
          <dd className="text-white/90">{(editing ? form.toiletBowlEnabled : config.toilet_bowl_enabled) ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Seeding rules</dt>
          <dd className="text-white/90">{editing ? form.seedingRules : config.seeding_rules ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Reseed behavior</dt>
          <dd className="text-white/90">{editing ? form.reseedBehavior : config.reseed_behavior ?? '—'}</dd>
        </div>
        {Array.isArray(config.tiebreaker_rules) && config.tiebreaker_rules.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-white/50">Playoff tiebreakers</dt>
            <dd className="text-white/90">{(editing ? form.tiebreakerRules : config.tiebreaker_rules).join(' -> ')}</dd>
          </div>
        )}
        {(editing ? form.byeRules : config.bye_rules) && (
          <div>
            <dt className="text-white/50">Bye rules</dt>
            <dd className="text-white/90">{editing ? form.byeRules : config.bye_rules}</dd>
          </div>
        )}
        {(editing ? form.standingsTiebreakers.length > 0 : Array.isArray(config.standings_tiebreakers) && config.standings_tiebreakers.length > 0) && (
          <div className="sm:col-span-2">
            <dt className="text-white/50">Standings tiebreakers</dt>
            <dd className="text-white/90">{(editing ? form.standingsTiebreakers : config.standings_tiebreakers ?? []).join(' -> ')}</dd>
          </div>
        )}
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
