'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { C2C_TAXI_LOCK_MODES } from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import { asC2C, asRecord, c2cRange, type LegacyC2CPanelProps } from './legacyC2CPanelProps'

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyC2c.taxi.lockTitle',
    fields: [
      {
        key: 'taxiLockMode',
        labelKey: 'legacyC2c.field.taxiLockMode',
        kind: 'enum',
        fallback: 'no_limit',
        options: C2C_TAXI_LOCK_MODES.map((v) => ({
          value: v,
          labelKey: `legacyC2c.opt.lock.${v}`,
          descKey: `legacyC2c.opt.lock.${v}.desc`,
        })),
      },
      {
        key: 'taxiLockDeadline',
        labelKey: 'legacyC2c.field.taxiLockDeadline',
        kind: 'datetime',
        helpKey: 'legacyC2c.help.taxiLockDeadline',
      },
    ],
  },
  {
    titleKey: 'legacyC2c.taxi.rulesTitle',
    fields: [
      { key: 'taxiRookieOnly', labelKey: 'legacyC2c.field.taxiRookieOnly', kind: 'bool', fallback: true },
      {
        key: 'taxiMaxExperienceYears',
        labelKey: 'legacyC2c.field.taxiMaxExperienceYears',
        kind: 'int',
        ...c2cRange('taxiMaxExperienceYears'),
        recordedOnly: true,
      },
      { key: 'taxiPointsVisible', labelKey: 'legacyC2c.field.taxiPointsVisible', kind: 'bool', fallback: true, recordedOnly: true },
    ],
  },
]

export function C2CTaxiPanel({ config, leagueId, canEdit = false, onSaved }: LegacyC2CPanelProps) {
  const { t } = useOptionalLanguage()
  return (
    <LegacySettingsEditor
      testId="c2c-taxi-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={asRecord(config)}
      saveUrl="/api/c2c/settings"
      responseKey="c2c"
      sections={SECTIONS}
      onSaved={onSaved ? (r) => onSaved(asC2C(r)) : undefined}
      intro={<p className="text-[12px] text-white/55">{t('legacyC2c.taxi.intro')}</p>}
    />
  )
}
