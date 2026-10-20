'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { TAXI_LOCK_BEHAVIOR_COPY, TAXI_SECTION_COPY, dynastyFormatLang } from '@/lib/i18n/dynasty-format-copy'
import type { DynastySettingsSnapshot } from './useDynastySettingsSnapshot'
import { SettingsHelper, SettingsSectionLabel, SettingsToggleRow, controlClassSm } from './settings-ui'

/**
 * The ONE place a commissioner edits taxi squad settings.
 *
 * It holds what used to be split across two editors, and saves each value where it was saved before:
 *   - League columns (`taxiSlots`, `taxiAllowNonRookies`, `taxiYearsLimit`, `taxiDeadlineWeek`) —
 *     moved verbatim out of the Roster tab's "Advanced reserve settings", same `debouncedSave` keys
 *     (PATCH /api/league/settings). These are what the roster validator reads.
 *   - Dynasty-config rules (`taxiLockBehavior`, `taxiInSeasonMoves`, `taxiPostseasonMoves`,
 *     `taxiScoringOn`, `taxiPromotionDeadlineWeek`) — previously editable only in
 *     `components/app/settings/DynastySettingsPanel`, same PUT /api/leagues/[id]/dynasty-settings.
 *     Shown for dynasty leagues only, once that route has answered.
 */
export function TaxiSquadSettingsSection({
  initialData,
  canEdit,
  debouncedSave,
  dynasty,
  saveDynasty,
}: {
  initialData: CommissionerSettingsFormData
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
  dynasty: DynastySettingsSnapshot | null
  saveDynasty: (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
}) {
  const { language } = useLanguage()
  const lang = dynastyFormatLang(language)
  const copy = TAXI_SECTION_COPY[lang]
  const disabled = !canEdit

  const [taxiSlots, setTaxiSlots] = useState(initialData.taxiSlots ?? 0)
  const [taxiNonRookies, setTaxiNonRookies] = useState(Boolean(initialData.taxiAllowNonRookies))
  const [taxiYears, setTaxiYears] = useState(initialData.taxiYearsLimit ?? 2)
  const [taxiDeadline, setTaxiDeadline] = useState(initialData.taxiDeadlineWeek ?? 4)

  useEffect(() => {
    setTaxiSlots(initialData.taxiSlots ?? 0)
    setTaxiNonRookies(Boolean(initialData.taxiAllowNonRookies))
    setTaxiYears(initialData.taxiYearsLimit ?? 2)
    setTaxiDeadline(initialData.taxiDeadlineWeek ?? 4)
  }, [initialData])

  const effective = dynasty?.effective ?? null
  const [rules, setRules] = useState(effective)
  const [rulesError, setRulesError] = useState<string | null>(null)
  useEffect(() => { setRules(effective) }, [effective])

  const saveRule = async (patch: Record<string, unknown>) => {
    if (disabled) return
    const previous = rules
    setRules((current) => ({ ...(current ?? {}), ...patch }))
    setRulesError(null)
    const result = await saveDynasty(patch)
    if (!result.ok) {
      setRules(previous)
      setRulesError(result.error ?? copy.saveFailed)
    }
  }

  const lockOptions = dynasty?.constants?.taxiLockBehaviorOptions ?? []

  return (
    <section
      className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4"
      data-testid="taxi-squad-settings-section"
    >
      <header>
        <h4 className="text-[13px] font-bold uppercase tracking-[0.12em] text-white/80">{copy.title}</h4>
        <p className="mt-1 text-[11px] text-white/45">{copy.subtitle}</p>
      </header>

      <div>
        <SettingsSectionLabel>{copy.slots}</SettingsSectionLabel>
        <select
          className={controlClassSm}
          disabled={disabled}
          value={taxiSlots}
          data-testid="taxi-slots"
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
        label={copy.allowNonRookies}
        checked={taxiNonRookies}
        disabled={disabled}
        onChange={(v) => {
          setTaxiNonRookies(v)
          debouncedSave({ taxiAllowNonRookies: v })
        }}
      />

      <div>
        <SettingsSectionLabel>{copy.yearsLimit}</SettingsSectionLabel>
        <select
          className={controlClassSm}
          disabled={disabled}
          value={taxiYears}
          data-testid="taxi-years-limit"
          onChange={(e) => {
            const n = Number(e.target.value)
            setTaxiYears(n)
            debouncedSave({ taxiYearsLimit: n })
          }}
        >
          <option value={0}>{copy.noMax}</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {copy.years(n)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <SettingsSectionLabel>{copy.deadline}</SettingsSectionLabel>
        <select
          className={controlClassSm}
          disabled={disabled}
          value={taxiDeadline}
          data-testid="taxi-deadline-week"
          onChange={(e) => {
            const n = Number(e.target.value)
            setTaxiDeadline(n)
            debouncedSave({ taxiDeadlineWeek: n })
          }}
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              {copy.week(w)}
            </option>
          ))}
        </select>
        <SettingsHelper>{copy.deadlineHelp}</SettingsHelper>
      </div>

      {rules ? (
        <div className="space-y-4 border-t border-white/[0.06] pt-4" data-testid="taxi-dynasty-rules">
          <SettingsSectionLabel>{copy.rulesTitle}</SettingsSectionLabel>
          {rulesError ? (
            <p role="alert" className="text-[12px] text-rose-300">{rulesError}</p>
          ) : null}
          {lockOptions.length > 0 ? (
            <div>
              <SettingsSectionLabel>{copy.lockBehavior}</SettingsSectionLabel>
              <select
                className={controlClassSm}
                disabled={disabled}
                value={rules.taxiLockBehavior ?? 'once_promoted_no_return'}
                data-testid="taxi-lock-behavior"
                onChange={(e) => void saveRule({ taxiLockBehavior: e.target.value })}
              >
                {lockOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {TAXI_LOCK_BEHAVIOR_COPY[o.value]?.[lang] ?? o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <SettingsToggleRow
            label={copy.inSeasonMoves}
            checked={rules.taxiInSeasonMoves ?? true}
            disabled={disabled}
            onChange={(v) => void saveRule({ taxiInSeasonMoves: v })}
          />
          <SettingsToggleRow
            label={copy.postseasonMoves}
            checked={rules.taxiPostseasonMoves ?? false}
            disabled={disabled}
            onChange={(v) => void saveRule({ taxiPostseasonMoves: v })}
          />
          <SettingsToggleRow
            label={copy.scoringOn}
            checked={rules.taxiScoringOn ?? false}
            disabled={disabled}
            onChange={(v) => void saveRule({ taxiScoringOn: v })}
          />
          <div>
            <SettingsSectionLabel>{copy.promotionDeadline}</SettingsSectionLabel>
            <select
              className={controlClassSm}
              disabled={disabled}
              value={rules.taxiPromotionDeadlineWeek == null ? '' : String(rules.taxiPromotionDeadlineWeek)}
              data-testid="taxi-promotion-deadline-week"
              onChange={(e) => void saveRule({ taxiPromotionDeadlineWeek: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">{copy.none}</option>
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  {copy.week(w)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </section>
  )
}
