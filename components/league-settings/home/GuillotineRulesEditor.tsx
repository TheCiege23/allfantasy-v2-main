'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Lock } from 'lucide-react'
import {
  ENDGAME_OPTIONS,
  GUILLOTINE_PAID_RULE_FIELDS,
  RELEASE_OPTIONS,
  RULE_LIMITS,
  TIEBREAK_OPTIONS,
  type GuillotineRuleField,
  type GuillotineRules,
} from '@/lib/guillotine/guillotineRules'
import { MAX_CHOPS_PER_WEEK } from '@/lib/guillotine/chopSchedule'
import { FAAB_ON_CHOP_OPTIONS, type FaabOnChop } from '@/lib/guillotine/faabOnChop'
import { SettingsSubPageFooter } from './LeagueSettingsHome'

type RulesView = {
  rules: GuillotineRules
  startWeek: number
  seasonWeeks: number
  endgameLocked: boolean
  canEditPaid: boolean
  aiRecapAvailable: boolean
}

const inputClass = 'w-full min-w-0 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white disabled:opacity-50'

/**
 * Guillotine "League rules": every rule the chop engine reads that is not already on the First chop
 * week or Chop rules pages (lib/guillotine/guillotineRules.ts). One explicit Save, a visible "Saved",
 * and AF Commissioner fields shown with a lock — not hidden — so a commissioner can see what the
 * plan adds. The server decides who may save which field with the same check that fills
 * `canEditPaid`, so the page and the save can never disagree about the plan.
 */
export function GuillotineRulesEditor({ leagueId, onSaved }: { leagueId: string; onSaved?: (rules: GuillotineRules) => void }) {
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`
  const [view, setView] = useState<RulesView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rules, setRules] = useState<GuillotineRules | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${url}?view=rules`, { credentials: 'include', cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setLoadError(typeof d?.error === 'string' ? d.error : 'Could not load the league rules.')
          return
        }
        setView(d as RulesView)
        setRules((d as RulesView).rules)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not reach the server. Try again.')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (loadError) return <p role="alert" className="text-[13px] text-red-300">{loadError}</p>
  if (!view || !rules) return <p className="text-[13px] text-white/50">Loading league rules…</p>

  const paidLocked = (field: GuillotineRuleField) => GUILLOTINE_PAID_RULE_FIELDS.has(field) && !view.canEditPaid
  const dirty = JSON.stringify(rules) !== JSON.stringify(view.rules)
  const update = (next: Partial<GuillotineRules>) => {
    setOk(false)
    setError(null)
    setRules({ ...rules, ...next })
  }
  const moveTiebreak = (index: number, delta: -1 | 1) => {
    const order = [...rules.tiebreakerOrder]
    const target = index + delta
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target]!, order[index]!]
    update({ tiebreakerOrder: order })
  }

  const submit = async () => {
    // Send only what changed, so a field the viewer cannot edit is never part of the request.
    const changed = (Object.keys(rules) as GuillotineRuleField[]).filter(
      (k) => JSON.stringify(rules[k]) !== JSON.stringify(view.rules[k]),
    )
    const patch = Object.fromEntries(changed.map((k) => [k, rules[k]]))
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: patch }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof d?.error === 'string' ? d.error : 'Could not save the league rules.')
        return
      }
      const next = d as RulesView
      setView(next)
      setRules(next.rules)
      setOk(true)
      onSaved?.(next.rules)
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const endgameHelp = ENDGAME_OPTIONS.find((o) => o.value === rules.endgame)?.help
  const releaseHelp = RELEASE_OPTIONS.find((o) => o.value === rules.rosterReleaseTiming)?.help
  const faabHelp = `${FAAB_ON_CHOP_OPTIONS.find((o) => o.value === rules.faabOnChop)?.help ?? ''} Only matters if your league uses FAAB bidding.`

  return (
    <div className="space-y-5" data-testid="guillotine-rules">
      <p className="text-[12px] text-white/55">
        Set these once. AllFantasy applies them every week — chops, releases and the finale run without you.
      </p>
      {!view.canEditPaid && (
        <p className="rounded-lg border border-violet-400/30 bg-violet-950/30 px-3 py-2 text-[12px] text-violet-200">
          Rules marked <Lock className="inline h-3 w-3" aria-hidden /> are part of AF Commissioner.{' '}
          <a href="/upgrade?plan=commissioner" className="font-semibold underline">Upgrade</a>
        </p>
      )}

      <Field label="How the season ends" help={view.endgameLocked ? 'Fixed for this season — the first chop has happened.' : endgameHelp}>
        <select
          className={inputClass}
          value={rules.endgame}
          disabled={view.endgameLocked}
          onChange={(e) => update({ endgame: e.target.value as GuillotineRules['endgame'] })}
          data-testid="guillotine-rules-endgame"
        >
          {ENDGAME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field label="When chopped players are released" help={releaseHelp}>
        <select
          className={inputClass}
          value={rules.rosterReleaseTiming}
          onChange={(e) => update({ rosterReleaseTiming: e.target.value as GuillotineRules['rosterReleaseTiming'] })}
        >
          {RELEASE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field label="A chopped team's unspent FAAB" help={faabHelp} paid={paidLocked('faabOnChop')}>
        <select
          className={inputClass}
          value={rules.faabOnChop}
          onChange={(e) => update({ faabOnChop: e.target.value as FaabOnChop })}
          data-testid="guillotine-rules-faab-on-chop"
        >
          {FAAB_ON_CHOP_OPTIONS.map((o) => {
            // Without AF Commissioner only "keep" is selectable — and the current value, so the page still shows it.
            const locked = paidLocked('faabOnChop') && o.value !== 'keep' && o.value !== rules.faabOnChop
            return (
              <option key={o.value} value={o.value} disabled={locked}>
                {o.label}{paidLocked('faabOnChop') && o.value !== 'keep' ? ' · AF Commissioner' : ''}
              </option>
            )
          })}
        </select>
      </Field>

      <section className="space-y-1.5">
        <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
          <span>
            <span className="block text-[13px] font-semibold text-white">Chimmy writes the weekly recap</span>
            <span className="block text-[12px] text-white/50">
              {view.aiRecapAvailable
                ? 'After every chop, Chimmy posts a story-style recap to league chat. Off = the standard recap.'
                : 'Included with AF Pro or AF Commissioner. Without one, the standard recap posts after every chop.'}
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={rules.aiRecapAuto && view.aiRecapAvailable}
            disabled={!view.aiRecapAvailable}
            onChange={(e) => update({ aiRecapAuto: e.target.checked })}
            data-testid="guillotine-rules-ai-recap"
          />
        </label>
      </section>

      <Field label="Teams chopped each week" paid={paidLocked('teamsPerChop')} help="The base number. Special weeks and steps live under Chop rules.">
        <select
          className={inputClass}
          value={rules.teamsPerChop}
          disabled={paidLocked('teamsPerChop')}
          onChange={(e) => update({ teamsPerChop: Number(e.target.value) })}
          data-testid="guillotine-rules-teams-per-chop"
        >
          {Array.from({ length: MAX_CHOPS_PER_WEEK }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n === 1 ? '1 team' : `${n} teams`}</option>
          ))}
        </select>
      </Field>

      <Field label="Last chop week" paid={paidLocked('eliminationEndWeek')} help={`Chops run from week ${view.startWeek} through this week.`}>
        <select
          className={inputClass}
          value={rules.eliminationEndWeek}
          disabled={paidLocked('eliminationEndWeek')}
          onChange={(e) => update({ eliminationEndWeek: Number(e.target.value) })}
        >
          {Array.from({ length: Math.max(1, view.seasonWeeks - view.startWeek + 1) }, (_, i) => view.startWeek + i).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
      </Field>

      <Field
        label="Wait for stat corrections"
        paid={paidLocked('statCorrectionHours')}
        help="Hours after a week's last game before the chop is final. Longer is fairer; shorter is faster."
      >
        <input
          type="number"
          inputMode="numeric"
          min={RULE_LIMITS.statCorrectionHours.min}
          max={RULE_LIMITS.statCorrectionHours.max}
          className={inputClass}
          value={rules.statCorrectionHours}
          disabled={paidLocked('statCorrectionHours')}
          onChange={(e) => update({ statCorrectionHours: Math.round(Number(e.target.value) || 0) })}
        />
      </Field>

      <Field
        label="Danger zone margin (points)"
        paid={paidLocked('dangerMarginPoints')}
        help="Teams within this many points of the chop line are flagged as in danger."
      >
        <input
          type="number"
          inputMode="numeric"
          min={RULE_LIMITS.dangerMarginPoints.min}
          max={RULE_LIMITS.dangerMarginPoints.max}
          className={inputClass}
          value={rules.dangerMarginPoints}
          disabled={paidLocked('dangerMarginPoints')}
          onChange={(e) => update({ dangerMarginPoints: Math.round(Number(e.target.value) || 0) })}
        />
      </Field>

      <Field label="Tiebreakers, in order" paid={paidLocked('tiebreakerOrder')} help="When the lowest scores tie, the first rule that separates them decides.">
        <ol className="space-y-1.5">
          {rules.tiebreakerOrder.map((step, i) => (
            <li key={step} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[13px] text-white/85">
              <span className="w-5 shrink-0 text-white/40">{i + 1}.</span>
              <span className="min-w-0 flex-1">{TIEBREAK_OPTIONS.find((o) => o.value === step)?.label ?? step}</span>
              <button
                type="button"
                aria-label="Move up"
                className="rounded p-1 text-white/60 hover:bg-white/10 disabled:opacity-30"
                disabled={paidLocked('tiebreakerOrder') || i === 0}
                onClick={() => moveTiebreak(i, -1)}
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Move down"
                className="rounded p-1 text-white/60 hover:bg-white/10 disabled:opacity-30"
                disabled={paidLocked('tiebreakerOrder') || i === rules.tiebreakerOrder.length - 1}
                onClick={() => moveTiebreak(i, 1)}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      </Field>

      {error && <p role="alert" className="text-[12px] text-red-300">{error}</p>}
      {ok && <p role="status" className="text-[12px] text-emerald-300" data-testid="guillotine-rules-saved">✓ Saved. These rules apply from the next chop.</p>}
      <SettingsSubPageFooter>
        <button type="button" className="lsh-primary" disabled={!dirty || saving} onClick={() => void submit()} data-testid="lsh-save">
          {saving ? 'Saving…' : 'Save league rules'}
        </button>
      </SettingsSubPageFooter>
    </div>
  )
}

function Field({ label, help, paid, children }: { label: string; help?: string; paid?: boolean; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
        {label}
        {paid ? <Lock className="h-3.5 w-3.5 text-violet-300" aria-label="AF Commissioner" /> : null}
      </h3>
      {children}
      {help ? <p className="text-[12px] text-white/50">{help}</p> : null}
    </section>
  )
}
