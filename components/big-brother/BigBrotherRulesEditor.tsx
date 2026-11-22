'use client'

/**
 * The commissioner's editor for a Big Brother league's rules: the weekly schedule, the competition and vote rules,
 * and (before the first eviction) the jury and finale.
 *
 * Until this, a commissioner could not change any of them after creating the league: the PATCH route existed but no
 * screen called it, and the panel told commissioners their rules were "the ones chosen when the league was created".
 *
 * It offers only settings the game reads, with the values the server accepts (lib/big-brother/configPatch.ts), and
 * sends only what changed. The server checks everything again — the "Format rules" lock, each value, and the
 * jury/finale cut-off — and its message is shown as it comes.
 */

import { useEffect, useMemo, useState } from 'react'
import { BB_DEADLINES } from '@/lib/big-brother/schedule'
import { AUTO_NOMINATION_FALLBACK_OPTIONS, CHALLENGE_MODES, FINALE_FORMATS, JURY_START_MODES, PUBLIC_VOTE_TOTALS_OPTIONS } from '@/lib/big-brother/constants'
import { EVICTION_TIE_BREAK_MODES, VETO_COMPETITORS_MAX, VETO_COMPETITORS_MIN } from '@/lib/big-brother/configPatch'

type Config = Record<string, unknown>

const DAYS = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }, { value: 7, label: 'Sunday' },
]

const LABELS: Record<string, Record<string, string>> = {
  // The same wording the league-creation wizard uses for these choices (LeagueFormatOptionsPanel.tsx).
  evictionTieBreakMode: { season_points: 'Season points (lowest evicted)', hoh_vote: 'HOH breaks the tie', random: 'Random (seeded)', commissioner: 'Commissioner decides' },
  challengeMode: { deterministic_score: 'Fantasy score (highest weekly score wins)', hybrid: 'Hybrid (score + challenge factor)', ai_theme: 'Themed challenges' },
  publicVoteTotalsVisibility: { exact: 'Show exact vote counts', evicted_only: 'Show only who was evicted' },
  autoNominationFallback: { lowest_season_points: 'Lowest season points', random: 'Random', commissioner: 'Commissioner picks' },
  finaleFormat: { final_2: 'Final 2', final_3: 'Final 3' },
  juryStartMode: { after_eliminations: 'After a number of evictions', when_remaining: 'When this many houseguests remain', fixed_week: 'From a fixed week' },
}

const JURY_NUMBER: Record<string, { field: string; label: string }> = {
  after_eliminations: { field: 'juryStartAfterEliminations', label: 'Evictions before the jury starts' },
  when_remaining: { field: 'juryStartWhenRemaining', label: 'Houseguests remaining' },
  fixed_week: { field: 'juryStartWeek', label: 'Week the jury starts' },
}

const inputCls = 'min-h-11 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white'

export function BigBrotherRulesEditor({ leagueId }: { leagueId: string }) {
  const [saved, setSaved] = useState<Config | null>(null)
  const [draft, setDraft] = useState<Config>({})
  const [juryOpen, setJuryOpen] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/config`, { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { config?: Config | null; juryAndFinaleOpen?: boolean; error?: string }
        if (!live) return
        if (!res.ok || !data.config) return setLoadError(data.error ?? 'Could not load the league rules.')
        setSaved(data.config)
        setDraft(data.config)
        setJuryOpen(data.juryAndFinaleOpen !== false)
      })
      .catch(() => live && setLoadError('Could not load the league rules.'))
    return () => {
      live = false
    }
  }, [leagueId])

  const changes = useMemo(() => {
    if (!saved) return {}
    return Object.fromEntries(Object.entries(draft).filter(([k, v]) => saved[k] !== v))
  }, [draft, saved])
  const changed = Object.keys(changes).length > 0

  const set = (field: string, value: unknown) => {
    setMessage(null)
    setDraft((d) => ({ ...d, [field]: value }))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const data = (await res.json().catch(() => ({}))) as { config?: Config; error?: string; message?: string }
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.error ?? data.message ?? `Could not save (${res.status}).` })
        return
      }
      const next = { ...saved, ...changes }
      setSaved(next)
      setDraft(next)
      setMessage({ tone: 'ok', text: 'Saved. The league log records the change.' })
    } catch {
      setMessage({ tone: 'error', text: 'Could not save. Check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <p className="text-sm text-rose-200" data-testid="bb-rules-editor-error">{loadError}</p>
  if (!saved) return <p className="text-sm text-white/50">Loading league rules…</p>

  const select = (field: string, options: readonly string[], disabled = false) => (
    <select
      aria-label={field}
      data-testid={`bb-rule-${field}`}
      value={String(draft[field] ?? '')}
      disabled={disabled}
      onChange={(e) => set(field, e.target.value)}
      className={`${inputCls} disabled:opacity-50`}
    >
      {options.map((o) => (
        <option key={o} value={o}>{LABELS[field]?.[o] ?? o}</option>
      ))}
    </select>
  )
  const toggle = (field: string, label: string) => (
    <label className="flex min-h-11 items-center gap-2 text-sm text-white/80">
      <input type="checkbox" data-testid={`bb-rule-${field}`} checked={draft[field] === true} onChange={(e) => set(field, e.target.checked)} />
      {label}
    </label>
  )
  const juryMode = String(draft.juryStartMode ?? 'after_eliminations')
  const juryNumber = JURY_NUMBER[juryMode] ?? JURY_NUMBER.after_eliminations

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="bb-rules-editor">
      <h3 className="text-sm font-medium text-white/90">League rules</h3>
      <p className="mt-1 text-xs text-white/50">
        Changes apply from the next competition, vote or deadline. If you locked “Format rules” for the season, unlock it first.
      </p>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/50">Weekly schedule (UTC)</h4>
      <div className="mt-2 grid gap-2">
        {BB_DEADLINES.map((d) => {
          const dayField = `${d.prefix}DayOfWeek`
          const timeField = `${d.prefix}TimeUtc`
          return (
            <div key={d.key} className="flex flex-wrap items-center gap-2">
              <span className="w-full text-sm text-white/80 sm:w-56">{d.label}</span>
              <select
                aria-label={`${d.label} day`}
                data-testid={`bb-rule-${dayField}`}
                value={draft[dayField] == null ? '' : String(draft[dayField])}
                onChange={(e) => set(dayField, e.target.value === '' ? null : Number(e.target.value))}
                className={inputCls}
              >
                <option value="">Not scheduled</option>
                {DAYS.map((day) => (
                  <option key={day.value} value={day.value}>{day.label}</option>
                ))}
              </select>
              <input
                type="time"
                aria-label={`${d.label} time (UTC)`}
                data-testid={`bb-rule-${timeField}`}
                value={typeof draft[timeField] === 'string' ? String(draft[timeField]) : ''}
                onChange={(e) => set(timeField, e.target.value === '' ? null : e.target.value)}
                className={inputCls}
              />
            </div>
          )
        })}
      </div>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/50">Competitions and votes</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-white/80">HOH and veto challenge{select('challengeMode', CHALLENGE_MODES)}</label>
        <label className="grid gap-1 text-sm text-white/80">Eviction tie-break{select('evictionTieBreakMode', EVICTION_TIE_BREAK_MODES)}</label>
        <label className="grid gap-1 text-sm text-white/80">If the HOH misses the nomination deadline{select('autoNominationFallback', AUTO_NOMINATION_FALLBACK_OPTIONS)}</label>
        <label className="grid gap-1 text-sm text-white/80">Vote results{select('publicVoteTotalsVisibility', PUBLIC_VOTE_TOTALS_OPTIONS)}</label>
        <label className="grid gap-1 text-sm text-white/80">
          Veto competitors (HOH and both nominees always play)
          <input
            type="number"
            min={VETO_COMPETITORS_MIN}
            max={VETO_COMPETITORS_MAX}
            data-testid="bb-rule-vetoCompetitorCount"
            value={String(draft.vetoCompetitorCount ?? '')}
            onChange={(e) => set('vetoCompetitorCount', e.target.value === '' ? null : Number(e.target.value))}
            className={inputCls}
          />
        </label>
        <div className="grid gap-1">
          {toggle('consecutiveHohAllowed', 'The HOH can win HOH again the next week')}
          {toggle('hohVotesOnlyInTie', 'The HOH votes only to break a tie')}
        </div>
      </div>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/50">Jury and finale</h4>
      {!juryOpen && (
        <p className="mt-1 text-xs text-amber-200/80" data-testid="bb-rules-jury-closed">
          Someone has been evicted, so the jury and finale are set for this season.
        </p>
      )}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-white/80">Finale{select('finaleFormat', FINALE_FORMATS, !juryOpen)}</label>
        <label className="grid gap-1 text-sm text-white/80">Jury starts{select('juryStartMode', JURY_START_MODES, !juryOpen)}</label>
        <label className="grid gap-1 text-sm text-white/80">
          {juryNumber.label}
          <input
            type="number"
            min={1}
            disabled={!juryOpen}
            data-testid="bb-rule-jury-number"
            value={draft[juryNumber.field] == null ? '' : String(draft[juryNumber.field])}
            onChange={(e) => set(juryNumber.field, e.target.value === '' ? null : Number(e.target.value))}
            className={`${inputCls} disabled:opacity-50`}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="bb-rules-save"
          onClick={save}
          disabled={!changed || saving}
          className="min-h-11 rounded-xl bg-cyan-500/20 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save rules'}
        </button>
        {message && (
          <p role="status" data-testid="bb-rules-message" className={`text-sm ${message.tone === 'ok' ? 'text-emerald-200' : 'text-rose-200'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}
