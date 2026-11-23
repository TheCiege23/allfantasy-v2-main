'use client'

import { useEffect, useState } from 'react'
import type { PirateRules } from '@/lib/pirate/rules'
import { useSaveScopeParticipant } from './SettingsSaveScope'
import '@/components/pirate/pirate-identity.css'

const integerIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max

export function PirateRulesEditor({ leagueId, onSaved }: { leagueId: string; onSaved?: (rules: PirateRules) => void }) {
  const [rules, setRules] = useState<PirateRules | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [baseline, setBaseline] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setRules(null)
    setBaseline('')
    setError('')
    setSaved(false)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/pirate?view=rules`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load Pirate rules')
        if (!body.rules) throw new Error('Pirate rules are unavailable')
        setRules(body.rules as PirateRules)
        setBaseline(JSON.stringify(body.rules))
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load Pirate rules')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [leagueId])

  const valid = Boolean(rules &&
    integerIn(rules.protectionLimit, 1, 10) &&
    integerIn(rules.selectionHours, 1, 72) &&
    integerIn(rules.claimHours, 1, 72) &&
    integerIn(rules.overflowGraceHours, 0, 72))

  async function save(): Promise<boolean> {
    if (!rules || !valid || saving) return false
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/pirate`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not save Pirate rules')
      if (!body.rules) throw new Error('The server did not confirm your Pirate rules. Try saving again.')
      setRules(body.rules as PirateRules)
      setBaseline(JSON.stringify(body.rules))
      onSaved?.(body.rules as PirateRules)
      setSaved(true)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save Pirate rules')
      return false
    } finally {
      setSaving(false)
    }
  }

  const inSaveScope = useSaveScopeParticipant(Boolean(rules && baseline && JSON.stringify(rules) !== baseline), save)

  return (
    <section className="pr pr-card mx-auto max-w-2xl space-y-5 rounded-2xl p-4 sm:p-6" data-testid="pirate-rules-editor">
      <div>
        <p className="pr-gold text-xs font-bold">Pirate League</p>
        {!inSaveScope ? <h2 className="pr-text mt-1 text-2xl font-black">Pirate rules</h2> : null}
        <p className="pr-muted mt-2 text-sm leading-6">Choose how many players each manager can lock and how long each claim stays open.</p>
      </div>
      {loading ? <p role="status" className="pr-muted text-sm">Loading Pirate rules…</p> : null}
      {error ? <p role="alert" className="pr-alert rounded-lg p-3 text-sm">{error}</p> : null}
      {rules ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <RuleNumber label="Protected players" description="Maximum players each manager can protect from a steal." value={rules.protectionLimit} min={1} max={10} onChange={(protectionLimit) => { setRules({ ...rules, protectionLimit }); setSaved(false) }} />
            <RuleNumber label="Winner selection (hours)" description="Time the winner has to choose an unprotected player." value={rules.selectionHours} min={1} max={72} onChange={(selectionHours) => { setRules({ ...rules, selectionHours }); setSaved(false) }} />
            <RuleNumber label="Claim response (hours)" description="Time to accept or counter a claim before the player moves automatically." value={rules.claimHours} min={1} max={72} onChange={(claimHours) => { setRules({ ...rules, claimHours }); setSaved(false) }} />
            <RuleNumber label="Roster drop deadline (hours)" description="Time to clear an extra roster spot after receiving a stolen player." value={rules.overflowGraceHours} min={0} max={72} onChange={(overflowGraceHours) => { setRules({ ...rules, overflowGraceHours }); setSaved(false) }} />
          </div>
          <label className="pr-well pr-text flex min-h-[52px] items-center gap-3 rounded-xl px-4 text-sm font-semibold">
            <input type="checkbox" checked={rules.playoffClaims} onChange={(event) => { setRules({ ...rules, playoffClaims: event.target.checked }); setSaved(false) }} className="size-5" style={{ accentColor: 'var(--pr-gold)' }} />
            Allow steals in playoffs
          </label>
          <p className="pr-muted text-xs leading-5">Set the playoff start week in Playoff settings.</p>
          {!valid ? <p role="alert" className="pr-warn text-sm">Enter whole numbers within the ranges shown above.</p> : null}
          {!inSaveScope ? <button type="button" onClick={() => void save()} disabled={!valid || saving} className="pr-btn-gold min-h-[48px] w-full rounded-xl px-4 py-3 text-sm font-black disabled:opacity-45" data-testid="pirate-rules-save">
            {saving ? 'Saving…' : 'Save Pirate rules'}
          </button> : null}
          {saved ? <p role="status" className="pr-good text-sm font-semibold">Pirate rules saved.</p> : null}
        </>
      ) : null}
    </section>
  )
}

function RuleNumber({ label, description, value, min, max, onChange }: { label: string; description: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="pr-text text-sm font-semibold">
      {label}
      <input aria-label={label} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="pr-field mt-2 min-h-[48px] w-full rounded-xl px-3 text-base" />
      <span className="pr-muted mt-1 block text-xs font-normal leading-5">{description} Allowed: {min}–{max}.</span>
    </label>
  )
}
