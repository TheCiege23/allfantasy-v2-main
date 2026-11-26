'use client'

/**
 * Commissioner settings for the college side of an NFL C2C or devy league
 * (/api/leagues/[leagueId]/college-side): devy college scoring and lineup, college season length,
 * college playoff size. Read-only for anyone who cannot edit.
 */
import { useEffect, useState } from 'react'
import type { CollegeSideSettings } from '@/lib/c2c/campusSeason/collegeSideSettings'

const SEATS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'] as const
const seatLabel = (s: string) => (s === 'SUPER_FLEX' ? 'Superflex' : s === 'FLEX' ? 'Flex' : s)

type State = { settings: CollegeSideSettings; seasonCreated: boolean; teamCount: number }

export function CollegeSideSettingsForm({ state, canEdit, onSave }: { state: State; canEdit: boolean; onSave: (patch: Record<string, unknown>) => Promise<string | null> }) {
  const { settings, seasonCreated, teamCount } = state
  const [weeks, setWeeks] = useState(String(settings.regularSeasonWeeks))
  const [playoff, setPlayoff] = useState(String(settings.playoffTeams))
  const [slots, setSlots] = useState<Record<string, number>>(settings.lineupSlots ?? {})
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setWeeks(String(settings.regularSeasonWeeks))
    setPlayoff(String(settings.playoffTeams))
    setSlots(settings.lineupSlots ?? {})
  }, [settings])

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true)
    setMessage(null)
    const error = await onSave(patch)
    setSaving(false)
    setMessage(error ?? 'Saved.')
  }
  const devy = settings.kind === 'devy'
  const shapeLocked = !canEdit || seasonCreated
  const starters = Object.values(slots).reduce((a, b) => a + b, 0)

  return (
    <section aria-label="College side" className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
      <h4 className="text-[12px] font-bold uppercase tracking-wide text-cyan-200/80">College side</h4>

      {devy && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={settings.collegeScoring}
              disabled={!canEdit || saving}
              onChange={(e) => void save({ collegeScoring: e.target.checked })}
            />
            College players score
          </label>
          <p className="text-[11px] text-white/50">
            {settings.collegeScoring
              ? 'Each team starts a college lineup that plays its own college schedule and standings.'
              : 'College players are stashed for the future and do not score.'}
          </p>
          {settings.collegeScoring && (
            <fieldset className="rounded-lg border border-white/10 p-3" disabled={!canEdit || saving}>
              <legend className="px-1 text-sm text-white/80">College lineup ({starters} starters)</legend>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {SEATS.map((seat) => (
                  <label key={seat} className="block text-[12px] text-white/70">
                    {seatLabel(seat)}
                    <input
                      type="number"
                      min={0}
                      max={4}
                      aria-label={`${seatLabel(seat)} starters`}
                      value={slots[seat] ?? 0}
                      onChange={(e) => setSlots({ ...slots, [seat]: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })}
                      className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-white"
                    />
                  </label>
                ))}
              </div>
              {canEdit && (
                <button type="button" className="mt-3 rounded bg-cyan-500/20 px-3 py-1.5 text-sm text-cyan-100" onClick={() => void save({ lineupSlots: slots })}>
                  Save college lineup
                </button>
              )}
            </fieldset>
          )}
        </div>
      )}

      {(!devy || settings.collegeScoring) && (
        <fieldset className="grid grid-cols-2 gap-3 rounded-lg border border-white/10 p-3" disabled={shapeLocked || saving}>
          <legend className="px-1 text-sm text-white/80">College season</legend>
          <label className="block text-[12px] text-white/70">
            Regular-season weeks
            <input type="number" min={1} max={14} aria-label="College regular-season weeks" value={weeks} onChange={(e) => setWeeks(e.target.value)} className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-white" />
          </label>
          <label className="block text-[12px] text-white/70">
            Playoff teams
            <select aria-label="College playoff teams" value={playoff} onChange={(e) => setPlayoff(e.target.value)} className="mt-1 w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-white">
              <option value="0">No college playoff</option>
              {Array.from({ length: Math.max(0, Math.min(32, teamCount) - 1) }, (_, i) => i + 2).map((n) => (
                <option key={n} value={String(n)}>{n} teams</option>
              ))}
            </select>
          </label>
          {!shapeLocked && (
            <button type="button" className="col-span-2 rounded bg-cyan-500/20 px-3 py-1.5 text-sm text-cyan-100" onClick={() => void save({ regularSeasonWeeks: Number(weeks), playoffTeams: Number(playoff) })}>
              Save college season
            </button>
          )}
          {seasonCreated && <p className="col-span-2 text-[11px] text-white/50">This year’s college schedule is set. Changes here apply from next season.</p>}
        </fieldset>
      )}

      {message && <p role="status" className="text-[12px] text-white/70">{message}</p>}
    </section>
  )
}

export function CollegeSideSettingsPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [state, setState] = useState<State | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/college-side`
  useEffect(() => {
    const controller = new AbortController()
    void fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: State | null) => { if (!controller.signal.aborted && d?.settings) setState(d) })
      .catch(() => undefined)
    return () => controller.abort()
  }, [url])
  if (!state) return null
  const onSave = async (patch: Record<string, unknown>): Promise<string | null> => {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    const d = (await res.json().catch(() => null)) as (State & { error?: string }) | null
    if (!res.ok) return d?.error ?? 'Could not save.'
    if (d?.settings) setState(d)
    return null
  }
  return <CollegeSideSettingsForm state={state} canEdit={canEdit} onSave={onSave} />
}
