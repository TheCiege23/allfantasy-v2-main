'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import type { LegacyDevyPanelProps } from './legacyDevyPanelProps'

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyDevy.drafts.tradingTitle',
    noteKey: 'legacyDevy.drafts.tradingNote',
    fields: [
      { key: 'rookiePickTradingEnabled', labelKey: 'legacyDevy.field.rookiePickTradingEnabled', kind: 'bool', fallback: true },
      { key: 'devyPickTradingEnabled', labelKey: 'legacyDevy.field.devyPickTradingEnabled', kind: 'bool', fallback: true },
    ],
  },
]

export function DevyDraftsPanel({ config, leagueId, canEdit = false, onSaved }: LegacyDevyPanelProps) {
  const { t } = useOptionalLanguage()
  return (
    <LegacySettingsEditor
      testId="devy-drafts-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={config}
      saveUrl="/api/devy"
      responseKey="config"
      sections={SECTIONS}
      onSaved={onSaved}
      footer={
        <div className="space-y-2 text-[12px] text-white/60">
          <p>{t('legacySettings.clockNote')}</p>
          <p>{t('legacyDevy.drafts.formatsNote')}</p>
        </div>
      }
    />
  )
}
