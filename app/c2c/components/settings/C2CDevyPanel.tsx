'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { asC2C, asRecord, type LegacyC2CPanelProps } from './legacyC2CPanelProps'

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyC2c.devy.title',
    fields: [
      {
        key: 'devyScoringEnabled',
        labelKey: 'legacyC2c.field.devyScoringEnabled',
        kind: 'bool',
        helpKey: 'legacyC2c.help.devyScoringEnabled',
      },
    ],
  },
]

export function C2CDevyPanel({ config, leagueId, canEdit = false, onSaved }: LegacyC2CPanelProps) {
  const { t } = useOptionalLanguage()
  return (
    <LegacySettingsEditor
      testId="c2c-devy-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={asRecord(config)}
      saveUrl="/api/c2c/settings"
      responseKey="c2c"
      sections={SECTIONS}
      onSaved={onSaved ? (r) => onSaved(asC2C(r)) : undefined}
      footer={<p className="text-[12px] text-white/55">{t('legacyC2c.devy.slotsElsewhere')}</p>}
    />
  )
}
