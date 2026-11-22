'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { devyRange, type LegacyDevyPanelProps } from './legacyDevyPanelProps'

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyDevy.taxi.title',
    fields: [
      { key: 'taxiRookieOnly', labelKey: 'legacyDevy.field.taxiRookieOnly', kind: 'bool', fallback: true },
      {
        key: 'taxiAllowNonRookies',
        labelKey: 'legacyDevy.field.taxiAllowNonRookies',
        kind: 'bool',
        helpKey: 'legacyDevy.help.taxiAllowNonRookies',
      },
      {
        key: 'taxiMaxExperienceYears',
        labelKey: 'legacyDevy.field.taxiMaxExperienceYears',
        kind: 'int',
        ...devyRange('taxiMaxExperienceYears'),
      },
      {
        key: 'taxiLockDeadline',
        labelKey: 'legacyDevy.field.taxiLockDeadline',
        kind: 'datetime',
        helpKey: 'legacyDevy.help.taxiLockDeadline',
      },
      { key: 'taxiPointsVisibleDisplay', labelKey: 'legacyDevy.field.taxiPointsVisibleDisplay', kind: 'bool', fallback: true, recordedOnly: true },
      { key: 'taxiCanReturnAfterPromo', labelKey: 'legacyDevy.field.taxiCanReturnAfterPromo', kind: 'bool', recordedOnly: true },
      { key: 'taxiDevyToRookieEligible', labelKey: 'legacyDevy.field.taxiDevyToRookieEligible', kind: 'bool', fallback: true, recordedOnly: true },
      { key: 'taxiPoachaingEnabled', labelKey: 'legacyDevy.field.taxiPoachaingEnabled', kind: 'bool', recordedOnly: true },
    ],
  },
]

export function DevyTaxiPanel({ config, leagueId, canEdit = false, onSaved }: LegacyDevyPanelProps) {
  const { t } = useOptionalLanguage()
  return (
    <LegacySettingsEditor
      testId="devy-taxi-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={config}
      saveUrl="/api/devy"
      responseKey="config"
      sections={SECTIONS}
      onSaved={onSaved}
      footer={
        <p className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-[12px] text-white/55">
          {t('legacyDevy.taxi.pointsLocked')}
        </p>
      }
    />
  )
}
