import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CommissionerDepthLocked } from '@/components/commissioner-os/shell/CommissionerDepthLocked'
import { FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { resolveCommissionerOsDepth } from '@/lib/commissioner-ui/commissionerOsDepth'
import { ManagerIntelligenceView } from '@/components/commissioner-os/managers/ManagerIntelligenceView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function ManagerIntelligencePage() {
  const depth = await resolveCommissionerOsDepth()
  if (!depth.unlocked) return <CommissionerDepthLocked access={depth} what="Manager intelligence" />

  const adapter = await getDecisionOSAdapter()
  const response = await adapter.managers.getManagerDirectory()

  return (
    <CommissionerPageContainer>
      <FreeUntilNote access={depth} />
      <ManagerIntelligenceView managers={response.data ?? []} dataMode={adapter.mode} />
    </CommissionerPageContainer>
  )
}
