'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import {
  SettingsPanelHeading,
  SettingsSectionLabel,
  SettingsHelper,
  SettingsToggleRow,
  controlClassSm,
} from './settings-ui'

type SlotKey = 'QB' | 'RB' | 'WR' | 'TE' | 'FLX' | 'SF' | 'K' | 'DEF' | 'BN' | 'IR'

type SlotRow = {
  key: SlotKey
  label: string
  group: 'Starters' | 'Bench' | 'Reserve'
  defaultValue: number
}

const ROSTER_SLOT_ROWS: SlotRow[] = [
  { key: 'QB', label: 'Quarterback', group: 'Starters', defaultValue: 1 },
  { key: 'RB', label: 'Running Back', group: 'Starters', defaultValue: 2 },
  { key: 'WR', label: 'Wide Receiver', group: 'Starters', defaultValue: 2 },
  { key: 'TE', label: 'Tight End', group: 'Starters', defaultValue: 1 },
  { key: 'FLX', label: 'Flex (WR/RB/TE)', group: 'Starters', defaultValue: 1 },
  { key: 'SF', label: 'Superflex (QB/RB/WR/TE)', group: 'Starters', defaultValue: 0 },
  { key: 'K', label: 'Kicker', group: 'Starters', defaultValue: 1 },
  { key: 'DEF', label: 'Defense / Special Teams', group: 'Starters', defaultValue: 1 },
  { key: 'BN', label: 'Bench', group: 'Bench', defaultValue: 6 },
  { key: 'IR', label: 'Injured Reserve', group: 'Reserve', defaultValue: 1 },
]

const SLOT_BADGE_CLASS: Record<SlotKey, string> = {
  QB: 'border-red-400/35 bg-red-500/15 text-red-100',
  RB: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-100',
  WR: 'border-sky-400/35 bg-sky-500/15 text-sky-100',
  TE: 'border-orange-400/35 bg-orange-500/15 text-orange-100',
  FLX: 'border-fuchsia-400/35 bg-fuchsia-500/15 text-fuchsia-100',
  SF: 'border-violet-400/35 bg-violet-500/15 text-violet-100',
  K: 'border-zinc-300/30 bg-zinc-400/12 text-zinc-100',
  DEF: 'border-slate-300/30 bg-slate-400/12 text-slate-100',
  BN: 'border-amber-400/35 bg-amber-500/15 text-amber-100',
  IR: 'border-rose-400/35 bg-rose-500/15 text-rose-100',
}

function readNumber(data: CommissionerSettingsFormData, keys: string[], fallback: number): number {
  const raw = data as unknown as Record<string, unknown>
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return fallback
}

function slotCountsFromData(data: CommissionerSettingsFormData): Record<SlotKey, number> {
  return {
    QB: readNumber(data, ['qbSlots', 'QB'], 1),
    RB: readNumber(data, ['rbSlots', 'RB'], 2),
    WR: readNumber(data, ['wrSlots', 'WR'], 2),
    TE: readNumber(data, ['teSlots', 'TE'], 1),
    FLX: readNumber(data, ['flexSlots', 'flxSlots', 'FLEX', 'FLX'], 1),
    SF: readNumber(data, ['superflexSlots', 'sfSlots', 'SUPERFLEX', 'SF'], 0),
    K: readNumber(data, ['kSlots', 'K'], 1),
    DEF: readNumber(data, ['defSlots', 'dstSlots', 'DEF', 'DST'], 1),
    BN: readNumber(data, ['benchSlots', 'BN'], 6),
    IR: readNumber(data, ['irSlots', 'IR'], data.irSlots ?? 1),
  }
}

export function RosterComplianceSettingsPanel({
  initialData,
  canEdit,
  debouncedSave,
}: {
  initialData: CommissionerSettingsFormData
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const disabled = !canEdit
  const [rosterSize, setRosterSize] = useState(initialData.rosterSize ?? 16)
  const [irSlots, setIrSlots] = useState(initialData.irSlots ?? 1)
  const [taxiSlots, setTaxiSlots] = useState(initialData.taxiSlots ?? 0)
  const [taxiNonRookies, setTaxiNonRookies] = useState(Boolean(initialData.taxiAllowNonRookies))
  const [taxiYears, setTaxiYears] = useState(initialData.taxiYearsLimit ?? 2)
  const [taxiDeadline, setTaxiDeadline] = useState(initialData.taxiDeadlineWeek ?? 4)
  const [irOut, setIrOut] = useState(Boolean(initialData.irAllowOut))
  const [irCovid, setIrCovid] = useState(Boolean(initialData.irAllowCovid))
  const [irSus, setIrSus] = useState(Boolean(initialData.irAllowSuspended))
  const [irNa, setIrNa] = useState(Boolean(initialData.irAllowNA))
  const [irDnr, setIrDnr] = useState(Boolean(initialData.irAllowDNR))
  const [irDoub, setIrDoub] = useState(Boolean(initialData.irAllowDoubtful))
  const [slotCounts, setSlotCounts] = useState<Record<SlotKey, number>>(() => slotCountsFromData(initialData))

  useEffect(() => {
    setRosterSize(initialData.rosterSize ?? 16)
    setIrSlots(initialData.irSlots ?? 1)
    setTaxiSlots(initialData.taxiSlots ?? 0)
    setTaxiNonRookies(Boolean(initialData.taxiAllowNonRookies))
    setTaxiYears(initialData.taxiYearsLimit ?? 2)
    setTaxiDeadline(initialData.taxiDeadlineWeek ?? 4)
    setIrOut(Boolean(initialData.irAllowOut))
    setIrCovid(Boolean(initialData.irAllowCovid))
    setIrSus(Boolean(initialData.irAllowSuspended))
    setIrNa(Boolean(initialData.irAllowNA))
    setIrDnr(Boolean(initialData.irAllowDNR))
    setIrDoub(Boolean(initialData.irAllowDoubtful))
    setSlotCounts(slotCountsFromData(initialData))
  }, [initialData])

  const adjustSlot = (key: SlotKey, delta: number) => {
    if (disabled) return
    setSlotCounts((current) => {
      const nextValue = Math.max(0, Math.min(30, (current[key] ?? 0) + delta))
      const next = { ...current, [key]: nextValue }
      if (key === 'IR') {
        setIrSlots(nextValue)
        debouncedSave({ irSlots: nextValue, rosterSlotCounts: next })
      } else {
        debouncedSave({ rosterSlotCounts: next })
      }
      return next
    })
  }

  return (
    <div className="min-h-0 flex-1 space-y-8 px-6 py-6 text-[13px] text-white/85" data-testid="settings-roster-panel">
      <SettingsPanelHeading
        title="Roster settings"
        subtitle="Set lineup slots and reserves. These values feed lineup legality, draft needs, and roster locks."
      />

      <section
        className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(12,20,36,0.96),rgba(8,13,24,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        data-testid="roster-slot-controls"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SettingsSectionLabel>Lineup slot template</SettingsSectionLabel>
            <p className="text-[11px] leading-relaxed text-white/45">
              Standard football redraft defaults. Superflex is visible and starts at 0.
            </p>
          </div>
          <span className="rounded-full border border-[#ff9ec0]/25 bg-[#ff3d81]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ffd7e5]">
            Redraft
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {(['Starters', 'Bench', 'Reserve'] as const).map((group) => (
            <div key={group} className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">{group}</p>
              <div className="grid gap-2">
                {ROSTER_SLOT_ROWS.filter((row) => row.group === group).map((row) => {
                  const value = slotCounts[row.key] ?? row.defaultValue
                  const testKey = row.key.toLowerCase()
                  return (
                    <div
                      key={row.key}
                      className="grid grid-cols-[auto_44px_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2"
                      data-testid={`roster-slot-row-${testKey}`}
                    >
                      <span
                        className={`inline-flex h-7 min-w-10 items-center justify-center rounded-lg border px-2 text-[11px] font-black ${SLOT_BADGE_CLASS[row.key]}`}
                        data-testid={`roster-slot-badge-${testKey}`}
                      >
                        {row.key}
                      </span>
                      <span
                        className="text-center text-base font-black tabular-nums text-white"
                        data-testid={`roster-slot-${testKey}`}
                      >
                        {value}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={disabled || value <= 0}
                          onClick={() => adjustSlot(row.key, -1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/20 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label={`Decrease ${row.label}`}
                          data-testid={`roster-slot-${testKey}-minus`}
                        >
                          -
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => adjustSlot(row.key, 1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/20 text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label={`Increase ${row.label}`}
                          data-testid={`roster-slot-${testKey}-plus`}
                        >
                          +
                        </button>
                      </div>
                      <span className="min-w-0 truncate text-[12px] font-medium text-white/78">{row.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div>
        <SettingsSectionLabel>Max roster size</SettingsSectionLabel>
        <select
          className={controlClassSm}
          disabled={disabled}
          value={rosterSize}
          onChange={(e) => {
            const n = Number(e.target.value)
            setRosterSize(n)
            debouncedSave({ rosterSize: n })
          }}
        >
          {Array.from({ length: 21 }, (_, i) => i + 10).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <SettingsSectionLabel>Injured reserve slots</SettingsSectionLabel>
        <select
          className={controlClassSm}
          disabled={disabled}
          value={irSlots}
          onChange={(e) => {
            const n = Number(e.target.value)
            setIrSlots(n)
            setSlotCounts((current) => ({ ...current, IR: n }))
            debouncedSave({ irSlots: n })
          }}
        >
          {Array.from({ length: 7 }, (_, i) => i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <details
        className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"
        data-testid="roster-advanced-reserve-settings"
      >
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">
          Advanced reserve settings
        </summary>
        <div className="mt-4 space-y-6">
          <div className="space-y-2">
            <SettingsSectionLabel>IR eligibility</SettingsSectionLabel>
            <div className="space-y-2">
              <SettingsToggleRow label="Allow OUT players on IR" checked={irOut} disabled={disabled} onChange={(v) => { setIrOut(v); debouncedSave({ irAllowOut: v }) }} />
              <SettingsToggleRow label="Allow COVID / PUP designation on IR" checked={irCovid} disabled={disabled} onChange={(v) => { setIrCovid(v); debouncedSave({ irAllowCovid: v }) }} />
              <SettingsToggleRow label="Allow suspended players on IR" checked={irSus} disabled={disabled} onChange={(v) => { setIrSus(v); debouncedSave({ irAllowSuspended: v }) }} />
              <SettingsToggleRow label="Allow NA players on IR" checked={irNa} disabled={disabled} onChange={(v) => { setIrNa(v); debouncedSave({ irAllowNA: v }) }} />
              <SettingsToggleRow label="Allow DNR / holdout / opt-out on IR" checked={irDnr} disabled={disabled} onChange={(v) => { setIrDnr(v); debouncedSave({ irAllowDNR: v }) }} />
              <SettingsToggleRow label="Allow doubtful players on IR" checked={irDoub} disabled={disabled} onChange={(v) => { setIrDoub(v); debouncedSave({ irAllowDoubtful: v }) }} />
            </div>
          </div>

          <div>
            <SettingsSectionLabel>Taxi squad slots</SettingsSectionLabel>
            <select
              className={controlClassSm}
              disabled={disabled}
              value={taxiSlots}
              onChange={(e) => {
                const n = Number(e.target.value)
                setTaxiSlots(n)
                debouncedSave({ taxiSlots: n })
              }}
            >
              {Array.from({ length: 7 }, (_, i) => i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <SettingsToggleRow
            label="Allow non-rookies on taxi"
            checked={taxiNonRookies}
            disabled={disabled}
            onChange={(v) => {
              setTaxiNonRookies(v)
              debouncedSave({ taxiAllowNonRookies: v })
            }}
          />

          <div>
            <SettingsSectionLabel>Taxi years experience limit</SettingsSectionLabel>
            <select
              className={controlClassSm}
              disabled={disabled}
              value={taxiYears}
              onChange={(e) => {
                const n = Number(e.target.value)
                setTaxiYears(n)
                debouncedSave({ taxiYearsLimit: n })
              }}
            >
              <option value={0}>No max</option>
              <option value={1}>1 year</option>
              <option value={2}>2 years</option>
              <option value={3}>3 years</option>
            </select>
          </div>

          <div>
            <SettingsSectionLabel>Taxi deadline (week)</SettingsSectionLabel>
            <select
              className={controlClassSm}
              disabled={disabled}
              value={taxiDeadline}
              onChange={(e) => {
                const n = Number(e.target.value)
                setTaxiDeadline(n)
                debouncedSave({ taxiDeadlineWeek: n })
              }}
            >
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
            <SettingsHelper>After this week, taxi promotions follow your league&apos;s promotion rules.</SettingsHelper>
          </div>
        </div>
      </details>
    </div>
  )
}
