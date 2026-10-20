'use client'

import { useId, useState } from 'react'
import { customScoringStartingPoint, getScoringLabel, LABEL_DEFAULTS, type LabelSport } from '@/lib/league-labels/catalog'
import { customScoringFields, customScoringValues, parseCustomOverrides, type CustomOverrides } from '@/lib/league-labels/customScoring'

/** "+0.04", "-2", and an em dash for a stat the option does not score. */
export function formatScoringValue(v: number): string {
  if (v === 0) return '—'
  return v > 0 ? `+${v}` : String(v)
}

const KDST_NOTE = 'K and DST use the AF standard tables in every NFL preset.'

/**
 * The detail panel under the scoring plates (handoff `scoring-roster-labels`, step 3): the value
 * table for a points option, the category chips for a category option, or editable inputs for
 * Custom, seeded from Half PPR (NFL) / Points (NBA).
 *
 * For Custom it reports every valid edit through `onOverrides` (only the values that differ from
 * the starting point) and `onValidity(false)` while any input is not a usable number, so the
 * caller can hold the save. The server re-validates with the same `parseCustomOverrides`.
 * Remount it (`key`) when the sport or option changes so the drafts start fresh.
 */
export function ScoringDetailPanel({
  sport,
  scoringId,
  overrides,
  onOverrides,
  onValidity,
  locked = false,
}: {
  sport: LabelSport
  scoringId: string
  overrides?: CustomOverrides
  onOverrides?: (next: CustomOverrides) => void
  onValidity?: (valid: boolean) => void
  locked?: boolean
}) {
  const label = getScoringLabel(scoringId)
  const idBase = useId()
  const fields = customScoringFields(sport)
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(customScoringValues(sport, overrides)).map(([k, v]) => [k, String(v)])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  if (!label) return null

  const base = getScoringLabel(customScoringStartingPoint(sport))
  const isDefault = LABEL_DEFAULTS[sport].scoring === label.id
  const note = label.type === 'custom'
    ? `Starts from ${base?.name ?? 'the default'}. Change any value — the label reads CUSTOM everywhere it appears.`
    : (sport === 'NFL' ? KDST_NOTE : 'Weekly totals use every game a player plays that week.') + (isDefault ? ' This is the default.' : '')

  function commit(next: Record<string, string>) {
    const nextErrors: Record<string, string> = {}
    const numbers: Record<string, number> = {}
    for (const f of fields) {
      const text = (next[f.key] ?? '').trim()
      const n = text === '' ? Number.NaN : Number(text)
      if (!Number.isFinite(n)) { nextErrors[f.key] = 'Enter a number.'; continue }
      const one = parseCustomOverrides(sport, { [f.key]: n })
      if (!one.ok) nextErrors[f.key] = one.issues[0]!.replace(`${f.label}: `, '').replace(/^./, (c) => c.toUpperCase())
      else numbers[f.key] = n
    }
    setErrors(nextErrors)
    const valid = Object.keys(nextErrors).length === 0
    onValidity?.(valid)
    if (!valid) return
    const parsed = parseCustomOverrides(sport, numbers)
    if (parsed.ok) onOverrides?.(parsed.overrides)
  }

  function change(key: string, text: string) {
    const next = { ...drafts, [key]: text }
    setDrafts(next)
    commit(next)
  }

  function reset() {
    const next = Object.fromEntries(fields.map((f) => [f.key, String(f.seed)]))
    setDrafts(next)
    commit(next)
  }

  return (
    <section
      className="mt-4 grid gap-5 rounded-2xl border border-white/10 bg-[#0e1018] p-4 sm:p-5 md:grid-cols-[minmax(0,300px)_1fr]"
      aria-labelledby={`${idBase}-name`}
      data-testid="scoring-detail-panel"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span id={`${idBase}-name`} className="text-xs font-bold uppercase tracking-[0.15em] text-[#ffd98a]">{label.name}</span>
        <span className="text-xl font-extrabold text-white">{label.type === 'custom' ? 'Commissioner sets every value' : label.oneLine}</span>
        <span className="text-sm text-slate-300">Best for: {label.bestFor}</span>
        <span className="text-xs text-slate-400" data-testid="scoring-detail-note">{note}</span>
      </div>

      {label.type === 'points' ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm" aria-label={`${label.name} point values`}>
          {label.values.map((v) => (
            <div key={v.key} className="contents">
              <dt className="border-b border-white/5 py-2 text-slate-200">{v.label}</dt>
              <dd className={`border-b border-white/5 py-2 text-right font-mono font-bold ${v.value < 0 ? 'text-[#ff9a8a]' : 'text-[#e8eaf2]'}`}>{formatScoringValue(v.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {label.type === 'categories' ? (
        <div>
          <ul className="flex flex-wrap gap-1.5" aria-label={`${label.name} categories`}>
            {label.categories.map((c) => (
              <li key={c} className="inline-flex h-8 items-center rounded-lg bg-[#151926] px-3 text-xs font-extrabold text-white">{c}</li>
            ))}
          </ul>
          <p className="mt-2.5 text-xs text-slate-400">Each week you play one opponent across every category. Win more categories than you lose to win the week.</p>
        </div>
      ) : null}

      {label.type === 'custom' ? (
        <fieldset className="min-w-0" disabled={locked}>
          <legend className="sr-only">Custom point values</legend>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4">
            {fields.map((f) => {
              const inputId = `${idBase}-${f.key}`
              const err = errors[f.key]
              return (
                <div key={f.key} className="contents">
                  <label htmlFor={inputId} className="border-b border-white/5 py-2 text-sm text-slate-200">{f.label}</label>
                  <div className="border-b border-white/5 py-1 text-right">
                    <input
                      id={inputId}
                      type="number"
                      inputMode="decimal"
                      step={f.step}
                      min={f.min}
                      max={f.max}
                      value={drafts[f.key] ?? ''}
                      onChange={(e) => change(f.key, e.target.value)}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `${inputId}-error` : undefined}
                      className={`h-11 w-24 rounded-lg border bg-[#07080d] px-2 text-right font-mono text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-60 ${err ? 'border-[#ff9a8a]' : 'border-white/15'}`}
                      data-testid={`custom-scoring-input-${f.key}`}
                    />
                    {err ? <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-[#ff9a8a]">{err}</p> : null}
                  </div>
                </div>
              )
            })}
          </div>
          <button
            type="button"
            onClick={reset}
            className="mt-3 min-h-11 rounded-xl border border-white/15 bg-black/20 px-4 text-sm font-semibold text-white hover:bg-white/[0.05] disabled:opacity-40"
          >
            Start again from {base?.name ?? 'the default'}
          </button>
        </fieldset>
      ) : null}
    </section>
  )
}
