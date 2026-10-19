'use client'

import { useState } from 'react'
import { DEFAULT_ADVANCED, MAX_CHOPS_PER_WEEK, MAX_FAAB_AMOUNT, describeSchedule, isDefault, type FaabAfterChop, type GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import { SettingsSubPageFooter } from './LeagueSettingsHome'

export type SaveChopRules = (a: GuillotineAdvanced) => Promise<{ ok: true; value: GuillotineAdvanced; lines: string[] } | { ok: false; error: string }>

/** PATCH /api/leagues/:id/guillotine/summary `{ advanced }` — commissioner-only, AF Commissioner to change. */
export function patchChopRules(leagueId: string): SaveChopRules {
  return async (advanced) => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advanced }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; advanced?: GuillotineAdvanced; scheduleLines?: string[] }
      if (!res.ok || !data.advanced) return { ok: false, error: data.error || 'Could not save the chop rules.' }
      return { ok: true, value: data.advanced, lines: data.scheduleLines ?? [] }
    } catch {
      return { ok: false, error: 'Could not reach the server. Try again.' }
    }
  }
}

const CHOPS = Array.from({ length: MAX_CHOPS_PER_WEEK }, (_, i) => i + 1)
const inputClass = 'w-full min-w-0 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white'

/**
 * Guillotine chop rules (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §4.5, AF Commissioner): how many teams
 * go each week, the weeks that differ (holiday no-chop, double chop) and top-scorer immunity.
 * Works mid-season — only weeks not yet chopped are affected.
 */
export function GuillotineChopRulesEditor({
  initial,
  baseChops,
  startWeek,
  endWeek,
  hasAfCommissionerSub,
  save,
  onSaved,
}: {
  initial: GuillotineAdvanced | null
  baseChops: number
  startWeek: number
  endWeek: number
  hasAfCommissionerSub: boolean
  save: SaveChopRules
  onSaved?: (a: GuillotineAdvanced, lines: string[]) => void
}) {
  const [rules, setRules] = useState<GuillotineAdvanced>({ ...DEFAULT_ADVANCED, ...(initial ?? {}) })
  const [saved, setSaved] = useState(JSON.stringify(initial ?? DEFAULT_ADVANCED))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const update = (next: GuillotineAdvanced) => {
    setOk(false)
    setError(null)
    setRules(next)
  }
  const overrides = Object.entries(rules.overrides).map(([w, n]) => ({ week: Number(w), chops: n })).sort((a, b) => a.week - b.week)
  const dirty = JSON.stringify(rules) !== saved
  const locked = !hasAfCommissionerSub && !isDefault(rules)
  const weeks = Array.from({ length: Math.max(1, endWeek - startWeek + 1) }, (_, i) => startWeek + i)

  const submit = async () => {
    setSaving(true)
    setError(null)
    const r = await save(rules)
    setSaving(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setRules(r.value)
    setSaved(JSON.stringify(r.value))
    setOk(true)
    onSaved?.(r.value, r.lines)
  }

  return (
    <div className="space-y-5" data-testid="guillotine-chop-rules">
      {!hasAfCommissionerSub && (
        <p className="rounded-lg border border-violet-400/30 bg-violet-950/30 px-3 py-2 text-[12px] text-violet-200">
          Chop schedules, special weeks, immunity and FAAB after a chop are part of AF Commissioner.{' '}
          <a href="/upgrade?plan=commissioner" className="font-semibold underline">Upgrade</a>
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-white">Teams chopped each week</h3>
        <p className="text-[12px] text-white/50">From week {startWeek}: {baseChops === 1 ? '1 team' : `${baseChops} teams`} a week. Add a step to change it later in the season.</p>
        {rules.steps.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <label className="text-[11px] text-white/50">From week
              <select className={inputClass} value={s.fromWeek} onChange={(e) => update({ ...rules, steps: rules.steps.map((x, j) => (j === i ? { ...x, fromWeek: Number(e.target.value) } : x)) })}>
                {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-white/50">Teams a week
              <select className={inputClass} value={s.chops} onChange={(e) => update({ ...rules, steps: rules.steps.map((x, j) => (j === i ? { ...x, chops: Number(e.target.value) } : x)) })}>
                {CHOPS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-[12px] text-white/70" onClick={() => update({ ...rules, steps: rules.steps.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white/85"
          onClick={() => {
            const used = new Set(rules.steps.map((s) => s.fromWeek))
            const week = weeks.find((w) => w > startWeek && !used.has(w)) ?? weeks[weeks.length - 1]
            update({ ...rules, steps: [...rules.steps, { fromWeek: week, chops: Math.min(MAX_CHOPS_PER_WEEK, baseChops + 1) }] })
          }}>
          Add a step
        </button>
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-white">Special weeks</h3>
        <p className="text-[12px] text-white/50">A holiday with no chop, or a double chop. These win over the steps above.</p>
        {overrides.map((o) => (
          <div key={o.week} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <label className="text-[11px] text-white/50">Week
              <select className={inputClass} value={o.week} onChange={(e) => {
                const next = { ...rules.overrides }
                delete next[o.week]
                next[Number(e.target.value)] = o.chops
                update({ ...rules, overrides: next })
              }}>
                {weeks.filter((w) => w === o.week || !(w in rules.overrides)).map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-white/50">Chop
              <select className={inputClass} value={o.chops} onChange={(e) => update({ ...rules, overrides: { ...rules.overrides, [o.week]: Number(e.target.value) } })}>
                <option value={0}>No chop</option>
                {CHOPS.map((n) => <option key={n} value={n}>{n === 1 ? '1 team' : `${n} teams`}</option>)}
              </select>
            </label>
            <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-[12px] text-white/70" onClick={() => {
              const next = { ...rules.overrides }
              delete next[o.week]
              update({ ...rules, overrides: next })
            }}>Remove</button>
          </div>
        ))}
        <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white/85"
          onClick={() => {
            const week = weeks.find((w) => !(w in rules.overrides))
            if (week != null) update({ ...rules, overrides: { ...rules.overrides, [week]: 0 } })
          }}>
          Add a special week
        </button>
      </section>

      <section className="space-y-2">
        <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
          <span>
            <span className="block text-[13px] font-semibold text-white">Top-scorer immunity</span>
            <span className="block text-[12px] text-white/50">Each week’s top scorer cannot be chopped the next week. Skipped in a week it would leave too few teams to chop.</span>
          </span>
          <input type="checkbox" className="h-5 w-5" checked={rules.immunity === 'top_scorer'} onChange={(e) => update({ ...rules, immunity: e.target.checked ? 'top_scorer' : 'off' })} />
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-white">FAAB after a chop</h3>
        <p className="text-[12px] text-white/50">What every surviving team’s FAAB becomes once a team is chopped, so the released players are worth bidding on. Only matters with FAAB waivers.</p>
        <div className="grid grid-cols-[1fr_1fr] items-end gap-2">
          <label className="text-[11px] text-white/50">Survivors’ FAAB
            <select className={inputClass} value={rules.faab.mode} data-testid="guillotine-faab-mode"
              onChange={(e) => {
                const mode = e.target.value as FaabAfterChop['mode']
                update({ ...rules, faab: { mode, amount: mode === 'unchanged' ? 0 : Math.max(mode === 'add' ? 1 : 0, rules.faab.amount || 100) } })
              }}>
              <option value="unchanged">Stays the same</option>
              <option value="add">Topped up by</option>
              <option value="set">Resets to</option>
            </select>
          </label>
          {rules.faab.mode !== 'unchanged' && (
            <label className="text-[11px] text-white/50">Amount ($)
              <input type="number" inputMode="numeric" min={rules.faab.mode === 'add' ? 1 : 0} max={MAX_FAAB_AMOUNT} className={inputClass} value={rules.faab.amount} data-testid="guillotine-faab-amount"
                onChange={(e) => update({ ...rules, faab: { ...rules.faab, amount: Math.round(Number(e.target.value)) } })} />
            </label>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-white/50">Your season</h3>
        <ul className="mt-1 space-y-0.5 text-[13px] text-white/85">
          {describeSchedule(rules, baseChops, startWeek).map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>

      {error && <p role="alert" className="text-[12px] text-red-300">{error}</p>}
      {ok && <p role="status" className="text-[12px] text-emerald-300">Saved.</p>}
      <SettingsSubPageFooter>
        <button type="button" className="lsh-primary" disabled={!dirty || saving || locked} onClick={() => void submit()} data-testid="lsh-save">
          {saving ? 'Saving…' : 'Save chop rules'}
        </button>
      </SettingsSubPageFooter>
    </div>
  )
}
