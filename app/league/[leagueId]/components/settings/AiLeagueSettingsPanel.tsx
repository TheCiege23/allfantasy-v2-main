'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import { SettingsPanelHeading, SettingsSectionLabel, SettingsToggleRow } from './settings-ui'
import { PremiumGate } from '@/components/subscription/PremiumGate'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useSubscriptionGateOptional } from '@/hooks/useSubscriptionGate'
import { AiOpponentsCommissionerSection } from '@/components/league-settings/AiOpponentsCommissionerSection'
import { LeagueFeedCommissionerSection } from '@/components/league-settings/LeagueFeedCommissionerSection'

export function AiLeagueSettingsPanel({
  leagueId,
  settingsSnapshot,
  initialData,
  canEdit,
  debouncedSave,
  save,
  hasAfCommissionerSub,
}: {
  leagueId: string
  settingsSnapshot: Record<string, unknown>
  initialData: CommissionerSettingsFormData
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
  save: (partial: Record<string, unknown>) => Promise<void>
  hasAfCommissionerSub: boolean
}) {
  const disabled = !canEdit
  const { hasCommissioner } = useEntitlements()
  const hasCommAccess = hasCommissioner || hasAfCommissionerSub
  const subscriptionGate = useSubscriptionGateOptional()

  const [chimmy, setChimmy] = useState(Boolean(initialData.aiChimmyEnabled))
  const [waiver, setWaiver] = useState(Boolean(initialData.aiWaiverSuggestions))
  const [trade, setTrade] = useState(Boolean(initialData.aiTradeAnalysis))
  const [lineup, setLineup] = useState(Boolean(initialData.aiLineupHelp))
  const [draft, setDraft] = useState(Boolean(initialData.aiDraftRecs))
  const [recaps, setRecaps] = useState(Boolean(initialData.aiRecaps))
  const [commAlerts, setCommAlerts] = useState(Boolean(initialData.leagueAiCommissionerAlerts))
  const [mod, setMod] = useState(Boolean(initialData.aiModeration))
  const [pr, setPr] = useState(Boolean(initialData.aiPowerRankings))

  useEffect(() => {
    setChimmy(Boolean(initialData.aiChimmyEnabled))
    setWaiver(Boolean(initialData.aiWaiverSuggestions))
    setTrade(Boolean(initialData.aiTradeAnalysis))
    setLineup(Boolean(initialData.aiLineupHelp))
    setDraft(Boolean(initialData.aiDraftRecs))
    setRecaps(Boolean(initialData.aiRecaps))
    setCommAlerts(Boolean(initialData.leagueAiCommissionerAlerts))
    setMod(Boolean(initialData.aiModeration))
    setPr(Boolean(initialData.aiPowerRankings))
  }, [initialData])

  return (
    <div className="min-h-0 flex-1 space-y-6 px-6 py-6 text-[13px] text-white/85" data-testid="settings-ai-panel">
      <SettingsPanelHeading
        title="Decision OS"
        subtitle="League-wide intelligence controls. Deterministic engines still enforce rules; recommendations stay explainable."
      />

      {!hasCommAccess ? (
        <PremiumGate featureId="commissioner_ai_tools" hasAccess={hasCommAccess} mode="overlay">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-100">
            <span>AF Commissioner or AF Supreme unlocks Commissioner Intelligence controls.</span>
            <SubscriptionGateBadge
              featureId="commissioner_ai_tools"
              onClick={() => subscriptionGate?.gate('commissioner_ai_tools', { highlightParam: 'ai_tools' })}
            />
          </div>
        </PremiumGate>
      ) : null}

      <AiOpponentsCommissionerSection leagueId={leagueId} canEdit={canEdit} />

      <LeagueFeedCommissionerSection settingsSnapshot={settingsSnapshot} canEdit={canEdit} debouncedSave={debouncedSave} />

      <div>
        <SettingsSectionLabel>Core</SettingsSectionLabel>
        <div className="space-y-2">
          <SettingsToggleRow
            label="League helper"
            checked={chimmy}
            disabled={disabled}
            onChange={(v) => {
              setChimmy(v)
              void save({ aiChimmyEnabled: v })
            }}
          />
          <SettingsToggleRow
            label="Waiver watchlist"
            checked={waiver}
            disabled={disabled}
            onChange={(v) => {
              setWaiver(v)
              void save({ aiWaiverSuggestions: v })
            }}
          />
          <SettingsToggleRow
            label="Trade health"
            checked={trade}
            disabled={disabled}
            onChange={(v) => {
              setTrade(v)
              void save({ aiTradeAnalysis: v })
            }}
          />
          <SettingsToggleRow
            label="Manager engagement"
            checked={lineup}
            disabled={disabled}
            onChange={(v) => {
              setLineup(v)
              void save({ aiLineupHelp: v })
            }}
          />
          <SettingsToggleRow
            label="Draft readiness"
            checked={draft}
            disabled={disabled}
            onChange={(v) => {
              setDraft(v)
              void save({ aiDraftRecs: v })
            }}
          />
          <SettingsToggleRow
            label="Weekly League Report"
            checked={recaps}
            disabled={disabled}
            onChange={(v) => {
              setRecaps(v)
              void save({ aiRecaps: v })
            }}
          />
        </div>
      </div>

      <div>
        <SettingsSectionLabel>Commissioner & league ops</SettingsSectionLabel>
        <div className="space-y-2">
          <SettingsToggleRow
            label="Commissioner Intelligence alerts"
            checked={commAlerts}
            disabled={disabled}
            onChange={(v) => {
              setCommAlerts(v)
              void save({ leagueAiCommissionerAlerts: v })
            }}
          />
          <SettingsToggleRow
            label="Fair Play Monitoring"
            checked={mod}
            disabled={disabled}
            onChange={(v) => {
              setMod(v)
              void save({ aiModeration: v })
            }}
          />
          <SettingsToggleRow
            label="League health rankings"
            checked={pr}
            disabled={disabled}
            onChange={(v) => {
              setPr(v)
              void save({ aiPowerRankings: v })
            }}
          />
        </div>
      </div>
    </div>
  )
}
