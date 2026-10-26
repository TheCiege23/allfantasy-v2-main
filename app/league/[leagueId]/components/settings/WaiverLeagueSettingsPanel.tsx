'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import {
  SettingsPanelHeading,
  SettingsSectionLabel,
  SettingsHelper,
  SettingsToggleRow,
  controlClass,
  controlClassSm,
} from './settings-ui'
import {
  readFaabRolloverRule,
  readFreeAgencyMode,
  type FaabRolloverRule,
  type FreeAgencyMode,
} from '@/lib/waiver-wire/hub-waiver-options'
import { effectiveFaabRolloverRule } from '@/lib/waiver-wire/faab-rollover'

const WAIVER_TYPES = [
  { value: 'faab', label: 'FAAB bidding' },
  { value: 'rolling', label: 'Rolling waivers' },
  { value: 'reverse_standings', label: 'Reverse standings' },
  { value: 'fcfs', label: 'Continual / free-for-all (FCFS)' },
  { value: 'standard', label: 'Standard (scheduled batch)' },
]

const FREE_AGENCY_MODES: Array<{ value: FreeAgencyMode; label: string }> = [
  { value: 'standard', label: "League's waiver rules" },
  { value: 'after_run', label: 'Waivers until each run, then free agents (Sleeper-style)' },
]

const FAAB_ROLLOVER: Array<{ value: FaabRolloverRule; label: string }> = [
  { value: 'reset', label: 'Reset to the starting budget' },
  { value: 'carry_over', label: 'Carry over what each team has left' },
]

const TIME_PRESETS = ['00:00', '01:00', '02:00', '03:00', '08:00', '10:00', '12:00', '18:00', '22:00']

export function WaiverLeagueSettingsPanel({
  leagueId,
  initialData,
  canEdit,
  debouncedSave,
}: {
  leagueId: string
  initialData: CommissionerSettingsFormData
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const disabled = !canEdit
  const [waiverType, setWaiverType] = useState(initialData.waiverType ?? 'faab')
  const [budget, setBudget] = useState(initialData.waiverBudget ?? 100)
  const [minBid, setMinBid] = useState(initialData.waiverMinBid ?? 0)
  const [clearAfter, setClearAfter] = useState(Boolean(initialData.waiverClearAfterGames))
  const [hours, setHours] = useState(initialData.waiverHours ?? 24)
  const [customDaily, setCustomDaily] = useState(Boolean(initialData.customDailyWaivers))
  const [processTime, setProcessTime] = useState(initialData.waiverProcessTime ?? '03:00')
  // These two live in the waiver-settings row's engine config, read from the effective settings.
  const [freeAgencyMode, setFreeAgencyMode] = useState<FreeAgencyMode>('standard')
  const [faabRollover, setFaabRollover] = useState<FaabRolloverRule | null>(null)
  // Unset, a redraft renewal resets FAAB and a keeper / dynasty one carries it over.
  const rolloverDefault = effectiveFaabRolloverRule(null, initialData.isDynasty ? 'carry_rosters' : 'redraft')

  useEffect(() => {
    let live = true
    void fetch(`/api/waiver-wire/leagues/${encodeURIComponent(leagueId)}/settings`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((eff: { freeAgencyMode?: string | null; faabRolloverRule?: string | null } | null) => {
        if (!live || !eff) return
        setFreeAgencyMode(readFreeAgencyMode(eff.freeAgencyMode))
        setFaabRollover(readFaabRolloverRule(eff.faabRolloverRule))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [leagueId])

  useEffect(() => {
    setWaiverType(initialData.waiverType ?? 'faab')
    setBudget(initialData.waiverBudget ?? 100)
    setMinBid(initialData.waiverMinBid ?? 0)
    setClearAfter(Boolean(initialData.waiverClearAfterGames))
    setHours(initialData.waiverHours ?? 24)
    setCustomDaily(Boolean(initialData.customDailyWaivers))
    setProcessTime(initialData.waiverProcessTime ?? '03:00')
  }, [initialData])

  return (
    <div className="min-h-0 flex-1 space-y-8 px-6 py-6 text-[13px] text-white/85" data-testid="settings-waiver-panel">
      <SettingsPanelHeading
        title="Waiver settings"
        subtitle="Synced to the waiver wire engine, add/drop validation, and FAAB processing. Extended JSON rules can be set via API (waiverEngineConfig)."
      />

      <div>
        <SettingsSectionLabel>Waiver type</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={waiverType}
          onChange={(e) => {
            const v = e.target.value
            setWaiverType(v)
            debouncedSave({ waiverType: v })
          }}
        >
          {WAIVER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <SettingsHelper>Maps to league.waiverType and the waiver processing engine.</SettingsHelper>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <SettingsSectionLabel>Waiver budget (FAAB)</SettingsSectionLabel>
          <input
            type="number"
            min={0}
            className={controlClass}
            disabled={disabled}
            value={budget}
            onChange={(e) => {
              const n = Number(e.target.value)
              setBudget(n)
              debouncedSave({ waiverBudget: n })
            }}
          />
        </div>
        <div>
          <SettingsSectionLabel>Minimum bid</SettingsSectionLabel>
          <input
            type="number"
            min={0}
            className={controlClass}
            disabled={disabled}
            value={minBid}
            onChange={(e) => {
              const n = Number(e.target.value)
              setMinBid(n)
              debouncedSave({ waiverMinBid: n })
            }}
          />
        </div>
      </div>

      {waiverType !== 'fcfs' ? (
        <div>
          <SettingsSectionLabel>Free agency</SettingsSectionLabel>
          <select
            className={controlClass}
            disabled={disabled}
            value={freeAgencyMode}
            onChange={(e) => {
              const v = e.target.value as FreeAgencyMode
              setFreeAgencyMode(v)
              debouncedSave({ waiverFreeAgencyMode: v })
            }}
            data-testid="settings-waiver-free-agency-mode"
          >
            {FREE_AGENCY_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <SettingsHelper>
            {freeAgencyMode === 'after_run'
              ? 'Unrostered players are on waivers until the scheduled run, then free agents (first come, first served). A player goes back on waivers once his game starts, until the next run. Dropped players still serve the waiver period.'
              : 'Free agents follow the waiver type above.'}
          </SettingsHelper>
        </div>
      ) : null}

      {waiverType === 'faab' ? (
        <div>
          <SettingsSectionLabel>FAAB at season rollover</SettingsSectionLabel>
          <select
            className={controlClass}
            disabled={disabled}
            value={faabRollover ?? rolloverDefault}
            onChange={(e) => {
              const v = e.target.value as FaabRolloverRule
              setFaabRollover(v)
              debouncedSave({ waiverFaabRollover: v })
            }}
            data-testid="settings-faab-rollover"
          >
            {FAAB_ROLLOVER.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <SettingsHelper>Applies when the league is renewed for next season. Current balances are not changed.</SettingsHelper>
        </div>
      ) : null}

      <SettingsToggleRow
        label="After games waivers clear"
        description="When enabled, players clear to free agency or the next waiver run after their game window (league policy)."
        checked={clearAfter}
        disabled={disabled}
        onChange={(v) => {
          setClearAfter(v)
          debouncedSave({ waiverClearAfterGames: v })
        }}
      />

      <div>
        <SettingsSectionLabel>Time players stay on waivers after drop (hours)</SettingsSectionLabel>
        <select
          className={controlClassSm}
          disabled={disabled}
          value={hours}
          onChange={(e) => {
            const n = Number(e.target.value)
            setHours(n)
            debouncedSave({ waiverHours: n })
          }}
        >
          {[1, 6, 12, 24, 48, 72, 96, 168].map((h) => (
            <option key={h} value={h}>
              {h} hours
            </option>
          ))}
        </select>
      </div>

      <SettingsToggleRow
        label="Allow custom daily waivers"
        description="Enables day-by-day waiver schedule stored on waiverSchedule (configure detail via import or API)."
        checked={customDaily}
        disabled={disabled}
        onChange={(v) => {
          setCustomDaily(v)
          debouncedSave({ customDailyWaivers: v })
        }}
      />

      <div>
        <SettingsSectionLabel>Waiver processing time (league local / stored as HH:MM)</SettingsSectionLabel>
        <div className="flex flex-wrap gap-2">
          {TIME_PRESETS.map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => {
                setProcessTime(t)
                debouncedSave({ waiverProcessTime: t })
              }}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                processTime === t
                  ? 'bg-teal-500/90 text-white'
                  : 'border border-white/15 bg-black/30 text-white/75 hover:bg-white/[0.06]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <SettingsHelper>Primary batch run time; cron and waiver engine also read LeagueWaiverSettings when present (leagueId: {leagueId}).</SettingsHelper>
      </div>
    </div>
  )
}
