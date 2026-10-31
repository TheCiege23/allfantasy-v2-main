'use client'

import { LegacySettingsEditor, type LegacyFieldDef, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { asC2C, asRecord, c2cRange, type LegacyC2CPanelProps } from './legacyC2CPanelProps'

const int = (key: string, extra: Partial<LegacyFieldDef> = {}): LegacyFieldDef => ({
  key,
  labelKey: `legacyC2c.field.${key}`,
  kind: 'int',
  ...c2cRange(key),
  ...extra,
})

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyC2c.rosters.title',
    noteKey: 'legacySettings.slotsNote',
    fields: [
      int('campusStarterSlots', { helpKey: 'legacyC2c.help.starterSlots' }),
      int('cantonStarterSlots', { helpKey: 'legacyC2c.help.starterSlots' }),
      int('benchSlots'),
      int('taxiSlots'),
      int('devySlots', { helpKey: 'legacyC2c.help.devySlots' }),
      int('irSlots'),
    ],
  },
]

export function C2CRostersPanel({ config, leagueId, canEdit = false, onSaved }: LegacyC2CPanelProps) {
  return (
    <LegacySettingsEditor
      testId="c2c-rosters-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={asRecord(config)}
      saveUrl="/api/c2c/settings"
      responseKey="c2c"
      sections={SECTIONS}
      onSaved={onSaved ? (r) => onSaved(asC2C(r)) : undefined}
    />
  )
}
