'use client'

/**
 * Commissioner UI for the IDP salary cap — now wired to a real endpoint.
 *
 * 🛑 IT USED TO SAVE NOTHING. This component took no props, held 22 useState values and made
 * zero fetch calls; its own footer said "Save wiring to league services can connect these
 * controls when ready". A commissioner could set a $200M cap, a floor, a franchise tag and a
 * draft salary curve, see every control respond, and navigate away having changed nothing.
 * There was no endpoint to save to: `IDPCapConfig` had fifteen readers and no writer anywhere
 * in the repo.
 *
 * ⚠ THREE CONTROLS WERE REMOVED RATHER THAN WIRED, because there is nothing to wire them to:
 *   - "Extension boost %" — no column, and `processExtension` applies no boost.
 *   - "Max contract length" — no column; the per-slot year fields above already bound length.
 *   - "Commissioner override (waive dead money)" — no column, AND `processPlayerCut` computes
 *     dead money unconditionally, so the checkbox could not have taken effect even with one.
 * Leaving them would have preserved exactly the defect this change exists to remove: a control
 * that looks like a setting and is not one.
 */

import { useCallback, useEffect, useState } from 'react'

type DraftMethod = 'auction' | 'snake_scale' | 'hybrid'
type Curve = 'linear' | 'logarithmic' | 'stepped'

type CapConfig = {
  totalCap: number
  isHardCap: boolean
  capFloorEnabled: boolean
  capFloor: number | null
  capRolloverEnabled: boolean
  inSeasonHoldbackEnabled: boolean
  inSeasonHoldbackPct: number
  franchiseTagEnabled: boolean
  franchiseTagValue: number
  draftSalaryMethod: DraftMethod
  snakeScaleHighSalary: number
  snakeScaleLowSalary: number
  snakeScaleCurve: Curve
  auctionDefaultContractYears: number
  snakeTopPickContractYears: number
  snakeMidPickContractYears: number
  snakeLatePickContractYears: number
  isDynastyMode: boolean
  contractsCarryOver: boolean
}

/** Mirrors the Prisma schema defaults, so an unconfigured league shows what it would get. */
const DEFAULTS: CapConfig = {
  totalCap: 200,
  isHardCap: true,
  capFloorEnabled: false,
  capFloor: null,
  capRolloverEnabled: false,
  inSeasonHoldbackEnabled: false,
  inSeasonHoldbackPct: 0.1,
  franchiseTagEnabled: false,
  franchiseTagValue: 20,
  draftSalaryMethod: 'auction',
  snakeScaleHighSalary: 30,
  snakeScaleLowSalary: 1,
  snakeScaleCurve: 'linear',
  auctionDefaultContractYears: 1,
  snakeTopPickContractYears: 3,
  snakeMidPickContractYears: 2,
  snakeLatePickContractYears: 1,
  isDynastyMode: false,
  contractsCarryOver: false,
}

const INPUT = 'rounded border border-white/15 bg-black/40 px-2 py-1 text-white'

export function IDPCapPanel({ leagueId }: { leagueId: string }) {
  const [cfg, setCfg] = useState<CapConfig>(DEFAULTS)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const set = <K extends keyof CapConfig>(k: K, v: CapConfig[K]) =>
    setCfg((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/idp/cap-config`, {
      cache: 'no-store',
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return
        setConfigured(Boolean(d.configured))
        if (d.config) setCfg({ ...DEFAULTS, ...d.config })
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  const save = useCallback(async () => {
    setSaving(true)
    setErrors([])
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/idp/cap-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(cfg),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        /* The server validates; surfacing its reasons beats a generic failure. */
        setErrors(Array.isArray(d?.errors) && d.errors.length ? d.errors : [d?.error ?? 'Could not save'])
        return
      }
      setConfigured(true)
      if (d.config) setCfg({ ...DEFAULTS, ...d.config })
      setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }, [cfg, leagueId])

  if (loading) {
    return (
      <div className="px-4 py-6 text-[13px] text-white/55" data-testid="idp-cap-panel-loading">
        Loading cap settings…
      </div>
    )
  }

  return (
    <div className="space-y-6 px-4 py-6 text-[13px] text-white/85" data-testid="idp-cap-panel">
      {configured === false ? (
        <p
          className="rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-[12px] text-amber-100"
          data-testid="idp-cap-unconfigured"
        >
          This league has no salary cap yet. The values below are the defaults that will apply
          once you save — nothing is in effect until then.
        </p>
      ) : null}

      <section className="space-y-3 rounded-xl border border-white/[0.08] bg-[#0d1117] p-4">
        <h3 className="text-sm font-bold text-white">Cap Configuration</h3>
        <label className="flex items-center justify-between gap-2">
          <span>Total cap ($M)</span>
          <input type="number" value={cfg.totalCap} onChange={(e) => set('totalCap', Number(e.target.value))} className={`w-24 ${INPUT}`} data-testid="idp-cap-total" />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Hard cap</span>
          <input type="checkbox" checked={cfg.isHardCap} onChange={(e) => set('isHardCap', e.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Cap floor</span>
          <input type="checkbox" checked={cfg.capFloorEnabled} onChange={(e) => set('capFloorEnabled', e.target.checked)} />
        </label>
        {cfg.capFloorEnabled ? (
          <label className="flex items-center justify-between gap-2 pl-2">
            <span>Floor (fraction of cap)</span>
            <input type="number" step={0.05} value={cfg.capFloor ?? 0.75} onChange={(e) => set('capFloor', Number(e.target.value))} className={`w-20 ${INPUT}`} />
          </label>
        ) : null}
        <label className="flex items-center justify-between gap-2">
          <span>Cap rollover</span>
          <input type="checkbox" checked={cfg.capRolloverEnabled} onChange={(e) => set('capRolloverEnabled', e.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>In-season holdback</span>
          <input type="checkbox" checked={cfg.inSeasonHoldbackEnabled} onChange={(e) => set('inSeasonHoldbackEnabled', e.target.checked)} />
        </label>
        {cfg.inSeasonHoldbackEnabled ? (
          <label className="flex items-center justify-between gap-2 pl-2">
            <span>Holdback (fraction of cap)</span>
            <input type="number" step={0.05} value={cfg.inSeasonHoldbackPct} onChange={(e) => set('inSeasonHoldbackPct', Number(e.target.value))} className={`w-20 ${INPUT}`} />
          </label>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-white/[0.08] bg-[#0d1117] p-4">
        <h3 className="text-sm font-bold text-white">Draft Salary Method</h3>
        <div className="flex flex-col gap-2">
          {(['auction', 'snake_scale', 'hybrid'] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name="dm" checked={cfg.draftSalaryMethod === m} onChange={() => set('draftSalaryMethod', m)} />
              <span className="capitalize">{m.replace('_', ' ')}</span>
            </label>
          ))}
        </div>
        {cfg.draftSalaryMethod === 'snake_scale' || cfg.draftSalaryMethod === 'hybrid' ? (
          <div className="space-y-2 border-t border-white/[0.06] pt-3">
            <label className="flex justify-between gap-2">
              Top pick salary ($M)
              <input type="number" value={cfg.snakeScaleHighSalary} onChange={(e) => set('snakeScaleHighSalary', Number(e.target.value))} className={`w-20 ${INPUT}`} />
            </label>
            <label className="flex justify-between gap-2">
              Last pick salary ($M)
              <input type="number" value={cfg.snakeScaleLowSalary} onChange={(e) => set('snakeScaleLowSalary', Number(e.target.value))} className={`w-20 ${INPUT}`} />
            </label>
            <p className="text-[11px] text-white/45">Salary curve</p>
            <select value={cfg.snakeScaleCurve} onChange={(e) => set('snakeScaleCurve', e.target.value as Curve)} className={INPUT}>
              <option value="linear">Linear</option>
              <option value="logarithmic">Logarithmic</option>
              <option value="stepped">Stepped</option>
            </select>
          </div>
        ) : null}
        <div className="grid gap-2 border-t border-white/[0.06] pt-3 text-[11px]">
          {([
            ['auctionDefaultContractYears', 'Auction default years'],
            ['snakeTopPickContractYears', 'Snake top 10 years'],
            ['snakeMidPickContractYears', 'Snake mid years'],
            ['snakeLatePickContractYears', 'Snake late years'],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex justify-between">
              {label}
              <input type="number" min={1} max={10} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} className={`w-16 ${INPUT}`} />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-white/[0.08] bg-[#0d1117] p-4">
        <h3 className="text-sm font-bold text-white">Contract Rules</h3>
        <label className="flex items-center justify-between">
          <span>Franchise tag</span>
          <input type="checkbox" checked={cfg.franchiseTagEnabled} onChange={(e) => set('franchiseTagEnabled', e.target.checked)} />
        </label>
        {cfg.franchiseTagEnabled ? (
          <label className="flex justify-between gap-2">
            Tag value ($M)
            <input type="number" value={cfg.franchiseTagValue} onChange={(e) => set('franchiseTagValue', Number(e.target.value))} className={`w-20 ${INPUT}`} />
          </label>
        ) : null}
        <label className="flex items-center justify-between">
          <span>Dynasty mode</span>
          <input type="checkbox" checked={cfg.isDynastyMode} onChange={(e) => set('isDynastyMode', e.target.checked)} />
        </label>
        {cfg.isDynastyMode ? (
          <label className="flex items-center justify-between pl-2">
            <span>Contracts carry over</span>
            <input type="checkbox" checked={cfg.contractsCarryOver} onChange={(e) => set('contractsCarryOver', e.target.checked)} />
          </label>
        ) : null}
      </section>

      <section className="space-y-2 rounded-xl border border-white/[0.08] bg-[#0d1117] p-4">
        <h3 className="text-sm font-bold text-white">Dead Money Rules</h3>
        {/*
          Stated as fixed because they ARE fixed: processPlayerCut computes
          currentYearDead = salary and futureYearsDead = salary * 0.25 * (yearsRemaining - 1),
          with no config column and no branch. The control that used to sit here implied a
          commissioner could waive it; nothing in the engine reads such a flag.
        */}
        <p className="text-[12px] text-white/55">Current year: 100% of remaining salary</p>
        <p className="text-[12px] text-white/55">Each further year: 25% of salary</p>
        <p className="text-[11px] text-white/35">Fixed by the cap engine — not configurable per league.</p>
      </section>

      {errors.length ? (
        <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-950/25 px-3 py-2 text-[12px] text-red-100" data-testid="idp-cap-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg border border-cyan-500/35 bg-cyan-950/30 px-3 py-2 text-[12px] font-semibold text-cyan-100 disabled:opacity-40"
          data-testid="idp-cap-save"
        >
          {saving ? 'Saving…' : configured ? 'Save cap settings' : 'Enable salary cap'}
        </button>
        {savedAt ? <span className="text-[11px] text-emerald-300/80" data-testid="idp-cap-saved">Saved</span> : null}
      </div>
    </div>
  )
}
