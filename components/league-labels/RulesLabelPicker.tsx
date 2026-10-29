'use client'

import { Lock } from 'lucide-react'
import { RosterLabel } from './RosterLabel'
import { ScoringLabel } from './ScoringLabel'

export type RulesPickerOption = { id: string; disabled?: boolean }

/**
 * A grid of selectable label cards (scoring or roster) — the picker for league creation, league
 * settings and the tournament planner's step 3. Single choice, real radio semantics.
 * `locked` freezes the choice (e.g. once registration opens) and says why.
 */
export function RulesLabelPicker({
  kind,
  options,
  value,
  onChange,
  locked = false,
  lockedReason = 'Locked once registration opens.',
  legend,
}: {
  kind: 'scoring' | 'roster'
  options: readonly RulesPickerOption[]
  value: string | null
  onChange: (id: string) => void
  locked?: boolean
  lockedReason?: string
  legend: string
}) {
  return (
    <fieldset className="min-w-0" disabled={locked} data-testid={`rules-label-picker-${kind}`}>
      <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {legend}
        {locked ? (
          <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-200">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {lockedReason}
          </span>
        ) : null}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={legend}>
        {options.map((opt) => {
          const selected = opt.id === value
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked || opt.disabled}
              onClick={() => onChange(opt.id)}
              className={`min-h-11 min-w-0 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                selected ? 'border-amber-300 bg-amber-300/10' : 'border-white/15 bg-black/20 hover:bg-white/[0.05]'
              }`}
              data-testid={`rules-label-option-${opt.id}`}
            >
              {kind === 'scoring' ? <ScoringLabel id={opt.id} size="md" /> : <RosterLabel id={opt.id} size="md" />}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
