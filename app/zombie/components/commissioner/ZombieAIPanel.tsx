'use client'

import { SettingsSection, SettingsRow } from '@/app/league/[leagueId]/tabs/settings/components'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { useSubscriptionGateOptional } from '@/hooks/useSubscriptionGate'

export function ZombieAIPanel({ hasAfSub }: { hasAfSub: boolean }) {
  const subscriptionGate = useSubscriptionGateOptional()
  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-amber-200/80">
          {hasAfSub ? 'AF Commissioner is active — Chimmy host automations are available.' : 'Chimmy host automations require AF Commissioner.'}
        </p>
        {!hasAfSub ? (
          <SubscriptionGateBadge
            featureId="commissioner_ai_tools"
            onClick={() => subscriptionGate?.gate('commissioner_ai_tools')}
          />
        ) : null}
      </div>
      <SettingsSection id="zm-ai" title="Chimmy host">
        <SettingsRow label="Auto weekly recap" control={<span className="text-white/40">Coming soon</span>} />
        <SettingsRow label="Event commentary" control={<span className="text-white/40">Coming soon</span>} />
      </SettingsSection>
    </div>
  )
}
