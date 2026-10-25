'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import { SettingsSection, SettingsRow, Toggle } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { useSubscriptionGateOptional } from '@/hooks/useSubscriptionGate'

export function SurvivorAIHostPanel({
  canEdit,
  hasAfCommissionerSub,
  initialData,
  debouncedSave,
}: SurvivorSettingsPanelProps & {
  initialData: CommissionerSettingsFormData
  debouncedSave: (partial: Record<string, unknown>, delayMs?: number) => void
}) {
  const [hostOn, setHostOn] = useState(Boolean(initialData.aiChimmyEnabled))
  const [recaps, setRecaps] = useState(Boolean(initialData.aiRecaps))
  const [alerts, setAlerts] = useState(Boolean(initialData.leagueAiCommissionerAlerts))
  const subscriptionGate = useSubscriptionGateOptional()

  useEffect(() => {
    setHostOn(Boolean(initialData.aiChimmyEnabled))
    setRecaps(Boolean(initialData.aiRecaps))
    setAlerts(Boolean(initialData.leagueAiCommissionerAlerts))
  }, [initialData])

  return <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
    <p className="text-[11px] text-amber-200/80">These controls save to league settings. Private vote handling and official ceremony results remain system-run regardless of AI narration preferences.</p>
    <SettingsSection id="sv-ai-host" title="Chimmy">
      <SettingsRow label="AI host enabled" control={<Toggle checked={hostOn} disabled={!canEdit} onChange={(value) => { setHostOn(value); debouncedSave({ aiChimmyEnabled: value }) }} />} />
      <SettingsRow label="Episode recaps" control={<div className="flex items-center gap-2"><Toggle checked={recaps} disabled={!canEdit} onChange={(value) => { if (!hasAfCommissionerSub) { subscriptionGate?.gate('commissioner_ai_recap', { highlightParam: 'ai_recap' }); return } setRecaps(value); debouncedSave({ aiRecaps: value }) }} />{!hasAfCommissionerSub && <SubscriptionGateBadge featureId="commissioner_ai_recap" onClick={() => subscriptionGate?.gate('commissioner_ai_recap', { highlightParam: 'ai_recap' })} />}</div>} />
      <SettingsRow label="Commissioner AI alerts" control={<Toggle checked={alerts} disabled={!canEdit} onChange={(value) => { setAlerts(value); debouncedSave({ leagueAiCommissionerAlerts: value }) }} />} />
    </SettingsSection>
    <p className="text-xs text-white/50">Automated announcement approvals, custom story arcs and confessionals are not configurable yet.</p>
  </div>
}
