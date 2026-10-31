'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { C2C_DRAFT_FORMATS } from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import { asC2C, asRecord, type LegacyC2CPanelProps } from './legacyC2CPanelProps'

const formatOptions = C2C_DRAFT_FORMATS.map((v) => ({ value: v, labelKey: `legacyC2c.opt.draft.${v}` }))

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyC2c.drafts.title',
    fields: [
      {
        key: 'startupDraftFormat',
        labelKey: 'legacyC2c.field.startupDraftFormat',
        kind: 'enum',
        options: formatOptions,
        fallback: 'split_campus_canton',
        helpKey: 'legacyC2c.help.startupDraftFormat',
      },
      {
        key: 'futureDraftFormat',
        labelKey: 'legacyC2c.field.futureDraftFormat',
        kind: 'enum',
        options: formatOptions,
        fallback: 'combined',
        helpKey: 'legacyC2c.help.futureDraftFormat',
      },
    ],
  },
]

export function C2CDraftsPanel({ config, leagueId, canEdit = false, onSaved }: LegacyC2CPanelProps) {
  const { t } = useOptionalLanguage()
  return (
    <LegacySettingsEditor
      testId="c2c-drafts-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={asRecord(config)}
      saveUrl="/api/c2c/settings"
      responseKey="c2c"
      sections={SECTIONS}
      onSaved={onSaved ? (r) => onSaved(asC2C(r)) : undefined}
      footer={<p className="text-[12px] text-white/60">{t('legacySettings.clockNote')}</p>}
    />
  )
}
