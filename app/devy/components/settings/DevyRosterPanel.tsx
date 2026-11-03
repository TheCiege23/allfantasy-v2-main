'use client'

import { LegacySettingsEditor, type LegacyFieldDef, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { devyRange, type LegacyDevyPanelProps } from './legacyDevyPanelProps'

const int = (key: string, extra: Partial<LegacyFieldDef> = {}): LegacyFieldDef => ({
  key,
  labelKey: `legacyDevy.field.${key}`,
  kind: 'int',
  ...devyRange(key),
  ...extra,
})

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyDevy.roster.title',
    noteKey: 'legacySettings.slotsNote',
    fields: [
      int('activeRosterSize', { helpKey: 'legacyDevy.help.activeRosterSize' }),
      int('benchSlots'),
      int('irSlots'),
      int('taxiSlots', { helpKey: 'legacyDevy.help.taxiSlots' }),
      int('devySlots', { recordedOnly: true }),
      int('maxDevyPerTeam', { recordedOnly: true }),
    ],
  },
]

export function DevyRosterPanel({ config, leagueId, canEdit = false, onSaved }: LegacyDevyPanelProps) {
  return (
    <LegacySettingsEditor
      testId="devy-roster-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={config}
      saveUrl="/api/devy"
      responseKey="config"
      sections={SECTIONS}
      onSaved={onSaved}
    />
  )
}
