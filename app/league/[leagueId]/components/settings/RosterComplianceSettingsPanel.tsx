'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import { TaxiSquadSettingsSection } from './TaxiSquadSettingsSection'
import { DynastyFormatPresetSection } from './DynastyFormatPresetSection'
import { useDynastySettingsSnapshot } from './useDynastySettingsSnapshot'
import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'
import {
  SettingsPanelHeading,
  SettingsSectionLabel,
  SettingsToggleRow,
  controlClassSm,
} from './settings-ui'

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
  const [irOut, setIrOut] = useState(Boolean(initialData.irAllowOut))
  const [irCovid, setIrCovid] = useState(Boolean(initialData.irAllowCovid))
  const [irSus, setIrSus] = useState(Boolean(initialData.irAllowSuspended))
  const [irNa, setIrNa] = useState(Boolean(initialData.irAllowNA))
  const [irDnr, setIrDnr] = useState(Boolean(initialData.irAllowDNR))
  const [irDoub, setIrDoub] = useState(Boolean(initialData.irAllowDoubtful))

  useEffect(() => {
    setRosterSize(initialData.rosterSize ?? 16)
    setIrOut(Boolean(initialData.irAllowOut))
    setIrCovid(Boolean(initialData.irAllowCovid))
    setIrSus(Boolean(initialData.irAllowSuspended))
    setIrNa(Boolean(initialData.irAllowNA))
    setIrDnr(Boolean(initialData.irAllowDNR))
    setIrDoub(Boolean(initialData.irAllowDoubtful))
  }, [initialData])

  // Dynasty leagues: the taxi section's lock / promotion rules and the NBA/NHL/MLB format presets.
  const params = useParams() as { leagueId?: string } | null
  const dynastySettings = useDynastySettingsSnapshot(params?.leagueId, Boolean(initialData.isDynasty))

  return (
    <div className="min-h-0 flex-1 space-y-8 px-6 py-6 text-[13px] text-white/85" data-testid="settings-roster-panel">
      <SettingsPanelHeading
        title="Roster settings"
        subtitle="Set lineup slots and reserves. These values feed lineup legality, draft needs, and roster locks."
      />

      <DynastyFormatPresetSection
        canEdit={canEdit}
        dynasty={dynastySettings.snapshot}
        saveDynasty={dynastySettings.put}
        onApplied={dynastySettings.reload}
      />

      {/*
        🛑 THESE SLOTS WERE NEVER SAVED (2026-11-15). This tab had its own football-only grid (QB…DEF, BN, IR) that
        sent a slot-count key the settings save ignores, so every change showed and then vanished — and an
        NBA, MLB, NHL or soccer league was shown football positions. It now uses the League settings roster editor,
        which lists the league's own sport, saves the layout lineups are checked against (with bench and IR/IL),
        resizes the draft, honours the settings lock and records the change in the league log.
      */}
      {params?.leagueId ? (
        <div data-testid="roster-slot-controls">
          <RosterSettingsEditor leagueId={params.leagueId} sport={String(initialData.sport ?? 'NFL')} />
        </div>
      ) : null}

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
        </div>
      </details>

      {/* Every taxi option lives here; the advanced reserve block above no longer repeats them. */}
      <TaxiSquadSettingsSection
        initialData={initialData}
        canEdit={canEdit}
        debouncedSave={debouncedSave}
        dynasty={dynastySettings.snapshot}
        saveDynasty={dynastySettings.put}
        leagueId={params?.leagueId ?? null}
      />
    </div>
  )
}
