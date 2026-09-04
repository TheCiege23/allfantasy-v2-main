import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { RecommendationsView } from '@/components/commissioner-os/recommendations/RecommendationsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function RecommendationsPage() {
  const adapter = await getDecisionOSAdapter()
  const response = await adapter.recommendations.getQueue()

  return (
    <CommissionerPageContainer>
      <RecommendationsView recommendations={response.data ?? []} dataMode={adapter.mode} />
    </CommissionerPageContainer>
  )
}
