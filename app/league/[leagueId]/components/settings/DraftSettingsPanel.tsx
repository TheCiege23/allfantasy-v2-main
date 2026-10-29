'use client'

import { useEffect, useState } from 'react'
import {
  SettingsPanelHeading,
  SettingsSectionLabel,
  SettingsHelper,
  SettingsToggleRow,
  controlClass,
} from './settings-ui'
import {
  startsAtScheduledTimeRegardlessOfAutostart,
  type ScheduledStartLeague,
} from '@/lib/draft/redraftScheduledStart'

const DRAFT_TYPES: { value: string; label: string }[] = [
  { value: 'snake', label: 'Snake' },
  { value: 'linear', label: 'Linear' },
  { value: '3rd_reversal', label: 'Third-round reversal' },
  { value: 'auction', label: 'Auction' },
]

const ORDER_METHODS: { value: string; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'randomized', label: 'Randomized' },
  { value: 'prev_standings', label: 'Previous season standings' },
  { value: 'worst_to_first', label: 'Worst to first' },
  { value: 'reverse_max_pf', label: 'Reverse max PF' },
  { value: 'custom_import', label: 'Custom / import' },
]

const TIMER_PRESETS: { value: string; label: string }[] = [
  { value: '30s', label: '30 seconds' },
  { value: '60s', label: '1 minute' },
  { value: '90s', label: '90 seconds' },
  { value: '120s', label: '2 minutes' },
  { value: '300s', label: '5 minutes' },
  { value: '600s', label: '10 minutes' },
  { value: '1800s', label: '30 minutes' },
  { value: '3600s', label: '1 hour' },
  { value: '3h', label: '3 hours' },
  { value: '8h', label: '8 hours' },
  { value: '24h', label: '24 hours' },
  { value: 'custom', label: 'Custom (seconds)' },
]

const PLAYER_POOLS: { value: string; label: string }[] = [
  { value: 'all', label: 'All players' },
  { value: 'rookies_only', label: 'Rookies only' },
  { value: 'veterans_only', label: 'Veterans only' },
]

function draftDateToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DraftSettingsPanel({
  draftRow,
  canEdit,
  save,
  debouncedSave,
  league,
}: {
  draftRow: Record<string, unknown> | null
  /** From `/api/league/settings`'s `league`; hides the Autostart toggle where it does nothing. */
  league?: ScheduledStartLeague | null
  canEdit: boolean
  save: (partial: Record<string, unknown>) => Promise<void>
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const disabled = !canEdit
  const startsAtScheduledTime = startsAtScheduledTimeRegardlessOfAutostart(league)
  const r = draftRow ?? {}

  const [draftType, setDraftType] = useState(String(r.draftType ?? 'snake'))
  const [pickTimerPreset, setPickTimerPreset] = useState(String(r.pickTimerPreset ?? '120s'))
  const [pickTimerCustomValue, setPickTimerCustomValue] = useState<number | ''>(
    r.pickTimerCustomValue != null ? Number(r.pickTimerCustomValue) : '',
  )
  const [rounds, setRounds] = useState(Number(r.rounds ?? 15))
  const [draftOrderMethod, setDraftOrderMethod] = useState(String(r.draftOrderMethod ?? 'manual'))
  const [randomizeCount, setRandomizeCount] = useState<number | ''>(
    r.randomizeCount != null ? Number(r.randomizeCount) : '',
  )
  const [draftOrderLocked, setDraftOrderLocked] = useState(Boolean(r.draftOrderLocked))
  const [playerPool, setPlayerPool] = useState(String(r.playerPool ?? 'all'))
  const [autostart, setAutostart] = useState(Boolean(r.autostart))
  const [slowDraftPause, setSlowDraftPause] = useState(Boolean(r.slowDraftPause))
  const [cpuAutoPick, setCpuAutoPick] = useState(r.cpuAutoPick !== false)
  const [aiAutoPick, setAiAutoPick] = useState(Boolean(r.aiAutoPick))
  const [alphabeticalSort, setAlphabeticalSort] = useState(Boolean(r.alphabeticalSort))
  const [draftDateLocal, setDraftDateLocal] = useState(() =>
    draftDateToLocalInput(typeof r.draftDateUtc === 'string' ? r.draftDateUtc : null),
  )
  const [aiQueueSuggestions, setAiQueueSuggestions] = useState(r.aiQueueSuggestions !== false)
  const [aiBestAvailable, setAiBestAvailable] = useState(r.aiBestAvailable !== false)
  const [aiScope, setAiScope] = useState(String(r.aiScope ?? 'everyone'))

  useEffect(() => {
    const row = draftRow ?? {}
    setDraftType(String(row.draftType ?? 'snake'))
    setPickTimerPreset(String(row.pickTimerPreset ?? '120s'))
    setPickTimerCustomValue(row.pickTimerCustomValue != null ? Number(row.pickTimerCustomValue) : '')
    setRounds(Number(row.rounds ?? 15))
    setDraftOrderMethod(String(row.draftOrderMethod ?? 'manual'))
    setRandomizeCount(row.randomizeCount != null ? Number(row.randomizeCount) : '')
    setDraftOrderLocked(Boolean(row.draftOrderLocked))
    setPlayerPool(String(row.playerPool ?? 'all'))
    setAutostart(Boolean(row.autostart))
    setSlowDraftPause(Boolean(row.slowDraftPause))
    setCpuAutoPick(row.cpuAutoPick !== false)
    setAiAutoPick(Boolean(row.aiAutoPick))
    setAlphabeticalSort(Boolean(row.alphabeticalSort))
    setDraftDateLocal(draftDateToLocalInput(typeof row.draftDateUtc === 'string' ? row.draftDateUtc : null))
    setAiQueueSuggestions(row.aiQueueSuggestions !== false)
    setAiBestAvailable(row.aiBestAvailable !== false)
    setAiScope(String(row.aiScope ?? 'everyone'))
  }, [draftRow])

  return (
    <div className="min-h-0 flex-1 space-y-8 px-6 py-6 text-[13px] text-white/85" data-testid="settings-draft-panel">
      <SettingsPanelHeading
        title="Draft settings"
        subtitle="Draft type, clock, rounds, and draft-room AI. Syncs to the live draft session when applicable."
      />

      <div>
        <SettingsSectionLabel>Draft type</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={draftType}
          onChange={(e) => {
            const v = e.target.value
            setDraftType(v)
            debouncedSave({ draftType: v })
          }}
        >
          {DRAFT_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <SettingsSectionLabel>Pick timer</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={pickTimerPreset}
          onChange={(e) => {
            const v = e.target.value
            setPickTimerPreset(v)
            debouncedSave({ pickTimerPreset: v })
          }}
        >
          {TIMER_PRESETS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {pickTimerPreset === 'custom' ? (
          <div className="mt-2">
            <SettingsHelper>Custom timer length in seconds (10–604800).</SettingsHelper>
            <input
              type="number"
              min={10}
              max={604800}
              className={`${controlClass} mt-1 max-w-xs`}
              disabled={disabled}
              value={pickTimerCustomValue === '' ? '' : pickTimerCustomValue}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === '') {
                  setPickTimerCustomValue('')
                  return
                }
                const n = Number(raw)
                setPickTimerCustomValue(n)
                debouncedSave({ pickTimerCustomValue: n })
              }}
            />
          </div>
        ) : null}
      </div>

      <div>
        <SettingsSectionLabel>Draft rounds</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={rounds}
          onChange={(e) => {
            const n = Number(e.target.value)
            setRounds(n)
            debouncedSave({ rounds: n })
          }}
        >
          {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <SettingsSectionLabel>Draft order method</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={draftOrderMethod}
          onChange={(e) => {
            const v = e.target.value
            setDraftOrderMethod(v)
            debouncedSave({ draftOrderMethod: v })
          }}
        >
          {ORDER_METHODS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <SettingsHelper>Reverse Max PF is unavailable when draft type is auction (server-enforced).</SettingsHelper>
      </div>

      <div>
        <SettingsSectionLabel>Randomize draft order (count)</SettingsSectionLabel>
        <input
          type="number"
          min={1}
          max={50}
          placeholder="e.g. 1"
          className={controlClass}
          disabled={disabled}
          value={randomizeCount === '' ? '' : randomizeCount}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              setRandomizeCount('')
              debouncedSave({ randomizeCount: null })
              return
            }
            const n = Number(raw)
            setRandomizeCount(n)
            debouncedSave({ randomizeCount: n })
          }}
        />
      </div>

      <div>
        <SettingsSectionLabel>Scheduled draft start (local)</SettingsSectionLabel>
        <input
          type="datetime-local"
          className={controlClass}
          disabled={disabled}
          value={draftDateLocal}
          onChange={(e) => {
            const v = e.target.value
            setDraftDateLocal(v)
            if (!v) {
              void save({ draftDateUtc: null })
              return
            }
            const d = new Date(v)
            void save({ draftDateUtc: Number.isNaN(d.getTime()) ? null : d.toISOString() })
          }}
        />
        <SettingsHelper>Stored in UTC; shown in your browser local time.</SettingsHelper>
      </div>

      <div>
        <SettingsSectionLabel>Player pool</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={playerPool}
          onChange={(e) => {
            const v = e.target.value
            setPlayerPool(v)
            debouncedSave({ playerPool: v })
          }}
        >
          {PLAYER_POOLS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <SettingsSectionLabel>Draft room behavior</SettingsSectionLabel>
        {startsAtScheduledTime ? (
          <SettingsHelper>Drafts start automatically at the scheduled time.</SettingsHelper>
        ) : (
          <SettingsToggleRow
            label="Autostart draft at scheduled time"
            checked={autostart}
            disabled={disabled}
            onChange={(v) => {
              setAutostart(v)
              void save({ autostart: v })
            }}
          />
        )}
        <SettingsToggleRow
          label="Slow draft pause (scheduled quiet hours)"
          checked={slowDraftPause}
          disabled={disabled}
          onChange={(v) => {
            setSlowDraftPause(v)
            void save({ slowDraftPause: v })
          }}
        />
        <SettingsToggleRow
          label="Lock draft order"
          checked={draftOrderLocked}
          disabled={disabled}
          onChange={(v) => {
            setDraftOrderLocked(v)
            void save({ draftOrderLocked: v })
          }}
        />
        <SettingsToggleRow
          label="CPU autopick for absent managers"
          checked={cpuAutoPick}
          disabled={disabled}
          onChange={(v) => {
            setCpuAutoPick(v)
            void save({ cpuAutoPick: v })
          }}
        />
        <SettingsToggleRow
          label="AI autopick"
          checked={aiAutoPick}
          disabled={disabled}
          onChange={(v) => {
            setAiAutoPick(v)
            void save({ aiAutoPick: v })
          }}
        />
        <SettingsToggleRow
          label="Alphabetical draft board sort"
          checked={alphabeticalSort}
          disabled={disabled}
          onChange={(v) => {
            setAlphabeticalSort(v)
            void save({ alphabeticalSort: v })
          }}
        />
      </div>

      <div>
        <SettingsSectionLabel>Draft AI scope</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={aiScope}
          onChange={(e) => {
            const v = e.target.value
            setAiScope(v)
            debouncedSave({ aiScope: v })
          }}
        >
          <option value="everyone">Everyone</option>
          <option value="per_user">Per user</option>
          <option value="commissioner_only">Commissioner only</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      <div className="space-y-2">
        <SettingsSectionLabel>In-draft AI assists</SettingsSectionLabel>
        <SettingsToggleRow
          label="Queue suggestions"
          checked={aiQueueSuggestions}
          disabled={disabled}
          onChange={(v) => {
            setAiQueueSuggestions(v)
            void save({ aiQueueSuggestions: v })
          }}
        />
        <SettingsToggleRow
          label="Best available hints"
          checked={aiBestAvailable}
          disabled={disabled}
          onChange={(v) => {
            setAiBestAvailable(v)
            void save({ aiBestAvailable: v })
          }}
        />
      </div>
    </div>
  )
}
