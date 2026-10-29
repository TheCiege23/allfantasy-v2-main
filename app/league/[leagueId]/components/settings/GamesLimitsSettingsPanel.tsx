'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import type { GamesLimits } from '@/lib/redraft/gamesLimits'
import { gamesLimitsCopy } from '@/lib/redraft/gamesLimitsCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { SettingsSectionLabel, SettingsHelper, controlClassSm } from './settings-ui'

type Draft = { caps: Record<string, string>; goalieMin: string; inningsMin: string; inningsMax: string }

function toDraft(limits: GamesLimits | null | undefined): Draft {
  return {
    caps: Object.fromEntries(Object.entries(limits?.gamesPlayedCaps ?? {}).map(([k, v]) => [k, String(v)])),
    goalieMin: limits?.goalieMinStarts != null ? String(limits.goalieMinStarts) : '',
    inningsMin: limits?.inningsMin != null ? String(limits.inningsMin) : '',
    inningsMax: limits?.inningsMax != null ? String(limits.inningsMax) : '',
  }
}

/** The PATCH body: blanks are dropped, so an all-blank form turns the limits off (stored as null). */
function toBody(draft: Draft, sport: string): GamesLimits | null {
  const out: GamesLimits = {}
  const caps = Object.fromEntries(
    Object.entries(draft.caps)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => [k, Number(v)]),
  )
  if (Object.keys(caps).length) out.gamesPlayedCaps = caps
  if (sport === 'NHL' && draft.goalieMin.trim()) out.goalieMinStarts = Number(draft.goalieMin)
  if (sport === 'MLB' && draft.inningsMin.trim()) out.inningsMin = Number(draft.inningsMin)
  if (sport === 'MLB' && draft.inningsMax.trim()) out.inningsMax = Number(draft.inningsMax)
  return Object.keys(out).length ? out : null
}

/**
 * Commissioner section for games limits (lib/redraft/gamesLimits.ts) — NBA, NHL and MLB only. Disabled,
 * with the reason shown, until the league is on daily lineups: the server refuses the setting otherwise.
 */
export function GamesLimitsSettingsPanel({
  sport,
  initialData,
  canEdit,
  debouncedSave,
}: {
  sport: string
  initialData: CommissionerSettingsFormData
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const { language } = useOptionalLanguage()
  const copy = gamesLimitsCopy(language)
  const sp = sport.toUpperCase()
  const daily = initialData.dailyLineupsActive === true
  const disabled = !canEdit || !daily
  const slots = initialData.gamesLimitsCapSlots ?? []
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialData.gamesLimits))

  useEffect(() => {
    setDraft(toDraft(initialData.gamesLimits))
  }, [initialData])

  if (!['NBA', 'NHL', 'MLB'].includes(sp)) return null

  const update = (next: Draft) => {
    setDraft(next)
    debouncedSave({ gamesLimits: toBody(next, sp) })
  }
  const numberInput = (value: string, onChange: (v: string) => void, max: number, label: string, testId: string) => (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      step={1}
      aria-label={label}
      data-testid={testId}
      className={`${controlClassSm} w-24`}
      disabled={disabled}
      placeholder={copy.off}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )

  return (
    <div className="space-y-5 border-t border-white/[0.06] px-6 py-6 text-[13px] text-white/85" data-testid="settings-games-limits-panel">
      <div>
        <p className="text-[14px] font-semibold text-white">{copy.title}</p>
        <p className="text-[12px] text-white/45">{copy.subtitle}</p>
        {!daily ? (
          <p className="mt-2 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100" data-testid="games-limits-needs-daily">
            {copy.needsDaily}
          </p>
        ) : null}
      </div>

      {slots.length ? (
        <div>
          <SettingsSectionLabel>{copy.capsLabel}</SettingsSectionLabel>
          <div className="flex flex-wrap gap-3">
            {slots.map((slot) => (
              <label key={slot} className="flex items-center gap-2 text-[12px] text-white/70">
                <span className="w-10 font-semibold">{slot}</span>
                {numberInput(
                  draft.caps[slot] ?? '',
                  (v) => update({ ...draft, caps: { ...draft.caps, [slot]: v } }),
                  200,
                  `${copy.capsLabel} ${slot}`,
                  `games-limits-cap-${slot}`,
                )}
              </label>
            ))}
          </div>
          <SettingsHelper>{copy.capsHelp}</SettingsHelper>
        </div>
      ) : null}

      {sp === 'NHL' ? (
        <div>
          <SettingsSectionLabel>{copy.goalieLabel}</SettingsSectionLabel>
          {numberInput(draft.goalieMin, (v) => update({ ...draft, goalieMin: v }), 7, copy.goalieLabel, 'games-limits-goalie-min')}
          <SettingsHelper>{copy.goalieHelp}</SettingsHelper>
        </div>
      ) : null}

      {sp === 'MLB' ? (
        <>
          <div>
            <SettingsSectionLabel>{copy.inningsMinLabel}</SettingsSectionLabel>
            {numberInput(draft.inningsMin, (v) => update({ ...draft, inningsMin: v }), 200, copy.inningsMinLabel, 'games-limits-innings-min')}
            <SettingsHelper>{copy.inningsMinHelp}</SettingsHelper>
          </div>
          <div>
            <SettingsSectionLabel>{copy.inningsMaxLabel}</SettingsSectionLabel>
            {numberInput(draft.inningsMax, (v) => update({ ...draft, inningsMax: v }), 200, copy.inningsMaxLabel, 'games-limits-innings-max')}
            <SettingsHelper>{copy.inningsMaxHelp}</SettingsHelper>
          </div>
        </>
      ) : null}
    </div>
  )
}
