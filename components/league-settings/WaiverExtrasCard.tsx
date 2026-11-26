'use client'

/**
 * AF Commissioner waiver extras (lib/waivers/waiverExtras.ts), in League settings → Waivers.
 * Every switch says what it does in one line (owner, 2026-11-26). Without AF Commissioner the card is
 * shown, locked, with an upgrade link — a league can still turn an extra it already has off.
 */
import { useState } from 'react'
import { SettingsSwitch } from '@/components/league-settings/SettingsSwitch'
import { upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import { defaultWaiverExtras, type WaiverExtras } from '@/lib/waivers/waiverExtras'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const hourLabel = (h: number) => (h === 0 || h === 24 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`)

const ROW = 'flex items-start gap-3 border-t border-white/[0.06] pt-3'
const HINT = 'mt-0.5 text-[11px] leading-snug text-white/50'
const INPUT = 'h-9 rounded-lg border border-white/[0.10] bg-black/25 px-2 text-sm text-white disabled:opacity-50'

export function WaiverExtrasCard({
  leagueId,
  initial,
  canEdit,
  hasAfCommissionerSub,
  timezoneLabel,
  onSave,
}: {
  leagueId: string
  initial: WaiverExtras | null
  canEdit: boolean
  hasAfCommissionerSub: boolean
  timezoneLabel: string
  onSave: (extras: WaiverExtras) => void
}) {
  const [x, setX] = useState<WaiverExtras>(initial ?? defaultWaiverExtras())
  const locked = !hasAfCommissionerSub
  const update = (next: WaiverExtras) => {
    setX(next)
    onSave(next)
  }
  /** Turning something on (or changing it) needs the plan; turning it off never does. */
  const can = (turningOn: boolean) => canEdit && (!locked || !turningOn)

  const toggle = (key: string, label: string, hint: string, checked: boolean, set: (v: boolean) => WaiverExtras) => (
    <div className={ROW}>
      <div className="min-w-0 flex-1">
        <p id={`wx-${key}-${leagueId}`} className="text-[13px] font-semibold text-white/90">{label}</p>
        <p className={HINT}>{hint}</p>
      </div>
      <SettingsSwitch
        checked={checked}
        onChange={(v) => update(set(v))}
        disabled={!can(!checked)}
        labelledBy={`wx-${key}-${leagueId}`}
      />
    </div>
  )

  return (
    <div className="space-y-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.03] p-4" data-testid="waiver-extras-card">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[12px] font-bold uppercase tracking-wide text-amber-200">Waiver extras · AF Commissioner</h4>
        {locked ? (
          <a href={upgradePathForPlan('af_commissioner', { feature: 'waiver_extras' })} className="text-[12px] font-bold text-amber-200 underline" data-testid="waiver-extras-upgrade">
            Upgrade
          </a>
        ) : null}
      </div>

      {toggle('cond', 'Conditional claims', 'Managers can group claims: "get A; if I lose A, try B". Once one claim in a group wins, the rest of that group is skipped.', x.conditionalClaims, (v) => ({ ...x, conditionalClaims: v }))}

      {toggle('rebuild', 'Rebuild priority', 'Once the playoffs start, teams out of the playoffs claim before teams still in them. This season only — it never touches next year\'s draft.', x.rebuildPriority, (v) => ({ ...x, rebuildPriority: v }))}

      {toggle('second', 'Second-chance claims', 'A FAAB bid that loses by a dollar or less moves that manager\'s next grouped claim to the front of the run. Needs conditional claims.', x.secondChance.enabled, (v) => ({ ...x, secondChance: { ...x.secondChance, enabled: v }, conditionalClaims: v ? true : x.conditionalClaims }))}
      {x.secondChance.enabled ? (
        <label className="ml-1 flex items-center gap-2 text-[12px] text-white/70">
          Lost by at most $
          <input
            type="number"
            min={0}
            max={100}
            value={x.secondChance.maxGap}
            disabled={!can(true)}
            onChange={(e) => update({ ...x, secondChance: { ...x.secondChance, maxGap: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
            className={`${INPUT} w-20`}
            data-testid="waiver-extras-second-gap"
          />
        </label>
      ) : null}

      {toggle('report', 'Waiver report in league chat', 'After each run, post who got whom and for how much.', x.runReport.enabled, (v) => ({ ...x, runReport: { ...x.runReport, enabled: v } }))}
      {x.runReport.enabled ? (
        <label className="ml-1 flex items-center gap-2 text-[12px] text-white/70">
          <input
            type="checkbox"
            checked={x.runReport.hideLosingBids}
            disabled={!canEdit}
            onChange={(e) => update({ ...x, runReport: { ...x.runReport, hideLosingBids: e.target.checked } })}
          />
          Hide the bids that lost
        </label>
      ) : null}

      <div className={ROW}>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[13px] font-semibold text-white/90">FAAB refills</p>
          <p className={HINT}>Every team gets extra FAAB at the start of a week you choose — for example $25 at the trade deadline.</p>
          {x.faabRefills.map((r, i) => (
            <div key={`${r.week}-${i}`} className="flex items-center gap-2 text-[12px] text-white/80">
              Week {r.week}: +${r.amount}
              <button type="button" disabled={!canEdit} onClick={() => update({ ...x, faabRefills: x.faabRefills.filter((_, j) => j !== i) })} className="text-white/50 underline">
                Remove
              </button>
            </div>
          ))}
          <RefillAdder disabled={!can(true)} onAdd={(r) => update({ ...x, faabRefills: [...x.faabRefills, r].sort((a, b) => a.week - b.week) })} />
        </div>
      </div>

      <div className={ROW}>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[13px] font-semibold text-white/90">Free-agent lock windows</p>
          <p className={HINT}>Hours when nobody can add a free agent, in league time ({timezoneLabel}) — for example game-day afternoons. Waiver claims stay open.</p>
          {x.faLockWindows.map((w, i) => (
            <div key={`${w.day}-${w.startHour}-${i}`} className="flex items-center gap-2 text-[12px] text-white/80">
              {DAYS[w.day]} {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
              <button type="button" disabled={!canEdit} onClick={() => update({ ...x, faLockWindows: x.faLockWindows.filter((_, j) => j !== i) })} className="text-white/50 underline">
                Remove
              </button>
            </div>
          ))}
          <LockWindowAdder disabled={!can(true)} onAdd={(w) => update({ ...x, faLockWindows: [...x.faLockWindows, w] })} />
        </div>
      </div>

      <p className="border-t border-white/[0.06] pt-3 text-[11px] leading-snug text-white/45">
        Managers with AF Pro also get Chimmy bid help: a suggested FAAB range from how this league has actually bid.
      </p>
    </div>
  )
}

function RefillAdder({ disabled, onAdd }: { disabled: boolean; onAdd: (r: { week: number; amount: number }) => void }) {
  const [week, setWeek] = useState(9)
  const [amount, setAmount] = useState(25)
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
      Week
      <input type="number" min={1} max={30} value={week} disabled={disabled} onChange={(e) => setWeek(Number(e.target.value) || 1)} className={`${INPUT} w-16`} aria-label="Refill week" />
      +$
      <input type="number" min={1} max={10000} value={amount} disabled={disabled} onChange={(e) => setAmount(Number(e.target.value) || 1)} className={`${INPUT} w-20`} aria-label="Refill amount" />
      <button type="button" disabled={disabled} onClick={() => onAdd({ week: Math.max(1, Math.min(30, week)), amount: Math.max(1, amount) })} className="rounded-lg bg-white/10 px-3 py-1.5 font-semibold text-white disabled:opacity-40" data-testid="waiver-extras-add-refill">
        Add refill
      </button>
    </div>
  )
}

function LockWindowAdder({ disabled, onAdd }: { disabled: boolean; onAdd: (w: { day: number; startHour: number; endHour: number }) => void }) {
  const [day, setDay] = useState(0)
  const [start, setStart] = useState(13)
  const [end, setEnd] = useState(20)
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
      <select value={day} disabled={disabled} onChange={(e) => setDay(Number(e.target.value))} className={INPUT} aria-label="Lock day">
        {DAYS.map((d, i) => <option key={d} value={i} className="bg-[#0d1117]">{d}</option>)}
      </select>
      <select value={start} disabled={disabled} onChange={(e) => setStart(Number(e.target.value))} className={INPUT} aria-label="Lock from">
        {hours.map((h) => <option key={h} value={h} className="bg-[#0d1117]">{hourLabel(h)}</option>)}
      </select>
      to
      <select value={end} disabled={disabled} onChange={(e) => setEnd(Number(e.target.value))} className={INPUT} aria-label="Lock until">
        {[...hours.slice(1), 24].map((h) => <option key={h} value={h} className="bg-[#0d1117]">{hourLabel(h)}</option>)}
      </select>
      <button type="button" disabled={disabled || end <= start} onClick={() => onAdd({ day, startHour: start, endHour: end })} className="rounded-lg bg-white/10 px-3 py-1.5 font-semibold text-white disabled:opacity-40" data-testid="waiver-extras-add-lock">
        Add window
      </button>
    </div>
  )
}
