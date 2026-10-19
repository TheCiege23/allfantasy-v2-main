'use client'
/**
 * "Plan a tournament", step 3: scoring and roster, drawn with the shared label plates.
 *
 * The divisions plan has no scoring/roster field yet (see `divisionsRulesLabels`), so both
 * pickers render LOCKED on the sport's defaults rather than offering a choice the save would
 * silently drop. Unlock them — `locked={false}` plus `onChange` into the plan — once the
 * blueprint stores `{ scoringId, rosterId }`.
 */
import { RosterLabel, RulesLabelPicker, ScoringLabel } from '@/components/league-labels'
import { plainRulesLabel, rosterLabelsForSport, scoringLabelsForSport } from '@/lib/league-labels/catalog'
import { divisionsRulesLabels } from '@/lib/tournament/divisions/blueprint'

const panel = 'rounded-2xl border border-white/10 bg-[#0b0d14] p-4 sm:p-5'
const heading = 'text-xs font-bold uppercase tracking-[0.2em] text-slate-400'
const noop = () => {}

export function TournamentRulesStep({ sport, onBack, onSave, saving, error }: {
  sport: 'NFL' | 'NBA'
  onBack: () => void
  onSave: () => void
  saving?: boolean
  error?: string
}) {
  const { scoringId, rosterId } = divisionsRulesLabels(sport)
  const lockedReason = `Every ${sport} divisions tournament plays these defaults for now.`
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <section className={panel}>
          <RulesLabelPicker kind="scoring" legend="Scoring" options={scoringLabelsForSport(sport).map(l => ({ id: l.id }))}
            value={scoringId} onChange={noop} locked lockedReason={lockedReason} />
        </section>
        <section className={panel}>
          <RulesLabelPicker kind="roster" legend="Roster" options={rosterLabelsForSport(sport).map(l => ({ id: l.id }))}
            value={rosterId} onChange={noop} locked lockedReason={lockedReason} />
        </section>
      </div>
      <aside className="space-y-4">
        <section className={panel} aria-labelledby="rules-label-heading">
          <h2 id="rules-label-heading" className={heading}>Your tournament label</h2>
          <p className="mt-2 text-sm text-slate-300">The same rules apply in every league and every stage. This is how they show on the hub and the invite page.</p>
          <div className="mt-3 space-y-3 text-white">
            <ScoringLabel id={scoringId} size="lg" />
            <RosterLabel id={rosterId} size="md" />
            <p className="text-sm font-semibold text-[#ffd98a]" data-testid="rules-plain-label">{plainRulesLabel(scoringId, rosterId)}</p>
          </div>
        </section>
        {error && <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-950/20 p-3 text-sm text-amber-200">{error}</p>}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <button type="button" onClick={onBack} className="min-h-12 rounded-xl border border-white/15 bg-[#0e1018] font-bold text-white">Back</button>
          <button type="button" onClick={onSave} disabled={saving} className="min-h-12 rounded-xl bg-[#e8b84a] font-bold text-[#1a1204] disabled:opacity-40">{saving ? 'Saving…' : 'Save and continue'}</button>
        </div>
      </aside>
    </div>
  )
}
