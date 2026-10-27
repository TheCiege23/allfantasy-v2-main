'use client'

import { useEffect, useState } from 'react'
import type { PirateRules } from '@/lib/pirate/rules'

const integerIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max

export function PirateRulesEditor({ leagueId, onSaved }: { leagueId: string; onSaved?: (rules: PirateRules) => void }) {
  const [rules, setRules] = useState<PirateRules | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/pirate`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load Pirate rules')
        if (!body.rules) throw new Error('Pirate rules are unavailable')
        setRules(body.rules as PirateRules)
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

  async function save() {
    if (!rules || !valid || saving) return
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
      setRules(body.rules as PirateRules)
      onSaved?.(body.rules as PirateRules)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save Pirate rules')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-amber-300/25 bg-[#081625] p-4 text-white sm:p-6" data-testid="pirate-rules-editor">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-amber-300">Pirate League</p>
        <h2 className="mt-1 text-2xl font-black">The league’s code</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">Choose how many players each manager can lock and how long each claim stays open.</p>
      </div>
      {loading ? <p role="status" className="text-sm text-slate-300">Loading Pirate rules…</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-rose-400/35 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p> : null}
      {rules ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <RuleNumber label="Protected players" value={rules.protectionLimit} min={1} max={10} onChange={(protectionLimit) => { setRules({ ...rules, protectionLimit }); setSaved(false) }} />
            <RuleNumber label="Winner selection hours" value={rules.selectionHours} min={1} max={72} onChange={(selectionHours) => { setRules({ ...rules, selectionHours }); setSaved(false) }} />
            <RuleNumber label="Claim response hours" value={rules.claimHours} min={1} max={72} onChange={(claimHours) => { setRules({ ...rules, claimHours }); setSaved(false) }} />
            <RuleNumber label="Roster drop grace hours" value={rules.overflowGraceHours} min={0} max={72} onChange={(overflowGraceHours) => { setRules({ ...rules, overflowGraceHours }); setSaved(false) }} />
          </div>
          <label className="flex min-h-[52px] items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold">
            <input type="checkbox" checked={rules.playoffClaims} onChange={(event) => { setRules({ ...rules, playoffClaims: event.target.checked }); setSaved(false) }} className="size-5 accent-amber-300" />
            Allow steals in playoffs
          </label>
          <p className="text-xs leading-5 text-slate-400">Set the playoff start week in the Playoffs section of League Settings.</p>
          {!valid ? <p role="alert" className="text-sm text-amber-200">Enter whole numbers within the ranges shown above.</p> : null}
          <button type="button" onClick={save} disabled={!valid || saving} className="min-h-[48px] w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-[#071522] disabled:opacity-45" data-testid="pirate-rules-save">
            {saving ? 'Saving…' : 'Save Pirate rules'}
          </button>
          {saved ? <p role="status" className="text-sm font-semibold text-emerald-300">Pirate rules saved.</p> : null}
        </>
      ) : null}
    </section>
  )
}

function RuleNumber({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="text-sm font-semibold text-slate-200">
      {label}
      <input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 min-h-[48px] w-full rounded-xl border border-white/20 bg-[#061421] px-3 text-base text-white" />
      <span className="mt-1 block text-xs font-normal text-slate-400">{min}–{max}</span>
    </label>
  )
}
