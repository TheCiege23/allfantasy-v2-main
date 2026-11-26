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
import { effectiveFaabRolloverRule, faabRolloverFamilyForLeague } from '@/lib/waiver-wire/faab-rollover'
import { utcProcessTimeAsLocalLabel } from '@/lib/waivers/dailyWaiverSchedule'

const WAIVER_TYPES = [
  { value: 'faab', label: 'FAAB bidding' },
  { value: 'rolling', label: 'Rolling waivers' },
  { value: 'reverse_standings', label: 'Reverse standings' },
  { value: 'fcfs', label: 'Continual / free-for-all (FCFS)' },
  { value: 'standard', label: 'Standard (scheduled batch)' },
]

/** One plain line per waiver type (same wording as the League settings hub, lsHub.wv.explain.*). */
const WAIVER_TYPE_EXPLAIN: Record<string, string> = {
  faab: 'Every team gets a budget for the season. Managers bid blind; the highest bid wins and that amount comes off their budget.',
  rolling: 'Teams stand in one line. The team at the front gets its claim, then goes to the back of the line.',
  reverse_standings: 'The team with the worst record gets first pick of every player, every run.',
  standard: 'Teams keep the same order all week — winning a claim does not move you. The order resets each week.',
  fcfs: 'No waivers: the first manager to add a player gets him, straight away.',
}

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
  const leagueTimeZone = initialData.timezone?.trim() || 'America/New_York'
  const [waiverType, setWaiverType] = useState(initialData.waiverType ?? 'faab')
  const [budget, setBudget] = useState(initialData.waiverBudget ?? 100)
  const [minBid, setMinBid] = useState(initialData.waiverMinBid ?? 0)
  const [hours, setHours] = useState(initialData.waiverHours ?? 24)
  const [processTime, setProcessTime] = useState(initialData.waiverProcessTime ?? '03:00')
  // These two live in the waiver-settings row's engine config, read from the effective settings.
  const [freeAgencyMode, setFreeAgencyMode] = useState<FreeAgencyMode>('standard')
  const [faabRollover, setFaabRollover] = useState<FaabRolloverRule | null>(null)
  // Off unless a commissioner turns it on: a benched player whose game has started is locked too.
  const [benchDropsAfterLock, setBenchDropsAfterLock] = useState(false)
  // Unset, a redraft renewal resets FAAB and a keeper / dynasty one carries it over. The server sends
  // `faabRolloverDefault` from the family the renew route applies (faabRolloverFamilyForLeague); this
  // form has no league variant or settings, so that answer replaces the first guess (league type and
  // isDynasty — a keeper league already reads "carry over") as soon as it lands.
  const [rolloverDefault, setRolloverDefault] = useState<FaabRolloverRule>(() =>
    effectiveFaabRolloverRule(null, faabRolloverFamilyForLeague({ leagueType: initialData.leagueType ?? null, isDynasty: initialData.isDynasty ?? null })),
  )

  useEffect(() => {
    let live = true
    void fetch(`/api/waiver-wire/leagues/${encodeURIComponent(leagueId)}/settings`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((eff: {
        freeAgencyMode?: string | null
        faabRolloverRule?: string | null
        faabRolloverDefault?: string | null
        waiverEngineConfig?: Record<string, unknown> | null
      } | null) => {
        if (!live || !eff) return
        setBenchDropsAfterLock(eff.waiverEngineConfig?.can_drop_bench_after_lock === true)
        setFreeAgencyMode(readFreeAgencyMode(eff.freeAgencyMode))
        setFaabRollover(readFaabRolloverRule(eff.faabRolloverRule))
        const fallback = readFaabRolloverRule(eff.faabRolloverDefault)
        if (fallback) setRolloverDefault(fallback)
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
    setHours(initialData.waiverHours ?? 24)
    setProcessTime(initialData.waiverProcessTime ?? '03:00')
  }, [initialData])

  return (
    <div className="min-h-0 flex-1 space-y-8 px-6 py-6 text-[13px] text-white/85" data-testid="settings-waiver-panel">
      <SettingsPanelHeading
        title="Waiver settings"
        subtitle="How players get claimed in this league. Changes apply to the next waiver run."
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
        <SettingsHelper>{WAIVER_TYPE_EXPLAIN[waiverType] ?? 'How claims on the same player are decided.'}</SettingsHelper>
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
          <SettingsHelper>How much each team can spend on bids for the whole season.</SettingsHelper>
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
          <SettingsHelper>The smallest bid a claim can carry. It cannot be more than the budget.</SettingsHelper>
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

      {/* "After games waivers clear" was removed 2026-11-26: nothing in the waiver engine read it, so the
          switch changed nothing. The waiver period below and "Bench drops after kickoff" are the real rules. */}
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
        <SettingsHelper>A dropped player can't be added straight away: he sits on waivers this long, so every team gets a fair shot at him.</SettingsHelper>
      </div>

      <SettingsToggleRow
        label="Allow bench drops after kickoff"
        description="Off by default: once a player's game starts he can't be dropped, starter or bench. Turn on to let managers drop a benched player whose game has started."
        checked={benchDropsAfterLock}
        disabled={disabled}
        onChange={(v) => {
          setBenchDropsAfterLock(v)
          debouncedSave({ waiverBenchDropsAfterLock: v })
        }}
      />

      {/* "Allow custom daily waivers" was removed 2026-11-26: no runtime read it. The real day-by-day
          schedule is League settings → Waivers → "Schedule by day". */}

      <div>
        {/*
          🛑 THIS SAID "LEAGUE LOCAL" AND SAVED UTC (2026-11-15). The time is stored as the engine's UTC run time, so a
          commissioner in New York who picked 03:00 got a 10 PM run. The label now says UTC and shows the league's
          own clock time beside each choice. League settings → Waivers sets the run in local time.
        */}
        <SettingsSectionLabel>Waiver processing time (UTC)</SettingsSectionLabel>
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
              {t} UTC
              {utcProcessTimeAsLocalLabel(t, leagueTimeZone) ? (
                <span className="ml-1 opacity-70" data-testid={`waiver-time-local-${t}`}>· {utcProcessTimeAsLocalLabel(t, leagueTimeZone)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <SettingsHelper>
          Shown in your league&apos;s time zone ({leagueTimeZone.replace(/_/g, ' ')}) after each UTC time. To set the run in
          local time by day, use League settings → Waivers.
        </SettingsHelper>
      </div>
    </div>
  )
}
