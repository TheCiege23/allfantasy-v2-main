import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CommissionerDepthLocked } from '@/components/commissioner-os/shell/CommissionerDepthLocked'
import { CommissionerFreeUntilNote } from '@/components/commissioner-os/shell/CommissionerFreeUntilNote'
import { resolveCommissionerOsDepth } from '@/lib/commissioner-ui/commissionerOsDepth'
import { RecommendationsView } from '@/components/commissioner-os/recommendations/RecommendationsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'
import { resolveActiveLeagueId } from '@/lib/commissioner-ui/resolveActiveLeagueId'
import { CommissionerChimmy } from '@/components/core-app/commissioner/CommissionerChimmy'

export default async function RecommendationsPage() {
  const depth = await resolveCommissionerOsDepth()
  if (!depth.unlocked) return <CommissionerDepthLocked access={depth} what="Recommendations" />

  const adapter = await getDecisionOSAdapter()
  const response = await adapter.recommendations.getQueue()
  const leagueId = await resolveActiveLeagueId()

  return (
    <CommissionerPageContainer>
      <CommissionerFreeUntilNote access={depth} />
      <RecommendationsView recommendations={response.data ?? []} dataMode={adapter.mode} />
      {leagueId && <CommissionerChimmy leagueId={leagueId} />}
    </CommissionerPageContainer>
  )
}
