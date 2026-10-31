'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { DEVY_FUTURE_DRAFT_FORMATS, DEVY_STARTUP_DRAFT_FORMATS } from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import type { LegacyDevyPanelProps } from './legacyDevyPanelProps'

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyDevy.format.draftsTitle',
    fields: [
      {
        key: 'startupDraftFormat',
        labelKey: 'legacyDevy.field.startupDraftFormat',
        kind: 'enum',
        options: DEVY_STARTUP_DRAFT_FORMATS.map((v) => ({ value: v, labelKey: `legacyDevy.opt.startup.${v}` })),
        helpKey: 'legacyDevy.help.startupDraftFormat',
      },
      {
        key: 'futureDraftFormat',
        labelKey: 'legacyDevy.field.futureDraftFormat',
        kind: 'enum',
        options: DEVY_FUTURE_DRAFT_FORMATS.map((v) => ({
          value: v,
          labelKey: `legacyDevy.opt.future.${v}`,
          descKey: `legacyDevy.opt.future.${v}.desc`,
        })),
        helpKey: 'legacyDevy.help.futureDraftFormat',
      },
    ],
  },
]

export function DevyFormatPanel({ config, leagueId, canEdit = false, onSaved }: LegacyDevyPanelProps) {
  const { t } = useOptionalLanguage()
  return (
    <LegacySettingsEditor
      testId="devy-format-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={config}
      saveUrl="/api/devy"
      responseKey="config"
      sections={SECTIONS}
      onSaved={onSaved}
      intro={
        <>
          <p className="text-[11px] text-sky-200/70">{t('legacyDevy.format.intro')}</p>
          <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/90">{t('legacyDevy.format.dynastyTitle')}</h3>
            <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-100/90">
              {t('legacyDevy.format.dynastyLocked')}
            </p>
          </section>
        </>
      }
    />
  )
}
