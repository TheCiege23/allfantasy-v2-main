'use client'

import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { DEVY_GRAD_BEHAVIORS } from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import type { LegacyDevyPanelProps } from './legacyDevyPanelProps'

const SECTIONS: LegacySectionDef[] = [
  {
    titleKey: 'legacyDevy.rules.title',
    fields: [
      { key: 'devyFreshmenEligible', labelKey: 'legacyDevy.field.devyFreshmenEligible', kind: 'bool', recordedOnly: true },
      { key: 'devyDeclarationVisibility', labelKey: 'legacyDevy.field.devyDeclarationVisibility', kind: 'bool', fallback: true, recordedOnly: true },
      { key: 'devyAutoPromoteToRookie', labelKey: 'legacyDevy.field.devyAutoPromoteToRookie', kind: 'bool', fallback: true, recordedOnly: true },
      {
        key: 'devyGradBehavior',
        labelKey: 'legacyDevy.field.devyGradBehavior',
        kind: 'enum',
        options: DEVY_GRAD_BEHAVIORS.map((v) => ({
          value: v,
          labelKey: `legacyDevy.opt.grad.${v}`,
          descKey: `legacyDevy.opt.grad.${v}.desc`,
        })),
      },
    ],
  },
]

export function DevyRulesPanel({ config, leagueId, canEdit = false, onSaved }: LegacyDevyPanelProps) {
  return (
    <LegacySettingsEditor
      testId="devy-rules-panel"
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
