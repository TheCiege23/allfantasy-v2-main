'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { c2cSportPairShort } from '@/lib/c2c/c2cUiLabels'
import { C2C_SCORING_MODES, C2C_WEIGHT_MAX, C2C_WEIGHT_MIN } from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import { asC2C, asRecord, type LegacyC2CPanelProps } from './legacyC2CPanelProps'

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyC2c.format.scoringTitle',
    noteKey: 'legacyC2c.format.scoringNote',
    fields: [
      {
        key: 'scoringMode',
        labelKey: 'legacyC2c.field.scoringMode',
        kind: 'enum',
        options: C2C_SCORING_MODES.map((v) => ({
          value: v,
          labelKey: `legacyC2c.opt.mode.${v}`,
          descKey: `legacyC2c.opt.mode.${v}.desc`,
        })),
      },
      {
        key: 'campusScoreWeight',
        labelKey: 'legacyC2c.field.campusScoreWeight',
        kind: 'percent',
        min: Math.round(C2C_WEIGHT_MIN * 100),
        max: Math.round(C2C_WEIGHT_MAX * 100),
        fallback: 0.4,
        helpKey: 'legacyC2c.help.campusScoreWeight',
        helpVars: (d) => ({ canton: 100 - (Number(d.campusScoreWeight) || 0) }),
        showWhen: (d) => d.scoringMode === 'weighted_combined',
      },
    ],
  },
]

export function C2CFormatPanel({ config, leagueId, canEdit = false, onSaved }: LegacyC2CPanelProps) {
  const { t } = useOptionalLanguage()
  return (
    <LegacySettingsEditor
      testId="c2c-format-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={asRecord(config)}
      saveUrl="/api/c2c/settings"
      responseKey="c2c"
      sections={SECTIONS}
      onSaved={onSaved ? (r) => onSaved(asC2C(r)) : undefined}
      intro={
        config ? (
          <section className="space-y-3 rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">{t('legacyC2c.format.sportPair')}</p>
              <p className="mt-1 font-semibold text-white">{c2cSportPairShort(config.sportPair).label}</p>
              <p className="mt-1 text-[11px] text-amber-200/80">{t('legacyC2c.format.sportPairLocked')}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">{t('legacyC2c.format.dynasty')}</p>
              <p className="mt-1 text-[12px] text-white/60">{t('legacyC2c.format.dynastyOn')}</p>
            </div>
          </section>
        ) : null
      }
    />
  )
}
