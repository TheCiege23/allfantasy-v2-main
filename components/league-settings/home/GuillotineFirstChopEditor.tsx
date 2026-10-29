'use client'

import { useState } from 'react'
import { SettingsSubPageFooter } from './LeagueSettingsHome'

export type SaveFirstChopWeek = (week: number) => Promise<{ ok: true; week: number } | { ok: false; error: string }>

/** PATCH /api/leagues/:id/guillotine/summary — the commissioner-only handler (rules server-side). */
export function patchFirstChopWeek(leagueId: string): SaveFirstChopWeek {
  return async (week) => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eliminationStartWeek: week }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; config?: { eliminationStartWeek?: number } }
      if (!res.ok) return { ok: false, error: data.error || 'Could not save the first chop week.' }
      return { ok: true, week: data.config?.eliminationStartWeek ?? week }
    } catch {
      return { ok: false, error: 'Could not reach the server. Try again.' }
    }
  }
}

/**
 * The one guillotine setting that had no editor: which week the first chop happens.
 * Explicit save (sticky footer), unlike the autosaving tabs.
 */
export function GuillotineFirstChopEditor({
  initialWeek,
  endWeek,
  locked,
  chopLabel,
  save,
  onSaved,
}: {
  initialWeek: number
  endWeek: number
  locked: boolean
  chopLabel?: string | null
  save: SaveFirstChopWeek
  onSaved?: (week: number) => void
}) {
  const [week, setWeek] = useState(initialWeek)
  const [savedWeek, setSavedWeek] = useState(initialWeek)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const valid = Number.isInteger(week) && week >= 1 && week <= endWeek
  const dirty = week !== savedWeek
  const set = (n: number) => {
    setOk(false)
    setError(null)
    setWeek(n)
  }

  const submit = async () => {
    if (!valid || locked) return
    setSaving(true)
    setError(null)
    const res = await save(week)
    setSaving(false)
    if (res.ok) {
      setSavedWeek(res.week)
      setWeek(res.week)
      setOk(true)
      onSaved?.(res.week)
    } else {
      setError(res.error)
    }
  }

  return (
    <>
      <div className="lsh-field-card">
        <label className="lsh-field-label" htmlFor="lsh-first-chop">
          First chop week
        </label>
        <div className="lsh-stepper">
          <button type="button" aria-label="Earlier week" disabled={locked || week <= 1} onClick={() => set(week - 1)}>
            −
          </button>
          <input
            id="lsh-first-chop"
            type="number"
            inputMode="numeric"
            min={1}
            max={endWeek}
            value={Number.isFinite(week) ? week : ''}
            disabled={locked}
            onChange={(e) => set(Math.trunc(Number(e.target.value)))}
            data-testid="lsh-first-chop-input"
          />
          <button type="button" aria-label="Later week" disabled={locked || week >= endWeek} onClick={() => set(week + 1)}>
            +
          </button>
        </div>
        <p className="lsh-help">
          No team is chopped before this week. Chops run every week from here through week {endWeek}
          {chopLabel ? ` (chop ${chopLabel.replace(/^By /, 'by ')})` : ''}.
        </p>
        {locked ? (
          <p className="lsh-error" role="status">
            The first chop has already happened, so this can no longer change.
          </p>
        ) : null}
        {!valid && !locked ? <p className="lsh-error">Pick a week from 1 to {endWeek}.</p> : null}
        {error ? (
          <p className="lsh-error" role="alert">
            {error}
          </p>
        ) : null}
        {ok && !dirty ? (
          <p className="lsh-ok" role="status">
            Saved — the first chop is week {savedWeek}.
          </p>
        ) : null}
      </div>
      {!locked ? (
        <SettingsSubPageFooter>
          <button type="button" className="lsh-primary" disabled={!valid || !dirty || saving} onClick={submit} data-testid="lsh-save">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </SettingsSubPageFooter>
      ) : null}
    </>
  )
}
