import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CommissionerDepthLocked } from '@/components/commissioner-os/shell/CommissionerDepthLocked'
import { FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { resolveCommissionerOsDepth } from '@/lib/commissioner-ui/commissionerOsDepth'
import { RecommendationsView } from '@/components/commissioner-os/recommendations/RecommendationsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function RecommendationsPage() {
  const depth = await resolveCommissionerOsDepth()
  if (!depth.unlocked) return <CommissionerDepthLocked access={depth} what="Recommendations" />

  const adapter = await getDecisionOSAdapter()
  const response = await adapter.recommendations.getQueue()

  return (
    <CommissionerPageContainer>
      <FreeUntilNote access={depth} />
      <RecommendationsView recommendations={response.data ?? []} dataMode={adapter.mode} />
    </CommissionerPageContainer>
  )
}
