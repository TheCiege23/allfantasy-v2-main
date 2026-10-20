'use client'
/**
 * "Plan a tournament", step 3: scoring and roster, drawn with the shared label plates.
 *
 * The commissioner picks one scoring and one roster for every league and every stage. Options
 * with no live preset behind them render disabled (see `lib/tournament/divisions/rules.ts`).
 * Under the plates, the detail panel shows the chosen option's value table or category chips, or
 * — for Custom — editable inputs seeded from Half PPR / Points. Save waits while an input is invalid.
 * `locked` freezes both pickers — the planner passes it while saving and once the plan exists;
 * after that the choice is read-only everywhere and the server refuses edits once registration
 * opens (`updateDivisionsBlueprint`).
 */
import { useState } from 'react'
import { RosterLabel, RulesLabelPicker, ScoringDetailPanel, ScoringLabel } from '@/components/league-labels'
import { plainRulesLabel } from '@/lib/league-labels/catalog'
import { rosterChoices, scoringChoices, type DivisionsRules } from '@/lib/tournament/divisions/rules'

const panel = 'rounded-2xl border border-white/10 bg-[#0b0d14] p-4 sm:p-5'
const heading = 'text-xs font-bold uppercase tracking-[0.2em] text-slate-400'

export function TournamentRulesStep({ sport, rules, onRules, locked = false, lockedReason = 'Locked once the tournament is saved.', onBack, onSave, saving, error }: {
  sport: 'NFL' | 'NBA'
  rules: DivisionsRules
  onRules: (next: DivisionsRules) => void
  locked?: boolean
  lockedReason?: string
  onBack: () => void
  onSave: () => void
  saving?: boolean
  error?: string
}) {
  const { scoringId, rosterId } = rules
  const [customValid, setCustomValid] = useState(true)
  const pickScoring = (id: string) => {
    const next = id as DivisionsRules['scoringId']
    setCustomValid(true)
    // Overrides belong to Custom only; Custom starts from its seed (no overrides yet).
    onRules(next === 'custom' ? { scoringId: next, rosterId, overrides: {} } : { scoringId: next, rosterId })
  }
  const blocked = scoringId === 'custom' && !customValid
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <section className={panel}>
          <RulesLabelPicker kind="scoring" legend="Scoring" options={scoringChoices(sport)}
            value={scoringId} onChange={pickScoring} locked={locked} lockedReason={lockedReason} />
          <ScoringDetailPanel key={`${sport}-${scoringId}`} sport={sport} scoringId={scoringId} overrides={rules.overrides} locked={locked}
            onOverrides={overrides => onRules({ ...rules, overrides })} onValidity={setCustomValid} />
        </section>
        <section className={panel}>
          <RulesLabelPicker kind="roster" legend="Roster" options={rosterChoices(sport)}
            value={rosterId} onChange={id => onRules({ ...rules, rosterId: id as DivisionsRules['rosterId'] })} locked={locked} lockedReason={lockedReason} />
        </section>
        <p className="text-sm text-slate-400">Greyed-out options are not scored by the app yet, so a tournament cannot use them.</p>
      </div>
      <aside className="space-y-4">
        <section className={panel} aria-labelledby="rules-label-heading">
          <h2 id="rules-label-heading" className={heading}>Your tournament label</h2>
          <p className="mt-2 text-sm text-slate-300">The same rules apply in every league and every stage, and they lock when registration opens. This is how they show on the hub and the invite page.</p>
          <div className="mt-3 space-y-3 text-white">
            <ScoringLabel id={scoringId} size="lg" />
            <RosterLabel id={rosterId} size="md" />
            <p className="text-sm font-semibold text-[#ffd98a]" data-testid="rules-plain-label">{plainRulesLabel(scoringId, rosterId)}</p>
          </div>
        </section>
        {blocked && <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-950/20 p-3 text-sm text-amber-200">Fix the custom values marked in red to continue.</p>}
        {error && <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-950/20 p-3 text-sm text-amber-200">{error}</p>}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <button type="button" onClick={onBack} disabled={saving} className="min-h-12 rounded-xl border border-white/15 bg-[#0e1018] font-bold text-white disabled:opacity-40">Back</button>
          <button type="button" onClick={onSave} disabled={saving || blocked} className="min-h-12 rounded-xl bg-[#e8b84a] font-bold text-[#1a1204] disabled:opacity-40">{saving ? 'Saving…' : 'Save and continue'}</button>
        </div>
      </aside>
    </div>
  )
}
